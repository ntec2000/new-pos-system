import { Sale } from '../src/sale';
import { SASKATCHEWAN } from '../src/jurisdictions';

const pop = { upc: '067000000000', description: 'COLA 355ML', price: 149, taxCategory: 'GENERAL',
  bottleLink: { deposit: 10, envFee: 2, depositTaxCategory: 'DEPOSIT' } };
const smokes = { upc: '062000000000', description: 'CIGARETTES', price: 1800, taxCategory: 'TOBACCO', ageRestriction: 19 };
const milk = { upc: '068700000001', description: 'MILK 2L', price: 489, taxCategory: 'BASIC_GROCERY' };

describe('sale', () => {
  it('adds deposit + EHC lines and voids them with the item', () => {
    const s = new Sale(SASKATCHEWAN, '2026-10-10');
    const l = s.addItem(pop, 2);
    expect(s.subtotal()).toBe(298 + 20 + 4);
    s.errorCorrect(l.id);
    expect(s.subtotal()).toBe(0);
  });
  it('error-corrects the last item', () => {
    const s = new Sale(SASKATCHEWAN, '2026-10-10');
    s.addItem(milk); s.addItem(pop);
    expect(s.errorCorrectLast()).toBe(true);
    expect(s.subtotal()).toBe(489);
  });
  it('blocks age restricted items without verification', () => {
    const s = new Sale(SASKATCHEWAN, '2026-10-10');
    expect(() => s.addItem(smokes)).toThrow('AGE_VERIFICATION_REQUIRED:19');
    expect(() => s.addItem(smokes, 1, 18)).toThrow();
    expect(() => s.addItem(smokes, 1, 19)).not.toThrow();
  });
  it('cash payment applies 5-cent rounding and change', () => {
    const s = new Sale(SASKATCHEWAN, '2026-10-10');
    s.addItem(pop, 1); // 1.49+0.10+0.02 ; tax 11% on 1.49 = 0.07+0.09 ; total 1.77
    expect(s.total()).toBe(177);
    expect(s.cashDue()).toBe(175);
    expect(s.payCash(500)).toEqual({ change: 325, rounding: -2, complete: true });
    expect(s.isComplete()).toBe(true);
    expect(() => s.addItem(milk)).toThrow('SALE_COMPLETE');
    expect(s.snapshot().rounding).toBe(-2);
  });
  it('partial cash then card (split tender)', () => {
    const s = new Sale(SASKATCHEWAN, '2026-10-10');
    s.addItem(milk); s.addItem(pop);
    s.payCash(200);
    expect(s.isComplete()).toBe(false);
    s.payCard(s.balance(), 'mock-1');
    expect(s.isComplete()).toBe(true);
  });
  it('open department sale and cancel', () => {
    const s = new Sale(SASKATCHEWAN, '2026-10-10');
    s.addOpen('GROCERY', 250, 'BASIC_GROCERY');
    expect(s.total()).toBe(250);
    s.cancel();
    expect(s.isCancelled).toBe(true);
    expect(() => s.addOpen('X', 1, 'GENERAL')).toThrow('SALE_CANCELLED');
  });
  it('rejects card amount above balance and invalid quantities', () => {
    const s = new Sale(SASKATCHEWAN, '2026-10-10');
    s.addItem(milk);
    expect(() => s.payCard(s.balance() + 1, 'x')).toThrow('INVALID_AMOUNT');
    expect(() => s.addItem(milk, 0)).toThrow('INVALID_QUANTITY');
  });
});
