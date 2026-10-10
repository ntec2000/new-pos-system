/**
 * Template-driven import for other vendors' files and weekly/monthly sale files.
 * Import modes follow the L-BOSS convention documented in the Programmer's guide (p.109):
 *   1 = insert or update, 2 = only if the item does not exist, 3 = only if it exists, 20 = skip.
 */
export type ImportMode = 1 | 2 | 3 | 20;

export interface FixedColumn { field: string; start: number; length: number; type: 'string' | 'cents' | 'int' | 'date_yyyymmdd' }
export interface CsvColumn { field: string; index: number; type: FixedColumn['type'] }

export type ImportTemplate =
  | { name: string; style: 'FIXED'; columns: FixedColumn[]; keyField: string; mode: ImportMode }
  | { name: string; style: 'CSV'; delimiter: string; hasHeader: boolean; columns: CsvColumn[]; keyField: string; mode: ImportMode };

export type Row = Record<string, string | number>;

function convert(raw: string, type: FixedColumn['type']): string | number {
  const v = raw.trim();
  switch (type) {
    case 'string': return v;
    case 'int': { const n = Number(v); if (!Number.isInteger(n)) throw new Error(`not an integer: "${v}"`); return n; }
    case 'cents': {
      if (!/^-?\d+(\.\d{1,2})?$/.test(v)) throw new Error(`not an amount: "${v}"`);
      const [whole, frac = ''] = v.replace('-', '').split('.');
      const c = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
      return v.startsWith('-') ? -c : c;
    }
    case 'date_yyyymmdd': {
      if (!/^\d{8}$/.test(v)) throw new Error(`not a yyyymmdd date: "${v}"`);
      return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
    }
  }
}

export interface ParseReport { rows: Row[]; errors: { line: number; message: string }[] }

/** Simple CSV splitter supporting double-quoted fields. */
function splitCsv(line: string, d: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === d) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseWithTemplate(text: string, t: ImportTemplate): ParseReport {
  const lines = text.split(/\r?\n/);
  const rows: Row[] = []; const errors: ParseReport['errors'] = [];
  lines.forEach((line, idx) => {
    if (line.trim() === '') return;
    if (t.style === 'CSV' && t.hasHeader && idx === 0) return;
    try {
      const row: Row = {};
      if (t.style === 'FIXED') {
        for (const c of t.columns) row[c.field] = convert(line.slice(c.start, c.start + c.length), c.type);
      } else {
        const parts = splitCsv(line, t.delimiter);
        for (const c of t.columns) {
          const raw = parts[c.index];
          if (raw === undefined) throw new Error(`missing column ${c.index}`);
          row[c.field] = convert(raw, c.type);
        }
      }
      rows.push(row);
    } catch (e) {
      errors.push({ line: idx + 1, message: (e as Error).message });
    }
  });
  return { rows, errors };
}

/** Apply parsed rows to an existing keyed store according to the import mode (preview-able). */
export function planImport(rows: Row[], existingKeys: Set<string>, t: ImportTemplate) {
  const inserts: Row[] = []; const updates: Row[] = []; const skipped: Row[] = [];
  for (const r of rows) {
    const key = String(r[t.keyField]);
    const exists = existingKeys.has(key);
    if (t.mode === 20) skipped.push(r);
    else if (t.mode === 2) (exists ? skipped : inserts).push(r);
    else if (t.mode === 3) (exists ? updates : skipped).push(r);
    else (exists ? updates : inserts).push(r);
  }
  return { inserts, updates, skipped };
}
