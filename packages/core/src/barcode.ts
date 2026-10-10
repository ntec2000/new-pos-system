/** GS1 check digit for EAN-8 / UPC-A / EAN-13 / GTIN-14 (data digits without check digit). */
export function gs1CheckDigit(data: string): number {
  if (!/^\d+$/.test(data)) throw new Error('digits only');
  let sum = 0;
  // weights 3,1,3,1... starting from the rightmost data digit
  for (let i = 0; i < data.length; i++) {
    const digit = Number(data[data.length - 1 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGs1(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  return gs1CheckDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

/**
 * Variable-measure (price / weight embedded) barcodes. Layouts differ between scale
 * vendors and stores, therefore the layout is configuration, not code.
 * Example layout for UPC-A "2 IIIII C PPPP C": prefix '2', item 1-5, price 7-10.
 */
export interface EmbeddedLayout {
  prefix: string;            // e.g. '2' or '02'
  itemStart: number; itemLength: number;
  valueStart: number; valueLength: number;
  valueKind: 'PRICE_CENTS' | 'WEIGHT_GRAMS' | 'WEIGHT_CENTI_LB';
}

export interface EmbeddedResult { itemCode: string; value: number; kind: EmbeddedLayout['valueKind'] }

export function parseEmbedded(code: string, layouts: EmbeddedLayout[]): EmbeddedResult | null {
  if (!isValidGs1(code)) return null;
  for (const l of layouts) {
    if (!code.startsWith(l.prefix)) continue;
    const item = code.slice(l.itemStart, l.itemStart + l.itemLength);
    const value = code.slice(l.valueStart, l.valueStart + l.valueLength);
    if (item.length !== l.itemLength || value.length !== l.valueLength) continue;
    return { itemCode: item, value: Number(value), kind: l.valueKind };
  }
  return null;
}
