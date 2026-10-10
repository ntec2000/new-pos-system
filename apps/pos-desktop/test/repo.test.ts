import initSqlJs from 'sql.js';
import { Sale, SASKATCHEWAN } from '@new-pos/core';
import { Repo } from '../src/shared/repo';

async function newRepo(): Promise<{ repo: Repo; saves: () => number }> {
  const SQL = await initSqlJs();
  let count = 0;
  const repo = new Repo(new SQL.Database(), () => { count++; });
  await repo.init();
  return { repo, saves: () => count };
}

describe('lane database', () => {
  it('seeds operators, sub-departments, SARCAN deposit links and sample items', async () => {
    const { repo } = await newRepo();
    expect(repo.listOperators().map(o => o.name)).toEqual(['Cashier 1', 'Owner']);
    expect(repo.listSubdepartments()).toHaveLength(8);
    expect(repo.listBottleLinks().map(b => b.depositCents)).toEqual([10, 25, 10, 20, 40, 5]);
    expect(repo.listBottleLinks().every(b => b.envFeeCents === 0)).toBe(true); // EHC must be set by the store
    expect(repo.getSettings().jurisdiction).toBe('CA-SK');
  });

  it('logs in with PIN and records failed attempts', async () => {
    const { repo } = await newRepo();
    expect((await repo.login('6', '1234'))?.name).toBe('Owner');
    expect(await repo.login('6', '0000')).toBeNull();
    expect(repo.listAudit().map(a => a.action)).toEqual(expect.arrayContaining(['LOGIN', 'LOGIN_FAILED']));
  });

  it('resolves sellable items: deposit link, sub-department age rule, leading zeros', async () => {
    const { repo } = await newRepo();
    expect(repo.sellable('11', '2026-10-10')).toMatchObject({ price: 149, bottleLink: { deposit: 10, envFee: 0 } });
    expect(repo.sellable('000000000016', '2026-10-10')).toMatchObject({ ageRestriction: 19, taxCategory: 'TOBACCO' });
    expect(repo.sellable('999999', '2026-10-10')).toBeNull();
  });

  it('applies period sale prices only inside the date range', async () => {
    const { repo } = await newRepo();
    const item = repo.getItemByUpc('000000000013')!;
    repo.saveItem({ ...item, salePriceCents: 399, saleFrom: '2026-10-12', saleTo: '2026-10-18' }, 'test');
    expect(repo.sellable('000000000013', '2026-10-11')?.price).toBe(489);
    expect(repo.sellable('000000000013', '2026-10-12')).toMatchObject({ price: 399, onSale: true });
    expect(repo.sellable('000000000013', '2026-10-19')?.price).toBe(489);
    expect(() => repo.saveItem({ ...item, upc: 'ABC' }, 'test')).toThrow('UPC_INVALID');
  });

  it('saves a sale and the day report matches the transaction', async () => {
    const { repo, saves } = await newRepo();
    const before = saves();
    const op = (await repo.login('1', '1111'))!;
    const sale = new Sale(SASKATCHEWAN, '2026-10-10');
    const cola = repo.sellable('000000000011', '2026-10-10')!;
    sale.addItem(cola, 2);
    sale.addItem(repo.sellable('000000000013', '2026-10-10')!);
    const chips = sale.addItem(repo.sellable('000000000015', '2026-10-10')!);
    sale.errorCorrect(chips.id);
    sale.payCash(2000);
    const no = repo.saveTransaction(sale.snapshot(), op.id);
    expect(no).toBe(1);
    expect(saves()).toBeGreaterThan(before);
    const rep = repo.dayReport('2026-10-10');
    expect(rep.transactions).toBe(1);
    expect(rep.grossSales).toBe(sale.subtotal());
    expect(rep.deposits).toBe(20);
    expect(rep.taxes.GST! + rep.taxes.PST!).toBe(sale.taxes().total);
    expect(rep.tenders.CASH).toBe(sale.total());
    expect(rep.rounding).toBe(sale.snapshot().rounding);
    expect(rep.errorCorrects).toBe(1);
    expect(repo.getTransaction(1)?.snapshot.total).toBe(sale.total());
    expect(repo.listTransactions('2026-10-10')[0]).toMatchObject({ number: 1, itemCount: 3 });
  });

  it('imports items with L-BOSS modes and reports errors', async () => {
    const { repo } = await newRepo();
    const r1 = repo.importItems([
      { upc: '000000000013', price: 499 },
      { upc: '777000000001', description: 'NEW ITEM', price: 250, subdepartment: 2 },
      { upc: 'BAD', price: 1 },
      { upc: '777000000002', price: 100 },
    ], 1, 'test');
    expect(r1).toMatchObject({ inserted: 1, updated: 1, skipped: 0 });
    expect(r1.errors.map(e => e.line)).toEqual([3, 4]);
    expect(repo.getItemByUpc('777000000001')?.taxCategory).toBe('GENERAL');
    const r3 = repo.importItems([{ upc: '000000000014', salePrice: 299, from: '2026-10-12', to: '2026-10-18' }, { upc: '888', price: 1 }], 3, 'test');
    expect(r3).toMatchObject({ updated: 1, skipped: 1, inserted: 0 });
    expect(repo.sellable('000000000014', '2026-10-13')?.price).toBe(299);
  });

  it('validates operator PINs and numbers', async () => {
    const { repo } = await newRepo();
    await expect(repo.saveOperator({ number: '2', name: 'New', level: 1, active: true }, 'x')).rejects.toThrow('PIN_REQUIRED');
    await expect(repo.saveOperator({ number: '2', name: 'New', level: 1, active: true, pin: '12' }, 'x')).rejects.toThrow('PIN_INVALID');
    await repo.saveOperator({ number: '2', name: 'New', level: 1, active: true, pin: '2468' }, 'x');
    expect((await repo.login('2', '2468'))?.name).toBe('New');
  });
});
