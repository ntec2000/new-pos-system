import { readFileSync, existsSync } from 'node:fs';
import { parseSil } from '../src/sil';
import { parseWithTemplate, planImport, ImportTemplate } from '../src/importer';

describe('SIL reader', () => {
  it('parses SIL text, empty values, escaped and unescaped apostrophes', () => {
    const s = parseSil("CREATE VIEW X_LOAD AS SELECT F01,F02,F30 FROM OBJ;\r\nINSERT INTO X_LOAD VALUES\r\n('0001','O''Brien',1.25),\r\n('0002','d'item',NULL),\r\n('0003',,2);\r\n@UPDATE_VIEW(ADD,OBJ,X_Load);");
    expect(s.table).toBe('OBJ');
    expect(s.rows).toEqual([
      { F01: '0001', F02: "O'Brien", F30: 1.25 },
      { F01: '0002', F02: "d'item", F30: null },
      { F01: '0003', F02: null, F30: 2 },
    ]);
    expect(s.commands).toEqual(['@UPDATE_VIEW(ADD,OBJ,X_Load)']);
  });
  it('handles empty VALUES blocks', () => {
    expect(parseSil('CREATE VIEW A AS SELECT F1 FROM T;\nINSERT INTO A VALUES\n;\n').rows).toEqual([]);
  });
  // Original L-BOSS data is not redistributed in this repository; this test runs only where it exists locally.
  const real = process.env.LBOSS_SIL_SAMPLE ?? '';
  it.runIf(real !== '' && existsSync(real))('parses an original L-BOSS SIL file when provided', () => {
    const s = parseSil(readFileSync(real, 'latin1'));
    expect(s.rows.length).toBeGreaterThan(0);
  });
});

describe('importer', () => {
  const fixed: ImportTemplate = {
    name: 'weekly sale (fixed)', style: 'FIXED', keyField: 'upc', mode: 3,
    columns: [
      { field: 'upc', start: 0, length: 12, type: 'string' },
      { field: 'salePrice', start: 12, length: 8, type: 'cents' },
      { field: 'from', start: 20, length: 8, type: 'date_yyyymmdd' },
      { field: 'to', start: 28, length: 8, type: 'date_yyyymmdd' },
    ],
  };
  it('parses fixed-length sale files and reports bad lines', () => {
    const r = parseWithTemplate('036000291452    3.992026101220261018\n036000291453    x.xx2026101220261018\n', fixed);
    expect(r.rows).toEqual([{ upc: '036000291452', salePrice: 399, from: '2026-10-12', to: '2026-10-18' }]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.line).toBe(2);
  });
  it('import modes', () => {
    const plan = planImport([{ upc: 'A' }, { upc: 'B' }], new Set(['A']), fixed);
    expect([plan.updates.length, plan.skipped.length, plan.inserts.length]).toEqual([1, 1, 0]);
    const plan2 = planImport([{ upc: 'A' }, { upc: 'B' }], new Set(['A']), { ...fixed, mode: 2 });
    expect([plan2.updates.length, plan2.skipped.length, plan2.inserts.length]).toEqual([0, 1, 1]);
  });
  it('parses CSV with quotes', () => {
    const csv: ImportTemplate = { name: 'vendor csv', style: 'CSV', delimiter: ',', hasHeader: true, keyField: 'upc', mode: 1,
      columns: [{ field: 'upc', index: 0, type: 'string' }, { field: 'desc', index: 1, type: 'string' }, { field: 'price', index: 2, type: 'cents' }] };
    expect(parseWithTemplate('UPC,DESC,PRICE\n036000291452,"MILK, 2L",4.99\n', csv).rows).toEqual([{ upc: '036000291452', desc: 'MILK, 2L', price: 499 }]);
  });
});
