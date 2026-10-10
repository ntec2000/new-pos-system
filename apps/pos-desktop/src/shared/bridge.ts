import type { PrinterSettings } from './types';
import type { RepoMethod } from './repo';

/** API exposed by the preload script to the renderer (window.pos). */
export interface PosBridge {
  call: (method: RepoMethod, ...args: unknown[]) => Promise<unknown>;
  print: (payload: { settings: PrinterSettings; lines: string[]; escpos: Uint8Array }) => Promise<{ ok: boolean }>;
  listPrinters: () => Promise<string[]>;
  sendRaw: (payload: { host: string; port: number; bytes: Uint8Array }) => Promise<{ ok: boolean }>;
  info: () => Promise<{ version: string; dataDir: string }>;
}
