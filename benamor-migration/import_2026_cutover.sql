-- =====================================================================
-- Benamor POS — 2026 CUTOVER import of the old Cadence/OpenConcerto history into pos_*
-- (Variant of import_to_supabase.sql chosen on 2026-09-16 — full-history version kept as fallback.)
--
-- What it imports:
--   • ALL 2026+ sales (2,700) + any older sale with balance_due > 0 (38 open invoices)
--     → invoice-level debt stays collectable; settled 2024/2025 history stays in the old backup.
--   • One deterministic 'opening' customer-ledger row per customer (dated 2026-01-01) that folds
--     every pre-2026 ledger entry → final customer balances land EXACTLY as the full import
--     (receivable 46,962.079; openings 41,990.479 across 30 customers).
--   • Products, customers, suppliers, purchases+items+supplier ledger, proformas, transfers,
--     expenses, stock snapshot: FULL (they are small and needed).
--   • A 2026 stock-movement JOURNAL (sale/return_customer/purchase/transfer_in/transfer_out with
--     real dates) for pairs the new system never stocked, + an opening row per pair dated 2026-01-01
--     holding the start-of-year qty → product movements screen shows 2026 history and the running
--     total per pair lands exactly on the imported qty (verified: 0 inconsistent pairs).
--
-- Run with psql from the folder that contains the CSV files:
--   psql "<SUPABASE_POSTGRES_CONNECTION_STRING>" -v DRY_RUN=1 -f import_2026_cutover.sql   (test: rolls back)
--   psql "<SUPABASE_POSTGRES_CONNECTION_STRING>" -v DRY_RUN=0 -f import_2026_cutover.sql   (real: commits)
-- Uses the direct postgres connection (bypasses RLS). Idempotent: re-running
-- skips rows whose deterministic id already exists (opening rows use md5-derived uuids).
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
\encoding UTF8
\timing off
\if :{?DRY_RUN}
\else
  \set DRY_RUN 1
\endif

begin;
set local statement_timeout = 0;
set local search_path = public;

-- ---------------------------------------------------------------- staging
drop schema if exists mig_stage cascade;
create schema mig_stage;

create table mig_stage.products (code text, name text, brand text, model text, category text, supplier_id uuid, purchase_price numeric, retail_price numeric, active boolean, barcode text, old_id bigint);
create table mig_stage.customers (id uuid, customer_no text, old_code text, name text, phone text, address text, notes text, active boolean, old_id bigint);
create table mig_stage.suppliers (id uuid, name text, phone text, address text, notes text, opening_balance numeric, active boolean, old_id bigint, old_code text);
create table mig_stage.sales (id uuid, invoice_no text, sale_date date, location_name text, customer_id uuid, payment_method text, subtotal numeric, discount numeric, total numeric, paid_amount numeric, balance_due numeric, status text, notes text, created_at timestamptz, old_id bigint, source text);
create table mig_stage.sale_items (id uuid, sale_id uuid, product_code text, product_name text, qty numeric, unit_price numeric, line_discount numeric, discount_text text, line_total numeric, unit_cost_at_sale numeric, old_id bigint);
create table mig_stage.sale_payments (id uuid, sale_id uuid, payment_date date, payment_method text, amount numeric, notes text, old_id bigint);
create table mig_stage.customer_ledger (id uuid, customer_id uuid, entry_date date, entry_type text, description text, debit numeric, credit numeric, reference_table text, reference_id uuid);
create table mig_stage.purchases (id uuid, purchase_no text, supplier_id uuid, location_name text, invoice_no text, purchase_date date, subtotal numeric, discount numeric, total numeric, paid_amount numeric, status text, notes text, old_id bigint);
create table mig_stage.purchase_items (id uuid, purchase_id uuid, product_code text, product_name text, qty numeric, unit_cost numeric, line_total numeric, old_id bigint);
create table mig_stage.supplier_ledger (id uuid, supplier_id uuid, entry_date date, entry_type text, description text, debit numeric, credit numeric, reference_table text, reference_id uuid);
create table mig_stage.proformas (id uuid, proforma_no text, proforma_date date, location_name text, customer_id uuid, customer_name text, customer_phone text, subtotal numeric, discount numeric, total numeric, status text, notes text, old_id bigint);
create table mig_stage.proforma_items (id uuid, proforma_id uuid, product_code text, product_name text, qty numeric, unit_price numeric, line_total numeric);
create table mig_stage.stock_transfers (id uuid, transfer_no text, transfer_date date, from_location_name text, to_location_name text, status text, notes text, old_id bigint);
create table mig_stage.stock_transfer_items (id uuid, transfer_id uuid, product_code text, product_name text, qty numeric);
create table mig_stage.stock (location_name text, product_code text, product_name text, qty numeric);
create table mig_stage.expenses (id uuid, expense_date date, location_name text, title text, amount numeric, notes text, old_id bigint);

