-- ═══ 0050 — أقسام كل موقع (بوّابة اقتراحات التحويل) — الأساس للمهام ٢-٤
-- المصدر: apps/pos/benamor-sales-system/supabase-pos-location-category-rules.sql
--
-- الغرض: بعض البضاعة خاصة بفرع (السراج فيه قسم أدوات/عدّة لا وجود له في
-- 11 يونيو). اقتراح تحويل مطرقة إلى 11 يونيو خطأٌ لا نقص مخزون — يُحلّ
-- على مستوى التصنيف (157) لا المنتج (4,453).
--
-- ⚠️ التعبئة المبدئية تخمين لا حقيقة: التصنيف قد يغيب عن فرع لأنه نفد
--    لا لأنه لا يُباع فيه. لذلك كل (تصنيف × موقع) صفٌّ صريح — الغائب
--    carried=false — والشاشة تعرض تنبيهاً بمراجعتها.
--    المتوقّع على الإنتاج: 471 صفاً (157×3) — السراج carried=154 ·
--    11 يونيو 75 · جنزور 22.
--
-- 🔴 يُطبَّق بـ supabase db push — لا SQL من المتصفّح
-- ═════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.pos_location_category_rules (
  location_id uuid not null references public.pos_locations(id) on delete cascade,
  category text not null,
  carried boolean not null default true,
  min_qty int null,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (location_id, category)
);

create index if not exists pos_location_category_rules_category_idx
  on public.pos_location_category_rules(category);

-- ─────────────────────────────────────────────
-- التعبئة المبدئية: كل تصنيف موجود في المنتجات × كل موقع
-- carried = true فقط إن كان للموقع اليوم أي صنف من التصنيف بكمية > 0
-- (الغائب صراحةً carried=false — صفوف كاملة لا فجوات)
-- ─────────────────────────────────────────────
insert into public.pos_location_category_rules(location_id, category, carried, updated_at, updated_by)
select l.id,
       c.category,
       exists(
         select 1
         from public.pos_stock s
         join public.pos_products p on p.code = s.product_code
         where s.location_id = l.id
           and p.category = c.category
           and s.qty > 0
       ),
       now(),
       'migration-0050'
from (select distinct category
      from public.pos_products
      where category is not null and trim(category) <> '') c
cross join public.pos_locations l
on conflict (location_id, category) do nothing;

-- ─────────────────────────────────────────────
-- الصلاحيات: القراءة لكل المسجّلين، الكتابة للمدير فقط
-- (الشاشة: البقيّة يرون ولا يغيّرون)
-- ─────────────────────────────────────────────
alter table public.pos_location_category_rules enable row level security;

drop policy if exists pos_role_lcr_read on public.pos_location_category_rules;
create policy pos_role_lcr_read on public.pos_location_category_rules
  for select to authenticated using (true);

drop policy if exists pos_role_lcr_write on public.pos_location_category_rules;
create policy pos_role_lcr_write on public.pos_location_category_rules
  for all to authenticated
  using (public.pos_policy_role() = 'admin')
  with check (public.pos_policy_role() = 'admin');

revoke all on public.pos_location_category_rules from anon;
grant select, insert, update, delete on public.pos_location_category_rules to authenticated; /* صريح: في Supabase افتراضي وفي Postgres الخام لا — RLS هي الحارس */
grant all on public.pos_location_category_rules to service_role;

-- ─────────────────────────────────────────────
-- فحص داخلي: الصفوف = تصنيفات × مواقع (بلا فجوات) + تقرير العدّ
-- ─────────────────────────────────────────────
do $$
declare
  v_cats int; v_locs int; v_rows int; v_expected int; v_carried int;
begin
  select count(distinct category) into v_cats from public.pos_products
    where category is not null and trim(category) <> '';
  select count(*) into v_locs from public.pos_locations;
  select count(*) into v_rows from public.pos_location_category_rules;
  select count(*) into v_carried from public.pos_location_category_rules where carried;
  v_expected := v_cats * v_locs;
  if v_rows <> v_expected then
    raise exception 'LCR_ROWS_MISMATCH: المتوقّع % (تصنيفات×مواقع) والموجود % — يجب أن يكون كل زوج صفاً صريحاً', v_expected, v_rows;
  end if;
  raise notice 'LCR ✓ تصنيفات=% · مواقع=% · صفوف=% (carried=true: % / carried=false: %)', v_cats, v_locs, v_rows, v_carried, v_rows-v_carried;
end $$;

commit;

-- ═══════════════════════════════════════════
-- التحقق البصري بعد التطبيق (الإنتاج المتوقّع بين قوسين):
--
-- (١) إجمالي الصفوف:                    ⇒ 471
--   select count(*) from pos_location_category_rules;
--
-- (٢) carried=true لكل موقع:            ⇒ السراج 154 · 11 يونيو 75 · جنزور 22
--   select l.name, count(*) filter (where r.carried) as carried_true, count(*) as total
--   from pos_location_category_rules r join pos_locations l on l.id=r.location_id
--   group by l.name order by carried_true desc;
--
-- (٣) بائع لا يكتب والمدير يكتب (نفّذ بجلسة كل منهما):
--   update pos_location_category_rules set carried=false where location_id=(select id from pos_locations limit 1) and category=(select min(category) from pos_location_category_rules);
--   ⇒ البائع: RLS error · المدير: UPDATE 1
-- ═══════════════════════════════════════════
