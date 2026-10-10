import type { Database, SqlValue } from 'sql.js';
import type { SaleSnapshot } from '@new-pos/core';
import { hashPin, verifyPin, uuid } from './crypto';
import type {
  BottleLink, DayReport, ImportResult, ItemRecord, Operator, SavedSale, SellableItem, StoreSettings,
  Subdepartment, TransactionSummary,
} from './types';

/**
 * Local lane database (SQLite through sql.js). Amounts are integer cents.
 * Every mutating method calls `persist()` so the file on disk always matches the last committed state.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS operators (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, name TEXT NOT NULL, pin_hash TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS subdepartments (
  id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, name TEXT NOT NULL, tax_category TEXT NOT NULL,
  age_restriction INTEGER, show_on_screen INTEGER NOT NULL DEFAULT 1, color TEXT NOT NULL DEFAULT '#3b6ea8');
CREATE TABLE IF NOT EXISTS bottle_links (
  id TEXT PRIMARY KEY, code INTEGER NOT NULL UNIQUE, description TEXT NOT NULL,
  deposit_cents INTEGER NOT NULL DEFAULT 0, env_fee_cents INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY, upc TEXT NOT NULL UNIQUE, description TEXT NOT NULL, description_alt TEXT NOT NULL DEFAULT '',
  subdepartment_id TEXT NOT NULL REFERENCES subdepartments(id), tax_category TEXT NOT NULL,
  price_cents INTEGER NOT NULL, sale_price_cents INTEGER, sale_from TEXT, sale_to TEXT, cost_cents INTEGER,
  bottle_link_id TEXT REFERENCES bottle_links(id), age_restriction INTEGER,
  active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, business_date TEXT NOT NULL, completed_at TEXT NOT NULL,
  operator_id TEXT NOT NULL, kind TEXT NOT NULL, subtotal_cents INTEGER NOT NULL, tax_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL, rounding_cents INTEGER NOT NULL DEFAULT 0, change_cents INTEGER NOT NULL DEFAULT 0,
  snapshot_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS transaction_lines (
  id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL REFERENCES transactions(id), line_no INTEGER NOT NULL,
  kind TEXT NOT NULL, upc TEXT, description TEXT NOT NULL, qty REAL NOT NULL, unit_price_cents INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL, tax_category TEXT NOT NULL, voided INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS transaction_taxes (
  transaction_id TEXT NOT NULL REFERENCES transactions(id), tax_code TEXT NOT NULL,
  base_cents INTEGER NOT NULL, tax_cents INTEGER NOT NULL, PRIMARY KEY (transaction_id, tax_code));
CREATE TABLE IF NOT EXISTS tenders (
  id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL REFERENCES transactions(id), kind TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, reference TEXT);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY, at TEXT NOT NULL, operator_id TEXT, action TEXT NOT NULL, detail TEXT);
CREATE INDEX IF NOT EXISTS ix_tx_date ON transactions(business_date);
`;

export const DEFAULT_SETTINGS: StoreSettings = {
  storeName: 'NEW POS DEMO STORE',
  headerLines: ['123 Main Street', 'Regina, SK', 'GST/HST #: (set in Settings)'],
  trailerLines: ['Thank you!'],
  jurisdiction: 'CA-SK',
  terminal: '01',
  language: 'en',
  printer: { mode: 'preview', deviceName: '', host: '192.168.1.100', port: 9100, width: 42, openDrawer: true },
};

type Row = Record<string, SqlValue>;
const n = (v: SqlValue | undefined): number => (v === null || v === undefined ? 0 : Number(v));
const s = (v: SqlValue | undefined): string => (v === null || v === undefined ? '' : String(v));
const nn = (v: SqlValue | undefined): number | null => (v === null || v === undefined ? null : Number(v));

export class Repo {
  constructor(private db: Database, private persist: () => void = () => {}) {}

  // ---------- low level ----------
  private all(sql: string, params: SqlValue[] = []): Row[] {
    const st = this.db.prepare(sql);
    try {
      st.bind(params);
      const rows: Row[] = [];
      while (st.step()) rows.push(st.getAsObject() as Row);
      return rows;
    } finally { st.free(); }
  }
  private one(sql: string, params: SqlValue[] = []): Row | undefined { return this.all(sql, params)[0]; }
  private run(sql: string, params: SqlValue[] = []): void { this.db.run(sql, params); }
  private tx<T>(fn: () => T): T {
    this.db.run('BEGIN');
    try { const r = fn(); this.db.run('COMMIT'); this.persist(); return r; }
    catch (e) { this.db.run('ROLLBACK'); throw e; }
  }

  // ---------- setup ----------
  async init(): Promise<void> {
    this.db.exec(SCHEMA);
    const seeded = this.one("SELECT value FROM meta WHERE key='seeded'");
    if (!seeded) await this.seed();
  }

  private async seed(): Promise<void> {
    const owner = await hashPin('1234');
    const cashier = await hashPin('1111');
    const now = new Date().toISOString();
    this.tx(() => {
      this.run("INSERT INTO meta VALUES ('settings', ?)", [JSON.stringify(DEFAULT_SETTINGS)]);
      this.run("INSERT INTO meta VALUES ('next_tx', '1')");
      this.run('INSERT INTO operators VALUES (?,?,?,?,?,1)', [uuid(), '6', 'Owner', owner, 9]);
      this.run('INSERT INTO operators VALUES (?,?,?,?,?,1)', [uuid(), '1', 'Cashier 1', cashier, 1]);
      const subs: [number, string, string, number | null, string][] = [
        [1, 'GROCERY', 'BASIC_GROCERY', null, '#2e7d32'], [2, 'GROCERY TAXABLE', 'GENERAL', null, '#ef6c00'],
        [3, 'PRODUCE', 'BASIC_GROCERY', null, '#558b2f'], [4, 'MEAT', 'BASIC_GROCERY', null, '#6d4c41'],
        [5, 'DELI / HOT FOOD', 'PREPARED_FOOD', null, '#c62828'], [6, 'CONFECTIONERY', 'SNACK', null, '#f9a825'],
        [7, 'TOBACCO', 'TOBACCO', 19, '#5d4037'], [8, 'FUEL', 'FUEL', null, '#1565c0'],
      ];
      const ids = new Map<number, string>();
      for (const [num, name, cat, age, color] of subs) {
        const id = uuid(); ids.set(num, id);
        this.run('INSERT INTO subdepartments VALUES (?,?,?,?,?,1,?)', [id, num, name, cat, age, color]);
      }
      // SARCAN deposit schedule (brochure 2024). EHC amounts are NOT verified -> 0 until set by the store.
      const links: [number, string, number][] = [
        [1, 'Can / plastic / carton <=999mL', 10], [2, 'Can / plastic / carton 1L+', 25],
        [3, 'Glass <=300mL', 10], [4, 'Glass 301-999mL', 20], [5, 'Glass 1L+', 40], [6, 'Refillable beer 341mL', 5],
      ];
      const linkIds = new Map<number, string>();
      for (const [code, d, dep] of links) {
        const id = uuid(); linkIds.set(code, id);
        this.run('INSERT INTO bottle_links VALUES (?,?,?,?,0)', [id, code, d, dep]);
      }
      const items: [string, string, string, number, number, number | null][] = [
        ['000000000011', 'SAMPLE COLA 355ML CAN', '샘플 콜라 캔', 2, 149, 1],
        ['000000000012', 'SAMPLE WATER 1L', '샘플 생수 1L', 2, 199, 2],
        ['000000000013', 'SAMPLE MILK 2L', '샘플 우유 2L', 1, 489, null],
        ['000000000014', 'SAMPLE BREAD', '샘플 식빵', 1, 329, null],
        ['000000000015', 'SAMPLE CHIPS 200G', '샘플 감자칩', 6, 399, null],
        ['000000000016', 'SAMPLE CIGARETTES', '샘플 담배', 7, 1800, null],
        ['000000000017', 'SAMPLE KIMCHI 1KG', '샘플 김치 1kg', 1, 1299, null],
        ['000000000018', 'SAMPLE HOT DOG', '샘플 핫도그', 5, 299, null],
      ];
      for (const [upc, d, alt, sub, price, link] of items) {
        const subId = ids.get(sub)!;
        const cat = subs.find(x => x[0] === sub)![2];
        this.run(`INSERT INTO items (id, upc, description, description_alt, subdepartment_id, tax_category, price_cents,
          bottle_link_id, active, updated_at) VALUES (?,?,?,?,?,?,?,?,1,?)`,
          [uuid(), upc, d, alt, subId, cat, price, link ? linkIds.get(link)! : null, now]);
      }
      this.run("INSERT INTO meta VALUES ('seeded', ?)", [now]);
    });
  }

  // ---------- settings ----------
  getSettings(): StoreSettings {
    const r = this.one("SELECT value FROM meta WHERE key='settings'");
    const saved = r ? (JSON.parse(s(r.value)) as Partial<StoreSettings>) : {};
    return { ...DEFAULT_SETTINGS, ...saved, printer: { ...DEFAULT_SETTINGS.printer, ...(saved.printer ?? {}) } };
  }
  saveSettings(settings: StoreSettings): void {
    this.tx(() => this.run("INSERT INTO meta VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [JSON.stringify(settings)]));
  }

  // ---------- operators ----------
  async login(number: string, pin: string): Promise<Operator | null> {
    const r = this.one('SELECT * FROM operators WHERE number=? AND active=1', [number.trim()]);
    if (!r || !(await verifyPin(pin, s(r.pin_hash)))) { this.audit(null, 'LOGIN_FAILED', number); return null; }
    this.audit(s(r.id), 'LOGIN', null);
    return { id: s(r.id), number: s(r.number), name: s(r.name), level: n(r.level), active: true };
  }
  listOperators(): Operator[] {
    return this.all('SELECT * FROM operators ORDER BY number').map(r => ({ id: s(r.id), number: s(r.number), name: s(r.name), level: n(r.level), active: n(r.active) === 1 }));
  }
  async saveOperator(op: { id?: string; number: string; name: string; level: number; active: boolean; pin?: string }, by: string): Promise<void> {
    if (!/^\d{1,8}$/.test(op.number)) throw new Error('OPERATOR_NUMBER_INVALID');
    const pinHash = op.pin ? await hashPin(op.pin) : null;
    if (op.pin !== undefined && !/^\d{4,8}$/.test(op.pin)) throw new Error('PIN_INVALID');
    this.tx(() => {
      if (op.id) {
        this.run('UPDATE operators SET number=?, name=?, level=?, active=? WHERE id=?', [op.number, op.name, op.level, op.active ? 1 : 0, op.id]);
        if (pinHash) this.run('UPDATE operators SET pin_hash=? WHERE id=?', [pinHash, op.id]);
      } else {
        if (!pinHash) throw new Error('PIN_REQUIRED');
        this.run('INSERT INTO operators VALUES (?,?,?,?,?,?)', [uuid(), op.number, op.name, pinHash, op.level, op.active ? 1 : 0]);
      }
      this.auditNoTx(by, 'OPERATOR_SAVE', op.number);
    });
  }

  // ---------- master data ----------
  listSubdepartments(): Subdepartment[] {
    return this.all('SELECT * FROM subdepartments ORDER BY number').map(r => ({
      id: s(r.id), number: n(r.number), name: s(r.name), taxCategory: s(r.tax_category),
      ageRestriction: nn(r.age_restriction), showOnScreen: n(r.show_on_screen) === 1, color: s(r.color),
    }));
  }
  saveSubdepartment(d: Subdepartment, by: string): void {
    this.tx(() => {
      this.run(`INSERT INTO subdepartments VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET number=excluded.number,
        name=excluded.name, tax_category=excluded.tax_category, age_restriction=excluded.age_restriction,
        show_on_screen=excluded.show_on_screen, color=excluded.color`,
        [d.id || uuid(), d.number, d.name, d.taxCategory, d.ageRestriction, d.showOnScreen ? 1 : 0, d.color]);
      this.auditNoTx(by, 'SUBDEPT_SAVE', d.name);
    });
  }
  listBottleLinks(): BottleLink[] {
    return this.all('SELECT * FROM bottle_links ORDER BY code').map(r => ({ id: s(r.id), code: n(r.code), description: s(r.description), depositCents: n(r.deposit_cents), envFeeCents: n(r.env_fee_cents) }));
  }
  saveBottleLink(b: BottleLink, by: string): void {
    this.tx(() => {
      this.run(`INSERT INTO bottle_links VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code,
        description=excluded.description, deposit_cents=excluded.deposit_cents, env_fee_cents=excluded.env_fee_cents`,
        [b.id || uuid(), b.code, b.description, b.depositCents, b.envFeeCents]);
      this.auditNoTx(by, 'BOTTLE_LINK_SAVE', `${b.code}`);
    });
  }

  private toItem(r: Row): ItemRecord {
    return {
      id: s(r.id), upc: s(r.upc), description: s(r.description), descriptionAlt: s(r.description_alt),
      subdepartmentId: s(r.subdepartment_id), taxCategory: s(r.tax_category), priceCents: n(r.price_cents),
      salePriceCents: nn(r.sale_price_cents), saleFrom: r.sale_from === null ? null : s(r.sale_from), saleTo: r.sale_to === null ? null : s(r.sale_to),
      costCents: nn(r.cost_cents), bottleLinkId: r.bottle_link_id === null ? null : s(r.bottle_link_id),
      ageRestriction: nn(r.age_restriction), active: n(r.active) === 1,
    };
  }
  getItemByUpc(upc: string): ItemRecord | null {
    const r = this.one("SELECT * FROM items WHERE upc=? OR ltrim(upc,'0')=ltrim(?,'0') ORDER BY upc=? DESC LIMIT 1", [upc, upc, upc]);
    return r ? this.toItem(r) : null;
  }
  searchItems(text: string, limit = 50): ItemRecord[] {
    const q = `%${text.trim()}%`;
    return this.all('SELECT * FROM items WHERE upc LIKE ? OR description LIKE ? OR description_alt LIKE ? ORDER BY description LIMIT ?', [q, q, q, limit]).map(r => this.toItem(r));
  }
  /** Resolve the item for sale on `date` (effective sale price, deposit link, age rule from item or sub-department). */
  sellable(upc: string, date: string): SellableItem | null {
    const r = this.one(`SELECT i.*, d.age_restriction AS dept_age, b.deposit_cents, b.env_fee_cents
      FROM items i JOIN subdepartments d ON d.id=i.subdepartment_id LEFT JOIN bottle_links b ON b.id=i.bottle_link_id
      WHERE (i.upc=? OR ltrim(i.upc,'0')=ltrim(?,'0')) AND i.active=1 ORDER BY i.upc=? DESC LIMIT 1`, [upc, upc, upc]);
    if (!r) return null;
    const it = this.toItem(r);
    const onSale = it.salePriceCents !== null && (!it.saleFrom || it.saleFrom <= date) && (!it.saleTo || date <= it.saleTo);
    const age = it.ageRestriction ?? nn(r.dept_age);
    const out: SellableItem = { upc: it.upc, description: it.description, descriptionAlt: it.descriptionAlt,
      price: onSale ? (it.salePriceCents as number) : it.priceCents, onSale, taxCategory: it.taxCategory };
    if (age !== null) out.ageRestriction = age;
    if (it.bottleLinkId) out.bottleLink = { deposit: n(r.deposit_cents), envFee: n(r.env_fee_cents), depositTaxCategory: 'DEPOSIT' };
    return out;
  }
  saveItem(item: ItemRecord, by: string): void {
    if (!/^\d{1,14}$/.test(item.upc)) throw new Error('UPC_INVALID');
    if (!item.description.trim()) throw new Error('DESCRIPTION_REQUIRED');
    if (!Number.isInteger(item.priceCents) || item.priceCents < 0) throw new Error('PRICE_INVALID');
    if (item.salePriceCents !== null && item.saleFrom && item.saleTo && item.saleFrom > item.saleTo) throw new Error('SALE_DATES_INVALID');
    this.tx(() => {
      const existing = this.one('SELECT id, price_cents FROM items WHERE upc=?', [item.upc]);
      const id = item.id || (existing ? s(existing.id) : uuid());
      this.run(`INSERT INTO items (id, upc, description, description_alt, subdepartment_id, tax_category, price_cents,
        sale_price_cents, sale_from, sale_to, cost_cents, bottle_link_id, age_restriction, active, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET upc=excluded.upc, description=excluded.description,
        description_alt=excluded.description_alt, subdepartment_id=excluded.subdepartment_id, tax_category=excluded.tax_category,
        price_cents=excluded.price_cents, sale_price_cents=excluded.sale_price_cents, sale_from=excluded.sale_from,
        sale_to=excluded.sale_to, cost_cents=excluded.cost_cents, bottle_link_id=excluded.bottle_link_id,
        age_restriction=excluded.age_restriction, active=excluded.active, updated_at=excluded.updated_at`,
        [id, item.upc, item.description.trim(), item.descriptionAlt, item.subdepartmentId, item.taxCategory, item.priceCents,
          item.salePriceCents, item.saleFrom, item.saleTo, item.costCents, item.bottleLinkId, item.ageRestriction,
          item.active ? 1 : 0, new Date().toISOString()]);
      this.auditNoTx(by, 'ITEM_SAVE', `${item.upc} ${existing ? `price ${n(existing.price_cents)} -> ${item.priceCents}` : 'new'}`);
    });
  }

  /**
   * Apply imported rows. Supported fields: upc (required), description, price, salePrice, from, to, subdepartment (number).
   * mode: 1 insert/update, 2 only new, 3 only existing, 20 skip (L-BOSS import convention).
   */
  importItems(rows: Record<string, string | number>[], mode: 1 | 2 | 3 | 20, by: string): ImportResult {
    const result: ImportResult = { inserted: 0, updated: 0, skipped: 0, errors: [] };
    const subs = this.listSubdepartments();
    const fallback = subs[0];
    if (!fallback) throw new Error('NO_SUBDEPARTMENTS');
    this.tx(() => {
      rows.forEach((row, i) => {
        const upc = String(row.upc ?? '').trim();
        if (!/^\d{1,14}$/.test(upc)) { result.errors.push({ line: i + 1, message: `invalid UPC "${upc}"` }); return; }
        const existing = this.one('SELECT * FROM items WHERE upc=?', [upc]);
        if (mode === 20 || (mode === 2 && existing) || (mode === 3 && !existing)) { result.skipped++; return; }
        const sub = row.subdepartment !== undefined ? subs.find(d => d.number === Number(row.subdepartment)) : undefined;
        if (existing) {
          const sets: string[] = []; const params: SqlValue[] = [];
          if (row.description !== undefined) { sets.push('description=?'); params.push(String(row.description)); }
          if (row.price !== undefined) { sets.push('price_cents=?'); params.push(Number(row.price)); }
          if (row.salePrice !== undefined) { sets.push('sale_price_cents=?'); params.push(Number(row.salePrice)); }
          if (row.from !== undefined) { sets.push('sale_from=?'); params.push(String(row.from)); }
          if (row.to !== undefined) { sets.push('sale_to=?'); params.push(String(row.to)); }
          if (sub) { sets.push('subdepartment_id=?, tax_category=?'); params.push(sub.id, sub.taxCategory); }
          sets.push('updated_at=?'); params.push(new Date().toISOString());
          this.run(`UPDATE items SET ${sets.join(', ')} WHERE id=?`, [...params, s(existing.id)]);
          result.updated++;
        } else {
          if (row.description === undefined || row.price === undefined) { result.errors.push({ line: i + 1, message: 'new item needs description and price' }); return; }
          const d = sub ?? fallback;
          this.run(`INSERT INTO items (id, upc, description, subdepartment_id, tax_category, price_cents, sale_price_cents,
            sale_from, sale_to, active, updated_at) VALUES (?,?,?,?,?,?,?,?,?,1,?)`,
            [uuid(), upc, String(row.description), d.id, d.taxCategory, Number(row.price),
              row.salePrice !== undefined ? Number(row.salePrice) : null, row.from !== undefined ? String(row.from) : null,
              row.to !== undefined ? String(row.to) : null, new Date().toISOString()]);
          result.inserted++;
        }
      });
      this.auditNoTx(by, 'IMPORT', JSON.stringify({ inserted: result.inserted, updated: result.updated, skipped: result.skipped, errors: result.errors.length }));
    });
    return result;
  }

  // ---------- transactions ----------
  saveTransaction(snap: SaleSnapshot, operatorId: string): number {
    return this.tx(() => {
      const next = n(this.one("SELECT value FROM meta WHERE key='next_tx'")?.value) || 1;
      this.run("UPDATE meta SET value=? WHERE key='next_tx'", [String(next + 1)]);
      const id = uuid();
      const kind = snap.cancelled ? 'CANCELLED' : 'SALE';
      this.run('INSERT INTO transactions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [id, next, snap.businessDate, new Date().toISOString(), operatorId, kind,
        snap.subtotal, snap.taxes.total, snap.total, snap.rounding, snap.change, JSON.stringify(snap)]);
      snap.lines.forEach((l, i) => this.run('INSERT INTO transaction_lines VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [uuid(), id, i + 1, l.kind, l.upc ?? null, l.description, l.qty, l.unitPrice, l.amount, l.taxCategory, l.voided ? 1 : 0]));
      for (const [code, t] of Object.entries(snap.taxes.byTax)) this.run('INSERT INTO transaction_taxes VALUES (?,?,?,?)', [id, code, t.base, t.tax]);
      for (const t of snap.tenders) this.run('INSERT INTO tenders VALUES (?,?,?,?,?)', [uuid(), id, t.kind, t.amount, t.reference ?? null]);
      const voids = snap.lines.filter(l => l.voided && !l.parentId).length;
      if (voids > 0) this.auditNoTx(operatorId, 'ERROR_CORRECT', `tx ${next}: ${voids} line(s)`);
      return next;
    });
  }
  getTransaction(number: number): SavedSale | null {
    const r = this.one('SELECT t.*, o.name AS op_name FROM transactions t LEFT JOIN operators o ON o.id=t.operator_id WHERE t.number=?', [number]);
    if (!r) return null;
    return { number: n(r.number), snapshot: JSON.parse(s(r.snapshot_json)) as SaleSnapshot, operatorName: s(r.op_name), completedAt: s(r.completed_at) };
  }
  listTransactions(businessDate: string): TransactionSummary[] {
    return this.all(`SELECT t.number, t.business_date, t.completed_at, t.kind, t.total_cents, o.name AS op_name,
      (SELECT COALESCE(SUM(qty),0) FROM transaction_lines l WHERE l.transaction_id=t.id AND l.voided=0 AND l.kind IN ('ITEM','OPEN')) AS items
      FROM transactions t LEFT JOIN operators o ON o.id=t.operator_id WHERE t.business_date=? ORDER BY t.number DESC`, [businessDate])
      .map(r => ({ number: n(r.number), businessDate: s(r.business_date), completedAt: s(r.completed_at), operator: s(r.op_name), kind: s(r.kind), total: n(r.total_cents), itemCount: n(r.items) }));
  }
  dayReport(businessDate: string): DayReport {
    const t = this.one(`SELECT COUNT(*) AS c, COALESCE(SUM(subtotal_cents),0) AS sub, COALESCE(SUM(rounding_cents),0) AS rnd
      FROM transactions WHERE business_date=? AND kind='SALE'`, [businessDate]);
    const cancelled = this.one("SELECT COUNT(*) AS c FROM transactions WHERE business_date=? AND kind='CANCELLED'", [businessDate]);
    const taxes: Record<string, number> = {};
    for (const r of this.all(`SELECT x.tax_code, SUM(x.tax_cents) AS t FROM transaction_taxes x JOIN transactions t ON t.id=x.transaction_id
      WHERE t.business_date=? AND t.kind='SALE' GROUP BY x.tax_code`, [businessDate])) taxes[s(r.tax_code)] = n(r.t);
    const tenders: Record<string, number> = {};
    for (const r of this.all(`SELECT x.kind, SUM(amount_cents) AS a FROM tenders x JOIN transactions t ON t.id=x.transaction_id
      WHERE t.business_date=? AND t.kind='SALE' GROUP BY x.kind`, [businessDate])) tenders[s(r.kind)] = n(r.a);
    const lineSum = (kind: string) => n(this.one(`SELECT COALESCE(SUM(amount_cents),0) AS a FROM transaction_lines l JOIN transactions t ON t.id=l.transaction_id
      WHERE t.business_date=? AND t.kind='SALE' AND l.voided=0 AND l.kind=?`, [businessDate, kind])?.a);
    const auditCount = (action: string) => n(this.one('SELECT COUNT(*) AS c FROM audit_log WHERE action=? AND substr(at,1,10)=?', [action, businessDate])?.c);
    return {
      businessDate, transactions: n(t?.c), cancelled: n(cancelled?.c), grossSales: n(t?.sub), taxes,
      deposits: lineSum('DEPOSIT'), envFees: lineSum('ENV_FEE'), tenders, rounding: n(t?.rnd),
      noSales: auditCount('NO_SALE'), errorCorrects: auditCount('ERROR_CORRECT'),
    };
  }

  // ---------- audit ----------
  audit(operatorId: string | null, action: string, detail: string | null): void {
    this.run('INSERT INTO audit_log VALUES (?,?,?,?,?)', [uuid(), new Date().toISOString(), operatorId, action, detail]);
    this.persist();
  }
  private auditNoTx(operatorId: string | null, action: string, detail: string | null): void {
    this.run('INSERT INTO audit_log VALUES (?,?,?,?,?)', [uuid(), new Date().toISOString(), operatorId, action, detail]);
  }
  listAudit(limit = 200): { at: string; operator: string; action: string; detail: string }[] {
    return this.all('SELECT a.at, o.name AS op, a.action, a.detail FROM audit_log a LEFT JOIN operators o ON o.id=a.operator_id ORDER BY a.at DESC LIMIT ?', [limit])
      .map(r => ({ at: s(r.at), operator: s(r.op), action: s(r.action), detail: s(r.detail) }));
  }
}

/** Methods the renderer may call through IPC (allow-list). */
export const REPO_METHODS = [
  'getSettings', 'saveSettings', 'login', 'listOperators', 'saveOperator', 'listSubdepartments', 'saveSubdepartment',
  'listBottleLinks', 'saveBottleLink', 'getItemByUpc', 'searchItems', 'sellable', 'saveItem', 'importItems',
  'saveTransaction', 'getTransaction', 'listTransactions', 'dayReport', 'audit', 'listAudit',
] as const;
export type RepoMethod = (typeof REPO_METHODS)[number];