\copy mig_stage.products from 'pos_products.csv' with (format csv, header true)
\copy mig_stage.customers from 'pos_customers.csv' with (format csv, header true)
\copy mig_stage.suppliers from 'pos_suppliers.csv' with (format csv, header true)
\copy mig_stage.sales from 'pos_sales.csv' with (format csv, header true)
\copy mig_stage.sale_items from 'pos_sale_items.csv' with (format csv, header true)
\copy mig_stage.sale_payments from 'pos_sale_payments.csv' with (format csv, header true)
\copy mig_stage.customer_ledger from 'pos_customer_ledger.csv' with (format csv, header true)
\copy mig_stage.purchases from 'pos_purchases.csv' with (format csv, header true)
\copy mig_stage.purchase_items from 'pos_purchase_items.csv' with (format csv, header true)
\copy mig_stage.supplier_ledger from 'pos_supplier_ledger.csv' with (format csv, header true)
\copy mig_stage.proformas from 'pos_proformas.csv' with (format csv, header true)
\copy mig_stage.proforma_items from 'pos_proforma_items.csv' with (format csv, header true)
\copy mig_stage.stock_transfers from 'pos_stock_transfers.csv' with (format csv, header true)
\copy mig_stage.stock_transfer_items from 'pos_stock_transfer_items.csv' with (format csv, header true)
\copy mig_stage.stock from 'pos_stock.csv' with (format csv, header true)
\copy mig_stage.expenses from 'pos_expenses.csv' with (format csv, header true)

-- ---------------------------------------------------------------- 0. 2026 cutover (run BEFORE anything reads mig_stage.sales)
-- keep rule: sale_date >= 2026-01-01 OR balance_due > 0 (still collectable).
-- Computed BEFORE any delete: per-customer net of all pre-2026 ledger entries.
create table mig_stage.cust_opening as
select customer_id, sum(debit - credit) bal
from mig_stage.customer_ledger
where entry_date < date '2026-01-01'
group by customer_id
having sum(debit - credit) <> 0;

-- payments/items follow their sale; dropped sales take nothing with them (no orphans, no FK violations)
delete from mig_stage.sale_payments p
where not exists (select 1 from mig_stage.sales s
                  where s.id = p.sale_id and (s.sale_date >= date '2026-01-01' or s.balance_due > 0));
delete from mig_stage.sale_items i
where not exists (select 1 from mig_stage.sales s
                  where s.id = i.sale_id and (s.sale_date >= date '2026-01-01' or s.balance_due > 0));
delete from mig_stage.sales s
where not (s.sale_date >= date '2026-01-01' or s.balance_due > 0);

-- 2026 ledger entries whose payment/sale target was dropped: keep the entry (the money is real),
-- clear only the dead pointer. (27 payment refs in this dataset.)
update mig_stage.customer_ledger c set reference_table = null, reference_id = null
where c.reference_table = 'pos_sale_payments'
  and not exists (select 1 from mig_stage.sale_payments p where p.id = c.reference_id);
