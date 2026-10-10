import { Cents } from '@new-pos/core';

/** Device abstractions: the sales engine never talks to hardware directly. */
export interface ReceiptPrinter { print(data: Uint8Array): Promise<void>; status(): Promise<'ONLINE' | 'OFFLINE' | 'PAPER_OUT'> }
export interface CashDrawer { open(): Promise<void>; isOpen(): Promise<boolean> }
export interface Scale { readWeight(): Promise<{ grams: number; stable: boolean }> }

/**
 * Payment terminals are semi-integrated: the terminal handles card data, the POS only sends
 * amounts and receives results, keeping card data out of the POS (smaller PCI scope).
 */
export interface PaymentRequest { amount: Cents; currency: 'CAD' | 'USD'; reference: string; allowTip: boolean }
export interface PaymentResult {
  approved: boolean; amount: Cents; tip: Cents; method: 'INTERAC' | 'CREDIT' | 'WALLET' | 'OTHER';
  authCode?: string; maskedPan?: string; processorRef?: string; message?: string;
}
export interface PaymentTerminal {
  readonly provider: string; // 'stripe' | 'moneris' | 'globalpayments' | 'mock'
  pay(req: PaymentRequest): Promise<PaymentResult>;
  refund(processorRef: string, amount: Cents): Promise<PaymentResult>;
}

/** Mock terminal used by automated tests and training mode. */
export class MockTerminal implements PaymentTerminal {
  readonly provider = 'mock';
  constructor(private declineOver: Cents = Number.MAX_SAFE_INTEGER) {}
  async pay(req: PaymentRequest): Promise<PaymentResult> {
    if (req.amount > this.declineOver) return { approved: false, amount: 0, tip: 0, method: 'CREDIT', message: 'DECLINED' };
    return { approved: true, amount: req.amount, tip: 0, method: 'INTERAC', authCode: 'TEST01', processorRef: `mock-${req.reference}` };
  }
  async refund(processorRef: string, amount: Cents): Promise<PaymentResult> {
    return { approved: true, amount: -amount, tip: 0, method: 'INTERAC', processorRef };
  }
}

/**
 * Generic continuous-output scale parser. Many retail scales stream ASCII frames such as
 * "ST,GS,+0001.250kg" or "  1.25 lb". The exact frame format is model specific and must be
 * configured from the manufacturer's protocol manual; this function covers the parsing step.
 */
export function parseScaleFrame(frame: string, stableToken = 'ST'): { grams: number; stable: boolean } | null {
  const m = /([-+]?\d+(?:\.\d+)?)\s*(kg|g|lb)/i.exec(frame);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  const value = Number(m[1]);
  const unit = m[2].toLowerCase();
  const grams = unit === 'kg' ? value * 1000 : unit === 'lb' ? value * 453.59237 : value;
  return { grams: Math.round(grams), stable: frame.includes(stableToken) };
}

/**
 * USB HID barcode scanners type like a keyboard. Characters arriving faster than a human can
 * type and ending with Enter are treated as a scan.
 */
export class ScanDetector {
  private buf = ''; private last = 0;
  constructor(private onScan: (code: string) => void, private maxGapMs = 35, private minLength = 6) {}
  key(ch: string, now: number): void {
    if (now - this.last > this.maxGapMs) this.buf = '';
    this.last = now;
    if (ch === 'Enter') { if (this.buf.length >= this.minLength) this.onScan(this.buf); this.buf = ''; return; }
    if (ch.length === 1) this.buf += ch;
  }
}
