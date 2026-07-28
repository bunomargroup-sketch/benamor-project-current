# POS/ERP Audit Action Plan

This file captures the actionable priorities from the professional POS/ERP audit pasted in the conversation.

## Current Status

Already implemented or partially implemented:

- New sales use `post_sale_transaction` RPC for atomic posting.
- New purchases use `post_purchase_transaction` RPC for atomic posting (SQL + frontend wiring created).
- New stock transfers use `post_stock_transfer_transaction` RPC for atomic posting (SQL + frontend wiring created).
- Backend invoice numbering has been started.
- Atomic stock mutation helper `pos_adjust_stock_checked` exists.
- Customer refund support for negative sales exists.
- Decimal currency input support exists.
- F3 product picker and keyboard checkout improvements exist.
- Payment drawer no longer blocks the whole sale table.

## Highest Priority Remaining Work

### Phase 1 — Urgent Protection

1. Create `post_purchase_transaction` RPC. **Done for new purchases.**
2. Create `post_stock_transfer_transaction` RPC. **Done for new transfers.**
3. Create `post_sale_return_transaction` RPC with cumulative return validation. **Done for original-invoice returns.**
4. Remove or restrict unlinked return lines inside normal checkout. **Done: normal sale RPC rejects negative quantities and UI no longer offers unlinked returns.**
5. Add historical cost snapshot on sale items: `unit_cost_at_sale`. **Done for new sales through Phase 1 hardening SQL.**
6. Stop silent finance movement failures. **Done in frontend helper: finance movement failures now throw instead of being swallowed. Transactional RPCs also require finance accounts for payments/refunds.**
7. Persist sale draft idempotency key across retries until confirmed. **Done for sale/purchase/transfer/return drafts in frontend.**
8. Add stronger backend validation for discounts, prices, quantities, and paid amounts. **Done for Phase 1 RPCs.**
9. Ensure branch and role checks happen inside RPCs, not only in the UI. **Done as Phase 1 helper SQL + transactional RPC redefinitions; needs live Supabase deployment/testing.**
10. Review XSS escaping in render functions. **Phase 1 review done: high-risk renderers/options/rows escaped in POS frontend; continue escaping-by-default in future edits.**

### Phase 2 — Cashier Workflow

1. Add parked/suspended sales.
2. Add safe draft recovery.
3. Simplify dashboard duplicate quick actions.
4. Improve F8/F9/F10 behavior to open payment drawer and focus the correct field.
5. Improve Escape behavior to close topmost layer.
6. Add confirmation before clearing non-empty invoice.
7. Add supervisor approvals for discounts, price overrides, returns, voids, and negative stock overrides.

### Phase 3 — Backend Hardening

1. Move sale edits to `amend_or_void_sale_transaction`.
2. Move purchases, transfers, returns, payments, expenses, salaries, and finance transfers into RPCs.
3. Add strict RLS by role and branch.
4. Add seller-safe product views excluding purchase cost and margin.
5. Add immutable journal tables and double-entry posting.
6. Add historical cost and allocated discount fields for reporting.
7. Add audit logs.

### Phase 4 — Advanced ERP Features

1. Cashier shifts and drawer reconciliation.
2. Physical stock counts.
3. Purchase orders and goods receipt.
4. Supplier returns.
5. Wholesale and customer-specific prices.
6. Barcode-label printing.
7. Bundles and kits.
8. WhatsApp invoice sharing.
9. Management exception dashboard.

## Recommended Next Implementation Step

Start with:

```text
post_purchase_transaction
```

Reason: Purchase posting currently affects inventory, supplier ledger, payments, and finance through separate frontend requests. This is one of the highest-risk workflows after sales.

## Deployment Rule

For each backend hardening task:

1. Create SQL/RPC file.
2. Upload/run SQL in Supabase first.
3. Update `updated-html-files/benamor-sales-system/index.html`.
4. Upload POS file.
5. Test using cache-busting URL.
