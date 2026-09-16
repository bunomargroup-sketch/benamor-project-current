-- ═══ 0013 — إغلاق الصندوق اليومي
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-daily-cash-closing.sql

-- Benamor POS - Daily cash closing reports
-- Run once in Supabase SQL Editor.

begin;

create table if not exists public.pos_daily_cash_closings (
  id uuid primary key default gen_random_uuid(),
  closing_date date not null,
  branch_id uuid not null references public.pos_locations(id) on delete cascade,
  branch_name text,
  responsible_identifier text,
  invoice_count integer not null default 0,
  sales_cash numeric not null default 0,
  sales_card numeric not null default 0,
  sales_bank_transfer numeric not null default 0,
  expenses_cash numeric not null default 0,
  expenses_card numeric not null default 0,
  expenses_bank_transfer numeric not null default 0,
  customer_payments_cash numeric not null default 0,
  customer_payments_card numeric not null default 0,
  customer_payments_bank_transfer numeric not null default 0,
  supplier_payments_cash numeric not null default 0,
  supplier_payments_card numeric not null default 0,
  supplier_payments_bank_transfer numeric not null default 0,
  refunds_cash numeric not null default 0,
  refunds_card numeric not null default 0,
  refunds_bank_transfer numeric not null default 0,
  cash_remaining numeric not null default 0,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(branch_id, closing_date)
);

create index if not exists pos_daily_cash_closings_date_idx on public.pos_daily_cash_closings(closing_date desc, branch_id);

alter table public.pos_daily_cash_closings enable row level security;

drop policy if exists "auth select pos_daily_cash_closings" on public.pos_daily_cash_closings;
drop policy if exists "auth insert pos_daily_cash_closings" on public.pos_daily_cash_closings;
drop policy if exists "auth update pos_daily_cash_closings" on public.pos_daily_cash_closings;

create policy "auth select pos_daily_cash_closings" on public.pos_daily_cash_closings for select to authenticated using (true);
create policy "auth insert pos_daily_cash_closings" on public.pos_daily_cash_closings for insert to authenticated with check (true);
create policy "auth update pos_daily_cash_closings" on public.pos_daily_cash_closings for update to authenticated using (true) with check (true);

commit;
