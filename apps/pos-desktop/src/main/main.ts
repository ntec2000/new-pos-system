import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { join } from 'node:path';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { connect } from 'node:net';
import initSqlJs from 'sql.js';
import { Repo, REPO_METHODS, RepoMethod } from '../shared/repo';
import type { PrinterSettings } from '../shared/types';

let repo: Repo | null = null;
let mainWindow: BrowserWindow | null = null;

function dataDir(): string {
  const dir = join(app.getPath('userData'), 'data');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

async function openDatabase(): Promise<Repo> {
  const wasmBinary = readFileSync(join(__dirname, 'sql-wasm.wasm'));
  const SQL = await initSqlJs({ wasmBinary: wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength) as ArrayBuffer });
  const file = join(dataDir(), 'newpos.sqlite');
  const db = existsSync(file) ? new SQL.Database(readFileSync(file)) : new SQL.Database();
  // Atomic save: write a temp file, keep the previous file as .bak, then rename.
  const persist = () => {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, Buffer.from(db.export()));
    if (existsSync(file)) copyFileSync(file, `${file}.bak`);
    renameSync(tmp, file);
  };
  const r = new Repo(db, persist);
  await r.init();
  persist();
  return r;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: 'New POS System',
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
}

// ---- printing ----
function sendRaw(host: string, port: number, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('PRINTER_TIMEOUT')); }, 5000);
    socket.on('connect', () => { socket.end(Buffer.from(bytes)); });
    socket.on('close', () => { clearTimeout(timer); resolve(); });
    socket.on('error', e => { clearTimeout(timer); reject(e); });
  });
}

function escapeHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function printWindows(lines: string[], deviceName: string): Promise<void> {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  const html = `<html><head><meta charset="utf-8"><style>@page{margin:0}body{margin:0;padding:4mm;font:11px Consolas,'Courier New',monospace}pre{margin:0;white-space:pre}</style></head><body><pre>${escapeHtml(lines.join('\n'))}</pre></body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise<void>((resolve, reject) => {
    win.webContents.print({ silent: true, printBackground: false, ...(deviceName ? { deviceName } : {}) }, (ok, reason) => {
      win.close();
      if (ok) resolve(); else reject(new Error(reason || 'PRINT_FAILED'));
    });
  });
}

function registerIpc(): void {
  ipcMain.handle('repo:call', async (_e, method: string, args: unknown[]) => {
    if (!repo) throw new Error('DB_NOT_READY');
    if (!(REPO_METHODS as readonly string[]).includes(method)) throw new Error(`METHOD_NOT_ALLOWED:${method}`);
    const fn = (repo as unknown as Record<RepoMethod, (...a: unknown[]) => unknown>)[method as RepoMethod];
    return await fn.apply(repo, args);
  });
  ipcMain.handle('printer:print', async (_e, p: { settings: PrinterSettings; lines: string[]; escpos: Uint8Array }) => {
    if (p.settings.mode === 'tcp') await sendRaw(p.settings.host, p.settings.port, p.escpos);
    else if (p.settings.mode === 'windows') await printWindows(p.lines, p.settings.deviceName);
    return { ok: true };
  });
  ipcMain.handle('printer:list', async () => {
    if (!mainWindow) return [];
    const list = await mainWindow.webContents.getPrintersAsync();
    return list.map(p => p.name);
  });
  ipcMain.handle('printer:raw', async (_e, p: { host: string; port: number; bytes: Uint8Array }) => {
    await sendRaw(p.host, p.port, p.bytes);
    return { ok: true };
  });
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), dataDir: dataDir() }));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });

void app.whenReady().then(async () => {
  try {
    repo = await openDatabase();
  } catch (e) {
    dialog.showErrorBox('New POS System', `Database could not be opened: ${(e as Error).message}`);
    app.quit();
    return;
  }
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
