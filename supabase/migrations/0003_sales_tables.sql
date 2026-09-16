-- ═══ 0003 — الزبائن/فواتير البيع/البنود/قيود الزبائن + view الأرصدة
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-sales-setup.sql

-- Benamor Sales System - Sales + customers setup
-- Run this once in Supabase SQL Editor before using the sales screen.

begin;

create table if not exists public.pos_customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  address text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pos_customers_name_idx on public.pos_customers using btree (name);
create index if not exists pos_customers_phone_idx on public.pos_customers using btree (phone);

create table if not exists public.pos_sales (
  id uuid primary key default gen_random_uuid(),
  invoice_no text,
  sale_date date not null default current_date,
  location_id uuid references public.pos_locations(id),
  customer_id uuid references public.pos_customers(id) on delete set null,
  payment_method text not null default 'cash' check (payment_method in ('cash','bank_transfer','card','mixed','credit')),
  subtotal numeric not null default 0,
  discount numeric not null default 0,
  total numeric not null default 0,
  paid_amount numeric not null default 0,
  balance_due numeric not null default 0,
  status text not null default 'posted' check (status in ('draft','posted','cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.pos_sales(id) on delete cascade,
  product_code text not null,
  product_name text not null,
  qty numeric not null check (qty <> 0),
  unit_price numeric not null default 0 check (unit_price >= 0),
  line_total numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.pos_customer_ledger (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.pos_customers(id) on delete cascade,
  entry_date date not null default current_date,
  entry_type text not null check (entry_type in ('opening','sale','payment','return','adjustment')),
  description text,
  debit numeric not null default 0 check (debit >= 0),
  credit numeric not null default 0 check (credit >= 0),
  reference_table text,
  reference_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists pos_sales_date_idx on public.pos_sales (sale_date desc, created_at desc);
create index if not exists pos_sale_items_sale_idx on public.pos_sale_items (sale_id);
create index if not exists pos_customer_ledger_customer_idx on public.pos_customer_ledger (customer_id, entry_date desc, created_at desc);

create or replace view public.pos_customer_balances as
select
  c.id,
  c.name,
  c.phone,
  c.address,
  c.notes,
  c.active,
  coalesce(sum(l.debit - l.credit), 0) as balance,
  case
    when coalesce(sum(l.debit - l.credit), 0) > 0 then 'على العميل'
    when coalesce(sum(l.debit - l.credit), 0) < 0 then 'للعميل رصيد'
    else 'متوازن'
  end as balance_status
from public.pos_customers c
left join public.pos_customer_ledger l on l.customer_id = c.id
group by c.id, c.name, c.phone, c.address, c.notes, c.active;

alter table public.pos_customers enable row level security;
alter table public.pos_sales enable row level security;
alter table public.pos_sale_items enable row level security;
alter table public.pos_customer_ledger enable row level security;

do $$
declare t text;
begin
  foreach t in array array['pos_customers','pos_sales','pos_sale_items','pos_customer_ledger'] loop
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

commit;
