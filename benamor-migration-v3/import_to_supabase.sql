-- =====================================================================
-- Benamor POS — import of the old Cadence/OpenConcerto history into pos_*
-- Run with psql from THIS folder (CSVs are in data/):
--   psql "<SUPABASE_POSTGRES_CONNECTION_STRING>" -v DRY_RUN=1 -f import_to_supabase.sql   (test: rolls back)
--   psql "<SUPABASE_POSTGRES_CONNECTION_STRING>" -v DRY_RUN=0 -f import_to_supabase.sql   (real: commits)
-- Uses the direct postgres connection (bypasses RLS). Idempotent: re-running
-- skips rows whose deterministic id already exists.
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
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
create table mig_stage.stock_movements (id uuid, movement_date timestamptz, location_name text, product_code text, product_name text, movement_type text, qty_change numeric, reference_table text, reference_id uuid, notes text, old_id bigint);
create table mig_stage.composite_items (id uuid, composite_code text, component_code text, component_name text, qty numeric);

\copy mig_stage.products from 'data/pos_products.csv' with (format csv, header true)
\copy mig_stage.customers from 'data/pos_customers.csv' with (format csv, header true)
\copy mig_stage.suppliers from 'data/pos_suppliers.csv' with (format csv, header true)
\copy mig_stage.sales from 'data/pos_sales.csv' with (format csv, header true)
\copy mig_stage.sale_items from 'data/pos_sale_items.csv' with (format csv, header true)
\copy mig_stage.sale_payments from 'data/pos_sale_payments.csv' with (format csv, header true)
\copy mig_stage.customer_ledger from 'data/pos_customer_ledger.csv' with (format csv, header true)
\copy mig_stage.purchases from 'data/pos_purchases.csv' with (format csv, header true)
\copy mig_stage.purchase_items from 'data/pos_purchase_items.csv' with (format csv, header true)
\copy mig_stage.supplier_ledger from 'data/pos_supplier_ledger.csv' with (format csv, header true)
\copy mig_stage.proformas from 'data/pos_proformas.csv' with (format csv, header true)
\copy mig_stage.proforma_items from 'data/pos_proforma_items.csv' with (format csv, header true)
\copy mig_stage.stock_transfers from 'data/pos_stock_transfers.csv' with (format csv, header true)
\copy mig_stage.stock_transfer_items from 'data/pos_stock_transfer_items.csv' with (format csv, header true)
\copy mig_stage.stock from 'data/pos_stock.csv' with (format csv, header true)
\copy mig_stage.expenses from 'data/pos_expenses.csv' with (format csv, header true)
\copy mig_stage.composite_items from 'data/pos_composite_items.csv' with (format csv, header true)
\copy mig_stage.stock_movements from 'data/pos_stock_movements.csv' with (format csv, header true)

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
--   match order: customer_no → cleaned phone (live unique index) → first old customer with the same phone → new row
create table mig_stage.customer_map as
with c as (
  select *, nullif(ltrim(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), '0'), '') as phone_clean,
         row_number() over (partition by nullif(ltrim(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), '0'), '') order by old_id) as rn
  from mig_stage.customers)
select c.id as mig_id,
       coalesce(pn.id, pp.id, first.id, c.id) as live_id,
       (pn.id is null and pp.id is null and first.id is null) as is_new,
       c.customer_no, c.old_id
from c
-- same number counts as the same person only when the phone agrees (old system re-used numbers)
left join public.pos_customers pn on pn.customer_no = c.customer_no
       and (c.phone_clean is null or nullif(ltrim(regexp_replace(coalesce(pn.phone,''), '[^0-9]', '', 'g'), '0'), '') is null
            or ltrim(regexp_replace(coalesce(pn.phone,''), '[^0-9]', '', 'g'), '0') = c.phone_clean)
left join public.pos_customers pp on c.phone_clean is not null
       and ltrim(regexp_replace(coalesce(pp.phone,''), '[^0-9]', '', 'g'), '0') = c.phone_clean
left join c first on c.phone_clean is not null and c.rn > 1 and first.phone_clean = c.phone_clean and first.rn = 1;

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

-- ---------------------------------------------------------------- 10b. composite products (old ARTICLE_PACK → pos_composite_items)
--   only for composites the new system has not defined yet; both codes must exist in pos_products
insert into public.pos_composite_items (id, composite_code, component_code, component_name, qty)
select c.id, c.composite_code, c.component_code, c.component_name, c.qty
from mig_stage.composite_items c
where exists (select 1 from public.pos_products p where p.code = c.composite_code)
  and exists (select 1 from public.pos_products p where p.code = c.component_code)
  and not exists (select 1 from public.pos_composite_items x where x.composite_code = c.composite_code);

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


