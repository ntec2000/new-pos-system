import { Sale, SASKATCHEWAN } from '@new-pos/core';
import { EscPos } from '../src/escpos';
import { MockTerminal, parseScaleFrame, ScanDetector } from '../src/devices';
import { receiptLines, receiptEscPos } from '../src/receipt';

describe('ESC/POS', () => {
  it('produces the expected raw bytes', () => {
    const b = new EscPos().initialize().align('center').bold(true).text('A').openDrawer().feedAndPartialCut().build();
    expect(Array.from(b)).toEqual([0x1b, 0x40, 0x1b, 0x61, 1, 0x1b, 0x45, 1, 0x41, 0x1b, 0x70, 0, 0x19, 0xfa, 0x1d, 0x56, 0x42, 0]);
  });
});

describe('devices', () => {
  it('parses scale frames', () => {
    expect(parseScaleFrame('ST,GS,+0001.250kg')).toEqual({ grams: 1250, stable: true });
    expect(parseScaleFrame('US,GS,  2.00 lb')).toEqual({ grams: 907, stable: false });
    expect(parseScaleFrame('garbage')).toBeNull();
  });
  it('detects HID scans vs human typing', () => {
    const scans: string[] = [];
    const d = new ScanDetector(c => scans.push(c));
    let t = 0;
    for (const ch of '036000291452') d.key(ch, (t += 10));
    d.key('Enter', (t += 10));
    for (const ch of '1234567') d.key(ch, (t += 200));
    d.key('Enter', (t += 200));
    expect(scans).toEqual(['036000291452']);
  });
  it('mock terminal approves and declines', async () => {
    const term = new MockTerminal(5000);
    expect((await term.pay({ amount: 1000, currency: 'CAD', reference: 'T1', allowTip: false })).approved).toBe(true);
    expect((await term.pay({ amount: 6000, currency: 'CAD', reference: 'T2', allowTip: false })).approved).toBe(false);
  });
});

describe('receipt', () => {
  const pop = { upc: '1', description: 'COLA 355ML', price: 149, taxCategory: 'GENERAL', bottleLink: { deposit: 10, envFee: 2, depositTaxCategory: 'DEPOSIT' } };
  it('renders totals, taxes, rounding and change within the paper width', () => {
    const s = new Sale(SASKATCHEWAN, '2026-10-10');
    s.addItem(pop);
    s.payCash(500);
    const ctx = { header: { storeName: 'TEST STORE', lines: ['Regina, SK'], trailer: ['Thank you'] }, transactionNumber: 7, terminal: '01', cashier: 'Owner', timestamp: '2026-10-10 09:00', width: 42 };
    const lines = receiptLines(s.snapshot(), ctx);
    expect(lines.every(l => l.length <= 42)).toBe(true);
    expect(lines).toContain('TOTAL' + ' '.repeat(42 - 5 - 5) + '$1.77');
    expect(lines.some(l => l.startsWith('Cash rounding') && l.endsWith('-$0.02'))).toBe(true);
    expect(lines.some(l => l.startsWith('CHANGE') && l.endsWith('$3.25'))).toBe(true);
    expect(lines.some(l => l.startsWith('CASH') && l.endsWith('$1.75'))).toBe(true); // 1.77 due, 1.75 handed over
    const bytes = receiptEscPos(s.snapshot(), ctx, true);
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x1b, 0x40]);
    expect(Array.from(bytes)).toContain(0x70);
  });
});