update mig_stage.customer_ledger c set reference_table = null, reference_id = null
where c.reference_table = 'pos_sales'
  and not exists (select 1 from mig_stage.sales s where s.id = c.reference_id);

-- drop pre-2026 ledger detail; replace with ONE opening row per customer carrying the exact same net
delete from mig_stage.customer_ledger where entry_date < date '2026-01-01';
insert into mig_stage.customer_ledger (id, customer_id, entry_date, entry_type, description, debit, credit, reference_table, reference_id)
select (md5('mig2026-opening-' || o.customer_id::text))::uuid,
       o.customer_id, date '2026-01-01', 'opening',
       'رصيد افتتاحي مرحّل من النظام القديم (ما قبل 2026)',
       greatest(o.bal, 0), greatest(- o.bal, 0), null, null
from mig_stage.cust_opening o;

-- ---------------------------------------------------------------- 1. locations (lookup by name — must already exist)
create table mig_stage.loc as select name, id from public.pos_locations;
do $$
declare missing text;
begin
  select string_agg(n, ', ') into missing from (
    select distinct location_name n from mig_stage.sales
    union select distinct location_name from mig_stage.purchases
    union select distinct location_name from mig_stage.stock
    union select distinct from_location_name from mig_stage.stock_transfers
    union select distinct to_location_name from mig_stage.stock_transfers) x
  where n is not null and n not in (select name from mig_stage.loc);
  if missing is not null then raise exception 'pos_locations is missing: %', missing; end if;
end $$;

-- ---------------------------------------------------------------- 2/3. finance: no historical movements (opening balances entered in the app);
--      one expense category for all historical expenses
insert into public.pos_expense_categories (name) select 'مصاريف تاريخية'
where not exists (select 1 from public.pos_expense_categories where name = 'مصاريف تاريخية');

-- ---------------------------------------------------------------- 4. suppliers (deterministic id; skip if id or same name exists)
--   live has a unique index on lower(trim(name)); old data also has duplicate names → merge onto the first one
create table mig_stage.supplier_map as
with s as (select *, row_number() over (partition by lower(trim(name)) order by old_id) rn from mig_stage.suppliers)
select s.id as mig_id, coalesce(p.id, first.id, s.id) as live_id
from s
left join public.pos_suppliers p on lower(trim(p.name)) = lower(trim(s.name))
left join s first on s.rn > 1 and first.rn = 1 and lower(trim(first.name)) = lower(trim(s.name));

insert into public.pos_suppliers (id, name, phone, address, notes, opening_balance, active)
select s.id, s.name, s.phone, s.address, s.notes, 0, s.active
from mig_stage.suppliers s
join mig_stage.supplier_map m on m.mig_id = s.id and m.live_id = s.id
where not exists (select 1 from public.pos_suppliers p where p.id = s.id);

-- ---------------------------------------------------------------- 5. products (existing rows untouched; only fill missing supplier_id)
insert into public.pos_products (code, name, brand, model, category, supplier_id, purchase_price, retail_price, active, barcode)
select p.code, p.name, p.brand, p.model, p.category, m.live_id, p.purchase_price, p.retail_price, p.active, p.barcode
from mig_stage.products p
left join mig_stage.supplier_map m on m.mig_id = p.supplier_id
on conflict (code) do nothing;

update public.pos_products p set supplier_id = m.live_id
from mig_stage.products s join mig_stage.supplier_map m on m.mig_id = s.supplier_id
where p.code = s.code and p.supplier_id is null;

-- ---------------------------------------------------------------- 6. customers (existing customer_no untouched)
--   match order: customer_no → cleaned phone → first old customer with the same phone → new row
--   each live-side match is forced to ONE deterministic row: production live data can contain
--   duplicate phones/customer_nos and a plain join would fan out (duplicating every downstream row).
create table mig_stage.customer_map as
with c as (
  select *, nullif(ltrim(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), '0'), '') as phone_clean,
         row_number() over (partition by nullif(ltrim(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), '0'), '') order by old_id) as rn
  from mig_stage.customers),
