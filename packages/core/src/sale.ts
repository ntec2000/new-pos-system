import { Cents, cashRound5 } from './money';
import { Jurisdiction, calculateTax, TaxableLine, TaxResult } from './tax';

export interface Item {
  upc: string;
  description: string;
  price: Cents;
  taxCategory: string;
  bottleLink?: { deposit: Cents; envFee: Cents; depositTaxCategory: string } | undefined;
  ageRestriction?: number | undefined;
  scalable?: boolean | undefined;
}

export type LineKind = 'ITEM' | 'OPEN' | 'DEPOSIT' | 'ENV_FEE' | 'DISCOUNT';

export interface Line {
  id: string;
  kind: LineKind;
  upc?: string | undefined;
  description: string;
  qty: number;
  unitPrice: Cents;
  amount: Cents;
  taxCategory: string;
  voided: boolean;
  parentId?: string | undefined;
}

export type TenderKind = 'CASH' | 'CARD' | 'GIFT' | 'ACCOUNT';
export interface Tender { kind: TenderKind; amount: Cents; reference?: string | undefined }

/** Function numbers kept close to L-POS for operator familiarity (101 cash, 104 credit, 610 error correct, 710 PLU). */
export const FN = { CASH: 101, CHECK: 102, CREDIT: 104, ERROR_CORRECT: 610, CANCEL_SALE: 630, REFUND: 650, PLU: 710 } as const;

export interface SaleSnapshot {
  businessDate: string;
  lines: Line[];
  tenders: Tender[];
  subtotal: Cents;
  taxes: TaxResult;
  total: Cents;
  rounding: Cents;
  change: Cents;
  cancelled: boolean;
}

export class Sale {
  readonly lines: Line[] = [];
  readonly tenders: Tender[] = [];
  private n = 0;
  private roundingTotal: Cents = 0;
  private changeGiven: Cents = 0;
  private cancelled = false;

  constructor(private jurisdiction: Jurisdiction, readonly businessDate: string) {}

  /** Add an item; bottle-linked items automatically add deposit and environmental fee lines. */
  addItem(item: Item, qty = 1, verifiedAge?: number): Line {
    this.assertOpen();
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('INVALID_QUANTITY');
    if (item.ageRestriction !== undefined && item.ageRestriction !== null && (verifiedAge === undefined || verifiedAge < item.ageRestriction)) {
      throw new Error(`AGE_VERIFICATION_REQUIRED:${item.ageRestriction}`);
    }
    const line = this.push({ kind: 'ITEM', upc: item.upc, description: item.description, qty, unitPrice: item.price, taxCategory: item.taxCategory });
    if (item.bottleLink) {
      const b = item.bottleLink;
      if (b.deposit > 0) this.push({ kind: 'DEPOSIT', description: 'Deposit', qty, unitPrice: b.deposit, taxCategory: b.depositTaxCategory, parentId: line.id });
      if (b.envFee > 0) this.push({ kind: 'ENV_FEE', description: 'Env. fee (EHC)', qty, unitPrice: b.envFee, taxCategory: b.depositTaxCategory, parentId: line.id });
    }
    return line;
  }

  /** Open-price department sale (L-POS sub-department key): amount entered by the cashier. */
  addOpen(description: string, amount: Cents, taxCategory: string): Line {
    this.assertOpen();
    if (!Number.isInteger(amount) || amount <= 0) throw new Error('INVALID_AMOUNT');
    return this.push({ kind: 'OPEN', description, qty: 1, unitPrice: amount, taxCategory });
  }

  /** Error correct (function 610): voids a line and the deposit/fee lines attached to it. */
  errorCorrect(lineId: string): void {
    this.assertOpen();
    for (const l of this.lines) if (l.id === lineId || l.parentId === lineId) l.voided = true;
  }

  /** Error correct the last active item line. Returns false when nothing to correct. */
  errorCorrectLast(): boolean {
    const last = [...this.lines].reverse().find(l => !l.voided && !l.parentId);
    if (!last) return false;
    this.errorCorrect(last.id);
    return true;
  }

  /** Cancel sale (function 630). Not allowed after a tender was applied. */
  cancel(): void {
    if (this.tenders.length > 0) throw new Error('CANNOT_CANCEL_WITH_TENDERS');
    this.cancelled = true;
  }

  get isCancelled(): boolean { return this.cancelled; }

  activeLines(): Line[] { return this.lines.filter(l => !l.voided); }
  itemCount(): number { return this.activeLines().filter(l => l.kind === 'ITEM' || l.kind === 'OPEN').reduce((s, l) => s + l.qty, 0); }
  subtotal(): Cents { return this.activeLines().reduce((s, l) => s + l.amount, 0); }

  taxes(): TaxResult {
    const taxable: TaxableLine[] = this.activeLines().map(l => ({ lineId: l.id, category: l.taxCategory, amount: l.amount }));
    return calculateTax(this.jurisdiction, taxable, this.businessDate);
  }

  total(): Cents { return this.subtotal() + this.taxes().total; }
  paid(): Cents { return this.tenders.reduce((s, t) => s + t.amount, 0); }
  balance(): Cents { return this.total() - this.paid(); }

  /** Amount due if the remaining balance is paid in cash (rounded to 5 cents). */
  cashDue(): Cents { return cashRound5(this.balance()); }

  /** Cash tender: applies 5-cent rounding on the cash portion and returns change due. */
  payCash(received: Cents): { change: Cents; rounding: Cents; complete: boolean } {
    this.assertOpen();
    if (!Number.isInteger(received) || received <= 0) throw new Error('INVALID_AMOUNT');
    const due = this.balance();
    const roundedDue = cashRound5(due);
    if (received < roundedDue) {
      this.tenders.push({ kind: 'CASH', amount: received });
      return { change: 0, rounding: 0, complete: false };
    }
    this.tenders.push({ kind: 'CASH', amount: due });
    const rounding = roundedDue - due;
    this.roundingTotal += rounding;
    this.changeGiven = received - roundedDue;
    return { change: this.changeGiven, rounding, complete: true };
  }

  /** Card tender (approved by the payment terminal). Card amounts are never rounded. */
  payCard(amount: Cents, reference: string): void {
    this.assertOpen();
    if (!Number.isInteger(amount) || amount <= 0 || amount > this.balance()) throw new Error('INVALID_AMOUNT');
    this.tenders.push({ kind: 'CARD', amount, reference });
  }

  isComplete(): boolean { return !this.cancelled && this.lines.some(l => !l.voided) && this.balance() <= 0; }

  snapshot(): SaleSnapshot {
    return {
      businessDate: this.businessDate,
      lines: this.lines.map(l => ({ ...l })),
      tenders: this.tenders.map(t => ({ ...t })),
      subtotal: this.subtotal(),
      taxes: this.taxes(),
      total: this.total(),
      rounding: this.roundingTotal,
      change: this.changeGiven,
      cancelled: this.cancelled,
    };
  }

  private assertOpen(): void {
    if (this.cancelled) throw new Error('SALE_CANCELLED');
    if (this.tenders.length > 0 && this.balance() <= 0) throw new Error('SALE_COMPLETE');
  }

  private push(p: Omit<Line, 'id' | 'amount' | 'voided'>): Line {
    const line: Line = { ...p, id: `L${++this.n}`, amount: Math.round(p.unitPrice * p.qty), voided: false };
    this.lines.push(line);
    return line;
  }
}
