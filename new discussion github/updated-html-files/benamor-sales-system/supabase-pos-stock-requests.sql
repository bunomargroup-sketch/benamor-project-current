-- ═══ 0051 — تسجيل «طُلب ولم يوجد» (إشارة الطلب الأثمن في المنظومة)
-- المصدر: apps/pos/benamor-sales-system/supabase-pos-stock-requests.sql
--
-- الغرض: حين يختار الكاشير منتجاً كميته في فرعه ≤ الحدّ ومتوفّراً في موقع
-- آخر، تُسجَّل الإشارة صامتة (بعد الرسم، بلا أي أثر على شاشة البيع) —
-- مرّة واحدة لكل (منتج، فرع، يوم) بفهرس فريد + ON CONFLICT DO NOTHING.
--
-- 🔴 يُطبَّق بـ supabase db push — لا SQL من المتصفّح
-- ═════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.pos_stock_requests (
  id uuid primary key default gen_random_uuid(),
  product_code text not null,
  request_date date not null default current_date,
  requested_at timestamptz not null default now(),
  location_id uuid not null references public.pos_locations(id) on delete cascade,
  qty_here numeric,
  available_elsewhere jsonb,
  user_identifier text,
  resolved boolean not null default false,
  resolved_at timestamptz,
  resolved_by text
);

-- التفرّد: مرّة واحدة لكل (منتج، فرع، يوم) — العميل يرسل ON CONFLICT DO NOTHING
create unique index if not exists pos_stock_requests_unique_day
  on public.pos_stock_requests(product_code, location_id, request_date);

-- الاستعلام الساخن: المفتوحة أولاً (قائمة «طُلب ولم يوجد» في المهام ٣)
create index if not exists pos_stock_requests_open_idx
  on public.pos_stock_requests(requested_at desc)
  where resolved = false;

create index if not exists pos_stock_requests_product_idx
  on public.pos_stock_requests(product_code);

-- ─── الصلاحيات: مسجَّلون يقرأون ويسجّلون ويعلّمون resolved · anon مرفوض ───
alter table public.pos_stock_requests enable row level security;

drop policy if exists pos_role_sreq_read on public.pos_stock_requests;
create policy pos_role_sreq_read on public.pos_stock_requests
  for select to authenticated using (true);

drop policy if exists pos_role_sreq_insert on public.pos_stock_requests;
create policy pos_role_sreq_insert on public.pos_stock_requests
  for insert to authenticated with check (true);

drop policy if exists pos_role_sreq_update on public.pos_stock_requests;
create policy pos_role_sreq_update on public.pos_stock_requests
  for update to authenticated using (true) with check (true);

revoke all on public.pos_stock_requests from anon;
grant select, insert, update on public.pos_stock_requests to authenticated; /* صريحة — Postgres الخام لا يمنح افتراضياً (درس 0050) */

commit;

-- ═══════════════════════════════════════════
-- التحقق بعد التطبيق (اختياري):
--
-- (١) التفرّد اليومي: الإدراج الثاني بنفس (منتج، فرع، اليوم) يُبتلع بصمت:
--   insert into pos_stock_requests(product_code,location_id,qty_here)
--   values ('TEST-1', (select id from pos_locations limit 1), 0)
--   on conflict do nothing;  -- مرتين متتاليتين ثم:
--   select count(*) from pos_stock_requests where product_code='TEST-1';  ⇒ 1
--   delete from pos_stock_requests where product_code='TEST-1';
-- ═══════════════════════════════════════════
