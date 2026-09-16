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
  /* حدّ اليوم بالتوقيت المحلي (ليبيا) — current_date بتوقيت UTC يجعل حدود اليوم 2 صباحاً محلياً */
  request_date date not null default ((now() at time zone 'Africa/Tripoli')::date),
  requested_at timestamptz not null default now(),
  location_id uuid not null references public.pos_locations(id) on delete cascade,
  qty_here numeric,
  available_elsewhere jsonb,
  user_identifier text,
  hit_count int not null default 1,
  last_requested_at timestamptz not null default now(),
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

-- ─── RPC التسجيل: صفّ واحد كما هو والعدّاد محفوظ (ON CONFLICT DO UPDATE) ═══
-- PostgREST لا يستطيع التعبير عن hit_count = hit_count + 1 — الدالة تفعلها ذرّياً
create or replace function public.pos_record_stock_request(
  p_product_code text,
  p_location_id uuid,
  p_qty_here numeric default null,
  p_available_elsewhere jsonb default null,
  p_user_identifier text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.pos_stock_requests
    (product_code, location_id, request_date, qty_here, available_elsewhere, user_identifier)
  values
    (p_product_code, p_location_id, (now() at time zone 'Africa/Tripoli')::date,
     p_qty_here, p_available_elsewhere, nullif(p_user_identifier, ''))
  on conflict (product_code, location_id, request_date)
  do update set hit_count          = public.pos_stock_requests.hit_count + 1,
                last_requested_at  = now(),
                qty_here           = excluded.qty_here,
                available_elsewhere = excluded.available_elsewhere,
                user_identifier    = excluded.user_identifier;
  /* resolved لا يُلمس: طلب حُلّ بتحويل ثم سُئل ثانيةً بنفس اليوم يبقى محلولاً */
end $$;

revoke all on function public.pos_record_stock_request(text,uuid,numeric,jsonb,text) from anon, public;
grant execute on function public.pos_record_stock_request(text,uuid,numeric,jsonb,text) to authenticated;

commit;

-- ═══════════════════════════════════════════
-- التحقق بعد التطبيق (اختياري):
--
-- (١) التفرّد اليومي + العدّاد (نفّذ مرتين متتاليتين):
--   select pos_record_stock_request('TEST-1',(select id from pos_locations limit 1),0,null,'admin');
--   select pos_record_stock_request('TEST-1',(select id from pos_locations limit 1),0,null,'admin');
--   select count(*), max(hit_count) from pos_stock_requests where product_code='TEST-1';
--   ⇒ صف واحد · hit_count=2
--   delete from pos_stock_requests where product_code='TEST-1';
-- ═══════════════════════════════════════════
