# New POS System (working name)

Open-source point-of-sale for Canadian **gas stations, convenience stores and grocery stores**, built for **Windows 11**.
First target: **Saskatchewan**, designed to extend to the rest of Canada and North America.

> **Status: v0.1.0 pilot release.** Single-lane, offline-capable POS. Real card-processor, fuel-controller and
> hardware certification work is **not** done yet (see *Limitations*). Do not use in production before a site pilot.

[한국어 안내 (Korean)](README.ko.md)

## Features in v0.1.0

| Area | What works |
|---|---|
| Selling | PLU / barcode entry (USB HID scanners type like a keyboard), quantity multiplier, open-price department keys, error correct (selected or last line), cancel sale, price check, No Sale (manager, logged) |
| Canadian tax | Effective-dated tax engine: Saskatchewan GST 5% + PST 6%, Ontario HST 13% with the $4 prepared-food rule, category-based rules, integer-cent math |
| Deposits | Bottle deposit + environmental handling charge (EHC) lines added automatically and voided with the item; SARCAN deposit schedule pre-loaded (EHC amounts set by the store) |
| Age check | Item / sub-department age rules (Saskatchewan tobacco = 19), ID confirmation or date-of-birth check, refusals logged |
| Payment | Cash with Canadian 5-cent rounding (cash only), quick bills, split tender, card recorded after approval on a stand-alone terminal |
| Receipts | Screen preview, Windows printer driver, or network ESC/POS printer (raw TCP 9100) with printer-driven cash drawer |
| Back office | Item maintenance (cost, margin/markup with last-digit rounding, period sale price, deposit link, age rule, alternate name e.g. Korean), sub-departments, deposit links, operators/PINs |
| Import | CSV item lists, price updates, weekly/monthly sale fixed-length TXT, L-BOSS SIL item files; L-BOSS import modes 1/2/3/20 with preview and error list |
| Reports | Day report (sales, taxes by code, tenders, deposits, EHC, rounding, No Sale, error corrections), transaction list, receipt reprint |
| Data | Local SQLite database (sql.js), atomic save with `.bak` copy, audit log |
| Languages | English, 한국어, Français (UI) |

## Install (Windows 11)

1. Download `New-POS-System-Setup-<version>.exe` from **Releases**.
2. Run the installer. Windows SmartScreen may warn because the installer is not code-signed yet: *More info → Run anyway*.
3. Start **New POS System**. Demo sign-in: operator **6** / PIN **1234** (manager), operator **1** / PIN **1111** (cashier).
   **Change both PINs in Settings before real use.**

Data is stored in `%APPDATA%\New POS System\data\newpos.sqlite` (path shown in Settings).

## Development

Requires Node.js 24.

```bash
npm ci
npm run typecheck
npm test
npm run build                       # Electron main/preload + renderer
npm run dev:web -w @new-pos/pos-desktop   # browser demo with in-browser database
npm run dist:win                    # Windows NSIS installer (run on Windows)
```

```
packages/core        money, tax engine, pricing, barcodes, sale engine, function dispatcher
packages/importers   SIL reader, CSV / fixed-length templates
packages/devices     ESC/POS builder, receipt rendering, device interfaces (scale, scanner, payment)
apps/pos-desktop     Electron + React lane application, SQLite repository
```

GitHub Actions run type checks and tests on Ubuntu and Windows for every push, build the Windows installer,
and attach it to every published GitHub Release.

## Limitations (v0.1.0)

- **Card payments:** no processor integration yet. Use a stand-alone terminal and record the approved card amount.
  Planned: Stripe Terminal, then Moneris and Global Payments (semi-integrated; no card data in the POS).
- **Fuel:** no forecourt-controller integration; the FUEL sub-department is an open-price key.
- **Scales / serial devices:** scale protocol drivers and serial printers are not included yet.
- **Multi-lane / store server / head office sync:** not included (single lane only).
- **Tax items to confirm:** Saskatchewan PST scope on basic groceries, tax on deposits/EHC, fuel tax handling and
  CRA rounding/receipt requirements must be confirmed against official sources before go-live. All rules are
  configurable data, not hard-coded logic.
- The installer is not code-signed.

## License

Apache License 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE). Copyright 2026 Sang-Mi Consulting Ltd.
This is an independent clean-room implementation and contains no Logivision L-POS / L-BOSS code or assets.
