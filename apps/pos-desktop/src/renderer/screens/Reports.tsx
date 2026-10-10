import { useEffect, useState } from 'react';
import { formatCAD } from '@new-pos/core';
import { receiptLines, receiptEscPos } from '@new-pos/devices';
import { api, errorText, today } from '../api';
import { t, Lang } from '../i18n';
import type { DayReport, StoreSettings, TransactionSummary } from '../../shared/types';

export function ReportsScreen({ settings, lang }: { settings: StoreSettings; lang: Lang }) {
  const [date, setDate] = useState(today());
  const [report, setReport] = useState<DayReport | null>(null);
  const [txs, setTxs] = useState<TransactionSummary[]>([]);
  const [receipt, setReceipt] = useState<string[] | null>(null);
  const [msg, setMsg] = useState('');

  const load = async () => {
    try { const [r, list] = await Promise.all([api.dayReport(date), api.listTransactions(date)]); setReport(r); setTxs(list); }
    catch (e) { setMsg(errorText(e)); }
  };
  useEffect(() => { void load(); }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  const show = async (n: number, print: boolean) => {
    const s = await api.getTransaction(n);
    if (!s) return;
    const ctx = { header: { storeName: settings.storeName, lines: settings.headerLines, trailer: [...settings.trailerLines, '*** COPY ***'] },
      transactionNumber: s.number, terminal: settings.terminal, cashier: s.operatorName, timestamp: s.completedAt.slice(0, 16).replace('T', ' '), width: settings.printer.width };
    const lines = receiptLines(s.snapshot, ctx);
    setReceipt(lines);
    if (print && settings.printer.mode !== 'preview') {
      try { await api.print(settings.printer, lines, receiptEscPos(s.snapshot, ctx, false)); } catch (e) { setMsg(errorText(e)); }
    }
  };

  return (
    <div className="admin">
      <div className="card admin-list">
        <div className="row-form"><h3>{t('reports', lang)}</h3><input type="date" value={date} onChange={e => setDate(e.target.value)} /><button className="btn" onClick={() => void load()}>↻</button></div>
        {msg && <div className="msg error">{msg}</div>}
        {report && (
          <table className="grid report"><tbody>
            <tr><td>Transactions</td><td>{report.transactions}</td></tr>
            <tr><td>Cancelled sales</td><td>{report.cancelled}</td></tr>
            <tr><td>Net sales (before tax, incl. deposits)</td><td>{formatCAD(report.grossSales)}</td></tr>
            <tr><td>  of which deposits</td><td>{formatCAD(report.deposits)}</td></tr>
            <tr><td>  of which environmental fees</td><td>{formatCAD(report.envFees)}</td></tr>
            {Object.entries(report.taxes).map(([k, v]) => <tr key={k}><td>Tax {k}</td><td>{formatCAD(v)}</td></tr>)}
            {Object.entries(report.tenders).map(([k, v]) => <tr key={k}><td>Tender {k}</td><td>{formatCAD(v)}</td></tr>)}
            <tr><td>Cash rounding</td><td>{formatCAD(report.rounding)}</td></tr>
            <tr><td>No Sale (drawer opened)</td><td>{report.noSales}</td></tr>
            <tr><td>Error corrections</td><td>{report.errorCorrects}</td></tr>
          </tbody></table>
        )}
        <h4>Transactions</h4>
        <table className="grid"><thead><tr><th>#</th><th>Time</th><th>Cashier</th><th>Type</th><th>Items</th><th>Total</th><th></th></tr></thead>
          <tbody>{txs.map(x => (
            <tr key={x.number}><td>{x.number}</td><td>{x.completedAt.slice(11, 16)}</td><td>{x.operator}</td><td>{x.kind}</td><td>{x.itemCount}</td><td>{formatCAD(x.total)}</td>
              <td><button className="btn small" onClick={() => void show(x.number, false)}>View</button>
                <button className="btn small" onClick={() => void show(x.number, true)}>{t('reprint', lang)}</button></td></tr>))}</tbody></table>
      </div>
      <div className="card admin-edit">{receipt ? <pre className="receipt">{receipt.join('\n')}</pre> : <p className="muted">Select a transaction to view its receipt.</p>}</div>
    </div>
  );
}
