import { Cents, RoundingMode, taxOn } from './money';

/** One tax (e.g. GST, PST-SK, HST-ON) valid for a date range. Dates are ISO yyyy-mm-dd. */
export interface TaxRate {
  code: string;            // 'GST', 'PST_SK', 'HST_ON', 'QST'
  rateMicro: number;       // 5% = 50000
  validFrom: string;       // inclusive
  validTo?: string;        // exclusive, open-ended when absent
  compoundOn?: string[];   // tax codes this tax is calculated on top of (rare; configurable)
}

/** Which taxes apply to an item tax category inside a jurisdiction. */
export interface TaxRule {
  category: string;        // 'GENERAL', 'BASIC_GROCERY', 'SNACK', 'PREPARED_FOOD', 'FUEL', ...
  taxes: string[];         // tax codes applied to that category
}

export interface Jurisdiction {
  id: string;              // 'CA-SK', 'CA-ON', 'US-ND-...'
  rates: TaxRate[];
  rules: TaxRule[];
  rounding: RoundingMode;
  /** optional special rules evaluated on the whole invoice (e.g. Ontario $4 prepared food rebate) */
  invoiceRules?: InvoiceRule[];
}

export interface TaxableLine {
  lineId: string;
  category: string;
  amount: Cents;           // extended amount after discounts
  exemptTaxes?: string[];  // taxes removed by tax-shift / exemption on this line
}

export interface InvoiceRule {
  id: string;
  /** returns tax codes to remove per line id, for the given invoice */
  apply(lines: TaxableLine[]): Map<string, string[]>;
}

export interface TaxResult {
  byTax: Record<string, { base: Cents; tax: Cents }>;
  total: Cents;
}

export function activeRate(j: Jurisdiction, code: string, onDate: string): TaxRate | undefined {
  return j.rates.find(r => r.code === code && r.validFrom <= onDate && (r.validTo === undefined || onDate < r.validTo));
}

/**
 * Invoice-level calculation: bases are summed per tax, then each tax is rounded once.
 * (Line-level rounding can be added as a jurisdiction option if required.)
 */
export function calculateTax(j: Jurisdiction, lines: TaxableLine[], onDate: string): TaxResult {
  const removals = new Map<string, string[]>();
  for (const rule of j.invoiceRules ?? []) {
    for (const [lineId, codes] of rule.apply(lines)) {
      removals.set(lineId, [...(removals.get(lineId) ?? []), ...codes]);
    }
  }
  const bases: Record<string, Cents> = {};
  for (const line of lines) {
    const rule = j.rules.find(r => r.category === line.category);
    if (!rule) throw new Error(`No tax rule for category ${line.category} in ${j.id}`);
    const removed = new Set([...(line.exemptTaxes ?? []), ...(removals.get(line.lineId) ?? [])]);
    for (const code of rule.taxes) {
      if (removed.has(code)) continue;
      bases[code] = (bases[code] ?? 0) + line.amount;
    }
  }
  const byTax: TaxResult['byTax'] = {};
  // non-compound taxes first, then compound taxes
  const codes = Object.keys(bases).sort((a, b) => {
    const ca = activeRate(j, a, onDate)?.compoundOn?.length ?? 0;
    const cb = activeRate(j, b, onDate)?.compoundOn?.length ?? 0;
    return ca - cb;
  });
  for (const code of codes) {
    const rate = activeRate(j, code, onDate);
    if (!rate) throw new Error(`Tax ${code} has no rate valid on ${onDate}`);
    let base = bases[code] ?? 0;
    for (const dep of rate.compoundOn ?? []) base += byTax[dep]?.tax ?? 0;
    byTax[code] = { base, tax: taxOn(base, rate.rateMicro, j.rounding) };
  }
  const total = Object.values(byTax).reduce((s, t) => s + t.tax, 0);
  return { byTax, total };
}

/**
 * Ontario point-of-sale rebate of the 8% provincial part of HST on qualifying prepared food
 * and beverages when their total is $4.00 or less (CRA GI-064). Modelled with two tax codes:
 * HST_ON_FED (5%) + HST_ON_PROV (8%) so the provincial part can be removed.
 */
export const ontarioPreparedFood4: InvoiceRule = {
  id: 'ON_PREPARED_FOOD_4',
  apply(lines) {
    const qualifying = lines.filter(l => l.category === 'PREPARED_FOOD');
    const total = qualifying.reduce((s, l) => s + l.amount, 0);
    const out = new Map<string, string[]>();
    if (qualifying.length > 0 && total <= 400) {
      for (const l of qualifying) out.set(l.lineId, ['HST_ON_PROV']);
    }
    return out;
  },
};
