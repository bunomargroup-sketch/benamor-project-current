-- =====================================================================
-- Benamor POS - v3 corrected cutover import (data: old-system backup 19-09-2026)
--
-- AGREED BUSINESS RULES (user decisions, 19-09-2026):
--   1. Sales: import old invoices in bulk up to 2026-09-08 (2026+ in full; pre-2026 only
--      if still owing). From 09-09 onward the LIVE copies are the surviving ones
--      (double-entry since 09/09) -> old twins are SKIPPED; an old window invoice with
--      NO live twin is still imported ("net" bucket) so nothing is ever lost.
--   2. Purchases: old-system only -> import all from the snapshot.
--      Transfers & expenses: double-entered, but OLD data stays ("more sure") ->
--      import all from the snapshot and DELETE the matching live twins (with their
--      movement/finance side rows) inside the overlap window.
--   3. No hand stock corrections were made live -> stock qty is REBUILT to the
--      movement-derived closing balance of the snapshot plus surviving live deltas
--      after the snapshot (>= 2026-09-18). Verified: qty == sum(movements) per pair.
--   4. Full 2020-2026 movement history is imported as the product journal
--      (حركات الصنف), excluding rows of skipped twins.
--
--   psql ... -v DRY_RUN=1 -f import_v3_corrected.sql   (report, rolls back)
--   psql ... -v DRY_RUN=0 -f import_v3_corrected.sql   (real, commits)
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
\if :{?DRY_RUN}
\else
  \set DRY_RUN 1
\endif
begin;
set local statement_timeout = 0;
set local search_path = public;

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
\copy mig_stage.stock_movements from 'pos_stock_movements.csv' with (format csv, header true)

create table mig_stage.loc as select name, id from public.pos_locations;

-- ---------- balances carried over from PRE-2026 (unchanged from previous cutover) ----------
create table mig_stage.cust_opening as
select c.id as customer_id, round(sum(l.debit - l.credit), 3) as bal
from mig_stage.customer_ledger l
join mig_stage.customers c on c.id = l.customer_id
where l.entry_date < date '2026-01-01'
group by c.id
having abs(round(sum(l.debit - l.credit), 3)) > 0.001;

insert into mig_stage.customer_ledger (id, customer_id, entry_date, entry_type, description, debit, credit, reference_table, reference_id)
select (md5('mig2026-open-' || o.customer_id::text))::uuid, o.customer_id, date '2026-01-01', 'opening',
       'رصيد افتتاحي مرحّل عن تاريخ النظام القديم (2024-2025)',
       greatest(o.bal,0), greatest(-o.bal,0), 'migration', null
from mig_stage.cust_opening o;

-- ---------- suppliers / products (proven merges) ----------
create table mig_stage.supplier_map as
with s as (select *, row_number() over (partition by lower(trim(name)) order by old_id) rn from mig_stage.suppliers),
sm as (select distinct on (s.id) s.id as mig_id, p.id as live_id
       from s join public.pos_suppliers p on lower(trim(p.name)) = lower(trim(s.name))
       order by s.id, p.created_at nulls last, p.id)
select s.id as mig_id, coalesce(sm.live_id, first.id, s.id) as live_id
from s
left join sm on sm.mig_id = s.id
left join s first on s.rn > 1 and first.rn = 1 and lower(trim(first.name)) = lower(trim(s.name));

insert into public.pos_suppliers (id, name, phone, address, notes, opening_balance, active)
select s.id, s.name, s.phone, s.address, s.notes, 0, s.active
from mig_stage.suppliers s
join mig_stage.supplier_map m on m.mig_id = s.id and m.live_id = s.id
where not exists (select 1 from public.pos_suppliers p where p.id = s.id);