-- ---------------------------------------------------------------- 12. item movements (حركات الصنف) — full history from the old MOUVEMENT_STOCK
--       Every movement keeps its original date and is linked to the migrated sale / purchase / transfer.
--       Inventory counts and other legacy sources come in as 'adjustment' with reference_table 'legacy:<SOURCE>'.
insert into public.pos_stock_movements (id, movement_date, location_id, product_code, product_name, movement_type, qty_change, reference_table, reference_id, notes, created_at)
select m.id, m.movement_date, l.id, m.product_code, m.product_name, m.movement_type, m.qty_change, m.reference_table,
       case when m.reference_table = 'pos_sales'           and exists (select 1 from public.pos_sales x where x.id = m.reference_id) then m.reference_id
            when m.reference_table = 'pos_purchases'       and exists (select 1 from public.pos_purchases x where x.id = m.reference_id) then m.reference_id
            when m.reference_table = 'pos_stock_transfers' and exists (select 1 from public.pos_stock_transfers x where x.id = m.reference_id) then m.reference_id
            else null end,
       m.notes, m.movement_date
from mig_stage.stock_movements m
join mig_stage.loc l on l.name = m.location_name
where exists (select 1 from public.pos_products p where p.code = m.product_code)
  and not exists (select 1 from public.pos_stock_movements x where x.id = m.id);

-- ---------------------------------------------------------------- 13. stock: closing balance of those movements, only for (location, product) pairs
--       the new system has NEVER stocked. Existing pos_stock rows are the live truth and are left untouched
--       (their history now shows the old movements followed by the new system's own rows).
create table mig_stage.stock_applied as
select l.id as location_id, s.product_code, s.product_name, s.qty
from mig_stage.stock s
join mig_stage.loc l on l.name = s.location_name
where exists (select 1 from public.pos_products p where p.code = s.product_code)
  and not exists (select 1 from public.pos_stock x where x.location_id = l.id and x.product_code = s.product_code);

insert into public.pos_stock (location_id, product_code, product_name, qty)
select location_id, product_code, product_name, qty from mig_stage.stock_applied;

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
\echo '=== counts inserted from migration'
select 'sales' t, count(*) from public.pos_sales where notes like 'old_ticket_id=%' or notes like 'old_invoice_id=%'
union all select 'sale_items', count(*) from public.pos_sale_items i join mig_stage.sales s on s.id = i.sale_id
union all select 'sale_payments', count(*) from public.pos_sale_payments p join mig_stage.sales s on s.id = p.sale_id
union all select 'customer_ledger', count(*) from public.pos_customer_ledger l where exists (select 1 from mig_stage.customer_ledger m where m.id = l.id)
union all select 'products_new', count(*) from public.pos_products p where exists (select 1 from mig_stage.products m where m.code = p.code) and p.created_at >= now() - interval '10 minutes'
union all select 'customers_new', count(*) from public.pos_customers where notes like 'old_id=%'
union all select 'suppliers_new', count(*) from public.pos_suppliers where notes like '%old_id=%'
union all select 'purchases', count(*) from public.pos_purchases where notes like 'old_id=%'
union all select 'expenses', count(*) from public.pos_expenses where notes like 'old_id=%'
union all select 'composite_items', count(*) from public.pos_composite_items x where exists (select 1 from mig_stage.composite_items m where m.id = x.id)
union all select 'stock_movements', count(*) from public.pos_stock_movements x where exists (select 1 from mig_stage.stock_movements m where m.id = x.id)
union all select 'stock_rows_added', count(*) from mig_stage.stock_applied
union all select 'stock_rows_skipped_existing', (select count(*) from mig_stage.stock) - count(*) from mig_stage.stock_applied;

\echo '=== must all be 0'
select
 (select count(*) from public.pos_sale_items i left join public.pos_sales s on s.id = i.sale_id where s.id is null) orphan_items,
 (select count(*) from public.pos_sales s join mig_stage.sales m on m.id = s.id
    where abs(s.subtotal - coalesce((select sum(line_total) from public.pos_sale_items where sale_id = s.id), 0)) > 0.01
      and exists (select 1 from public.pos_sale_items where sale_id = s.id)) header_vs_lines_mismatch,
 (select count(*) from public.pos_customer_ledger l left join public.pos_customers c on c.id = l.customer_id where c.id is null) orphan_ledger,
 (select count(*) from public.pos_sales where location_id is null) sales_without_location,
 (select count(*) from (select invoice_no from public.pos_sales where invoice_no is not null group by 1 having count(*) > 1) d) duplicate_invoice_no;

\echo '=== sales by year / branch (should match the old system)'
select extract(year from s.sale_date)::int yr, l.name, count(*) docs, round(sum(s.total), 3) net_sales, round(sum(s.balance_due), 3) still_due
from public.pos_sales s join public.pos_locations l on l.id = s.location_id
join mig_stage.sales m on m.id = s.id
group by 1, 2 order by 1, 2;

\echo '=== receivable from migrated ledger'
select round(sum(debit - credit), 3) receivable from public.pos_customer_ledger l where exists (select 1 from mig_stage.customer_ledger m where m.id = l.id);

drop schema mig_stage cascade;

\if :DRY_RUN
  \echo '*** DRY RUN — rolling back, nothing was written ***'
  rollback;
\else
  commit;
  \echo '*** COMMITTED ***'
\endif
