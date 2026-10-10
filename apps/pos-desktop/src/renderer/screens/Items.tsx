import { useEffect, useState } from 'react';
import { formatCAD, suggestedRetail, actualMargin, TAX_CATEGORIES } from '@new-pos/core';
import { api, errorText, parseAmount } from '../api';
import { t, Lang } from '../i18n';
import type { BottleLink, ItemRecord, Operator, Subdepartment } from '../../shared/types';

const cents = (v: number | null) => (v === null ? '' : (v / 100).toFixed(2));

function blank(upc: string, subs: Subdepartment[]): ItemRecord {
  const d = subs[0];
  return { id: '', upc, description: '', descriptionAlt: '', subdepartmentId: d?.id ?? '', taxCategory: d?.taxCategory ?? 'GENERAL',
    priceCents: 0, salePriceCents: null, saleFrom: null, saleTo: null, costCents: null, bottleLinkId: null, ageRestriction: null, active: true };
}

export function ItemsScreen({ operator, lang, draftUpc, onDraftUsed }: { operator: Operator; lang: Lang; draftUpc: string | null; onDraftUsed: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ItemRecord[]>([]);
  const [subs, setSubs] = useState<Subdepartment[]>([]);
  const [links, setLinks] = useState<BottleLink[]>([]);
  const [edit, setEdit] = useState<ItemRecord | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [margin, setMargin] = useState({ method: 'MARGIN' as 'MARGIN' | 'MARKUP', percent: '30', lastDigit: '9' });
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);

  const search = async (q = query) => setResults(await api.searchItems(q, 100));
  useEffect(() => {
    void (async () => {
      const [s, l] = await Promise.all([api.listSubdepartments(), api.listBottleLinks()]);
      setSubs(s); setLinks(l);
      if (draftUpc) { open(blank(draftUpc, s)); onDraftUsed(); } else void search('');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = (it: ItemRecord) => {
    setEdit(it); setMsg(null);
    setForm({ price: cents(it.priceCents), sale: cents(it.salePriceCents), cost: cents(it.costCents), age: it.ageRestriction === null ? '' : String(it.ageRestriction) });
  };

  const save = async () => {
    if (!edit) return;
    const price = parseAmount(form.price ?? '');
    if (price === null) { setMsg({ text: 'Price is required (e.g. 4.99)', kind: 'error' }); return; }
    const sale = form.sale ? parseAmount(form.sale) : null;
    const cost = form.cost ? parseAmount(form.cost) : null;
    const item: ItemRecord = { ...edit, priceCents: price, salePriceCents: sale, costCents: cost,
      ageRestriction: form.age ? Number(form.age) : null, saleFrom: edit.saleFrom || null, saleTo: edit.saleTo || null };
    try { await api.saveItem(item, operator.id); setMsg({ text: `Saved ${item.upc}`, kind: 'ok' }); setEdit(null); await search(); }
    catch (e) { setMsg({ text: errorText(e), kind: 'error' }); }
  };

  const applyMargin = () => {
    const cost = parseAmount(form.cost ?? '');
    if (cost === null) { setMsg({ text: 'Enter the cost first', kind: 'error' }); return; }
    try {
      const p = suggestedRetail(cost, margin.method, Math.round(Number(margin.percent) * 1000), margin.lastDigit === '' ? undefined : Number(margin.lastDigit));
      setForm(f => ({ ...f, price: cents(p) }));
    } catch (e) { setMsg({ text: errorText(e), kind: 'error' }); }
  };

  const priceC = parseAmount(form.price ?? ''); const costC = parseAmount(form.cost ?? '');
  return (
    <div className="admin">
      <div className="admin-list card">
        <form className="row-form" onSubmit={e => { e.preventDefault(); void search(); }}>
          <input placeholder="UPC / description" value={query} onChange={e => setQuery(e.target.value)} />
          <button className="btn" type="submit">{t('search', lang)}</button>
          <button className="btn primary" type="button" onClick={() => open(blank('', subs))}>+ {t('newItem', lang)}</button>
        </form>
        <table className="grid">
          <thead><tr><th>UPC</th><th>Description</th><th>Price</th><th>Sale</th><th>Tax</th></tr></thead>
          <tbody>{results.map(r => (
            <tr key={r.id} onClick={() => open(r)} className={r.active ? '' : 'inactive'}>
              <td>{r.upc}</td><td>{r.description}<div className="alt">{r.descriptionAlt}</div></td><td>{formatCAD(r.priceCents)}</td>
              <td>{r.salePriceCents !== null ? `${formatCAD(r.salePriceCents)} ${r.saleFrom ?? ''}~${r.saleTo ?? ''}` : ''}</td><td>{r.taxCategory}</td>
            </tr>))}</tbody>
        </table>
      </div>
      <div className="admin-edit card">
        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
        {!edit ? <p className="muted">Select an item or create a new one.</p> : (
          <form className="form" onSubmit={e => { e.preventDefault(); void save(); }}>
            <h3>{edit.id ? 'Edit item' : t('newItem', lang)}</h3>
            <label>UPC / PLU<input value={edit.upc} disabled={!!edit.id} onChange={e => setEdit({ ...edit, upc: e.target.value.replace(/\D/g, '') })} /></label>
            <label>Description (receipt)<input value={edit.description} maxLength={30} onChange={e => setEdit({ ...edit, description: e.target.value.toUpperCase() })} /></label>
            <label>Alternate name (cashier screen, e.g. Korean)<input value={edit.descriptionAlt} onChange={e => setEdit({ ...edit, descriptionAlt: e.target.value })} /></label>
            <label>Sub-department<select value={edit.subdepartmentId} onChange={e => { const d = subs.find(x => x.id === e.target.value); setEdit({ ...edit, subdepartmentId: e.target.value, taxCategory: d?.taxCategory ?? edit.taxCategory }); }}>
              {subs.map(d => <option key={d.id} value={d.id}>{d.number} {d.name}</option>)}</select></label>
            <label>Tax category<select value={edit.taxCategory} onChange={e => setEdit({ ...edit, taxCategory: e.target.value })}>
              {TAX_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
            <label>Deposit / EHC link<select value={edit.bottleLinkId ?? ''} onChange={e => setEdit({ ...edit, bottleLinkId: e.target.value || null })}>
              <option value="">None</option>{links.map(b => <option key={b.id} value={b.id}>{b.code} {b.description} ({formatCAD(b.depositCents)}{b.envFeeCents ? ` + EHC ${formatCAD(b.envFeeCents)}` : ''})</option>)}</select></label>
            <div className="two">
              <label>Cost<input value={form.cost ?? ''} onChange={e => setForm({ ...form, cost: e.target.value })} placeholder="0.00" /></label>
              <label>Retail price<input value={form.price ?? ''} onChange={e => setForm({ ...form, price: e.target.value })} placeholder="0.00" /></label>
            </div>
            <div className="margin-box">
              <select value={margin.method} onChange={e => setMargin({ ...margin, method: e.target.value as 'MARGIN' | 'MARKUP' })}><option>MARGIN</option><option>MARKUP</option></select>
              <input value={margin.percent} onChange={e => setMargin({ ...margin, percent: e.target.value })} style={{ width: 70 }} />%
              <span>last digit</span><input value={margin.lastDigit} maxLength={1} onChange={e => setMargin({ ...margin, lastDigit: e.target.value.replace(/\D/g, '') })} style={{ width: 40 }} />
              <button type="button" className="btn" onClick={applyMargin}>Calculate price</button>
              {priceC !== null && costC !== null && priceC > 0 && <span className="muted">actual margin {(actualMargin(priceC, costC) / 1000).toFixed(1)}%</span>}
            </div>
            <div className="two">
              <label>Sale price<input value={form.sale ?? ''} onChange={e => setForm({ ...form, sale: e.target.value })} placeholder="optional" /></label>
              <label>Age restriction<input value={form.age ?? ''} onChange={e => setForm({ ...form, age: e.target.value.replace(/\D/g, '') })} placeholder="e.g. 19" /></label>
            </div>
            <div className="two">
              <label>Sale from<input type="date" value={edit.saleFrom ?? ''} onChange={e => setEdit({ ...edit, saleFrom: e.target.value || null })} /></label>
              <label>Sale to<input type="date" value={edit.saleTo ?? ''} onChange={e => setEdit({ ...edit, saleTo: e.target.value || null })} /></label>
            </div>
            <label className="check"><input type="checkbox" checked={edit.active} onChange={e => setEdit({ ...edit, active: e.target.checked })} /> Active</label>
            <div className="actions"><button className="btn primary" type="submit">{t('save', lang)}</button><button className="btn" type="button" onClick={() => setEdit(null)}>{t('close', lang)}</button></div>
          </form>
        )}
      </div>
    </div>
  );
}
