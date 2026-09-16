-- Benamor POS - الجرد الفعلي + سجل التدقيق + مستويات التسعير
-- Stock count + Audit trail + Wholesale pricing
-- Run this in Supabase SQL Editor BEFORE uploading the new HTML.

begin;

-- 1. جدول سجل التدقيق (Audit trail)
create table if not exists public.pos_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_identifier text,
  action text not null,
  entity_type text,
  entity_id text,
  details text,
  branch_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists pos_audit_log_idx on public.pos_audit_log(created_at desc);
alter table public.pos_audit_log enable row level security;
drop policy if exists "auth select pos_audit_log" on public.pos_audit_log;
drop policy if exists "auth insert pos_audit_log" on public.pos_audit_log;
create policy "auth select pos_audit_log" on public.pos_audit_log for select to authenticated using (true);
create policy "auth insert pos_audit_log" on public.pos_audit_log for insert to authenticated with check (true);

-- 2. عمود سعر الجملة (Wholesale price)
alter table public.pos_products add column if not exists wholesale_price numeric not null default 0;

commit;
