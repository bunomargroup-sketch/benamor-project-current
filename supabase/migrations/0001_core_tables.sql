-- ═══ 0001 — الفروع/المورّدون/المخزون/الشراء/التحويلات + view أرصدة المورّدين
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-setup.sql
-- الترتيب داخل supabase/migrations هو ترتيب التنفيذ المعتمد لقاعدة فارغة

-- Benamar / Bun Omar Sales System - POS phase 1
-- Run this once in Supabase SQL Editor.
-- This creates separate POS tables and does NOT replace the current pricechecker2 tables.

create extension if not exists pgcrypto;

-- 1) Locations: sales branches and warehouses
create table if not exists public.pos_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  location_type text not null check (location_type in ('branch', 'warehouse')),
  is_sales_location boolean not null default false,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.pos_locations (name, location_type, is_sales_location, notes)
values
  ('فرع 11 يونيو', 'branch', true, 'فرع بيع'),
  ('فرع السراج', 'branch', true, 'فرع بيع'),
  ('مخزن جنزور', 'warehouse', false, 'مخزن فقط بدون بيع مباشر')
on conflict (name) do update set
  location_type = excluded.location_type,
  is_sales_location = excluded.is_sales_location,
  notes = excluded.notes,
  active = true,
  updated_at = now();

-- 2) Suppliers
create table if not exists public.pos_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  address text,
  notes text,
  opening_balance numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pos_suppliers_name_idx on public.pos_suppliers using btree (name);

-- 3) Supplier ledger
-- Business meaning:
-- credit = increases what we owe to supplier
-- debit  = decreases what we owe to supplier / amount supplier owes us
-- balance = sum(credit - debit)
-- positive balance = علينا للمورد
-- negative balance = لنا عند المورد
create table if not exists public.pos_supplier_ledger (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.pos_suppliers(id) on delete cascade,
  entry_date date not null default current_date,
  entry_type text not null check (entry_type in ('opening', 'purchase', 'payment', 'return', 'adjustment')),
  description text,
  debit numeric not null default 0 check (debit >= 0),
  credit numeric not null default 0 check (credit >= 0),
  reference_table text,
  reference_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists pos_supplier_ledger_supplier_idx on public.pos_supplier_ledger (supplier_id, entry_date desc, created_at desc);

-- 4) Supplier payments
create table if not exists public.pos_supplier_payments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.pos_suppliers(id) on delete cascade,
  payment_date date not null default current_date,
  amount numeric not null check (amount > 0),
  payment_method text not null check (payment_method in ('cash', 'bank_transfer', 'card')),
  notes text,
  created_at timestamptz not null default now()
);

-- 5) Purchases from suppliers, prepared for next phase
create table if not exists public.pos_purchases (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.pos_suppliers(id),
  location_id uuid references public.pos_locations(id),
  invoice_no text,
  purchase_date date not null default current_date,
  subtotal numeric not null default 0,
  discount numeric not null default 0,
  total numeric not null default 0,
  paid_amount numeric not null default 0,
  status text not null default 'posted' check (status in ('draft', 'posted', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.pos_purchases(id) on delete cascade,
  product_code text,
  product_name text not null,
  qty numeric not null check (qty <> 0),
  unit_cost numeric not null default 0 check (unit_cost >= 0),
  line_total numeric not null default 0,
  created_at timestamptz not null default now()
);

-- 6) Stock tables, prepared for full stock management
create table if not exists public.pos_stock (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.pos_locations(id) on delete cascade,
  product_code text not null,
  product_name text,
  qty numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (location_id, product_code)
);

create table if not exists public.pos_stock_movements (
  id uuid primary key default gen_random_uuid(),
  movement_date timestamptz not null default now(),
  location_id uuid references public.pos_locations(id),
  product_code text not null,
  product_name text,
  movement_type text not null check (movement_type in ('purchase', 'sale', 'return_supplier', 'return_customer', 'transfer_in', 'transfer_out', 'adjustment')),
  qty_change numeric not null,
  reference_table text,
  reference_id uuid,
  notes text,
  created_at timestamptz not null default now()
);

-- 7) Stock transfers, prepared for branch/warehouse movements
create table if not exists public.pos_stock_transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_date date not null default current_date,
  from_location_id uuid references public.pos_locations(id),
  to_location_id uuid references public.pos_locations(id),
  status text not null default 'draft' check (status in ('draft', 'posted', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_stock_transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.pos_stock_transfers(id) on delete cascade,
  product_code text not null,
  product_name text,
  qty numeric not null check (qty <> 0),
  created_at timestamptz not null default now()
);

-- 8) Supplier balances view
create or replace view public.pos_supplier_balances as
select
  s.id,
  s.name,
  s.phone,
  s.address,
  s.notes,
  s.active,
  coalesce(sum(l.credit - l.debit), 0) as balance,
  case
    when coalesce(sum(l.credit - l.debit), 0) > 0 then 'علينا للمورد'
    when coalesce(sum(l.credit - l.debit), 0) < 0 then 'لنا عند المورد'
    else 'متوازن'
  end as balance_status
from public.pos_suppliers s
left join public.pos_supplier_ledger l on l.supplier_id = s.id
group by s.id, s.name, s.phone, s.address, s.notes, s.active;

-- 9) RLS policies for GitHub Pages app using anon key.
-- Internal system: keep repository private if later moving to stronger auth; for now policies allow app usage.
alter table public.pos_locations enable row level security;
alter table public.pos_suppliers enable row level security;
alter table public.pos_supplier_ledger enable row level security;
alter table public.pos_supplier_payments enable row level security;
alter table public.pos_purchases enable row level security;
alter table public.pos_purchase_items enable row level security;
alter table public.pos_stock enable row level security;
alter table public.pos_stock_movements enable row level security;
alter table public.pos_stock_transfers enable row level security;
alter table public.pos_stock_transfer_items enable row level security;

-- Recreate permissive policies safely

do $$
declare
  t text;
begin
  foreach t in array array[
    'pos_locations','pos_suppliers','pos_supplier_ledger','pos_supplier_payments',
    'pos_purchases','pos_purchase_items','pos_stock','pos_stock_movements',
    'pos_stock_transfers','pos_stock_transfer_items'
  ] loop
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
