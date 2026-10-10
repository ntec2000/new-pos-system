import { Jurisdiction, ontarioPreparedFood4 } from './tax';

/**
 * Built-in jurisdictions.
 *
 * Rates verified against the Retail Council of Canada table (2026-10):
 *   SK: GST 5% + PST 6%  |  ON: HST 13%  |  NS: HST 14% from 2025-04-01 (15% before)
 * Saskatchewan PST applies to restaurant meals and snack foods since 2017-04-01.
 *
 * Category assignments marked TO_CONFIRM are configuration defaults that must be checked
 * against official Saskatchewan / CRA bulletins before production use. Stores can override
 * every rule from Settings without code changes.
 */
export const TAX_CATEGORIES = ['GENERAL', 'SNACK', 'PREPARED_FOOD', 'BASIC_GROCERY', 'TOBACCO', 'FUEL', 'DEPOSIT', 'EXEMPT'] as const;
export type TaxCategory = (typeof TAX_CATEGORIES)[number];

export const SASKATCHEWAN: Jurisdiction = {
  id: 'CA-SK',
  rounding: 'HALF_UP', // TO_CONFIRM: CRA rounding guidance
  rates: [
    { code: 'GST', rateMicro: 50_000, validFrom: '1991-01-01' },
    { code: 'PST', rateMicro: 60_000, validFrom: '2017-03-23' },
  ],
  rules: [
    { category: 'GENERAL', taxes: ['GST', 'PST'] },
    { category: 'SNACK', taxes: ['GST', 'PST'] },
    { category: 'PREPARED_FOOD', taxes: ['GST', 'PST'] },
    { category: 'TOBACCO', taxes: ['GST', 'PST'] },
    { category: 'BASIC_GROCERY', taxes: [] },   // GST zero-rated; PST scope TO_CONFIRM
    { category: 'FUEL', taxes: ['GST'] },       // TO_CONFIRM before fuel go-live
    { category: 'DEPOSIT', taxes: [] },         // TO_CONFIRM
    { category: 'EXEMPT', taxes: [] },
  ],
};

export const ONTARIO: Jurisdiction = {
  id: 'CA-ON',
  rounding: 'HALF_UP',
  rates: [
    { code: 'HST_FED', rateMicro: 50_000, validFrom: '2010-07-01' },
    { code: 'HST_PROV', rateMicro: 80_000, validFrom: '2010-07-01' },
  ],
  rules: TAX_CATEGORIES.map(category => ({
    category,
    taxes: category === 'BASIC_GROCERY' || category === 'DEPOSIT' || category === 'EXEMPT' ? [] : ['HST_FED', 'HST_PROV'],
  })),
  invoiceRules: [{ ...ontarioPreparedFood4, apply: lines => {
    const qualifying = lines.filter(l => l.category === 'PREPARED_FOOD');
    const total = qualifying.reduce((s, l) => s + l.amount, 0);
    const out = new Map<string, string[]>();
    if (qualifying.length > 0 && total <= 400) for (const l of qualifying) out.set(l.lineId, ['HST_PROV']);
    return out;
  } }],
};

export const JURISDICTIONS: Record<string, Jurisdiction> = {
  [SASKATCHEWAN.id]: SASKATCHEWAN,
  [ONTARIO.id]: ONTARIO,
};
