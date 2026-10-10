import { useEffect, useState } from 'react';
import { EscPos } from '@new-pos/devices';
import { formatCAD, TAX_CATEGORIES } from '@new-pos/core';
import { api, errorText, parseAmount } from '../api';
import { t, Lang } from '../i18n';
import type { BottleLink, Operator, StoreSettings, Subdepartment } from '../../shared/types';

export function SettingsScreen({ settings, operator, lang, onSaved }: { settings: StoreSettings; operator: Operator; lang: Lang; onSaved: (s: StoreSettings) => void }) {
  const [s, setS] = useState<StoreSettings>(settings);
  const [printers, setPrinters] = useState<string[]>([]);
  const [ops, setOps] = useState<Operator[]>([]);
  const [subs, setSubs] = useState<Subdepartment[]>([]);
  const [links, setLinks] = useState<BottleLink[]>([]);
  const [newOp, setNewOp] = useState({ number: '', name: '', level: 1, pin: '' });
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const [info, setInfo] = useState('');

  const reload = async () => {
    const [o, d, l] = await Promise.all([api.listOperators(), api.listSubdepartments(), api.listBottleLinks()]);
    setOps(o); setSubs(d); setLinks(l);
  };
  useEffect(() => {
    void reload();
    void api.listPrinters().then(setPrinters).catch(() => setPrinters([]));
    void api.info().then(i => setInfo(`Version ${i.version} · data: ${i.dataDir}`)).catch(() => {});
  }, []);

  const ok = (text: string) => setMsg({ text, kind: 'ok' });
  const fail = (e: unknown) => setMsg({ text: errorText(e), kind: 'error' });

  const save = async () => { try { await api.saveSettings(s); onSaved(s); ok('Settings saved'); } catch (e) { fail(e); } };

  const testPrint = async () => {
    const lines = [s.storeName, ...s.headerLines, '-'.repeat(s.printer.width), 'PRINTER TEST', new Date().toLocaleString(), '-'.repeat(s.printer.width)];
    const p = new EscPos().initialize();
    lines.forEach(l => p.line(l));
    p.newline().newline().newline().feedAndPartialCut();
    try { await api.print(s.printer, lines, p.build()); ok(s.printer.mode === 'preview' ? 'Preview mode: nothing sent to a printer' : 'Test sent to printer'); } catch (e) { fail(e); }
  };

  const addOperator = async () => {
    try { await api.saveOperator({ number: newOp.number, name: newOp.name, level: newOp.level, active: true, pin: newOp.pin }, operator.id); setNewOp({ number: '', name: '', level: 1, pin: '' }); await reload(); ok('Operator saved'); }
    catch (e) { fail(e); }
  };
  const [pinEdit, setPinEdit] = useState<{ id: string; pin: string } | null>(null);
  const changePin = async (o: Operator, pin: string) => {
    try { await api.saveOperator({ id: o.id, number: o.number, name: o.name, level: o.level, active: o.active, pin }, operator.id); setPinEdit(null); ok(`PIN changed for ${o.name}`); } catch (e) { fail(e); }
  };
  const saveSub = async (d: Subdepartment) => { try { await api.saveSubdepartment(d, operator.id); await reload(); ok(`Saved ${d.name}`); } catch (e) { fail(e); } };
  const saveLink = async (b: BottleLink) => { try { await api.saveBottleLink(b, operator.id); await reload(); ok(`Saved link ${b.code}`); } catch (e) { fail(e); } };

  return (
    <div className="admin settings">
      <div className="card">
        <h3>{t('settings', lang)}</h3>
        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
        <div className="form">
          <label>Store name<input value={s.storeName} onChange={e => setS({ ...s, storeName: e.target.value })} /></label>
          <label>Receipt header (one line each; include your GST/HST number)<textarea rows={4} value={s.headerLines.join('\n')} onChange={e => setS({ ...s, headerLines: e.target.value.split('\n').slice(0, 15) })} /></label>
          <label>Receipt trailer<textarea rows={3} value={s.trailerLines.join('\n')} onChange={e => setS({ ...s, trailerLines: e.target.value.split('\n').slice(0, 15) })} /></label>
          <div className="two">
            <label>Tax jurisdiction<select value={s.jurisdiction} onChange={e => setS({ ...s, jurisdiction: e.target.value })}><option value="CA-SK">Saskatchewan (GST 5% + PST 6%)</option><option value="CA-ON">Ontario (HST 13%)</option></select></label>
            <label>Terminal #<input value={s.terminal} maxLength={4} onChange={e => setS({ ...s, terminal: e.target.value })} /></label>
          </div>
          <label>Language<select value={s.language} onChange={e => setS({ ...s, language: e.target.value as StoreSettings['language'] })}><option value="en">English</option><option value="ko">한국어</option><option value="fr">Français</option></select></label>
          <h4>Receipt printer</h4>
          <label>Mode<select value={s.printer.mode} onChange={e => setS({ ...s, printer: { ...s.printer, mode: e.target.value as StoreSettings['printer']['mode'] } })}>
            <option value="preview">Screen preview only</option><option value="windows">Windows printer driver</option><option value="tcp">Network ESC/POS printer (raw TCP)</option></select></label>
          {s.printer.mode === 'windows' && <label>Windows printer<select value={s.printer.deviceName} onChange={e => setS({ ...s, printer: { ...s.printer, deviceName: e.target.value } })}>
            <option value="">(default printer)</option>{printers.map(p => <option key={p}>{p}</option>)}</select></label>}
          {s.printer.mode === 'tcp' && <div className="two">
            <label>IP address<input value={s.printer.host} onChange={e => setS({ ...s, printer: { ...s.printer, host: e.target.value } })} /></label>
            <label>Port<input value={s.printer.port} onChange={e => setS({ ...s, printer: { ...s.printer, port: Number(e.target.value) || 9100 } })} /></label></div>}
          <div className="two">
            <label>Characters per line<input value={s.printer.width} onChange={e => setS({ ...s, printer: { ...s.printer, width: Math.min(64, Math.max(24, Number(e.target.value) || 42)) } })} /></label>
            <label className="check"><input type="checkbox" checked={s.printer.openDrawer} onChange={e => setS({ ...s, printer: { ...s.printer, openDrawer: e.target.checked } })} /> Open printer-driven cash drawer (network mode)</label>
          </div>
          <div className="actions"><button className="btn primary" onClick={() => void save()}>{t('save', lang)}</button><button className="btn" onClick={() => void testPrint()}>{t('printTest', lang)}</button></div>
          <p className="muted">{info}</p>
        </div>
      </div>
      <div className="card">
        <h4>Operators</h4>
        <table className="grid"><thead><tr><th>#</th><th>Name</th><th>Level</th><th></th></tr></thead><tbody>
          {ops.map(o => <tr key={o.id}><td>{o.number}</td><td>{o.name}</td><td>{o.level}{o.level >= 5 ? ' (manager)' : ''}</td><td>{pinEdit?.id === o.id
            ? <><input type="password" placeholder="new PIN" style={{ width: 90 }} value={pinEdit.pin} onChange={e => setPinEdit({ id: o.id, pin: e.target.value.replace(/\D/g, '') })} />
                <button className="btn small" onClick={() => void changePin(o, pinEdit.pin)}>Save</button></>
            : <button className="btn small" onClick={() => setPinEdit({ id: o.id, pin: '' })}>PIN</button>}</td></tr>)}
        </tbody></table>
        <div className="row-form">
          <input placeholder="#" style={{ width: 60 }} value={newOp.number} onChange={e => setNewOp({ ...newOp, number: e.target.value.replace(/\D/g, '') })} />
          <input placeholder="Name" value={newOp.name} onChange={e => setNewOp({ ...newOp, name: e.target.value })} />
          <select value={newOp.level} onChange={e => setNewOp({ ...newOp, level: Number(e.target.value) })}><option value={1}>Cashier (1)</option><option value={5}>Manager (5)</option><option value={9}>Owner (9)</option></select>
          <input placeholder="PIN" type="password" style={{ width: 80 }} value={newOp.pin} onChange={e => setNewOp({ ...newOp, pin: e.target.value.replace(/\D/g, '') })} />
          <button className="btn" onClick={() => void addOperator()}>Add</button>
        </div>
        <h4>Sub-departments (screen buttons)</h4>
        <table className="grid"><thead><tr><th>#</th><th>Name</th><th>Tax</th><th>Age</th><th>Show</th><th></th></tr></thead><tbody>
          {subs.map(d => <SubRow key={d.id} d={d} onSave={saveSub} />)}
        </tbody></table>
        <h4>Deposit / environmental fee links (SARCAN)</h4>
        <p className="muted">Deposit amounts are pre-filled from the SARCAN brochure. Environmental Handling Charge (EHC) amounts must be entered by the store.</p>
        <table className="grid"><thead><tr><th>Code</th><th>Description</th><th>Deposit</th><th>EHC</th><th></th></tr></thead><tbody>
          {links.map(b => <LinkRow key={b.id} b={b} onSave={saveLink} />)}
        </tbody></table>
      </div>
    </div>
  );
}

