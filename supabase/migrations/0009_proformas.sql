-- ═══ 0009 — الفواتير المبدئية
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-proforma-setup.sql

-- Benamor Sales System - Proforma invoices / preliminary invoices
-- Run once in Supabase SQL Editor.

begin;

create table if not exists public.pos_proformas (
  id uuid primary key default gen_random_uuid(),
  proforma_no text,
  proforma_date date not null default current_date,
  location_id uuid references public.pos_locations(id) on delete set null,
  customer_id uuid references public.pos_customers(id) on delete set null,
  customer_name text,
  customer_phone text,
  subtotal numeric not null default 0,
  discount numeric not null default 0,
  total numeric not null default 0,
  status text not null default 'draft' check (status in ('draft','converted','cancelled')),
  source_sale_id uuid references public.pos_sales(id) on delete set null,
  converted_sale_id uuid references public.pos_sales(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_proforma_items (
  id uuid primary key default gen_random_uuid(),
  proforma_id uuid not null references public.pos_proformas(id) on delete cascade,
  product_code text not null,
  product_name text not null,
  qty numeric not null check (qty > 0),
  unit_price numeric not null default 0,
  line_discount numeric not null default 0,
  discount_text text,
  line_total numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists pos_proformas_date_idx on public.pos_proformas(proforma_date desc, created_at desc);
create index if not exists pos_proformas_source_sale_idx on public.pos_proformas(source_sale_id);
create index if not exists pos_proforma_items_proforma_idx on public.pos_proforma_items(proforma_id);

alter table public.pos_proformas enable row level security;
alter table public.pos_proforma_items enable row level security;

do $$
declare t text;
begin
  foreach t in array array['pos_proformas','pos_proforma_items'] loop
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
