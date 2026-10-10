import type { SaleSnapshot } from '@new-pos/core';

export interface PrinterSettings {
  mode: 'preview' | 'windows' | 'tcp';
  deviceName: string;   // Windows printer name (mode = windows); empty = default printer
  host: string;         // network ESC/POS printer (mode = tcp)
  port: number;         // usually 9100 for raw printing
  width: number;        // characters per line
  openDrawer: boolean;  // pulse printer-driven cash drawer after cash sales (tcp mode)
}

export interface StoreSettings {
  storeName: string;
  headerLines: string[];
  trailerLines: string[];
  jurisdiction: string;   // 'CA-SK'
  terminal: string;       // '01'
  language: 'en' | 'ko' | 'fr';
  printer: PrinterSettings;
}

export interface Operator { id: string; number: string; name: string; level: number; active: boolean }

export interface Subdepartment {
  id: string; number: number; name: string; taxCategory: string;
  ageRestriction: number | null; showOnScreen: boolean; color: string;
}

export interface BottleLink { id: string; code: number; description: string; depositCents: number; envFeeCents: number }

export interface ItemRecord {
  id: string;
  upc: string;
  description: string;
  descriptionAlt: string;
  subdepartmentId: string;
  taxCategory: string;
  priceCents: number;
  salePriceCents: number | null;
  saleFrom: string | null;   // yyyy-mm-dd inclusive
  saleTo: string | null;     // yyyy-mm-dd inclusive
  costCents: number | null;
  bottleLinkId: string | null;
  ageRestriction: number | null;
  active: boolean;
}

/** Item resolved for selling on a given date (effective price + deposit link + age rule). */
export interface SellableItem {
  upc: string;
  description: string;
  descriptionAlt: string;
  price: number;
  onSale: boolean;
  taxCategory: string;
  ageRestriction?: number;
  bottleLink?: { deposit: number; envFee: number; depositTaxCategory: string };
}

export interface TransactionSummary {
  number: number; businessDate: string; completedAt: string; operator: string;
  kind: string; total: number; itemCount: number;
}

export interface DayReport {
  businessDate: string;
  transactions: number;
  cancelled: number;
  grossSales: number;          // sum of subtotals (excl. tax)
  taxes: Record<string, number>;
  deposits: number;
  envFees: number;
  tenders: Record<string, number>;
  rounding: number;
  noSales: number;
  errorCorrects: number;
}

export interface ImportResult { inserted: number; updated: number; skipped: number; errors: { line: number; message: string }[] }

export interface SavedSale { number: number; snapshot: SaleSnapshot; operatorName: string; completedAt: string }
