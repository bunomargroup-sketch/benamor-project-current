-- Supabase setup for the client website
-- Run this file in Supabase SQL Editor.
-- It creates:
-- 1) web_products: product details, descriptions, multiple photos
-- 2) web_orders: client order headers
-- 3) web_order_items: products inside each client order

-- =========================================================
-- Website selected products / product pages
-- =========================================================

create table if not exists web_products (
  code text primary key,
  name text,
  brand text,
  model text,
  category text,
  price numeric default 0,
  description text,
  image_paths jsonb default '[]'::jsonb,
  active boolean default true,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);


-- Extra dynamic product columns
alter table web_products add column if not exists main_category text;
alter table web_products add column if not exists featured boolean default false;
alter table web_products add column if not exists cost numeric default 0;

alter table web_products enable row level security;

drop policy if exists "Public read web products" on web_products;
drop policy if exists "Public insert web products" on web_products;
drop policy if exists "Public update web products" on web_products;
drop policy if exists "Public delete web products" on web_products;

create policy "Public read web products"
on web_products
for select
to anon
using (true);

create policy "Public insert web products"
on web_products
for insert
to anon
with check (true);

create policy "Public update web products"
on web_products
for update
to anon
using (true)
with check (true);

create policy "Public delete web products"
on web_products
for delete
to anon
using (true);

-- =========================================================
-- Website client orders
-- =========================================================

create table if not exists web_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique,
  customer_name text not null,
  customer_phone text not null,
  city text,
  address text,
  notes text,
  subtotal numeric default 0,
  total numeric default 0,
  status text default 'جديد',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists web_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references web_orders(id) on delete cascade,
  product_code text not null,
  product_name text,
  quantity numeric default 1,
  unit_price numeric default 0,
  line_total numeric default 0,
  created_at timestamptz default now()
);

alter table web_orders enable row level security;
alter table web_order_items enable row level security;

drop policy if exists "Public insert web orders" on web_orders;
drop policy if exists "Public read web orders" on web_orders;
drop policy if exists "Public update web orders" on web_orders;
drop policy if exists "Public insert web order items" on web_order_items;
drop policy if exists "Public read web order items" on web_order_items;

create policy "Public insert web orders"
on web_orders
for insert
to anon
with check (true);

create policy "Public read web orders"
on web_orders
for select
to anon
using (true);

create policy "Public update web orders"
on web_orders
for update
to anon
using (true)
with check (true);

create policy "Public insert web order items"
on web_order_items
for insert
to anon
with check (true);

create policy "Public read web order items"
on web_order_items
for select
to anon
using (true);
