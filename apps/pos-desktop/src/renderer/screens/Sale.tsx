import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sale, JURISDICTIONS, SASKATCHEWAN, formatCAD, Item } from '@new-pos/core';
import { receiptEscPos, receiptLines, EscPos } from '@new-pos/devices';
import { api, errorText, nowText, parseAmount, today } from '../api';
import { t, Lang } from '../i18n';
import type { Operator, SellableItem, StoreSettings, Subdepartment } from '../../shared/types';
import { MANAGER_LEVEL } from '../App';

interface Props { settings: StoreSettings; operator: Operator; lang: Lang; onAddItem: (upc: string) => void }
type Pending = { kind: 'item'; item: Item; qty: number; age: number } | { kind: 'open'; dept: Subdepartment; amount: number; age: number };
interface Completed { number: number; change: number; lines: string[]; printError?: string }

function ageFromBirthDate(iso: string, on: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  let age = on.getFullYear() - y;
  if (on.getMonth() + 1 < mo || (on.getMonth() + 1 === mo && on.getDate() < d)) age--;
  return age;
}

export function SaleScreen({ settings, operator, lang, onAddItem }: Props) {
  const jurisdiction = JURISDICTIONS[settings.jurisdiction] ?? SASKATCHEWAN;
  const newSale = useCallback(() => new Sale(jurisdiction, today()), [jurisdiction]);
  const [sale, setSale] = useState<Sale>(() => newSale());
  const [, setVersion] = useState(0);
  const refresh = () => setVersion(v => v + 1);
  const [buffer, setBuffer] = useState('');
  const [qty, setQty] = useState(1);
  const [message, setMessage] = useState<{ text: string; kind: 'info' | 'error' | 'ok'; addUpc?: string } | null>(null);
  const [lastItem, setLastItem] = useState<SellableItem | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [dob, setDob] = useState('');
  const [tendering, setTendering] = useState(false);
  const [completed, setCompleted] = useState<Completed | null>(null);
  const [depts, setDepts] = useState<Subdepartment[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.listSubdepartments().then(d => setDepts(d.filter(x => x.showOnScreen))).catch(e => setMessage({ text: errorText(e), kind: 'error' })); }, []);

  const info = (text: string, kind: 'info' | 'error' | 'ok' = 'info', addUpc?: string) => setMessage(addUpc ? { text, kind, addUpc } : { text, kind });
  const resetEntry = () => { setBuffer(''); setQty(1); };

  const startNewSale = () => { setSale(newSale()); setCompleted(null); setTendering(false); setSelected(null); setLastItem(null); setMessage(null); resetEntry(); };

  const addItem = (item: SellableItem, q: number, verifiedAge?: number) => {
    try {
      const it: Item = { upc: item.upc, description: item.description, price: item.price, taxCategory: item.taxCategory };
      if (item.ageRestriction !== undefined) it.ageRestriction = item.ageRestriction;
      if (item.bottleLink) it.bottleLink = item.bottleLink;
      sale.addItem(it, q, verifiedAge);
      setLastItem(item); resetEntry(); setMessage(null); refresh();
    } catch (e) {
      const m = errorText(e);
      if (m.startsWith('AGE_VERIFICATION_REQUIRED')) {
        const it: Item = { upc: item.upc, description: item.description, price: item.price, taxCategory: item.taxCategory, ageRestriction: item.ageRestriction };
        if (item.bottleLink) it.bottleLink = item.bottleLink;
        setLastItem(item); setPending({ kind: 'item', item: it, qty: q, age: item.ageRestriction ?? 0 }); setDob('');
      } else info(m, 'error');
    }
  };

  const enterPlu = async () => {
    if (completed) { startNewSale(); return; }
    const code = buffer.trim();
    if (!/^\d{1,14}$/.test(code)) { info('Enter or scan a PLU / UPC', 'error'); return; }
    const item = await api.sellable(code, today());
    if (!item) { setBuffer(''); info(`${t('notFound', lang)}: ${code}`, 'error', code); return; }
    addItem(item, qty);
  };

  const priceCheck = async () => {
    const code = buffer.trim();
    if (!code) { info('Enter a PLU first', 'error'); return; }
    const item = await api.sellable(code, today());
    setBuffer('');
    if (!item) info(`${t('notFound', lang)}: ${code}`, 'error', code);
    else { setLastItem(item); info(`${item.description}  ${formatCAD(item.price)}${item.onSale ? '  (SALE)' : ''}`, 'info'); }
  };

  const department = (d: Subdepartment) => {
    if (completed) startNewSale();
    const amount = parseAmount(buffer);
    if (amount === null || amount <= 0) { info(`Enter the amount, then press ${d.name}`, 'error'); return; }
    const total = amount * qty;
    if (d.ageRestriction) { setPending({ kind: 'open', dept: d, amount: total, age: d.ageRestriction }); setDob(''); return; }
    try { sale.addOpen(d.name, total, d.taxCategory); resetEntry(); setMessage(null); refresh(); } catch (e) { info(errorText(e), 'error'); }
  };

  const confirmAge = (verifiedAge: number) => {
    if (!pending) return;
    if (verifiedAge < pending.age) { void api.audit(operator.id, 'AGE_REFUSED', `${pending.age}`); setPending(null); info(`Sale refused: customer under ${pending.age}`, 'error'); resetEntry(); return; }
    if (pending.kind === 'item') {
      try { sale.addItem(pending.item, pending.qty, verifiedAge); resetEntry(); setMessage(null); refresh(); } catch (e) { info(errorText(e), 'error'); }
    } else {
      try { sale.addOpen(pending.dept.name, pending.amount, pending.dept.taxCategory); resetEntry(); refresh(); } catch (e) { info(errorText(e), 'error'); }
    }
    void api.audit(operator.id, 'AGE_VERIFIED', `${pending.age}`);
    setPending(null);
  };

  const errorCorrect = () => {
    if (completed || tendering) return;
    if (selected) { sale.errorCorrect(selected); setSelected(null); refresh(); return; }
    if (!sale.errorCorrectLast()) info('Nothing to correct', 'error'); else refresh();
  };

  const cancelSale = async () => {
    if (completed || sale.activeLines().length === 0) { startNewSale(); return; }
    if (sale.tenders.length > 0) { info('Cannot cancel after a payment was applied', 'error'); return; }
    sale.cancel();
    await api.saveTransaction(sale.snapshot(), operator.id);
    startNewSale();
    info('Sale cancelled', 'ok');
  };

  const openDrawer = async () => {
    const p = settings.printer;
    if (p.mode === 'tcp' && p.openDrawer) await api.sendRaw(p.host, p.port, new EscPos().initialize().openDrawer(0).build());
  };

  const noSale = async () => {
    if (operator.level < MANAGER_LEVEL) { info('Manager level required for No Sale', 'error'); return; }
    await api.audit(operator.id, 'NO_SALE', null);
    try { await openDrawer(); info('Drawer opened (logged)', 'ok'); } catch (e) { info(`Drawer: ${errorText(e)}`, 'error'); }
  };

  const finish = async (change: number) => {
    setBusy(true);
    try {
      const snap = sale.snapshot();
      const number = await api.saveTransaction(snap, operator.id);
      const ctx = { header: { storeName: settings.storeName, lines: settings.headerLines, trailer: settings.trailerLines }, transactionNumber: number, terminal: settings.terminal, cashier: operator.name, timestamp: nowText(), width: settings.printer.width };
      const lines = receiptLines(snap, ctx);
      const done: Completed = { number, change, lines };
      if (settings.printer.mode !== 'preview') {
        const hasCash = snap.tenders.some(x => x.kind === 'CASH');
        try { await api.print(settings.printer, lines, receiptEscPos(snap, ctx, hasCash && settings.printer.openDrawer)); }
        catch (e) { done.printError = errorText(e); }
      }
      setCompleted(done); setTendering(false); resetEntry();
    } catch (e) { info(errorText(e), 'error'); }
    finally { setBusy(false); }
  };

  const payCash = async (amount: number) => {
    try {
      const r = sale.payCash(amount);
      refresh(); resetEntry();
      if (r.complete) await finish(r.change);
    } catch (e) { info(errorText(e), 'error'); }
  };

  const payCard = async () => {
    try {
      sale.payCard(sale.balance(), `EXT-${Date.now()}`);
      refresh();
      if (sale.isComplete()) await finish(0);
    } catch (e) { info(errorText(e), 'error'); }
  };

  const press = (k: string) => {
    if (completed && k !== 'C') startNewSale();
    if (k === 'C') { setBuffer(''); setQty(1); setMessage(null); return; }
    if (k === 'BS') { setBuffer(b => b.slice(0, -1)); return; }
    if (k === '.' && buffer.includes('.')) return;
    setBuffer(b => (b + k).slice(0, 16));
  };

  const setQuantity = () => {
    const q = Number(buffer);
    if (!Number.isInteger(q) || q < 1 || q > 999) { info('Enter a quantity (1-999), then Qty', 'error'); return; }
    setQty(q); setBuffer('');
  };

  // physical keyboard and USB HID barcode scanners (they type digits followed by Enter)
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (pending || busy) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    if (/^[0-9.]$/.test(e.key)) { press(e.key); e.preventDefault(); }
    else if (e.key === 'Backspace') { press('BS'); e.preventDefault(); }
    else if (e.key === 'Escape') { press('C'); e.preventDefault(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (tendering) { const a = parseAmount(buffer); if (a) void payCash(a); }
      else void enterPlu();
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const taxes = useMemo(() => { try { return sale.taxes(); } catch { return { byTax: {}, total: 0 }; } }, [sale, sale.lines.length, sale.lines.filter(l => l.voided).length]);
  const lines = sale.lines;
  const bal = sale.balance();

  return (
    <div className="sale">
      <section className="left">
        <div className="journal">
          {lines.length === 0 && !completed && <div className="empty">{t('sale', lang)} · {today()}</div>}
          {lines.map(l => (
            <div key={l.id} className={`jline ${l.voided ? 'void' : ''} ${l.parentId ? 'child' : ''} ${selected === l.id ? 'sel' : ''}`}
              onClick={() => !l.voided && !l.parentId && setSelected(selected === l.id ? null : l.id)}>
              <span className="d">{l.description}{l.qty !== 1 ? ` ×${l.qty}` : ''}</span>
              <span className="a">{formatCAD(l.amount)}</span>
            </div>
          ))}
          {sale.tenders.map((x, i) => (
            <div key={`t${i}`} className="jline tender"><span className="d">{x.kind}</span><span className="a">-{formatCAD(x.amount)}</span></div>
          ))}
        </div>
        <div className="totals">
          <div className="row"><span>{t('items_count', lang)}</span><span>{sale.itemCount()}</span></div>
          <div className="row"><span>{t('subtotal', lang)}</span><span>{formatCAD(sale.subtotal())}</span></div>
          {Object.entries(taxes.byTax).map(([code, v]) => v.tax !== 0 && <div className="row" key={code}><span>{code}</span><span>{formatCAD(v.tax)}</span></div>)}
          <div className="row grand"><span>{t('total', lang)}</span><span>{formatCAD(sale.total())}</span></div>
          {sale.tenders.length > 0 && !completed && <div className="row due"><span>{t('balance', lang)}</span><span>{formatCAD(Math.max(0, bal))}</span></div>}
        </div>
      </section>

      <section className="right">
        <div className="display">
          <div className="detail">
            {lastItem ? (<>
              <div className="name">{lastItem.description}{lastItem.onSale && <span className="badge">SALE</span>}</div>
              {lastItem.descriptionAlt && <div className="alt">{lastItem.descriptionAlt}</div>}
              <div className="price">{formatCAD(lastItem.price)} <span className="muted">{lastItem.taxCategory}{lastItem.bottleLink ? ` · deposit ${formatCAD(lastItem.bottleLink.deposit)}` : ''}</span></div>
            </>) : <div className="muted">Scan an item or enter a PLU</div>}
          </div>
          <div className="entry">{qty > 1 && <span className="qty">{qty} ×</span>}<span className="buf">{buffer || ' '}</span></div>
          {message && <div className={`msg ${message.kind}`}>{message.text}
            {message.addUpc && operator.level >= MANAGER_LEVEL && <button className="btn small" onClick={() => onAddItem(message.addUpc!)}>+ {t('newItem', lang)}</button>}
          </div>}
        </div>

        <div className="pads">
          <div className="keypad">
            {['7', '8', '9'].map(k => <button key={k} className="key" onClick={() => press(k)}>{k}</button>)}
            <button className="key warn" onClick={() => press('C')}>{t('clear', lang)}</button>
            {['4', '5', '6'].map(k => <button key={k} className="key" onClick={() => press(k)}>{k}</button>)}
            <button className="key side" onClick={() => press('BS')} aria-label="Backspace">⌫</button>
            {['1', '2', '3'].map(k => <button key={k} className="key" onClick={() => press(k)}>{k}</button>)}
            <button className="key side" onClick={setQuantity}>{t('qty', lang)}</button>
            {['0', '00', '.'].map(k => <button key={k} className="key" onClick={() => press(k)}>{k}</button>)}
            <button className="key plu" onClick={() => void enterPlu()}>{t('plu', lang)}</button>
          </div>
          <div className="functions">
            <button className="fn red" onClick={errorCorrect}>{t('errorCorrect', lang)}{selected ? ' ✓' : ''}</button>
            <button className="fn red" onClick={() => void cancelSale()}>{t('cancelSale', lang)}</button>
            <button className="fn blue" onClick={() => void priceCheck()}>{t('priceCheck', lang)}</button>
            <button className="fn gray" onClick={() => void noSale()}>{t('noSale', lang)}</button>
            <button className="fn green big" disabled={sale.activeLines().length === 0 || !!completed} onClick={() => setTendering(true)}>{t('pay', lang)}</button>
          </div>
        </div>

        <div className="depts">
          {depts.map(d => <button key={d.id} className="dept" style={{ background: d.color }} onClick={() => department(d)}>{d.name}{d.ageRestriction ? ` (${d.ageRestriction}+)` : ''}</button>)}
        </div>
      </section>

      {tendering && !completed && (
        <div className="overlay">
          <div className="card tender-card">
            <h2>{t('balance', lang)}: {formatCAD(bal)}</h2>
            <p className="muted">{t('cashDue', lang)}: <b>{formatCAD(sale.cashDue())}</b></p>
            <div className="entry small"><span className="buf">{buffer ? formatCAD(parseAmount(buffer) ?? 0) : ' '}</span></div>
            <div className="keypad compact">
              {['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '00', 'BS'].map(k => <button key={k} className="key" onClick={() => press(k)}>{k === 'BS' ? '⌫' : k}</button>)}
            </div>
            <div className="tender-buttons">
              <button className="fn green" disabled={busy} onClick={() => { const a = parseAmount(buffer); if (a) void payCash(a); else info('Enter the cash amount received', 'error'); }}>{t('cash', lang)}</button>
              <button className="fn green" disabled={busy} onClick={() => void payCash(sale.cashDue())}>{t('exact', lang)}</button>
              {[500, 1000, 2000, 5000, 10000].map(v => <button key={v} className="fn green" disabled={busy} onClick={() => void payCash(v)}>{formatCAD(v)}</button>)}
              <button className="fn blue" disabled={busy} onClick={() => void payCard()}>{t('card', lang)}</button>
              <button className="fn gray" onClick={() => { setTendering(false); resetEntry(); }}>{t('close', lang)}</button>
            </div>
            {message && <div className={`msg ${message.kind}`}>{message.text}</div>}
          </div>
        </div>
      )}

      {completed && (
        <div className="overlay">
          <div className="card done-card">
            <h2>#{completed.number}</h2>
            {completed.change > 0 && <div className="change">{t('change', lang)}: {formatCAD(completed.change)}</div>}
            {completed.printError && <div className="msg error">Printer: {completed.printError}</div>}
            <pre className="receipt">{completed.lines.join('\n')}</pre>
            <button className="btn primary big" autoFocus onClick={startNewSale}>{t('newSale', lang)}</button>
          </div>
        </div>
      )}

      {pending && (
        <div className="overlay">
          <div className="card age-card">
            <h2>{t('ageTitle', lang)}: {pending.age}+</h2>
            <p>{pending.kind === 'item' ? pending.item.description : pending.dept.name}</p>
            <button className="btn primary big" onClick={() => confirmAge(pending.age)}>{t('ageConfirm', lang)}</button>
            <label className="dob">{t('birthDate', lang)} (YYYY-MM-DD)
              <input value={dob} placeholder="2000-01-31" onChange={e => setDob(e.target.value)} />
            </label>
            <button className="btn" onClick={() => { const a = ageFromBirthDate(dob, new Date()); if (a === null) info('Invalid date', 'error'); else confirmAge(a); }}>OK</button>
            <button className="btn danger" onClick={() => confirmAge(-1)}>{t('ageRefuse', lang)}</button>
          </div>
        </div>
      )}
    </div>
  );
}
