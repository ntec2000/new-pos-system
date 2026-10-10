import initSqlJs from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { Repo, REPO_METHODS, RepoMethod } from '../shared/repo';
import type { PosBridge } from '../shared/bridge';

const KEY = 'newpos-web-demo-db';

function toB64(u8: Uint8Array): string { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); }
function fromB64(s: string): Uint8Array { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

/** Browser-only demo bridge used for UI development and automated UI checks (no printer, no files). */
export async function createWebBridge(): Promise<PosBridge> {
  const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
  const saved = localStorage.getItem(KEY);
  const db = saved ? new SQL.Database(fromB64(saved)) : new SQL.Database();
  const repo = new Repo(db, () => localStorage.setItem(KEY, toB64(db.export())));
  await repo.init();
  return {
    call: async (method, ...args) => {
      if (!(REPO_METHODS as readonly string[]).includes(method)) throw new Error(`METHOD_NOT_ALLOWED:${method}`);
      const fn = (repo as unknown as Record<RepoMethod, (...a: unknown[]) => unknown>)[method];
      return await fn.apply(repo, args);
    },
    print: async () => ({ ok: true }),
    listPrinters: async () => [],
    sendRaw: async () => { throw new Error('Network printing is only available in the desktop app'); },
    info: async () => ({ version: 'web-demo', dataDir: 'browser localStorage' }),
  };
}
