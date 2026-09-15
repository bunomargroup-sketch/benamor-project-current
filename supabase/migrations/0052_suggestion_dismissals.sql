-- ═══ 0052 — تجاهل اقتراحات التحويل (30 يوماً) — جزء من المهمة ٣
-- بدون هذا تعود نفس الصفوف المرفوضة كل يوم فيهجر المستخدم الشاشة.
-- المفتاح: (المنتج، الوجهة) — التجاهل يخفي كل اقتراح بنقل هذا المنتج
-- إلى هذه الوجهة أياً كان المصدر أو القائمة، حتى dismissed_until.
-- 🔴 يُطبَّق بـ supabase db push — لا SQL من المتصفّح
-- ═════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.pos_suggestion_dismissals (
  product_code text not null,
  to_location_id uuid not null references public.pos_locations(id) on delete cascade,
  dismissed_until timestamptz not null,
  dismissed_by text,
  created_at timestamptz not null default now(),
  primary key (product_code, to_location_id)
);

create index if not exists pos_suggestion_dismissals_until_idx
  on public.pos_suggestion_dismissals(dismissed_until);

alter table public.pos_suggestion_dismissals enable row level security;

drop policy if exists pos_role_sdis_read on public.pos_suggestion_dismissals;
create policy pos_role_sdis_read on public.pos_suggestion_dismissals
  for select to authenticated using (true);

drop policy if exists pos_role_sdis_write on public.pos_suggestion_dismissals;
create policy pos_role_sdis_write on public.pos_suggestion_dismissals
  for all to authenticated
  using (public.pos_policy_role() in ('admin','sales_purchase','seller_11','seller_sarraj'))
  with check (public.pos_policy_role() in ('admin','sales_purchase','seller_11','seller_sarraj'));

revoke all on public.pos_suggestion_dismissals from anon;
grant select, insert, update, delete on public.pos_suggestion_dismissals to authenticated; /* صريحة — درس 0050 */

commit;
