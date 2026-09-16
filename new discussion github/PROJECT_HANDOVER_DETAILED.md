# Ben Amor / Bun Omar Group — Detailed Project Handover

Date prepared: 2026-07-27

This handover is for starting a new AI-agent conversation without losing project context. It covers the Price Checker, Admin apps, public website, POS/ERP system, Supabase setup, deployment files, DNS/domain work, and the current implementation state.

---

## ⭐ CURRENT STATE — 2026-09-16 (read this first; the sections below are from 2026-07-27)

**Deployment**: follow `DEPLOYMENT-RUNBOOK.md` (Arabic, one safe order: pricechecker files → db push → POS files). **Never apply migration 0053 before the new pricechecker build is live on the shop tablet** (it revokes the anon stock reads the old build depends on).

**Test infrastructure (biggest change since July)**: `npm test` → 160 tests in `tests/` (node:test + @electric-sql/pglite WASM Postgres for server/migration tests; VM harness for client tests). Migrations 0001..0055 build a full local DB; RLS tested via `set role`. Running the suite re-stamps builds via `scripts/bump-build.js` (now also stamps the pricechecker single-file app: PC_BUILD + sw CACHE).

**Migrations 0049–0055 (all single-statement DO blocks, SQL-Editor-safe, idempotent)**:
- 0049 suppliers dedup v2 (prod expectation 175→90 suppliers, 4445 products-with-supplier unchanged)
- 0050 location_category_rules (471 rows expected on prod) + admin screen in locations tab
- 0051 pos_stock_requests + pos_record_stock_request RPC (silent cashier demand signal, hit_count)
- 0052 pos_suggestion_dismissals (30-day dismiss)
- 0053 anon lockdown (revoke all anon on pos_*, legacy pricechecker2 tables incl. app_users code_hash column grant, login_app_user + next_pos_invoice_number; web_orders/web_order_items keep INSERT, web_products keeps column-level SELECT of the 15 public catalog columns — cost never exposed; in-transaction guard)
- 0054 created_by backfill from pos_audit_log (single distinct user only; pre-measurement query in file header)
- 0055 return-without-invoice (sale_id nullable + reason CHECK + price_edited; post_sale_return_transaction no-invoice branch for all users — owner decision, no limits/approval; UI button in both salesList panels, mandatory reason, explicit account select; audit log + dashboard line + returns-list badge/reason column)

**Transfer suggestions feature (complete: Tasks 1–4)**: 3-list suggestions screen in transfers tab + «جرد مطلوب» sub-tab (negative stock sorted most-negative-first, CSV export w/ BOM, shelf print) + clickable negatives banner. `supabase/verify-0049-0052.sql` = one-query structure check (run after db push).

**Pricechecker (apps/pricechecker/index.html)**: authenticated catalog reads — all REST calls via fetchWithAuthRetry (Bearer + 401→refresh→retry once), auth-gated boot (zero data calls without session), offline cache display without update, visible build fingerprint. Single file + sw.js.