insert into public.pos_products (code, name, brand, model, category, supplier_id, purchase_price, retail_price, active, barcode)
select p.code, p.name, p.brand, p.model, p.category, m.live_id, p.purchase_price, p.retail_price, p.active, p.barcode
from mig_stage.products p
left join mig_stage.supplier_map m on m.mig_id = p.supplier_id
on conflict (code) do nothing;

update public.pos_products p set supplier_id = m.live_id
from mig_stage.products s join mig_stage.supplier_map m on m.mig_id = s.supplier_id
where p.code = s.code and p.supplier_id is null;

-- ---------- customers (deterministic one-row-per-old-customer matching + hard gate) ----------
create table mig_stage.customer_map as
with c as (
  select *, nullif(ltrim(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), '0'), '') as phone_clean,
         row_number() over (partition by nullif(ltrim(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), '0'), '') order by old_id) as rn
  from mig_stage.customers),
pn_1 as (
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

do $$
begin
  if exists (select mig_id from mig_stage.customer_map group by 1 having count(*) > 1)
     or exists (select mig_id from mig_stage.supplier_map group by 1 having count(*) > 1) then
    raise exception 'MIGRATION ABORTED: matching map fan-out (duplicate live match) detected';
  end if;
end $$;

create table mig_stage.customer_new as
select c.*, case when exists (select 1 from public.pos_customers p where p.customer_no = c.customer_no)
                   or row_number() over (partition by c.customer_no order by c.old_id) > 1
                 then c.customer_no || '-' || c.old_id else c.customer_no end as customer_no_final
from mig_stage.customers c
join mig_stage.customer_map m on m.mig_id = c.id and m.is_new;

update public.pos_customers p
set notes = coalesce(p.notes,'') || ' old_id=' || c.old_id || ' | old_code=' || coalesce(c.old_code,'')
from mig_stage.customers c
join mig_stage.customer_map m on m.mig_id = c.id
where m.live_id = p.id and (p.notes is null or p.notes not like '%old_id=%');

insert into public.pos_customers (id, customer_no, name, phone, address, notes, active)
select c.id, c.customer_no_final, c.name, c.phone, c.address,
       'old_id=' || c.old_id || ' | old_code=' || coalesce(c.old_code,'') ||
       case when c.customer_no_final <> c.customer_no then ' | كان ' || c.customer_no else '' end ||
       coalesce(' | ' || c.notes,''), c.active
from mig_stage.customer_new c
where not exists (select 1 from public.pos_customers p where p.id = c.id);

-- ---------- sales cut sets ----------
-- keep = full 2026 bulk up to 09-08 + pre-2026 that still owe
create table mig_stage.sales_keep as
select * from mig_stage.sales
where (sale_date between date '2026-01-01' and date '2026-09-08')
   or (sale_date < date '2026-01-01' and balance_due > 0);

-- twin = an old window invoice whose live copy already exists (date + amount + compatible customer)
create table mig_stage.sales_twin as
select s.id as old_id, l.id as live_id, s.invoice_no, s.sale_date, s.total
from mig_stage.sales s
join public.pos_sales l on l.sale_date = s.sale_date and l.total = s.total
where s.sale_date > date '2026-09-08'
  and (l.notes is null or l.notes not like 'old_ticket_id=%')
  and (s.customer_id is null or l.customer_id is null
       or l.customer_id = (select cm.live_id from mig_stage.customer_map cm where cm.mig_id = s.customer_id));

-- net = old window invoices with NO live twin -> still imported, nothing lost
create table mig_stage.sales_net as
select s.* from mig_stage.sales s
where s.sale_date > date '2026-09-08'
  and not exists (select 1 from mig_stage.sales_twin t where t.old_id = s.id);

create table mig_stage.sales_import as
select * from mig_stage.sales_keep
union all select * from mig_stage.sales_net;

-- ---------- insert documents ----------
insert into public.pos_sales (id, invoice_no, sale_date, location_id, customer_id, payment_method, subtotal, discount, total, paid_amount, balance_due, status, notes, created_at)
select s.id, s.invoice_no, s.sale_date, l.id, m.live_id, s.payment_method, s.subtotal, s.discount, s.total, s.paid_amount, s.balance_due, s.status, s.notes, coalesce(s.created_at, s.sale_date::timestamptz)
from mig_stage.sales_import s
join mig_stage.loc l on l.name = s.location_name
left join mig_stage.customer_map m on m.mig_id = s.customer_id
where not exists (select 1 from public.pos_sales x where x.id = s.id);

insert into public.pos_sale_items (id, sale_id, product_code, product_name, qty, unit_price, line_discount, discount_text, line_total, unit_cost_at_sale)
select i.id, i.sale_id, i.product_code, i.product_name, i.qty, i.unit_price, i.line_discount, i.discount_text, i.line_total, greatest(i.unit_cost_at_sale, 0)
from mig_stage.sale_items i
where exists (select 1 from mig_stage.sales_import si where si.id = i.sale_id)
  and not exists (select 1 from public.pos_sale_items x where x.id = i.id);

insert into public.pos_sale_payments (id, sale_id, payment_date, payment_method, amount, notes)
select p.id, p.sale_id, p.payment_date, p.payment_method, p.amount, p.notes
from mig_stage.sale_payments p
where exists (select 1 from mig_stage.sales_import si where si.id = p.sale_id)
  and not exists (select 1 from public.pos_sale_payments x where x.id = p.id);

-- customer ledger: skip rows tied to skipped window sales; payments to kept sales keep refs;
-- payment rows whose payment's sale was kept stay linked; otherwise reference cleared to null
-- first clear ledger references that point at payments whose sale is not imported
update mig_stage.customer_ledger c set reference_id = null
where c.reference_table = 'pos_sale_payments' and c.reference_id is not null
  and not exists (select 1 from mig_stage.sale_payments p where p.id = c.reference_id
                    and exists (select 1 from mig_stage.sales_import si where si.id = p.sale_id));

insert into public.pos_customer_ledger (id, customer_id, entry_date, entry_type, description, debit, credit, reference_table, reference_id)
select c.id, m.live_id, c.entry_date, c.entry_type, c.description, c.debit, c.credit, c.reference_table,
       case when c.reference_id is null then null
            when exists (select 1 from mig_stage.sales_import si where si.id = c.reference_id) then c.reference_id
            when exists (select 1 from mig_stage.sales twin_skipped where twin_skipped.id = c.reference_id) then null  -- never reached: rows of those sales are filtered below
            else c.reference_id end
from mig_stage.customer_ledger c
join mig_stage.customer_map m on m.mig_id = c.customer_id
where not exists (select 1 from public.pos_customer_ledger x where x.id = c.id)
  and not exists (select 1 from mig_stage.sales ws
                  where ws.sale_date > date '2026-09-08' and ws.id = c.reference_id
                    and not exists (select 1 from mig_stage.sales_net n where n.id = ws.id));


-- ---------- purchases / supplier ledger / proformas / expenses / transfers (old-system truth) ----------
insert into public.pos_purchases (id, supplier_id, location_id, invoice_no, purchase_date, subtotal, discount, total, paid_amount, status, notes)
select p.id, sm.live_id, l.id, coalesce(p.invoice_no, p.purchase_no), p.purchase_date, p.subtotal, p.discount, p.total, p.paid_amount, p.status, p.notes
from mig_stage.purchases p
left join mig_stage.supplier_map sm on sm.mig_id = p.supplier_id
left join mig_stage.loc l on l.name = p.location_name
where not exists (select 1 from public.pos_purchases x where x.id = p.id);

insert into public.pos_purchase_items (id, purchase_id, product_code, product_name, qty, unit_cost, line_total)
select i.id, i.purchase_id, i.product_code, i.product_name, i.qty, i.unit_cost, i.line_total
from mig_stage.purchase_items i
where not exists (select 1 from public.pos_purchase_items x where x.id = i.id);

insert into public.pos_supplier_ledger (id, supplier_id, entry_date, entry_type, description, debit, credit, reference_table, reference_id)
select s.id, sm.live_id, s.entry_date, s.entry_type, s.description, s.debit, s.credit, s.reference_table, s.reference_id
from mig_stage.supplier_ledger s
join mig_stage.supplier_map sm on sm.mig_id = s.supplier_id
where not exists (select 1 from public.pos_supplier_ledger x where x.id = s.id);

insert into public.pos_proformas (id, proforma_no, proforma_date, location_id, customer_id, customer_name, customer_phone, subtotal, discount, total, status, notes)
select p.id, p.proforma_no, p.proforma_date, l.id, m.live_id, p.customer_name, p.customer_phone, p.subtotal, p.discount, p.total, p.status, p.notes
from mig_stage.proformas p
join mig_stage.loc l on l.name = p.location_name
left join mig_stage.customer_map m on m.mig_id = p.customer_id
where not exists (select 1 from public.pos_proformas x where x.id = p.id);

insert into public.pos_proforma_items (id, proforma_id, product_code, product_name, qty, unit_price, line_total)
select i.id, i.proforma_id, i.product_code, i.product_name, i.qty, i.unit_price, i.line_total
from mig_stage.proforma_items i
where not exists (select 1 from public.pos_proforma_items x where x.id = i.id);

insert into public.pos_finance_accounts (name, account_type, opening_balance, active, notes)
select 'أرشيف النظام القديم (Cadence)', 'cash', 0, false, 'حساب أرشيفي للمصاريف التاريخية المستوردة — لا يُستخدم'
where not exists (select 1 from public.pos_finance_accounts where name = 'أرشيف النظام القديم (Cadence)');
insert into public.pos_expense_categories (name) select 'مصاريف تاريخية'
where not exists (select 1 from public.pos_expense_categories where name = 'مصاريف تاريخية');

insert into public.pos_expenses (id, expense_date, location_id, account_id, category_id, title, amount, notes)
select e.id, e.expense_date, l.id,
       (select id from public.pos_finance_accounts where name = 'أرشيف النظام القديم (Cadence)'),
       (select id from public.pos_expense_categories where name = 'مصاريف تاريخية'), e.title, e.amount, e.notes
from mig_stage.expenses e
join mig_stage.loc l on l.name = e.location_name
where not exists (select 1 from public.pos_expenses x where x.id = e.id);

insert into public.pos_stock_transfers (id, transfer_date, from_location_id, to_location_id, status, notes)
select t.id, t.transfer_date, lf.id, lt.id, t.status, t.notes
from mig_stage.stock_transfers t
join mig_stage.loc lf on lf.name = t.from_location_name
join mig_stage.loc lt on lt.name = t.to_location_name
where not exists (select 1 from public.pos_stock_transfers x where x.id = t.id);

insert into public.pos_stock_transfer_items (id, transfer_id, product_code, product_name, qty)
select i.id, i.transfer_id, i.product_code, i.product_name, i.qty
from mig_stage.stock_transfer_items i
where not exists (select 1 from public.pos_stock_transfer_items x where x.id = i.id);

-- ---------- remove LIVE twins of double-entered transfers & expenses (old copy already imported above) ----------
create table mig_stage.dead_transfers as
select l.id
from public.pos_stock_transfers l
join mig_stage.stock_transfers t
  on t.transfer_date = l.transfer_date
 and t.from_location_name = (select name from public.pos_locations x where x.id = l.from_location_id)
 and t.to_location_name   = (select name from public.pos_locations x where x.id = l.to_location_id)
where l.transfer_date > date '2026-09-08'
  and (l.notes is null or l.notes not like 'old_id=%');

delete from public.pos_stock_movements m
using mig_stage.dead_transfers d where m.reference_table = 'pos_stock_transfers' and m.reference_id = d.id;
delete from public.pos_stock_transfer_items i
using mig_stage.dead_transfers d where i.transfer_id = d.id;
delete from public.pos_stock_transfers t
using mig_stage.dead_transfers d where t.id = d.id;

create table mig_stage.dead_expenses as
select l.id, l.amount, l.expense_date, l.title
from public.pos_expenses l
where l.expense_date > date '2026-09-08'
  and (l.notes is null or l.notes not like 'old_id=%')
  and exists (select 1 from mig_stage.expenses e where e.expense_date = l.expense_date and e.amount = l.amount);

delete from public.pos_finance_movements f
using mig_stage.dead_expenses d where f.reference_table = 'pos_expenses' and f.reference_id = d.id;
delete from public.pos_expenses x
using mig_stage.dead_expenses d where x.id = d.id;

-- ---------- the movement journal (حركات الصنف) — full history minus skipped twins ----------
insert into public.pos_stock_movements (id, movement_date, location_id, product_code, product_name, movement_type, qty_change, reference_table, reference_id, notes)
select x.id, x.movement_date, l.id, x.product_code, x.product_name, x.movement_type, x.qty_change, x.reference_table, x.reference_id, x.notes
from mig_stage.stock_movements x
join mig_stage.loc l on l.name = x.location_name
where not exists (select 1 from public.pos_stock_movements e where e.id = x.id)
  and not exists (select 1 from mig_stage.sales ws
                  where ws.id = x.reference_id and ws.sale_date > date '2026-09-08'
                    and not exists (select 1 from mig_stage.sales_net n where n.id = ws.id));

-- ---------- stock rebuild: snapshot movement-derived qty + surviving live deltas after the snapshot ----------
create table mig_stage.stock_final as
select l.id as location_id, s.product_code, s.product_name,
       s.qty + coalesce((select sum(m.qty_change) from public.pos_stock_movements m
                          where m.location_id = l.id and m.product_code = s.product_code
                            and m.movement_date::date > date '2026-09-17'), 0) as final_qty
from mig_stage.stock s
join mig_stage.loc l on l.name = s.location_name;

insert into public.pos_stock (location_id, product_code, product_name, qty)
select location_id, product_code, product_name, final_qty from mig_stage.stock_final
where not exists (select 1 from public.pos_stock x where x.location_id = stock_final.location_id and x.product_code = stock_final.product_code);

update public.pos_stock st set qty = f.final_qty
from mig_stage.stock_final f
where st.location_id = f.location_id and st.product_code = f.product_code and st.qty <> f.final_qty;

-- ================================================================ verification
\set QUIET off
\echo '=== import-set profile'
select 'sales_bulk_2026_or_owing (expect 2681)' t, count(*) from mig_stage.sales_keep
union all select 'window_twin_skipped_live_exists', count(*) from mig_stage.sales_twin
union all select 'window_net_imported_no_live_twin', count(*) from mig_stage.sales_net
union all select 'sales_now_in_table_with_old_markers', (select count(*) from public.pos_sales where notes like 'old_ticket_id=%')
union all select 'sale_items_of_import_set', (select count(*) from mig_stage.sale_items i join mig_stage.sales_import s on s.id = i.sale_id)
union all select 'payments_of_import_set', (select count(*) from mig_stage.sale_payments p join mig_stage.sales_import s on s.id = p.sale_id)
union all select 'customer_ledger_imported_staged', (select count(*) from public.pos_customer_ledger l where exists (select 1 from mig_stage.customer_ledger m where m.id = l.id))
union all select '  of which opening rows (expect 30)', (select count(*) from public.pos_customer_ledger l join mig_stage.customer_ledger m on m.id = l.id where l.entry_type = 'opening')
union all select 'customers_new', (select count(*) from public.pos_customers where notes like 'old_id=%')
union all select 'products_new', (select count(*) from public.pos_products p where exists (select 1 from mig_stage.products m where m.code = p.code) and p.created_at >= now() - interval '15 minutes')
union all select 'suppliers_new', (select count(*) from public.pos_suppliers where notes like '%old_id=%')
union all select 'purchases_imported (expect ~699)', (select count(*) from public.pos_purchases where notes like '%old_id=%')
union all select 'expenses_imported (expect 3281)', (select count(*) from public.pos_expenses where notes like 'old_id=%')
union all select 'transfers_imported', (select count(*) from public.pos_stock_transfers where notes like 'old_id=%')
union all select 'live_twins_transfers_deleted', (select count(*) from mig_stage.dead_transfers)
union all select 'live_twins_expenses_deleted', (select count(*) from mig_stage.dead_expenses)
union all select 'movement_journal_rows_inserted', (select count(*) from public.pos_stock_movements m where exists (select 1 from mig_stage.stock_movements x where x.id = m.id))
union all select 'stock_rows_written', (select count(*) from public.pos_stock st where exists (select 1 from mig_stage.stock_final f where f.location_id = st.location_id and f.product_code = st.product_code))
union all select 'stock_pairs_qty_vs_movement_sum_violations (HARD: expect 0)', (select count(*) from mig_stage.stock_final f where abs(f.final_qty - coalesce((select sum(m.qty_change) from public.pos_stock_movements m where m.location_id = f.location_id and m.product_code = f.product_code),0)) > 0.001)

\echo '=== must be 0 / 1'
select (select count(*) from public.pos_sale_items i where not exists (select 1 from public.pos_sales s where s.id=i.sale_id)) orphan_items,
       (select count(*) from public.pos_sales s where s.notes like 'old_ticket_id=%' and abs(s.total - coalesce((select sum(i.line_total) from public.pos_sale_items i where i.sale_id=s.id),0)) > 0.01) header_vs_lines_mismatch,
       (select count(*) from public.pos_customer_ledger l where not exists (select 1 from public.pos_customers c where c.id=l.customer_id)) orphan_ledger,
       (select count(*) from mig_stage.sales_import si left join mig_stage.loc l on l.name=si.location_name where l.id is null) sales_without_location;

\echo '=== twin list (eyeball: these old invoices were skipped because the live copy exists)'
select invoice_no, sale_date, total from mig_stage.sales_twin order by sale_date;

\echo '=== live twins removed (transfers / expenses in overlap window)'
select 'transfer' kind, count(*) from mig_stage.dead_transfers union all select 'expense', count(*) from mig_stage.dead_expenses;

\echo '=== opening balances (expect 30 = 41990.479)'
select count(*) customers, round(sum(bal),3) folded from mig_stage.cust_opening;

\echo '=== receivable reconciliation (sum must equal snapshot receivable 46892.079)'
select round(sum(l.debit - l.credit), 3) as migrated_net_from_raw_ledger,
       (select round(sum(w.debit - w.credit), 3) from mig_stage.customer_ledger w
         where exists (select 1 from mig_stage.sales ws where ws.id = w.reference_id and ws.sale_date > date '2026-09-08'
                       and not exists (select 1 from mig_stage.sales_net n where n.id = ws.id))) as left_to_live_net,
       round((select coalesce(sum(o.debit - o.credit),0) from mig_stage.customer_ledger o where o.entry_type = 'opening'), 3) as opening_rows_folded,
       46892.079 as expected_from_snapshot
from mig_stage.customer_ledger l
where l.entry_type <> 'opening'
  and not exists (select 1 from mig_stage.sales ws where ws.id = l.reference_id and ws.sale_date > date '2026-09-08'
                  and not exists (select 1 from mig_stage.sales_net n where n.id = ws.id));

drop schema mig_stage cascade;

\if :DRY_RUN
  \echo '*** DRY RUN - rolling back, nothing was written ***'
  rollback;
\else
  commit;
  \echo '*** COMMITTED ***'
\endif
