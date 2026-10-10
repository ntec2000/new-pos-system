# Changelog

## v0.1.0 — 2026-10-10 (pilot)

First public pilot release.

- Single-lane Windows 11 POS (Electron + React) with local SQLite database
- Canadian tax engine (Saskatchewan GST+PST, Ontario HST with $4 prepared-food rule), effective-dated rates
- Deposits and environmental fee lines, age verification, cash 5-cent rounding, split tender
- Item maintenance with margin/markup pricing and period sale prices; sub-departments, deposit links, operators
- Import: CSV, fixed-length weekly/monthly sale TXT, L-BOSS SIL item files (modes 1/2/3/20)
- Day report, transaction list, receipt reprint, audit log
- Receipt printing: preview, Windows printer driver, network ESC/POS with cash drawer
- English / Korean / French UI
- CI on Ubuntu and Windows; Windows installer attached to GitHub Releases