pn_1 as (  -- same number counts as the same person only when the phone agrees (old system re-used numbers)
  select distinct on (c.id) c.id as mig_id, pn.id as live_id
  from c
  join public.pos_customers pn on pn.customer_no = c.customer_no
       and (c.phone_clean is null or nullif(ltrim(regexp_replace(coalesce(pn.phone,''), '[^0-9]', '', 'g'), '0'), '') is null
            or ltrim(regexp_replace(coalesce(pn.phone,''), '[^0-9]', '', 'g'), '0') = c.phone_clean)
  order by c.id, pn.created_at nulls last, pn.id),
pp_1 as (
  select distinct on (c.id) c.id as mig_id, pp.id as live_id
  from c
  join public.pos_customers pp on c.phone_clean is not null
       and ltrim(regexp_replace(coalesce(pp.phone,''), '[^0-9]', '', 'g'), '0') = c.phone_clean
  order by c.id, pp.created_at nulls last, pp.id)
select c.id as mig_id,
       coalesce(pn_1.live_id, pp_1.live_id, first.id, c.id) as live_id,
       (pn_1.live_id is null and pp_1.live_id is null and first.id is null) as is_new,
       c.customer_no, c.old_id
from c
left join pn_1 on pn_1.mig_id = c.id
left join pp_1 on pp_1.mig_id = c.id
left join c first on c.phone_clean is not null and c.rn > 1 and first.phone_clean = c.phone_clean and first.rn = 1;

-- hard stop: any residual map fan-out would duplicate downstream rows — abort instead of corrupting
do $$
begin
  if exists (select mig_id from mig_stage.customer_map group by 1 having count(*) > 1)
     or exists (select mig_id from mig_stage.supplier_map group by 1 having count(*) > 1) then
    raise exception 'MIGRATION ABORTED: matching map fan-out (duplicate live match) detected';
  end if;
end $$;

-- new rows: keep the old number unless it is already taken (live or by another new row) → suffix with old id
create table mig_stage.customer_new as
select c.*, case when exists (select 1 from public.pos_customers p where p.customer_no = c.customer_no)
                   or row_number() over (partition by c.customer_no order by c.old_id) > 1
                 then c.customer_no || '-' || c.old_id else c.customer_no end as customer_no_final
from mig_stage.customers c
join mig_stage.customer_map m on m.mig_id = c.id and m.is_new;

insert into public.pos_customers (id, customer_no, name, phone, address, notes, active)
select c.id, c.customer_no_final, c.name, nullif(ltrim(regexp_replace(coalesce(c.phone,''), '[^0-9]', '', 'g'), '0'), ''), c.address, c.notes, c.active
from mig_stage.customer_new c
where not exists (select 1 from public.pos_customers p where p.id = c.id);

-- ---------------------------------------------------------------- 7. purchases
insert into public.pos_purchases (id, supplier_id, location_id, invoice_no, purchase_date, subtotal, discount, total, paid_amount, status, notes)
select p.id, m.live_id, l.id, coalesce(p.invoice_no, p.purchase_no), p.purchase_date, p.subtotal, p.discount, p.total, p.paid_amount, p.status, p.notes
from mig_stage.purchases p
left join mig_stage.supplier_map m on m.mig_id = p.supplier_id
left join mig_stage.loc l on l.name = p.location_name
where not exists (select 1 from public.pos_purchases x where x.id = p.id);

insert into public.pos_purchase_items (id, purchase_id, product_code, product_name, qty, unit_cost, line_total)
select i.id, i.purchase_id, i.product_code, i.product_name, i.qty, i.unit_cost, i.line_total
from mig_stage.purchase_items i
where not exists (select 1 from public.pos_purchase_items x where x.id = i.id);

insert into public.pos_supplier_ledger (id, supplier_id, entry_date, entry_type, description, debit, credit, reference_table, reference_id)
select s.id, m.live_id, s.entry_date, s.entry_type, s.description, s.debit, s.credit, s.reference_table, s.reference_id
from mig_stage.supplier_ledger s
join mig_stage.supplier_map m on m.mig_id = s.supplier_id
where not exists (select 1 from public.pos_supplier_ledger x where x.id = s.id);

