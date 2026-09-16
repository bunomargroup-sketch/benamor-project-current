-- ═══ 0007 — مرتجعات البيع + باركود + نقطة إعادة الطلب + view الملخص النهائي
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-returns-barcode-discount-reorder.sql

-- Benamor Sales System - Barcode, returns/refunds, sale line discounts, reorder points
-- Run this once in Supabase SQL Editor.

begin;

-- Product barcode + reorder point
alter table public.pos_products
  add column if not exists barcode text,
  add column if not exists reorder_point numeric not null default 0;

create index if not exists pos_products_barcode_idx on public.pos_products using btree (barcode);
create index if not exists pos_products_reorder_point_idx on public.pos_products using btree (reorder_point);

-- Sale line discount support
alter table public.pos_sale_items
  add column if not exists line_discount numeric not null default 0,
  add column if not exists discount_text text;

-- Sale returns / refunds
create table if not exists public.pos_sale_returns (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.pos_sales(id) on delete cascade,
  return_date date not null default current_date,
  location_id uuid references public.pos_locations(id),
  customer_id uuid references public.pos_customers(id) on delete set null,
  total numeric not null default 0,
  refund_method text not null default 'cash' check (refund_method in ('cash','bank_transfer','card','credit_reduction','none')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_sale_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.pos_sale_returns(id) on delete cascade,
  sale_item_id uuid references public.pos_sale_items(id) on delete set null,
  product_code text not null,
  product_name text not null,
  qty numeric not null check (qty > 0),
  unit_price numeric not null default 0,
  line_discount numeric not null default 0,
  line_total numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists pos_sale_returns_sale_idx on public.pos_sale_returns (sale_id, return_date desc);
create index if not exists pos_sale_returns_date_idx on public.pos_sale_returns (return_date desc, created_at desc);
create index if not exists pos_sale_return_items_return_idx on public.pos_sale_return_items (return_id);

alter table public.pos_sale_returns enable row level security;
alter table public.pos_sale_return_items enable row level security;

do $$
declare t text;
begin
  foreach t in array array['pos_sale_returns','pos_sale_return_items'] loop
    execute format('drop policy if exists "POS public select %1$s" on public.%1$I', t);
    execute format('drop policy if exists "POS public insert %1$s" on public.%1$I', t);
    execute format('drop policy if exists "POS public update %1$s" on public.%1$I', t);
    execute format('drop policy if exists "POS public delete %1$s" on public.%1$I', t);
    execute format('create policy "POS public select %1$s" on public.%1$I for select to anon using (true)', t);
    execute format('create policy "POS public insert %1$s" on public.%1$I for insert to anon with check (true)', t);
    execute format('create policy "POS public update %1$s" on public.%1$I for update to anon using (true) with check (true)', t);
    execute format('create policy "POS public delete %1$s" on public.%1$I for delete to anon using (true)', t);
  end loop;
end $$;

-- Recreate product summary view with barcode and reorder point.
drop view if exists public.pos_product_stock_summary;

create view public.pos_product_stock_summary as
select
  p.code,
  p.name,
  p.brand,
  p.model,
  p.color,
  p.barcode,
  p.category,
  p.purchase_price,
  p.retail_price,
  p.reorder_point,
  s.name as supplier_name,
  coalesce(sum(st.qty) filter (where l.name = 'فرع 11 يونيو'), 0) as stock_11_june,
  coalesce(sum(st.qty) filter (where l.name = 'فرع السراج'), 0) as stock_sarraj,
  coalesce(sum(st.qty) filter (where l.name = 'مخزن جنزور'), 0) as stock_janzour,
  coalesce(sum(st.qty), 0) as total_stock
from public.pos_products p
left join public.pos_suppliers s on s.id = p.supplier_id
left join public.pos_stock st on st.product_code = p.code
left join public.pos_locations l on l.id = st.location_id
group by p.code, p.name, p.brand, p.model, p.color, p.barcode, p.category, p.purchase_price, p.retail_price, p.reorder_point, s.name;

commit;
