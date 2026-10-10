import { useState } from 'react';
import { parseSil, parseWithTemplate, ImportTemplate, ImportMode } from '@new-pos/importers';
import { api, errorText } from '../api';
import { t, Lang } from '../i18n';
import type { ImportResult, Operator } from '../../shared/types';

const PRESETS: Record<string, ImportTemplate> = {
  itemsCsv: { name: 'Item list CSV: UPC, Description, Price', style: 'CSV', delimiter: ',', hasHeader: true, keyField: 'upc', mode: 1,
    columns: [{ field: 'upc', index: 0, type: 'string' }, { field: 'description', index: 1, type: 'string' }, { field: 'price', index: 2, type: 'cents' }] },
  priceCsv: { name: 'Price update CSV: UPC, Price', style: 'CSV', delimiter: ',', hasHeader: true, keyField: 'upc', mode: 3,
    columns: [{ field: 'upc', index: 0, type: 'string' }, { field: 'price', index: 1, type: 'cents' }] },
  weeklySaleFixed: { name: 'Weekly/monthly sale TXT (fixed): UPC(12) SalePrice(8) From(8 yyyymmdd) To(8 yyyymmdd)', style: 'FIXED', keyField: 'upc', mode: 3,
    columns: [{ field: 'upc', start: 0, length: 12, type: 'string' }, { field: 'salePrice', start: 12, length: 8, type: 'cents' },
      { field: 'from', start: 20, length: 8, type: 'date_yyyymmdd' }, { field: 'to', start: 28, length: 8, type: 'date_yyyymmdd' }] },
};

/** L-BOSS SIL item files use F-codes: F01 UPC, F02/F29 description, F30 retail price (dollars). */
function silToRows(text: string): Record<string, string | number>[] {
  const s = parseSil(text);
  return s.rows.map(r => {
    const row: Record<string, string | number> = { upc: String(r.F01 ?? '').trim() };
    const desc = r.F29 ?? r.F02; if (desc !== null && desc !== undefined) row.description = String(desc).trim();
    if (r.F30 !== null && r.F30 !== undefined) row.price = Math.round(Number(r.F30) * 100);
    return row;
  });
}

export function ImportScreen({ operator, lang }: { operator: Operator; lang: Lang }) {
  const [preset, setPreset] = useState<keyof typeof PRESETS | 'sil'>('itemsCsv');
  const [mode, setMode] = useState<ImportMode>(1);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<{ rows: Record<string, string | number>[]; errors: { line: number; message: string }[] } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [msg, setMsg] = useState('');

  const parse = (content: string) => {
    setResult(null); setMsg('');
    try {
      if (preset === 'sil') setPreview({ rows: silToRows(content), errors: [] });
      else setPreview(parseWithTemplate(content, PRESETS[preset]!));
    } catch (e) { setPreview(null); setMsg(errorText(e)); }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setFileName(f.name);
    const buf = await f.arrayBuffer();
    const content = new TextDecoder(preset === 'sil' ? 'windows-1252' : 'utf-8').decode(buf);
    setText(content); parse(content);
  };

  const apply = async () => {
    if (!preview) return;
    try { setResult(await api.importItems(preview.rows, mode, operator.id)); } catch (e) { setMsg(errorText(e)); }
  };

  return (
    <div className="admin single">
      <div className="card">
        <h3>{t('import', lang)}</h3>
        <div className="form">
          <label>File format<select value={preset} onChange={e => { const v = e.target.value as keyof typeof PRESETS | 'sil'; setPreset(v); setMode(v === 'sil' ? 1 : PRESETS[v]!.mode); setPreview(null); }}>
            {Object.entries(PRESETS).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}
            <option value="sil">L-BOSS SIL item file (F01, F02/F29, F30)</option>
          </select></label>
          <label>Import mode<select value={mode} onChange={e => setMode(Number(e.target.value) as ImportMode)}>
            <option value={1}>1 - insert new and update existing</option>
            <option value={2}>2 - only items that do not exist</option>
            <option value={3}>3 - only items that already exist</option>
            <option value={20}>20 - do not import (test)</option>
          </select></label>
          <label>File<input type="file" accept=".csv,.txt,.000,.sil" onChange={e => void onFile(e.target.files?.[0])} /></label>
          <label>…or paste content<textarea rows={6} value={text} onChange={e => setText(e.target.value)} /></label>
          <div className="actions"><button className="btn" onClick={() => parse(text)}>Preview</button>
            <button className="btn primary" disabled={!preview || preview.rows.length === 0} onClick={() => void apply()}>Apply import</button></div>
        </div>
        {msg && <div className="msg error">{msg}</div>}
        {preview && (
          <div>
            <p>{fileName} · {preview.rows.length} valid row(s) · {preview.errors.length} error(s)</p>
            {preview.errors.slice(0, 20).map(e => <div key={e.line} className="msg error">line {e.line}: {e.message}</div>)}
            <table className="grid"><tbody>{preview.rows.slice(0, 20).map((r, i) => <tr key={i}>{Object.entries(r).map(([k, v]) => <td key={k}><b>{k}</b> {String(v)}</td>)}</tr>)}</tbody></table>
          </div>
        )}
        {result && <div className="msg ok">Inserted {result.inserted} · updated {result.updated} · skipped {result.skipped} · errors {result.errors.length}
          {result.errors.slice(0, 10).map(e => <div key={e.line}>row {e.line}: {e.message}</div>)}</div>}
      </div>
    </div>
  );
}