-- ---------------------------------------------------------------- 8. sales (created_by / idempotency_key left null on purpose)
insert into public.pos_sales (id, invoice_no, sale_date, location_id, customer_id, payment_method, subtotal, discount, total, paid_amount, balance_due, status, notes, created_at)
select s.id, s.invoice_no, s.sale_date, l.id, m.live_id, s.payment_method, s.subtotal, s.discount, s.total, s.paid_amount, s.balance_due, s.status, s.notes, coalesce(s.created_at, s.sale_date::timestamptz)
from mig_stage.sales s
join mig_stage.loc l on l.name = s.location_name
left join mig_stage.customer_map m on m.mig_id = s.customer_id
where not exists (select 1 from public.pos_sales x where x.id = s.id);

insert into public.pos_sale_items (id, sale_id, product_code, product_name, qty, unit_price, line_discount, discount_text, line_total, unit_cost_at_sale)
select i.id, i.sale_id, i.product_code, i.product_name, i.qty, i.unit_price, i.line_discount, i.discount_text, i.line_total, greatest(i.unit_cost_at_sale, 0)
from mig_stage.sale_items i
where not exists (select 1 from public.pos_sale_items x where x.id = i.id);

insert into public.pos_sale_payments (id, sale_id, payment_date, payment_method, amount, notes)
select p.id, p.sale_id, p.payment_date, p.payment_method, p.amount, p.notes
from mig_stage.sale_payments p
where not exists (select 1 from public.pos_sale_payments x where x.id = p.id);

insert into public.pos_customer_ledger (id, customer_id, entry_date, entry_type, description, debit, credit, reference_table, reference_id)
select c.id, m.live_id, c.entry_date, c.entry_type, c.description, c.debit, c.credit, c.reference_table, c.reference_id
from mig_stage.customer_ledger c
join mig_stage.customer_map m on m.mig_id = c.customer_id
where not exists (select 1 from public.pos_customer_ledger x where x.id = c.id);

-- ---------------------------------------------------------------- 9. proformas
insert into public.pos_proformas (id, proforma_no, proforma_date, location_id, customer_id, customer_name, customer_phone, subtotal, discount, total, status, notes)
select p.id, p.proforma_no, p.proforma_date, l.id, m.live_id, p.customer_name, p.customer_phone, p.subtotal, p.discount, p.total, p.status, p.notes
from mig_stage.proformas p
join mig_stage.loc l on l.name = p.location_name
left join mig_stage.customer_map m on m.mig_id = p.customer_id
where not exists (select 1 from public.pos_proformas x where x.id = p.id);

insert into public.pos_proforma_items (id, proforma_id, product_code, product_name, qty, unit_price, line_total)
select i.id, i.proforma_id, i.product_code, i.product_name, i.qty, i.unit_price, i.line_total
from mig_stage.proforma_items i
where i.qty > 0 and not exists (select 1 from public.pos_proforma_items x where x.id = i.id);

-- ---------------------------------------------------------------- 10. stock transfers (history only — stock is set in step 12)
insert into public.pos_stock_transfers (id, transfer_date, from_location_id, to_location_id, status, notes)
select t.id, t.transfer_date, f.id, d.id, t.status, concat_ws(' | ', t.transfer_no, t.notes)
from mig_stage.stock_transfers t
left join mig_stage.loc f on f.name = t.from_location_name
left join mig_stage.loc d on d.name = t.to_location_name
where not exists (select 1 from public.pos_stock_transfers x where x.id = t.id);

insert into public.pos_stock_transfer_items (id, transfer_id, product_code, product_name, qty)
select i.id, i.transfer_id, i.product_code, i.product_name, i.qty
from mig_stage.stock_transfer_items i
where not exists (select 1 from public.pos_stock_transfer_items x where x.id = i.id);

