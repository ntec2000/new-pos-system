import { formatCAD, SaleSnapshot } from '@new-pos/core';
import { EscPos } from './escpos';

export interface ReceiptHeader {
  storeName: string;
  lines: string[];          // address, phone, GST registration number ...
  trailer: string[];        // thank-you text, return policy ...
}

export interface ReceiptContext {
  header: ReceiptHeader;
  transactionNumber: number;
  terminal: string;
  cashier: string;
  timestamp: string;        // already formatted local time
  width: number;            // characters per line (42 for 80mm Font A is common; configurable)
}

const TAX_LABEL: Record<string, string> = { GST: 'GST', PST: 'PST', HST_FED: 'HST', HST_PROV: 'HST' };

/** Plain-text receipt lines (used for on-screen preview, Windows-driver printing and ESC/POS). */
export function receiptLines(s: SaleSnapshot, c: ReceiptContext): string[] {
  const w = c.width;
  const center = (t: string) => ' '.repeat(Math.max(0, Math.floor((w - t.length) / 2))) + t;
  const cols = (l: string, r: string) => {
    const left = l.length + r.length + 1 > w ? l.slice(0, Math.max(0, w - r.length - 1)) : l;
    return left + ' '.repeat(Math.max(1, w - left.length - r.length)) + r;
  };
  const out: string[] = [];
  out.push(center(c.header.storeName));
  for (const h of c.header.lines) if (h.trim()) out.push(center(h));
  out.push('-'.repeat(w));
  out.push(cols(`#${c.transactionNumber}  T${c.terminal}`, c.timestamp));
  out.push(`Cashier: ${c.cashier}`);
  out.push('-'.repeat(w));
  for (const l of s.lines) {
    if (l.voided) continue;
    const desc = l.qty !== 1 ? `${l.description} x${l.qty}` : l.description;
    out.push(cols(l.parentId ? `  ${desc}` : desc, formatCAD(l.amount)));
  }
  out.push('-'.repeat(w));
  out.push(cols('SUBTOTAL', formatCAD(s.subtotal)));
  for (const [code, t] of Object.entries(s.taxes.byTax)) {
    if (t.tax !== 0) out.push(cols(TAX_LABEL[code] ?? code, formatCAD(t.tax)));
  }
  out.push(cols('TOTAL', formatCAD(s.total)));
  if (s.rounding !== 0) out.push(cols('Cash rounding', formatCAD(s.rounding)));
  // the cash actually handed over includes the 5-cent rounding (applied to the last cash tender)
  const lastCash = s.tenders.map(t => t.kind).lastIndexOf('CASH');
  s.tenders.forEach((t, i) => out.push(cols(t.kind, formatCAD(t.amount + (i === lastCash ? s.rounding : 0)))));
  if (s.change > 0) out.push(cols('CHANGE', formatCAD(s.change)));
  out.push('-'.repeat(w));
  for (const t of c.header.trailer) if (t.trim()) out.push(center(t));
  return out;
}

/** ESC/POS bytes for a receipt printer; optionally opens the printer-driven cash drawer. */
export function receiptEscPos(s: SaleSnapshot, c: ReceiptContext, openDrawer: boolean): Uint8Array {
  const p = new EscPos().initialize();
  const lines = receiptLines(s, c);
  p.align('left');
  lines.forEach((ln, i) => {
    if (i === 0) p.bold(true).line(ln).bold(false);
    else if (ln.startsWith('TOTAL')) p.bold(true).line(ln).bold(false);
    else p.line(ln);
  });
  p.newline().newline().newline();
  if (openDrawer) p.openDrawer(0);
  p.feedAndPartialCut();
  return p.build();
}
