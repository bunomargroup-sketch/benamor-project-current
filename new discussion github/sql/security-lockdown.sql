-- Security Lockdown for Ben Amor Suite
-- Run only after staff users have been migrated to Supabase Auth and updated HTML files are ready.
-- Idempotent: can be re-run.

begin;

-- Staff roles
create table if not exists public.staff_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','seller')),
  created_at timestamptz not null default now()
);
alter table public.staff_roles enable row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='staff_roles' loop
    execute format('drop policy if exists %I on public.staff_roles', r.policyname);
  end loop;
end $$;
create policy "staff can read own role" on public.staff_roles for select to authenticated using (user_id = auth.uid());

-- Product costs
create table if not exists public.product_costs (
  code text primary key,
  cost numeric not null default 0
);
alter table public.product_costs enable row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='product_costs' loop
    execute format('drop policy if exists %I on public.product_costs', r.policyname);
  end loop;
end $$;
create policy "authenticated can read product costs" on public.product_costs for select to authenticated using (true);

-- Utility: drop all policies on target public tables if they exist
DO $$
declare t text; r record;
begin
  foreach t in array array[
    'web_products','web_orders','web_order_items','carts','cart_items','app_users',
    'pos_locations','pos_suppliers','pos_supplier_ledger','pos_supplier_payments','pos_purchases','pos_purchase_items',
    'pos_stock','pos_stock_movements','pos_stock_transfers','pos_stock_transfer_items','pos_products',
    'pos_customers','pos_customer_ledger','pos_sales','pos_sale_items','pos_sale_payments','pos_sale_returns','pos_sale_return_items',
    'pos_finance_accounts','pos_finance_movements','pos_expense_categories','pos_expenses','pos_employees','pos_salary_payments',
    'pos_proformas','pos_proforma_items','pos_user_roles','pos_number_counters'
  ] loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I enable row level security', t);
      for r in select policyname from pg_policies where schemaname='public' and tablename=t loop
        execute format('drop policy if exists %I on public.%I', r.policyname, t);
      end loop;
    end if;
  end loop;
end $$;

-- Website product catalog: public read active only, staff write
create policy "public read active web products" on public.web_products
for select to anon, authenticated
using (coalesce(active,true) = true);
create policy "staff insert web products" on public.web_products for insert to authenticated with check (true);
create policy "staff update web products" on public.web_products for update to authenticated using (true) with check (true);
create policy "staff delete web products" on public.web_products for delete to authenticated using (true);

-- Website orders: public insert only; staff read/update; no delete
create policy "public create web orders" on public.web_orders
for insert to anon with check (status is null or status in ('جديد','new'));
create policy "staff read web orders" on public.web_orders for select to authenticated using (true);
create policy "staff update web orders" on public.web_orders for update to authenticated using (true) with check (true);

create policy "public create web order items" on public.web_order_items for insert to anon with check (true);
create policy "staff read web order items" on public.web_order_items for select to authenticated using (true);

-- Saved carts: authenticated owners only. Add user_id columns.
alter table public.carts add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.cart_items add column if not exists user_id uuid references auth.users(id) on delete cascade;
-- Owner must run migration mapping app_user_id -> auth.users before strict enforcement for old rows.
create policy "owner read carts" on public.carts for select to authenticated using (user_id = auth.uid());
create policy "owner insert carts" on public.carts for insert to authenticated with check (user_id = auth.uid());
create policy "owner update carts" on public.carts for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner delete carts" on public.carts for delete to authenticated using (user_id = auth.uid());
create policy "owner read cart items" on public.cart_items for select to authenticated using (user_id = auth.uid());
create policy "owner insert cart items" on public.cart_items for insert to authenticated with check (user_id = auth.uid());
create policy "owner update cart items" on public.cart_items for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner delete cart items" on public.cart_items for delete to authenticated using (user_id = auth.uid());

-- app_users: historical only; no public or staff access from browser
-- No policies = blocked by RLS.

-- POS/business tables: authenticated access. Delete only where current apps use deletes during edit flows.
DO $$
declare t text;
begin
  foreach t in array array[
    'pos_locations','pos_suppliers','pos_supplier_ledger','pos_supplier_payments','pos_purchases','pos_purchase_items',
    'pos_stock','pos_stock_movements','pos_stock_transfers','pos_stock_transfer_items','pos_products',
    'pos_customers','pos_customer_ledger','pos_sales','pos_sale_items','pos_sale_payments','pos_sale_returns','pos_sale_return_items',
    'pos_finance_accounts','pos_finance_movements','pos_expense_categories','pos_expenses','pos_employees','pos_salary_payments',
    'pos_proformas','pos_proforma_items','pos_user_roles','pos_number_counters'
  ] loop
    if to_regclass('public.'||t) is not null then
      execute format('create policy %I on public.%I for select to authenticated using (true)', 'auth select '||t, t);
      execute format('create policy %I on public.%I for insert to authenticated with check (true)', 'auth insert '||t, t);
      execute format('create policy %I on public.%I for update to authenticated using (true) with check (true)', 'auth update '||t, t);
    end if;
  end loop;
  foreach t in array array['pos_purchase_items','pos_supplier_ledger','pos_stock_movements','pos_stock_transfer_items','pos_sale_items','pos_sale_payments','pos_customer_ledger','pos_proforma_items','pos_finance_movements'] loop
    if to_regclass('public.'||t) is not null then
      execute format('create policy %I on public.%I for delete to authenticated using (true)', 'auth delete '||t, t);
    end if;
  end loop;
end $$;

-- Storage: product-images public read, authenticated write
DO $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'product-images%' loop
    execute format('drop policy if exists %I on storage.objects', r.policyname);
  end loop;
end $$;
create policy "product-images public read" on storage.objects for select to anon, authenticated using (bucket_id='product-images');
create policy "product-images authenticated insert" on storage.objects for insert to authenticated with check (bucket_id='product-images');
create policy "product-images authenticated update" on storage.objects for update to authenticated using (bucket_id='product-images') with check (bucket_id='product-images');
create policy "product-images authenticated delete" on storage.objects for delete to authenticated using (bucket_id='product-images');

commit;

-- Verification: paste this result back for review.
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where (schemaname='public' and (tablename like 'pos_%' or tablename in ('web_products','web_orders','web_order_items','carts','cart_items','app_users','product_costs','staff_roles')))
   or (schemaname='storage' and tablename='objects' and policyname like 'product-images%')
order by schemaname, tablename, policyname;
