# Benamor POS — Database Migrations & Verification

This folder turns the full production database design into a **verified, ordered
migration chain** plus tooling to prove it rebuilds an identical schema from an
empty database, and a test suite for the accounting-integrity layer.

## Contents

| Path | Purpose |
|---|---|
| `migrations/0001..0045_*.sql` | The complete schema chain, in the exact order they must run on an **empty** database. Each file is a verbatim copy of its source file in `apps/pos/benamor-sales-system/` (marked ⚙️ where a chain-fix was needed). |
| `local-verify.js` | Applies the whole chain on a real PostgreSQL (PGlite/WASM) over a Supabase-environment shim, then exports the resulting schema. |
| `local-shim.sql` | Local-testing only (NOT a migration): creates the `anon`/`authenticated`/`service_role` roles, `auth.users`/`auth.identities`, `extensions`+pgcrypto — everything Supabase provides natively. |
| `extract-live-schema.sql` | Read-only catalog extraction (tables/views/functions/policies/triggers). Runs identically on production (SQL Editor) and locally. |
| `compare-schemas.js` | Diffs two schema exports (CSV from live vs JSON from local). |
| `schema-local.json` | Generated output of `local-verify.js` (git-ignored, regenerable). |

## 1) Run the tests (one command)

```bash
npm install        # once — installs @electric-sql/pglite (local Postgres for tests)
npm test
```

Two suites run:

* `tests/accounting-integrity.test.js` — the client-side `AccountingIntegrity`
  engine from the production `app.js`: simple cash sale, mixed payment,
  credit sale, return invoice, line+invoice discounts, zero/negative qty &
  price handling, account-to-account transfer, float rounding, and
  **deliberately unbalanced transactions must throw**.
* `tests/server-transactions.test.js` — builds the entire database from
  `supabase/migrations`, seeds minimal data, then calls the real RPCs:
  cash/mixed/credit sales with full effect assertions (stock, payments,
  finance movements, customer ledger), full return flow, line+invoice
  discounts, **qty=0 / negative qty / negative price rejected by the server**,
  the offline-queue stock guard (`INSUFFICIENT_STOCK_QUEUED`), idempotency
  replay (same key ⇒ one row), and branch-permission assertions.

### Prove the "must fail" acceptance criterion

Break the balance on purpose and watch tests fail:

```bash
# e.g. remove the Accounts_Receivable line in a copy of app.js, then:
APP_JS=/tmp/broken-app.js npm test        # → at least one test FAILS
npm test                                  # → all pass again
```

## 2) Verify the chain locally (fresh DB → full schema)

```bash
node supabase/local-verify.js
```

Applies `0001..0045` in order on a fresh PGlite database. Current result:
**45/45 apply cleanly** producing 34 tables, 4 views, 31 functions,
76 policies, 9 triggers, 1 sequence — and writes `schema-local.json`.

## 3) Build a staging environment from scratch

1. Create a new (empty) Supabase project.
2. In its SQL Editor run the migration files **in filename order**
   (`0001_core_tables.sql` → `0045_offline_queue.sql`). Each file is
   self-contained and idempotent-guarded where history required it.
3. Create staff accounts from the POS admin screen (or via `create_app_user`).

No Supabase CLI needed; plain SQL Editor works. (The chain is also compatible
with `supabase db push` conventions if you adopt the CLI later.)

## 4) Compare staging/local schema vs production (drift detection)

1. **Production (read-only):** run `extract-live-schema.sql` in the production
   SQL Editor → Download CSV → save as `schema-live.csv`.
   (The query only reads catalog tables — it modifies nothing.)
2. **Local:** `node supabase/local-verify.js` → `schema-local.json`
   (same extraction query).
3. **Diff:**

```bash
node supabase/compare-schemas.js schema-live.csv supabase/schema-local.json
```

Expected known diffs (see "Reconstructed objects" below) will list
`carts`, `cart_items`, `save_pricechecker_cart`, `pos_import_staging`.
Everything else should match; any additional difference is real drift between
the repository chain and production and must be reconciled.

## LIVE PARITY — verified 2026-09-14 (full reconciliation complete)

A full live export (`schema-live.csv`, produced by `extract-live-schema.sql`
on production) was compared against the chain-built schema
(`schema-local.json`). **Result: 169 objects on each side, zero objects
missing on either side, and exactly ONE definition difference:**

* `post_sale_transaction` — the chain includes the offline-queue stock guard
  (`0045`) which has NOT been run on production yet. Running
  `supabase-pos-offline-queue.sql` in production closes the last gap and
  makes the schemas 100% identical.

### Objects that existed only live (now reproduced verbatim)
* `0036_web_and_legacy_tables.sql` — `app_users` + `login_app_user()` (legacy
  prototype auth; `carts.app_user_id` FK points to it), `product_costs`,
  `staff_roles`, `web_products`, `web_orders`, `web_order_items` + all their
  policies (website catalog & orders).
* `0037_pricechecker_carts_tables.sql` — `carts`, `cart_items`, their 8
  per-command policies and the REAL `save_pricechecker_cart()` (returns jsonb)
  — rebuilt VERBATIM from the live export.
* `0043` (⚙️ block) — real `pos_import_staging` definition (product-import
  staging, PK=code).
* `0047_post_purchase_sales_purchase.sql` — production's
  `post_purchase_transaction` allows the `sales_purchase` role (repo files
  did not); live version adopted verbatim.

### Files never run on production (moved to `_excluded/`)
* `numbering-setup` — would add product_no/purchase_no/return_no/transfer_no/
  proforma_no columns, `next_pos_number()` and 7 triggers; production only
  ever applied sales invoice numbering (`invoice_numbering_fix`). Excluded to
  match live exactly.
* (finance-payment-methods WAS excluded then RESTORED — production does have
  `accepted_methods`, added via ALTER, so it runs at 0011.)

## Chain fixes (⚙️ markers inside migration copies)

History left a few files that could not run standalone on an empty database.
The chain copies fix them, each marked with a `⚙️ إصلاح سلسلة` comment:

| File | Fix | Why |
|---|---|---|
| `0001_core_tables` | purchase/transfer item qty checks `> 0` (source file says `<> 0`) | production tables kept the original checks; only sale_items was later changed |
| `0004_customer_enhancements` | add `customer_no` (before `phone2`) + its unique index | columns/index existed in production only (added manually), in that order |
| `0008_audit_log_pricing` | add `pos_products.description` | column exists in production only (added manually, last position) |
| `0010_finance` | remove inline `accepted_methods` | in production the column was added later via ALTER (0011), so it is the LAST column |
| `0043_role_policies_phase3` | create real `pos_import_staging` | table existed only live |

## Excluded from the chain (on purpose)

* `supabase-pos-fresh-start.sql` — destructive data wipe (keep out of any chain).
* `supabase-pos-import-*.sql`, `supabase-pos-fill-wholesale-prices.sql` —
  one-off **data** migrations, not schema.
* `supabase-pos-pricechecker-public-read.sql` — deprecated, superseded by
  `0039_rls_lockdown` (would re-open anon access — never re-run).

## Notes

* `local-shim.sql` is for local testing only — a real Supabase project already
  provides roles, `auth` schema and pgcrypto.
* Grants (GRANT/REVOKE) are intentionally excluded from schema comparison:
  they legitimately differ between environments.
* The chain ends at the latest known state including the offline-queue guard
  (`0045`) and the expenses audit-list migration (`0046`). Any future change to the live database must land as a new numbered
  migration in this folder — that is the whole point of the chain.
