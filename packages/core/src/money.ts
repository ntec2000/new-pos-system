/**
 * Money is always stored as integer cents (or integer milli-cents for fuel unit prices).
 * Floating point is never used for amounts.
 */
export type Cents = number;

export type RoundingMode = 'HALF_UP' | 'HALF_EVEN';

/** Round a rational amount (numerator / denominator, both integers) to whole cents. */
export function roundDiv(numerator: number, denominator: number, mode: RoundingMode = 'HALF_UP'): Cents {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0) {
    throw new Error('roundDiv expects integers and a positive denominator');
  }
  const sign = numerator < 0 ? -1 : 1;
  const n = Math.abs(numerator);
  const q = Math.floor(n / denominator);
  const r = n - q * denominator;
  const twice = r * 2;
  let result = q;
  if (twice > denominator) result = q + 1;
  else if (twice === denominator) result = mode === 'HALF_UP' ? q + 1 : (q % 2 === 0 ? q : q + 1);
  return sign * result;
}

/**
 * Tax on a base amount. Rate is expressed in basis points x 100 ("micro-percent")
 * so that 9.975% = 99750 and 5% = 50000 (rate / 1_000_000).
 */
export function taxOn(base: Cents, rateMicro: number, mode: RoundingMode = 'HALF_UP'): Cents {
  return roundDiv(base * rateMicro, 1_000_000, mode);
}

/**
 * Canadian cash rounding to the nearest 5 cents (cash tenders only; card amounts are not rounded).
 * 1,2 -> down to 0 ; 3,4 -> up to 5 ; 6,7 -> down to 5 ; 8,9 -> up to 10.
 */
export function cashRound5(amount: Cents): Cents {
  const sign = amount < 0 ? -1 : 1;
  const a = Math.abs(amount);
  const last = a % 5;
  const rounded = last <= 2 ? a - last : a + (5 - last);
  return sign * rounded;
}

export function formatCAD(c: Cents): string {
  const sign = c < 0 ? '-' : '';
  const a = Math.abs(c);
  return `${sign}$${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}