**POS sale screen**: reorganized per consultant spec (merged topbar with chips: date/customer/price/details, shortcuts line, prominent barcode strip, conditional stock-context strip, rail 9→6 buttons — price-edit & margins moved to row right-click menu, viewport-height column layout ≥10 item rows at 900px, fixed orange pay bar #d97706 always visible). Margin row coloring (red <5% incl. negative, orange 5–15, yellow 15–30, none ≥30; on effective line price after discount; thresholds 5/15/30 in Settings/APP_CONFIG). Customer search fixes: whole chip opens panel, Enter guarded, rebuild-on-open.

**Build stamps**: POS + pricechecker both at `b20260916-1339` (stamped by test runs; fingerprint visible in POS Settings and pricechecker top bar/login card). Upload-ready copies in `updated-html-files/benamor-sales-system/` (4 files + all supabase-pos-*.sql mirrors incl. anon-lockdown, created-by-backfill, return-without-invoice) and `updated-html-files/pricechecker/` (2 files).

**Awaiting the owner (blocks everything remaining)**: device verification of pricechecker auth (before 0053 push), db push of 0049–0055 + verification numbers (90 suppliers / **471 rules — exact** / anon script results), device verification of the sale-screen fixes and جرد مطلوب counts (~222 rows / 215 products).


---

## 1. Main Live URLs

### Price Checker / Seller app

```text
https://bunomargroup-sketch.github.io/pricechecker2/
```

Main file:

```text
index.html
updated-html-files/index.html
```

Purpose:

- Internal fast product search and selling assistant.
- Product lookup.
- Cart and saved carts.
- Margins for authorized users.
- Quotations / print / WhatsApp.
- PWA installable.

### Admin app

```text
https://bunomargroup-sketch.github.io/pricechecker2/admin.html
```

Files:

```text
admin.html
updated-html-files/admin.html
```

Purpose:

- Website orders/admin functions.
- Product/admin operations.
- Security-sensitive admin-only area.

### Website product/photo manager

```text
https://bunomargroup-sketch.github.io/pricechecker2/admin-shop.html
```

Files:

```text
admin-shop.html
updated-html-files/admin-shop.html
```

Purpose:

- Manage public website products.
- Manage descriptions, visibility, featured status, photos.
- New thumbnail system added for product images.

### Public website

Current GitHub URL:

```text
https://bunomargroup-sketch.github.io/pricechecker2/shop/
```

New domain / Cloudflare Pages target:

```text
https://benamorgroup.store
https://www.benamorgroup.store
```

Files:

```text
shop/index.html
shop/robots.txt
shop/sitemap.xml
benamorgroup-store-site.zip
```

Purpose:

- Public Arabic customer-facing product website.
- Product cards, cart, WhatsApp/contact, product detail modal, customer order submission.

### POS / ERP system

```text
https://bunomargroup-sketch.github.io/benamor-sales-system/
```

Files:

```text
benamor-sales-system/index.html
updated-html-files/benamor-sales-system/index.html
```

Purpose:

- Full Arabic POS/ERP system.
- Sales, purchases, returns, stock, transfers, suppliers, customers/زبائن, debts, finance accounts, expenses, salaries, reports, product movements, proformas, daily cash closing, right-click menus, barcode/F3 workflows, PWA.

---

## 2. Supabase Project

Project URL:

```text
https://kkqbkumobeimwuscxztu.supabase.co
```

Frontend anon key is embedded in frontend files and is expected.

Important rule:

- Never put a service_role key in HTML, GitHub, or frontend code.
- If admin-only DB operations require elevated privilege, create Supabase RPC/security-definer functions carefully.

Staff Auth domain:

```text
@bag.com
```

Frontend login convention:

```text
identifier + code/password
identifier -> identifier@bag.com
```

Known roles in POS:

```text
admin
seller_11
seller_sarraj
sales_purchase
warehouse
accountant
viewer
```

New role added:

```text
sales_purchase = بيع وشراء الفرعين
```

This role can sell and create purchases in both sales branches, view products/customers/suppliers/purchases/stock, but is not admin and cannot manage users/settings/payroll/finance unless explicitly granted.

---

## 3. Important Business Rules

- No VAT / no tax in POS reports or invoices.
- UI should use Arabic.
- Use “زبون” not “عميل”.
- POS must favor speed and experienced-user workflows.
- Branch selected at login should control branch context.
- Sellers should not see sensitive cost/margin data unless explicitly authorized.
- Frontend hiding is not security. Sensitive data must be protected by RLS/views/RPCs.
- Important documents should be immutable or amended through RPCs/void/reversal, not unsafe client-side multi-step edits.

---

## 4. Current Major Completed Work

### Price Checker

Implemented/modified:

- Auth-based login using Supabase Auth.
- Stronger login gate added so app should show login if no valid session.
- Refresh token handling exists in parts of the app.
- Product data updated from CSV to 4369 products.
- Embedded cost fields removed from seller app product data.
- Costs loaded from private table `product_costs` using authenticated session.
- Cost batch loading fixed for >1000 rows.
- Saved cart RLS issue addressed with RPC:

```text
supabase-pricechecker-save-cart-rpc.sql
updated-html-files/supabase-pricechecker-save-cart-rpc.sql
```

- Saved cart RPC now uses `user_id` not `app_user_id` for Auth/RLS compatibility.
- Price Checker login now asks branch before login and saves `branch_name` into saved carts.
- POS can load branch-visible Price Checker carts via RPC.

Known Price Checker files:

```text
apps/pricechecker/index.html
apps/pricechecker/supabase-pricechecker-save-cart-rpc.sql
updated-html-files/index.html
updated-html-files/supabase-pricechecker-save-cart-rpc.sql
```

Important current notes:

- If login behaves oddly on old tablets/PWA, clear browser/site cache or reinstall PWA.
- For saving carts, Supabase must have latest `save_pricechecker_cart` RPC installed.
- If saved carts fail, check Console for RLS/constraint errors.

---

### POS / ERP

Implemented/modified:

#### Authentication and login UX

- POS login became a standalone screen.
- Main app is hidden until login.
- Branch is selected at login.
- Sales branch is hidden for normal sellers and assigned from login branch.
- `sales_purchase`/admin can select branch where needed.

#### Sales screen / cashier workflow

- Fast cashier layout with barcode input, F3 product picker, payment drawer, keyboard shortcuts.
- Payment drawer no longer covers the whole invoice table.
- Tablet payment sheet improved.
- Keyboard shortcuts:

```text
F3 = product picker
F6 = save no print
F7 = save and print
F8 = cash payment
F9 = bank transfer
F10 = card
Shift+Enter or NumPad+ = instant cash out
/ or ~ = focus barcode
Delete = remove selected sale line
F2 = focus selected row quantity
Esc = close topmost layer
```

- Parked/suspended sales added.
- Draft recovery added for active sale.
- Confirmation before clearing non-empty invoice.
- Right-click context menu expanded.
- Copy cell/row/selected text available in right-click menu for all tables.

#### Margin / cost

- Margin toggle fixed; sale screen hides/shows margin columns.
- Margin is based on product cost. Cost function now tries:
  1. Weighted average from `pos_purchase_items`.
  2. Historical `unit_cost_at_sale` if available.
  3. Product `purchase_price` fallback.
- Added `unit_cost_at_sale` in Phase 1 hardening SQL for new sales.

#### Atomic RPCs / backend hardening

Implemented SQL files:

```text
supabase-pos-post-sale-transaction.sql
supabase-pos-post-purchase-transaction.sql
supabase-pos-post-stock-transfer-transaction.sql
supabase-pos-post-sale-return-transaction.sql
supabase-pos-atomic-stock-rpc.sql
supabase-pos-phase1-cost-and-return-hardening.sql
supabase-pos-phase1-rpc-permissions-hardening.sql
supabase-pos-rpc-permission-helpers.sql
```

Functional intent:

- New sales are saved atomically via `post_sale_transaction`.
- New purchases are saved atomically via `post_purchase_transaction`.
- New stock transfers are saved atomically via `post_stock_transfer_transaction`.
- Sale returns linked to original invoice are saved atomically via `post_sale_return_transaction`.
- Stock changes use `pos_adjust_stock_checked` to lock and reject negative stock.
- RPCs were patched to include role/location checks.

Known caveat:

- Editing existing sale/purchase/transfer still may follow older multi-step flows. Future work should implement amendment/void RPCs.

#### Daily operations

- Moved `المصاريف` out of Finance into independent `العمليات اليومية → المصاريف`.
- Moved `إغلاق الخزينة اليومي` out of reports into independent `العمليات اليومية → إغلاق الخزينة اليومي`.
- Daily cash closing report:
  - Calculates sales cash/card/transfer.
  - Expenses cash/card/transfer.
  - Customer payments.
  - Supplier payments.
  - Refunds.
  - Cash remaining.
  - Printable report.
  - Saved closings table.
  - Transfer cash remaining to manager cash drawer preparation.

Important SQL:

```text
supabase-pos-daily-cash-closing.sql
supabase-pos-expenses-branch.sql
```

#### Expenses

- Expense branch is automatic from login and hidden/disabled.
- Expense payment method controls available accounts:
  - Cash -> branch cash drawer.
  - Card/bank transfer -> bank/card accounts.
- Expense categories can be added from Settings.

#### Settings improvements

- Settings now include:
  - Business name/tagline/currency/low stock threshold.
  - Add product brands/companies, models, colors without editing code.
  - Add expense categories without editing code.

#### Roles and permissions

- Added role `sales_purchase`.
- Added RPC for admin role management:

```text
supabase-pos-role-management-rpc.sql
```

- Direct writes to `pos_user_roles` are intentionally blocked by RLS; admins must use RPC.
- If new user login says “identifier or code incorrect”, create the Auth user in Supabase Authentication as `identifier@bag.com` and set password/code, then assign role.

#### Price Checker carts in POS

- Added POS button: `سلات الباحث`.
- POS can load open Price Checker carts for branch employees via RPC:

```text
supabase-pos-pricechecker-carts-rpc.sql
```

- Carts can be opened into POS sale invoice and edited on the device.
- After sale is saved, cart status is marked `converted`.
- Price Checker stores `branch_name` in saved carts.

Known issue fixed:

- RPC schema cache issue: function now takes dummy JSON parameter `p_dummy` and frontend calls with `{p_dummy:{}}`.

#### Customers import

Customer CSV imported/processed from:

```text
uploads/Untitled spreadsheet - Sheet2.csv
```

Generated files:

```text
customers-current-clean.csv
customers-import-skipped.csv
supabase-pos-customers-constraints.sql
pos-customers-import.sql
updated-html-files/supabase-pos-customers-constraints.sql
updated-html-files/pos-customers-import.sql
```

Stats:

- Original rows: 2339.
- Clean import rows: 2330.
- Skipped: 9 duplicate phone rows.

Important constraints:

- `customer_no` unique where non-empty.
- Cleaned phone unique where non-empty/non-zero.

#### Long list picker

Added modal picker for long lists:

- Existing customer.
- Supplier lists.
- Product supplier.
- Customer payments/customer ledger.
- Brand/model/color fields.

Search supports name/code/phone where relevant.

---

### Public Website / Cloudflare Pages

Domain:

```text
benamorgroup.store
www.benamorgroup.store
```

Domain is now on Cloudflare.

Cloudflare Pages package:

```text
benamorgroup-store-site.zip
```

Inside package:

```text
index.html
assets/
robots.txt
sitemap.xml
README_ADD_IMAGES_AR.txt
DEPLOY_TO_CLOUDFLARE.txt
```

Website SEO:

- Added `robots.txt`.
- Added `sitemap.xml` with product links.
- Updated `title`, `description`, OG URL/image to new domain.
- Product links use query-string URLs such as:

```text
https://benamorgroup.store/?product=VP20483-...
```

Hero image:

- Code checks for `assets/showroom-N.png` if user later adds them.
- Fallback uses existing hero images if showroom images missing.

Product image thumbnails:

- Added `thumbnail_paths` support in public website.
- Product cards prefer `thumbnail_paths[0]`; fallback to `image_paths[0]`.
- Images use `loading="lazy" decoding="async" width/height`.

Important SQL:

```text
supabase-web-products-thumbnails.sql
updated-html-files/supabase-web-products-thumbnails.sql
```

---

### Admin-Shop thumbnails

`admin-shop.html` was updated:

- Upload now compresses images client-side.
- Creates full WebP around 1200px quality 0.82.
- Creates thumbnail WebP around 600px quality 0.72.
- Saves paths:

```text
image_paths
thumbnail_paths
```

- Added buttons:

```text
توليد صور مصغرة لهذا المنتج
توليد صور مصغرة لكل المنتجات
```

- Old photo thumbnails can be generated without requiring original filenames to match product code.
- Thumbnails are stored under product code folder for organization.

Important caveat:

- Products with old images but empty `image_paths` cannot generate thumbnails until the image path is linked to product.

---

## 5. Important SQL Files

### Price Checker / seller app

```text
supabase-pricechecker-save-cart-rpc.sql
```

### Website

```text
supabase-website-setup.sql
supabase-web-products-thumbnails.sql
```

### POS core setup

```text
supabase-pos-setup.sql
supabase-pos-sales-setup.sql
supabase-pos-sale-payments.sql
supabase-pos-finance-setup.sql
supabase-pos-products-setup.sql
supabase-pos-products-color-update.sql
supabase-pos-proforma-setup.sql
supabase-pos-returns-barcode-discount-reorder.sql
supabase-pos-numbering-setup.sql
supabase-pos-users-setup.sql
```

### POS hardening / additions

```text
supabase-pos-invoice-numbering-fix.sql
supabase-pos-negative-sale-items-setup.sql
supabase-pos-customer-refund-setup.sql
supabase-pos-atomic-stock-rpc.sql
supabase-pos-post-sale-transaction.sql
supabase-pos-post-purchase-transaction.sql
supabase-pos-post-stock-transfer-transaction.sql
supabase-pos-post-sale-return-transaction.sql
supabase-pos-phase1-cost-and-return-hardening.sql
supabase-pos-phase1-rpc-permissions-hardening.sql
supabase-pos-rpc-permission-helpers.sql
supabase-pos-role-management-rpc.sql
supabase-pos-sales-purchase-role.sql
supabase-pos-pricechecker-carts-rpc.sql
supabase-pos-daily-cash-closing.sql
supabase-pos-expenses-branch.sql
```

### Customers import

```text
supabase-pos-customers-constraints.sql
pos-customers-import.sql
```

### Security lockdown

```text
security-lockdown.sql
security-lockdown-round2.sql
```

---

## 6. Deployment Rules

For POS backend changes:

1. Run required SQL in Supabase first.
2. Wait 30-60 seconds if a new RPC was created.
3. If RPC not found, run:

```sql
notify pgrst, 'reload schema';
```

4. Upload HTML after SQL.
5. Use cache-busting URLs.

For frontend uploads:

- POS:

```text
updated-html-files/benamor-sales-system/index.html -> /benamor-sales-system/index.html
```

- Price Checker:

```text
updated-html-files/index.html -> /pricechecker2/index.html
```

- Admin:

```text
updated-html-files/admin.html -> /pricechecker2/admin.html
updated-html-files/admin-shop.html -> /pricechecker2/admin-shop.html
```

- Website GitHub copy:

```text
updated-html-files/shop/index.html -> /pricechecker2/shop/index.html
```

- Website Cloudflare Pages:

```text
benamorgroup-store-site.zip -> Cloudflare Pages direct upload
```

---

## 7. Known Recent Issues and Fixes

### Price Checker save cart

Problem:

- RLS rejected direct saves.
- `app_user_id` FK mismatch.

Fix:

- RPC `save_pricechecker_cart` created.
- It uses `user_id = auth.uid()`.
- It no longer writes `app_user_id` in SQL RPC.
- If it still fails, run latest `supabase-pricechecker-save-cart-rpc.sql`.

### POS reading Price Checker carts

Problem:

- PostgREST schema cache could not find function without parameters.

Fix:

- Function changed to accept dummy JSON parameter.
- POS calls:

```js
rpc('pos_get_branch_pricechecker_carts',{p_dummy:{}})
```

### POS cart list error `norm is not defined`

Fix:

- Replaced `norm` with `normText` in POS Price Checker cart modal.

### Login on old tablets / Price Checker

Problem:

- Login says success but app does not open.
- Or blank blue screen.

Fixes attempted:

- Strict login gate added.
- Duplicate old `updateLogin` removed.
- `applyAuthDisplay` added.
- Login now uses `authSession.user.id` fallback.

If still problematic:

- Clear site data on tablet.
- Delete/reinstall PWA.
- Test with Chrome.

### Admin-shop login

Problem:

- It showed “غير مصرح” immediately due to stale session.

Fix:

- Clears stale `adminShopAuthSession` and asks login again.
- Adds button to re-login.

---

## 8. Outstanding / Recommended Next Work

### Immediate

1. Test `sales_purchase` role end-to-end.
2. Test POS opening Price Checker saved carts by branch.
3. Test customer import in Supabase; fix DB duplicates if constraint SQL fails.
4. Test daily cash closing save/history.
5. Test expense branch/payment method logic.
6. Test product thumbnails upload and old thumbnail generation.

### Backend hardening still recommended

1. `amend_sale_transaction` or void/reversal workflow.
2. `amend_purchase_transaction`.
3. `amend_stock_transfer_transaction`.
4. True audit log table for supervisor approvals.
5. Double-entry journal tables and server-side posting.
6. Seller-safe product view without cost/margin data.
7. Strict branch/role RLS and role-aware views.

### UI improvements still recommended

1. Better modal picker design and integration for all long lists.
2. Better customer creation workflow inside POS.
3. Better cashier shift/cash drawer workflow if business evolves beyond daily branch closing.
4. Server-side product search for very large catalogs.
5. Report performance via SQL views/RPCs.

---

## 9. Important Current Files in This New Discussion Folder

A file index is available:

```text
FILE_INDEX.txt
```

Upload-ready files are in:

```text
updated-html-files/
```

Full current POS app:

```text
apps/pos/benamor-sales-system/index.html
```

Full current Price Checker:

```text
apps/pricechecker/index.html
```

Full current public website GitHub copy:

```text
apps/website/shop/index.html
```

Cloudflare Pages package:

```text
apps/website/benamorgroup-store-site.zip
```

---

## 10. Recommended New Conversation Starting Point

Recommended prompt file:

```text
NEW_CHAT_PROMPT.md
```

Use it in the new conversation and upload/reference this folder or zip.