function SubRow({ d, onSave }: { d: Subdepartment; onSave: (d: Subdepartment) => void }) {
  const [v, setV] = useState(d);
  return <tr><td>{v.number}</td><td><input value={v.name} onChange={e => setV({ ...v, name: e.target.value.toUpperCase() })} /></td>
    <td><select value={v.taxCategory} onChange={e => setV({ ...v, taxCategory: e.target.value })}>{TAX_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></td>
    <td><input style={{ width: 50 }} value={v.ageRestriction ?? ''} onChange={e => setV({ ...v, ageRestriction: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null })} /></td>
    <td><input type="checkbox" checked={v.showOnScreen} onChange={e => setV({ ...v, showOnScreen: e.target.checked })} /></td>
    <td><button className="btn small" onClick={() => onSave(v)}>Save</button></td></tr>;
}

function LinkRow({ b, onSave }: { b: BottleLink; onSave: (b: BottleLink) => void }) {
  const [dep, setDep] = useState((b.depositCents / 100).toFixed(2));
  const [ehc, setEhc] = useState((b.envFeeCents / 100).toFixed(2));
  return <tr><td>{b.code}</td><td>{b.description}</td>
    <td><input style={{ width: 70 }} value={dep} onChange={e => setDep(e.target.value)} /></td>
    <td><input style={{ width: 70 }} value={ehc} onChange={e => setEhc(e.target.value)} /></td>
    <td><button className="btn small" onClick={() => { const d = parseAmount(dep); const f = parseAmount(ehc); if (d !== null && f !== null) onSave({ ...b, depositCents: d, envFeeCents: f }); }}>Save</button>
      <span className="muted"> {formatCAD(b.depositCents)}</span></td></tr>;
}
