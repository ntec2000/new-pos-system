import { Cents, roundDiv } from './money';

export type PriceMethod = 'MARGIN' | 'MARKUP';

/**
 * Suggested retail price from cost, like L-BOSS "Margin / Markup" with "Last digit".
 * percentMilli: 30% = 30000 (percent x 1000).
 * MARGIN: price = cost / (1 - m)      MARKUP: price = cost * (1 + m)
 * lastDigit: truncate the last digit of the computed price and replace it (e.g. 9 -> $x.x9).
 */
export function suggestedRetail(cost: Cents, method: PriceMethod, percentMilli: number, lastDigit?: number): Cents {
  if (cost < 0) throw new Error('cost must be >= 0');
  let price: Cents;
  if (method === 'MARGIN') {
    if (percentMilli >= 100_000) throw new Error('margin must be below 100%');
    price = roundDiv(cost * 100_000, 100_000 - percentMilli);
  } else {
    price = roundDiv(cost * (100_000 + percentMilli), 100_000);
  }
  if (lastDigit !== undefined) {
    if (!Number.isInteger(lastDigit) || lastDigit < 0 || lastDigit > 9) throw new Error('lastDigit 0-9');
    price = Math.floor(price / 10) * 10 + lastDigit;
  }
  return price;
}

/** Actual gross margin in percent x 1000 for a price and cost. */
export function actualMargin(price: Cents, cost: Cents): number {
  if (price <= 0) return 0;
  return roundDiv((price - cost) * 100_000, price);
}
