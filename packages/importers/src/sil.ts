/**
 * Reader for L-BOSS SIL-style files as found in the original installer, e.g.
 *   CREATE VIEW FUNCTIONS_LOAD AS SELECT F2000,F2013,F1000 FROM FUNCTIONS;
 *   INSERT INTO FUNCTIONS_LOAD VALUES
 *   (5734,1,'PAL'),
 *   (5736,1,'PAL');
 *   @UPDATE_VIEW(ADD,FUNCTIONS,FUNCTIONS_Load);
 *
 * Variants observed in the real files and handled here:
 *  - a header INSERT (e.g. HEADER_DCT) before the CREATE VIEW  -> the first INSERT after CREATE VIEW is used
 *  - empty VALUES blocks ("INSERT INTO X VALUES ;")             -> zero rows
 *  - empty values (",,")                                         -> null
 *  - unescaped apostrophes inside quoted text (French "d'item") -> a quote only closes a string
 *    when the next non-blank character is ',' or ')'
 */
export interface SilData {
  table: string;
  fields: string[];
  rows: Record<string, string | number | null>[];
  /** statements after the VALUES block, e.g. "@UPDATE_VIEW(ADD,FUNCTIONS,FUNCTIONS_Load)" */
  commands: string[];
}

function nextNonBlank(s: string, from: number): string | undefined {
  let k = from;
  while (k < s.length && /\s/.test(s[k]!)) k++;
  return s[k];
}

export function parseSil(text: string): SilData {
  const view = /CREATE\s+VIEW\s+(\w+)\s+AS\s+SELECT\s+([\w\s,]+?)\s+FROM\s+(\w+)\s*;/i.exec(text);
  if (!view || view[2] === undefined || view[3] === undefined) throw new Error('SIL header (CREATE VIEW ... FROM ...) not found');
  const fields = view[2].split(',').map(f => f.trim()).filter(Boolean);
  const table = view[3];
  const afterView = text.slice(view.index + view[0].length);
  const insert = /INSERT\s+INTO\s+\w+\s+VALUES/i.exec(afterView);
  if (!insert) return { table, fields, rows: [], commands: [] };
  const body = afterView.slice(insert.index + insert[0].length);
  const rows: SilData['rows'] = [];
  let i = 0;
  while (i < body.length) {
    const start = nextNonBlank(body, i);
    if (start !== '(') break;                 // ';' (possibly empty block) or end of data
    const open = body.indexOf('(', i);
    const values: (string | number | null)[] = [];
    let j = open + 1;
    let current = '';
    let inQuote = false;
    let wasQuoted = false;
    for (; j < body.length; j++) {
      const ch = body[j]!;
      if (inQuote) {
        if (ch === "'" && body[j + 1] === "'") { current += "'"; j++; }
        else if (ch === "'") {
          const n = nextNonBlank(body, j + 1);
          if (n === ',' || n === ')') inQuote = false;
          else current += ch;                 // literal apostrophe left unescaped in the source data
        } else current += ch;
      } else if (ch === "'") { inQuote = true; wasQuoted = true; }
      else if (ch === ',' || ch === ')') {
        const raw = current.trim();
        values.push(wasQuoted ? current : raw === '' || /^null$/i.test(raw) ? null : Number.isNaN(Number(raw)) ? raw : Number(raw));
        current = ''; wasQuoted = false;
        if (ch === ')') break;
      } else if (!/\s/.test(ch)) current += ch;
    }
    if (values.length !== fields.length) throw new Error(`Row ${rows.length + 1} has ${values.length} values, expected ${fields.length}`);
    rows.push(Object.fromEntries(fields.map((f, k) => [f, values[k] ?? null])));
    let k = j + 1;
    while (k < body.length && /\s/.test(body[k]!)) k++;
    if (body[k] === ',') { i = k + 1; continue; }
    i = k;
    break;
  }
  const rest = body.slice(i).replace(/^\s*;/, '');
  const commands = rest.split(';').map(c => c.trim()).filter(Boolean);
  return { table, fields, rows, commands };
}
