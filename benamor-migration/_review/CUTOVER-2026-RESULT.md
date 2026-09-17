# 2026 cutover import — built, simulated, proven (2026-09-16, main session)

**Deliverable: `benamor-migration/import_2026_cutover.sql`** — the script to run.
`import_to_supabase.sql` (full history) is untouched and stays as fallback.

## What the cutover script does differently

1. Keeps every sale dated **2026-01-01 or later (2,700)** plus every older sale with
   `balance_due > 0` (**38 open invoices**) → settled 2024/2025 history stays only in the old backup.
2. Items/payments follow their sale (no orphans, no FK violations possible — enforced and tested).
3. Deletes the 439 pre-2026 customer-ledger entries and replaces them with **one deterministic
   `opening` row per customer** (id from `md5()`, dated 2026-01-01) → 30 rows, total **41,990.479**.
4. Clears the reference on 27 ledger entries whose 2026 payments paid settled old invoices
   (entry kept — the money is real — only the dead pointer nulled).
5. Everything else imports in FULL: products 4,509 · customers (+171) · suppliers 94 ·
   purchases 699 + items 4,210 + supplier ledger 699 · proformas 15 · transfers 518 ·
   expenses 3,275 · stock 4,458 (+movements).
6. Adds `\encoding UTF8` (Windows-psql Arabic safety).

## Proof executed (PGlite, migrations 0001–0056 + current 2,330 live customers)

- Both scripts run clean end-to-end; **re-runs insert nothing** (zero drift, both).
- Per-customer final balances: cutover vs full-history — **0 differences** across all customers.
- Totals: receivable **46,962.079** (identical both ways); invoice-level `balance_due` sum
  **49,254.079** (identical — the 5 no-customer debt invoices λ 2,292 are all kept).
- The 5 documented header/lines mismatches: 4 cut (fully settled), 1 stays (**2025-ين-10**,
  kept because it still owes 3,760) → verification prints `header_vs_lines_mismatch = 1`.
- One noise note: the app sizes after this — `loadAll` ≈ 3.5 MB, essential cache ≈ 3.0 MB (fits 5 MB).

## Expected outputs when you run it (compare before/after COMMIT)

```
counts inserted from migration (2026 cutover):
  sales 2,738 · sale_items 7,606 · sale_payments 2,691
  customer_ledger 348   (= 318 of 2026 + 30 openings)
    opening rows 30 · refs cleared to null 27
  products_new 4,509* · customers_new 171* · suppliers_new 94*
  purchases 699 · expenses 3,275 · stock_rows_added 4,458* · skipped 1
must-be-0 row:  orphan_items 0 · header_vs_lines_mismatch 1 · orphan_ledger 0
                sales_without_location 0 · duplicate_invoice_no 0
opening balances: 30 customers · 41,990.479
receivable from migrated ledger: 46,962.079   ← must equal this exactly
sales by year/branch:
  2024  فرع 11 يونيو   1 doc          2,200.000 total    2,200.000 due
  2024  فرع السراج      3 docs         1,235.000           610.000
  2025  فرع 11 يونيو  11 docs         6,957.829         6,407.829
  2025  فرع السراج     23 docs        18,550.500         8,459.500
  2026  فرع 11 يونيو 900 docs     1,382,881.750        22,273.750
  2026  فرع السراج  1,800 docs      750,496.764         9,303.000
```
\* on the EMPTY test project. On real production these are smaller (existing products/stock
are protected) — `customers_new` depends on live phone matching then.

## Run protocol (unchanged)

```bat
set PGCLIENTENCODING=UTF8
cd benamor-migration
psql "<CONNECTION_STRING>" -v DRY_RUN=1 -f import_2026_cutover.sql
```
Compare with the numbers above → then re-run with `-v DRY_RUN=0`. Production: after hours,
after a Supabase backup.

## Not tested (honestly)

- Real Supabase project / production data beyond current customers + schema chain.
- On-device app speed after import (static analysis only: risks now small, cache fits).