-- ---------------------------------------------------------------- 11. expenses
--   account_id is NOT NULL in live, so historical expenses sit on one INACTIVE archive account
--   with no finance movements → balance 0, invisible in account dropdowns, no effect on current cash.
insert into public.pos_finance_accounts (name, account_type, opening_balance, active, notes)
select 'أرشيف النظام القديم (Cadence)', 'cash', 0, false, 'حساب أرشيفي للمصاريف التاريخية المستوردة — لا يُستخدم'
where not exists (select 1 from public.pos_finance_accounts where name = 'أرشيف النظام القديم (Cadence)');

insert into public.pos_expenses (id, expense_date, location_id, account_id, category_id, title, amount, notes)
select e.id, e.expense_date, l.id,
       (select id from public.pos_finance_accounts where name = 'أرشيف النظام القديم (Cadence)'),
       (select id from public.pos_expense_categories where name = 'مصاريف تاريخية'), e.title, e.amount, e.notes
from mig_stage.expenses e
left join mig_stage.loc l on l.name = e.location_name
where not exists (select 1 from public.pos_expenses x where x.id = e.id);

-- ---------------------------------------------------------------- 12/13. stock: only (location, product) pairs the new system has NEVER stocked.
--       Existing pos_stock rows are the live truth and are left untouched.
--       delta = the pair's old-system 2026 movement (kept sales+returns, purchases, transfers).
create table mig_stage.stock_delta as
select loc as location_id, code as product_code, sum(d) as delta from (
  select l.id loc, i.product_code code, -i.qty d
  from mig_stage.sale_items i
  join mig_stage.sales s on s.id = i.sale_id and s.sale_date >= date '2026-01-01'
  join mig_stage.loc l on l.name = s.location_name
  union all
  select l.id, i.product_code, i.qty
  from mig_stage.purchase_items i
  join mig_stage.purchases p on p.id = i.purchase_id and p.purchase_date >= date '2026-01-01'
  join mig_stage.loc l on l.name = p.location_name
  union all
  select l.id, i.product_code, -i.qty
  from mig_stage.stock_transfer_items i
  join mig_stage.stock_transfers t on t.id = i.transfer_id and t.transfer_date >= date '2026-01-01'
  join mig_stage.loc l on l.name = t.from_location_name
  union all
  select l.id, i.product_code, i.qty
  from mig_stage.stock_transfer_items i
  join mig_stage.stock_transfers t on t.id = i.transfer_id and t.transfer_date >= date '2026-01-01'
  join mig_stage.loc l on l.name = t.to_location_name
) x group by 1, 2;

create table mig_stage.stock_applied as
select l.id as location_id, s.product_code, s.product_name, s.qty, coalesce(d.delta, 0) as delta
from mig_stage.stock s
join mig_stage.loc l on l.name = s.location_name
left join mig_stage.stock_delta d on d.location_id = l.id and d.product_code = s.product_code
where exists (select 1 from public.pos_products p where p.code = s.product_code)
  and not exists (select 1 from public.pos_stock x where x.location_id = l.id and x.product_code = s.product_code)
  and not exists (select 1 from public.pos_stock_movements x where x.location_id = l.id and x.product_code = s.product_code);

insert into public.pos_stock (location_id, product_code, product_name, qty)
select location_id, product_code, product_name, qty from mig_stage.stock_applied;

