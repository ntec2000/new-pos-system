import { Jurisdiction, ontarioPreparedFood4 } from '../src/tax';

/**
 * EXAMPLE configurations used to test the engine behaviour.
 * Rates: Retail Council of Canada table (SK GST 5% + PST 6%; ON HST 13%; NS HST 15% -> 14% on 2025-04-01).
 * Category-to-tax assignments marked "to confirm" are placeholders until verified against official bulletins.
 */
export const SK: Jurisdiction = {
  id: 'CA-SK',
  rounding: 'HALF_UP',
  rates: [
    { code: 'GST', rateMicro: 50_000, validFrom: '1991-01-01' },
    { code: 'PST_SK', rateMicro: 60_000, validFrom: '2017-03-23' },
  ],
  rules: [
    { category: 'GENERAL', taxes: ['GST', 'PST_SK'] },
    { category: 'SNACK', taxes: ['GST', 'PST_SK'] },         // PST on snack foods since 2017-04-01
    { category: 'BASIC_GROCERY', taxes: [] },                // GST zero-rated; PST status: to confirm
    { category: 'DEPOSIT', taxes: [] },                      // to confirm
  ],
};

export const ON: Jurisdiction = {
  id: 'CA-ON',
  rounding: 'HALF_UP',
  rates: [
    { code: 'HST_ON_FED', rateMicro: 50_000, validFrom: '2010-07-01' },
    { code: 'HST_ON_PROV', rateMicro: 80_000, validFrom: '2010-07-01' },
  ],
  rules: [
    { category: 'GENERAL', taxes: ['HST_ON_FED', 'HST_ON_PROV'] },
    { category: 'PREPARED_FOOD', taxes: ['HST_ON_FED', 'HST_ON_PROV'] },
  ],
  invoiceRules: [ontarioPreparedFood4],
};

export const NS: Jurisdiction = {
  id: 'CA-NS',
  rounding: 'HALF_UP',
  rates: [
    { code: 'HST_NS', rateMicro: 150_000, validFrom: '2016-07-01', validTo: '2025-04-01' },
    { code: 'HST_NS', rateMicro: 140_000, validFrom: '2025-04-01' },
  ],
  rules: [{ category: 'GENERAL', taxes: ['HST_NS'] }],
};
