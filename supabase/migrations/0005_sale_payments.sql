-- ═══ 0005 — دفعات فواتير البيع
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-sale-payments.sql

-- Benamor Sales System - Sale split payments
-- Run once in Supabase SQL Editor.

begin;

create table if not exists public.pos_sale_payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.pos_sales(id) on delete cascade,
  payment_date date not null default current_date,
  payment_method text not null check (payment_method in ('cash','bank_transfer','card')),
  amount numeric not null check (amount > 0),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists pos_sale_payments_sale_idx on public.pos_sale_payments (sale_id);
create index if not exists pos_sale_payments_date_idx on public.pos_sale_payments (payment_date desc, created_at desc);

alter table public.pos_sale_payments enable row level security;

drop policy if exists "POS public select pos_sale_payments" on public.pos_sale_payments;
drop policy if exists "POS public insert pos_sale_payments" on public.pos_sale_payments;
drop policy if exists "POS public update pos_sale_payments" on public.pos_sale_payments;
drop policy if exists "POS public delete pos_sale_payments" on public.pos_sale_payments;

create policy "POS public select pos_sale_payments" on public.pos_sale_payments for select to anon using (true);
create policy "POS public insert pos_sale_payments" on public.pos_sale_payments for insert to anon with check (true);
create policy "POS public update pos_sale_payments" on public.pos_sale_payments for update to anon using (true) with check (true);
create policy "POS public delete pos_sale_payments" on public.pos_sale_payments for delete to anon using (true);

commit;
