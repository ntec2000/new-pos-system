import type { SaleSnapshot } from '@new-pos/core';
import type { PosBridge } from '../shared/bridge';
import type { RepoMethod } from '../shared/repo';
import type {
  BottleLink, DayReport, ImportResult, ItemRecord, Operator, PrinterSettings, SavedSale, SellableItem, StoreSettings,
  Subdepartment, TransactionSummary,
} from '../shared/types';

let bridgePromise: Promise<PosBridge> | null = null;

/** Electron: window.pos from the preload script. Browser demo: an in-browser database (sql.js + localStorage). */
function bridge(): Promise<PosBridge> {
  if (!bridgePromise) {
    if (window.pos) bridgePromise = Promise.resolve(window.pos);
    else if (__WEB_DEMO__) bridgePromise = import('./webDemo').then(m => m.createWebBridge());
    else bridgePromise = Promise.reject(new Error('POS bridge unavailable'));
  }
  return bridgePromise;
}

async function call<T>(method: RepoMethod, ...args: unknown[]): Promise<T> {
  return (await bridge()).call(method, ...args) as Promise<T>;
}

export const api = {
  getSettings: () => call<StoreSettings>('getSettings'),
  saveSettings: (s: StoreSettings) => call<void>('saveSettings', s),
  login: (number: string, pin: string) => call<Operator | null>('login', number, pin),
  listOperators: () => call<Operator[]>('listOperators'),
  saveOperator: (op: { id?: string; number: string; name: string; level: number; active: boolean; pin?: string }, by: string) => call<void>('saveOperator', op, by),
  listSubdepartments: () => call<Subdepartment[]>('listSubdepartments'),
  saveSubdepartment: (d: Subdepartment, by: string) => call<void>('saveSubdepartment', d, by),
  listBottleLinks: () => call<BottleLink[]>('listBottleLinks'),
  saveBottleLink: (b: BottleLink, by: string) => call<void>('saveBottleLink', b, by),
  getItemByUpc: (upc: string) => call<ItemRecord | null>('getItemByUpc', upc),
  searchItems: (text: string, limit?: number) => call<ItemRecord[]>('searchItems', text, limit ?? 50),
  sellable: (upc: string, date: string) => call<SellableItem | null>('sellable', upc, date),
  saveItem: (item: ItemRecord, by: string) => call<void>('saveItem', item, by),
  importItems: (rows: Record<string, string | number>[], mode: 1 | 2 | 3 | 20, by: string) => call<ImportResult>('importItems', rows, mode, by),
  saveTransaction: (snap: SaleSnapshot, operatorId: string) => call<number>('saveTransaction', snap, operatorId),
  getTransaction: (n: number) => call<SavedSale | null>('getTransaction', n),
  listTransactions: (date: string) => call<TransactionSummary[]>('listTransactions', date),
  dayReport: (date: string) => call<DayReport>('dayReport', date),
  audit: (operatorId: string | null, action: string, detail: string | null) => call<void>('audit', operatorId, action, detail),
  listAudit: (limit?: number) => call<{ at: string; operator: string; action: string; detail: string }[]>('listAudit', limit ?? 200),
  print: async (settings: PrinterSettings, lines: string[], escpos: Uint8Array) => (await bridge()).print({ settings, lines, escpos }),
  listPrinters: async () => (await bridge()).listPrinters(),
  sendRaw: async (host: string, port: number, bytes: Uint8Array) => (await bridge()).sendRaw({ host, port, bytes }),
  info: async () => (await bridge()).info(),
};

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function nowText(): string {
  const d = new Date();
  return `${today()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "1234" typed on the keypad -> 1234 cents ($12.34); "12.34" -> 1234. */
export function parseAmount(buffer: string): number | null {
  const t = buffer.trim();
  if (t === '') return null;
  if (t.includes('.')) {
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
    const [w, f = ''] = t.split('.');
    return Number(w) * 100 + Number(f.padEnd(2, '0'));
  }
  if (!/^\d+$/.test(t)) return null;
  return Number(t);
}

export function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
