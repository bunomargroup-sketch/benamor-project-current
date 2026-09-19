# Rehearsal of `import_v3_corrected.sql` — PGlite simulation, 2026-09-19

Fixture (`/tmp/inject_live_v3.sql`, realistic kkqb live state):
- 3 live twin sales mirroring staged window invoices س-7491 (110.000), س-7493 (40.000), س-7494 (1400.000), all 2026-09-09, each with movement rows mirroring the staged effects exactly (re-entry = faithful copy).
- 1 live-only sale 2026-09-18 (post-snapshot → exercises stock delta path).
- 1 live transfer twin (السراج→11 يونيو, 09-09) + items/moves mirroring staged transfer old_id=210000284; 1 live expense twin (حواله 70.000, 09-09).
- 2 dirty live customers with colliding phones (fan-out gate coverage).

## Pass-1 (DRY RUN) anchors — all green
| check | sim | expected |
|---|---|---|
| sales_bulk (2026 ≤09-08 + owing) | 2,681 | 2,681 ✓ |
| window twins skipped (live exists) | 3 | 3 ✓ |
| window net imported (no live twin) | 66 | 66 ✓ |
| pos_sales total after pass | 2,751 | 2,681+66+4 live = 2,751 ✓ |
| sale_items / payments / customer_ledger | 7,620 / 2,702 / 788 (30 openings = 41,990.479) | — |
| purchases / expenses / transfers | 699 / 3,281 / 518 | ✓ |
| live twins deleted (transfer / expense) | 1 / 1 | 1 / 1 ✓ |
| movement journal rows inserted | 38,683 | 38,695 − 12 twin-linked = 38,683 ✓ |
| stock rows written | 4,444 | 4,450 − 4 fixture-overlapped + 2 live-only |
| **per-pair qty == Σ movements (HARD)** | **0 violations** | 0 ✓ |
| receivable: migrated raw-ledger net | **46,892.079** | = snapshot ✓ (left_to_live null: sim twins carry no ledger rows) |
| orphan items / ledger / sales-without-location | 0 / 0 / 0 | ✓ |
| header≷lines mismatches (informational) | 29 | real old-system data noise (2024–2026 receipts; header total authoritative) |
| idempotency (commit → re-run) | zero drift | ✅ |

## Defects fixed during rehearsal (none reach prod)
1. Payment-ref nulling for skipped sales ran after the ledger insert → moved before.
2. Broken receivable block tail; rewritten to compare migrated raw-ledger net vs 46,892.079 with separately-printed openings.
3. Fixture: text-null into uuid customer_id (union typing); fixed with `null::uuid`.
4. `UPDATE … JOIN target alias inside FROM` → moved to WHERE (PG restriction).
5. Expenses lacked `account_id`/archive-account setup (prod NOT NULL) → added archive account `أرشيف النظام القديم (Cadence)` + category `مصاريف تاريخية` (idempotent create-if-missing).
6. Sales/expenses staging carried old-system columns that don't exist in prod (`transfer_no`, `purchase_no`) → dropped/coalesced like v1.

Production expectations at run time: same anchors; twin/skipped counts printed live; receivable split `migrated_net + left_to_live_net = 46,892.079`.
