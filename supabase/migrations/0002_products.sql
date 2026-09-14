-- ═══ 0002 — المنتجات + view ملخص المخزون (الأساس)
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-products-setup.sql

-- Benamor Sales System - Products setup only
-- Run this if the Products page says pos_products or pos_product_stock_summary does not exist.
-- If you already ran import-chunks/00-setup-staging.sql and 99-finalize-import.sql, you may not need this.

begin;

create table if not exists public.pos_products (
  code text primary key,
  name text not null,
  brand text,
  model text,
  category text,
  supplier_id uuid references public.pos_suppliers(id) on delete set null,
  purchase_price numeric not null default 0,
  retail_price numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pos_products_name_idx on public.pos_products using btree (name);
create index if not exists pos_products_category_idx on public.pos_products using btree (category);
create index if not exists pos_products_supplier_idx on public.pos_products using btree (supplier_id);

alter table public.pos_products enable row level security;

drop policy if exists "POS public select pos_products" on public.pos_products;
drop policy if exists "POS public insert pos_products" on public.pos_products;
drop policy if exists "POS public update pos_products" on public.pos_products;
drop policy if exists "POS public delete pos_products" on public.pos_products;

create policy "POS public select pos_products" on public.pos_products for select to anon using (true);
create policy "POS public insert pos_products" on public.pos_products for insert to anon with check (true);
create policy "POS public update pos_products" on public.pos_products for update to anon using (true) with check (true);
create policy "POS public delete pos_products" on public.pos_products for delete to anon using (true);

create or replace view public.pos_product_stock_summary as
select
  p.code,
  p.name,
  p.brand,
  p.model,
  p.category,
  p.purchase_price,
  p.retail_price,
  s.name as supplier_name,
  coalesce(sum(st.qty) filter (where l.name = 'فرع 11 يونيو'), 0) as stock_11_june,
  coalesce(sum(st.qty) filter (where l.name = 'فرع السراج'), 0) as stock_sarraj,
  coalesce(sum(st.qty) filter (where l.name = 'مخزن جنزور'), 0) as stock_janzour,
  coalesce(sum(st.qty), 0) as total_stock
from public.pos_products p
left join public.pos_suppliers s on s.id = p.supplier_id
left join public.pos_stock st on st.product_code = p.code
left join public.pos_locations l on l.id = st.location_id
group by p.code, p.name, p.brand, p.model, p.category, p.purchase_price, p.retail_price, s.name;

commit;
