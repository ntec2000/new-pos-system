import { roundDiv, taxOn, cashRound5, formatCAD } from '../src/money';
import { calculateTax } from '../src/tax';
import { suggestedRetail, actualMargin } from '../src/pricing';
import { gs1CheckDigit, isValidGs1, parseEmbedded } from '../src/barcode';
import { parseArgs, Dispatcher } from '../src/dispatcher';
import { SASKATCHEWAN, ONTARIO } from '../src/jurisdictions';
import { SK, ON, NS } from './fixtures';

describe('money', () => {
  it('rounds half up and half even', () => {
    expect(roundDiv(5, 10)).toBe(1);
    expect(roundDiv(15, 10, 'HALF_EVEN')).toBe(2);
    expect(roundDiv(25, 10, 'HALF_EVEN')).toBe(2);
    expect(roundDiv(-15, 10)).toBe(-2);
  });
  it('computes 9.975% without floating point', () => {
    expect(taxOn(10_000, 99_750)).toBe(998);
  });
  it('cash rounds to 5 cents', () => {
    expect([101, 102, 103, 104, 106, 107, 108, 109, 100].map(cashRound5)).toEqual([100, 100, 105, 105, 105, 105, 110, 110, 100]);
    expect(cashRound5(-103)).toBe(-105);
    expect(formatCAD(1234)).toBe('$12.34');
    expect(formatCAD(-5)).toBe('-$0.05');
  });
});

describe('tax engine', () => {
  it('Saskatchewan GST 5% + PST 6%', () => {
    const r = calculateTax(SK, [{ lineId: 'a', category: 'GENERAL', amount: 1000 }], '2026-10-10');
    expect(r.byTax.GST?.tax).toBe(50);
    expect(r.byTax.PST_SK?.tax).toBe(60);
    expect(r.total).toBe(110);
  });
  it('built-in SASKATCHEWAN jurisdiction', () => {
    const r = calculateTax(SASKATCHEWAN, [
      { lineId: 'a', category: 'GENERAL', amount: 1000 },
      { lineId: 'b', category: 'BASIC_GROCERY', amount: 500 },
      { lineId: 'c', category: 'FUEL', amount: 4000 },
    ], '2026-10-10');
    expect(r.byTax.GST).toEqual({ base: 5000, tax: 250 });
    expect(r.byTax.PST).toEqual({ base: 1000, tax: 60 });
  });
  it('line exemption removes only the selected tax (tax shift)', () => {
    const r = calculateTax(SK, [{ lineId: 'a', category: 'GENERAL', amount: 1000, exemptTaxes: ['PST_SK'] }], '2026-10-10');
    expect(r.total).toBe(50);
  });
  it('Ontario: provincial 8% removed when prepared food total <= $4.00', () => {
    expect(calculateTax(ON, [{ lineId: 'a', category: 'PREPARED_FOOD', amount: 399 }], '2026-10-10').total).toBe(20);
    expect(calculateTax(ON, [{ lineId: 'a', category: 'PREPARED_FOOD', amount: 401 }], '2026-10-10').total).toBe(52);
    expect(calculateTax(ONTARIO, [{ lineId: 'a', category: 'PREPARED_FOOD', amount: 399 }], '2026-10-10').total).toBe(20);
  });
  it('Nova Scotia rate change by effective date', () => {
    expect(calculateTax(NS, [{ lineId: 'a', category: 'GENERAL', amount: 10_000 }], '2025-03-31').total).toBe(1500);
    expect(calculateTax(NS, [{ lineId: 'a', category: 'GENERAL', amount: 10_000 }], '2025-04-01').total).toBe(1400);
  });
  it('throws for unknown category (configuration error is never silent)', () => {
    expect(() => calculateTax(SK, [{ lineId: 'a', category: 'NOPE', amount: 1 }], '2026-10-10')).toThrow();
  });
});

describe('pricing', () => {
  it('margin vs markup with last digit', () => {
    expect(suggestedRetail(700, 'MARGIN', 30_000)).toBe(1000);
    expect(suggestedRetail(700, 'MARKUP', 30_000)).toBe(910);
    expect(suggestedRetail(700, 'MARKUP', 30_000, 9)).toBe(919);
    expect(actualMargin(1000, 700)).toBe(30_000);
    expect(() => suggestedRetail(700, 'MARGIN', 100_000)).toThrow();
  });
});

describe('barcodes', () => {
  it('GS1 check digit', () => {
    expect(gs1CheckDigit('03600029145')).toBe(2);
    expect(isValidGs1('036000291452')).toBe(true);
    expect(isValidGs1('4006381333931')).toBe(true);
    expect(isValidGs1('4006381333932')).toBe(false);
  });
  it('price-embedded UPC-A with configurable layout', () => {
    const data = '2123450' + '0499';
    const code = data + gs1CheckDigit(data);
    expect(parseEmbedded(code, [{ prefix: '2', itemStart: 1, itemLength: 5, valueStart: 7, valueLength: 4, valueKind: 'PRICE_CENTS' }]))
      .toEqual({ itemCode: '12345', value: 499, kind: 'PRICE_CENTS' });
  });
});

describe('dispatcher', () => {
  it('parses L-POS style arguments', () => {
    expect(parseArgs('/MAX=1000.00 /CHG=100.00')).toEqual({ MAX: '1000.00', CHG: '100.00' });
    expect(parseArgs('/TOG /SWP=+6')).toEqual({ TOG: true, SWP: '+6' });
    expect(parseArgs('')).toEqual({});
  });
  it('runs chained functions in sequence and rejects unknown functions', async () => {
    const calls: string[] = [];
    const d = new Dispatcher().register(1, () => { calls.push('a'); }).register(2, () => { calls.push('b'); });
    await d.run({ input: '' }, [{ seq: 2, functionNo: 2, args: '' }, { seq: 1, functionNo: 1, args: '' }]);
    expect(calls).toEqual(['a', 'b']);
    await expect(d.run({ input: '' }, [{ seq: 1, functionNo: 999, args: '' }])).rejects.toThrow('FUNCTION_NOT_IMPLEMENTED:999');
  });
});