-- opening row PER PAIR dated 2026-01-01 holding the START-OF-YEAR quantity (snapshot qty minus the
-- pair's 2026 movement) so that opening + 2026 journal rows lands exactly on the imported qty.
insert into public.pos_stock_movements (id, movement_date, location_id, product_code, product_name, movement_type, qty_change, reference_table, reference_id, notes)
select (md5('mig2026-open-' || location_id::text || ':' || product_code))::uuid,
       timestamptz '2026-01-01', location_id, product_code, product_name, 'adjustment',
       qty - delta, 'migration', null, 'رصيد افتتاحي 2026 مرحّل من النظام القديم (Cadence)'
from mig_stage.stock_applied
on conflict (id) do nothing;

-- 2026 movement journal, real dates, deterministic ids; only for the pairs inserted above
-- (pairs the new system already trades keep their own live journal — no duplication).
insert into public.pos_stock_movements (id, movement_date, location_id, product_code, product_name, movement_type, qty_change, reference_table, reference_id, notes)
select (md5('mig2026-mv-sale-' || i.id::text))::uuid, s.sale_date::timestamptz, l.id, i.product_code, i.product_name,
       case when i.qty < 0 then 'return_customer' else 'sale' end, -i.qty, 'pos_sales', s.id, 'حركة 2026 من النظام القديم (Cadence)'
from mig_stage.sale_items i
join mig_stage.sales s on s.id = i.sale_id and s.sale_date >= date '2026-01-01'
join mig_stage.loc l on l.name = s.location_name
join mig_stage.stock_applied a on a.location_id = l.id and a.product_code = i.product_code
union all
select (md5('mig2026-mv-pur-' || i.id::text))::uuid, p.purchase_date::timestamptz, l.id, i.product_code, i.product_name,
       'purchase', i.qty, 'pos_purchases', p.id, 'حركة 2026 من النظام القديم (Cadence)'
from mig_stage.purchase_items i
join mig_stage.purchases p on p.id = i.purchase_id and p.purchase_date >= date '2026-01-01'
join mig_stage.loc l on l.name = p.location_name
join mig_stage.stock_applied a on a.location_id = l.id and a.product_code = i.product_code
union all
select (md5('mig2026-mv-tr-o-' || i.id::text))::uuid, t.transfer_date::timestamptz, l.id, i.product_code, i.product_name,
       'transfer_out', -i.qty, 'pos_stock_transfers', t.id, 'حركة 2026 من النظام القديم (Cadence)'
from mig_stage.stock_transfer_items i
join mig_stage.stock_transfers t on t.id = i.transfer_id and t.transfer_date >= date '2026-01-01'
join mig_stage.loc l on l.name = t.from_location_name
join mig_stage.stock_applied a on a.location_id = l.id and a.product_code = i.product_code
union all
select (md5('mig2026-mv-tr-i-' || i.id::text))::uuid, t.transfer_date::timestamptz, l.id, i.product_code, i.product_name,
       'transfer_in', i.qty, 'pos_stock_transfers', t.id, 'حركة 2026 من النظام القديم (Cadence)'
from mig_stage.stock_transfer_items i
join mig_stage.stock_transfers t on t.id = i.transfer_id and t.transfer_date >= date '2026-01-01'
join mig_stage.loc l on l.name = t.to_location_name
join mig_stage.stock_applied a on a.location_id = l.id and a.product_code = i.product_code
on conflict (id) do nothing;

-- (numbering: live invoice counter uses the S- prefix and customer_no uses a sequence; old numbers cannot collide, nothing to bump)

-- ---------------------------------------------------------------- 15. customer balances (column added by live migration; recompute from ledger)
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='pos_customers' and column_name='balance') then
    update public.pos_customers c set balance = coalesce(l.bal, 0)
    from (select customer_id, sum(debit - credit) bal from public.pos_customer_ledger group by 1) l
    where c.id = l.customer_id;
  end if;
end $$;

-- ================================================================ verification
\set QUIET off
\echo '=== counts inserted from migration (2026 cutover)'
select 'sales (expect 2738)' t, count(*) from public.pos_sales where notes like 'old_ticket_id=%' or notes like 'old_invoice_id=%'
union all select 'sale_items (expect 7606)', count(*) from public.pos_sale_items i join mig_stage.sales s on s.id = i.sale_id
union all select 'sale_payments (expect 2691)', count(*) from public.pos_sale_payments p join mig_stage.sales s on s.id = p.sale_id
union all select 'customer_ledger (expect 348 = 318 + 30 openings)', count(*) from public.pos_customer_ledger l where exists (select 1 from mig_stage.customer_ledger m where m.id = l.id)
union all select '  of which opening rows (expect 30)', count(*) from public.pos_customer_ledger l join mig_stage.customer_ledger m on m.id = l.id where l.entry_type = 'opening'
union all select '  of which refs cleared to null (expect 27)', count(*) from mig_stage.customer_ledger where entry_date >= date '2026-01-01' and entry_type = 'payment' and reference_id is null
union all select 'products_new', count(*) from public.pos_products p where exists (select 1 from mig_stage.products m where m.code = p.code) and p.created_at >= now() - interval '10 minutes'
union all select 'customers_new', count(*) from public.pos_customers where notes like 'old_id=%'
union all select 'suppliers_new', count(*) from public.pos_suppliers where notes like '%old_id=%'
union all select 'purchases', count(*) from public.pos_purchases where notes like 'old_id=%'
union all select 'expenses', count(*) from public.pos_expenses where notes like 'old_id=%'
union all select 'stock_rows_added', count(*) from mig_stage.stock_applied
union all select 'stock_rows_skipped_existing', (select count(*) from mig_stage.stock) - count(*) from mig_stage.stock_applied
union all select 'stock_opening_rows (expect = stock_rows_added)', count(*) from public.pos_stock_movements where notes like 'رصيد افتتاحي 2026%'
union all select 'stock_journal_2026_rows (expect 8104 on empty test DB)', count(*) from public.pos_stock_movements where notes like 'حركة 2026 من النظام القديم%'
union all select 'stock_pairs_where_opening_plus_journal_ne_qty (expect 0)',
  (select count(*) from (
     select a.location_id, a.product_code
     from mig_stage.stock_applied a
     join public.pos_stock st on st.location_id = a.location_id and st.product_code = a.product_code
     where abs(st.qty - coalesce((select sum(m.qty_change) from public.pos_stock_movements m
        where m.location_id = a.location_id and m.product_code = a.product_code), 0)) > 0.001) bad);

\echo '=== must all be 0'
select
 (select count(*) from public.pos_sale_items i left join public.pos_sales s on s.id = i.sale_id where s.id is null) orphan_items,
 (select count(*) from public.pos_sales s join mig_stage.sales m on m.id = s.id
    where abs(s.subtotal - coalesce((select sum(line_total) from public.pos_sale_items where sale_id = s.id), 0)) > 0.01
      and exists (select 1 from public.pos_sale_items where sale_id = s.id)) header_vs_lines_mismatch,
 (select count(*) from public.pos_customer_ledger l left join public.pos_customers c on c.id = l.customer_id where c.id is null) orphan_ledger,
 (select count(*) from public.pos_sales where location_id is null) sales_without_location,
 (select count(*) from (select invoice_no from public.pos_sales where invoice_no is not null group by 1 having count(*) > 1) d) duplicate_invoice_no;

\echo '=== sales by year / branch (2026 in full; 2024/2025 = unpaid invoices only)'
select extract(year from s.sale_date)::int yr, l.name, count(*) docs, round(sum(s.total), 3) net_sales, round(sum(s.balance_due), 3) still_due
from public.pos_sales s join public.pos_locations l on l.id = s.location_id
join mig_stage.sales m on m.id = s.id
group by 1, 2 order by 1, 2;

\echo '=== opening balances folded from pre-2026 history (must total 41990.479 across 30 customers)'
select count(*) customers, round(sum(debit - credit), 3) folded_opening_debt
from mig_stage.customer_ledger where entry_type = 'opening';

\echo '=== receivable from migrated ledger (MUST equal the full-history figure: 46962.079)'
select round(sum(debit - credit), 3) receivable from public.pos_customer_ledger l where exists (select 1 from mig_stage.customer_ledger m where m.id = l.id);

drop schema mig_stage cascade;

\if :DRY_RUN
  \echo '*** DRY RUN — rolling back, nothing was written ***'
  rollback;
\else
  commit;
  \echo '*** COMMITTED ***'
\endif
