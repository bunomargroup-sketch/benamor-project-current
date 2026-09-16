-- ═══════════════════════════════════════════════════════════════════════
-- 0054 — تعبئة pos_sales.created_by للفواتير القديمة من سجل التدقيق
--
-- المشكلة المقيسة: 34 من 42 فاتورة فيها created_by = NULL، فقاعدة
-- «البائع يعدّل فواتيره فقط» تحجبها عن أصحابها لأن النظام لا يعرف منشئها.
-- القاعدة سليمة، والبيانات ناقصة.
--
-- قاعدة التعبئة (لا تخمين إطلاقاً):
--   • لكل فاتورة NULL: خذ مستخدمي سجل التدقيق المختلفين لسجلاتها
--     (entity_type='pos_sales' وentity_id=معرّف الفاتورة)
--   • مستخدم واحد مختلف بالضبط ⇒ عبّئ به
--   • لا سجل، أو أكثر من مستخدم مختلف ⇒ تبقى NULL كما أمر صاحب العمل
--   • لا استنتاج من الفرع ولا من التاريخ ولا من البائع
--
-- الحارس داخل المعاملة:
--   • التحديث لا يمسّ إلا الصفوف NULL أصلاً (شرط WHERE)
--   • تحقّق بعدي: عدد غير الخالية زاد بعدد المعبّأة حصراً، وعدد NULL
--     نقص بالمقدار نفسه — أي انحراف ⇒ استثناء ⇒ تراجع كل شيء
--
-- الملف بيان واحد (كتلة DO واحدة) — لا يقسّمه SQL Editor.
-- 🔴 يُطبَّق بـ supabase db push — لا SQL من المتصفّح
-- ═══════════════════════════════════════════════════════════════════════
-- شغّل هذا أولاً (قبل التشغيل — لقطة «كم ستُعبّأ وكم ستبقى NULL ولماذا»):
--
-- with cand as (
--   select a.entity_id,
--          count(distinct btrim(a.user_identifier)) as n_users
--   from pos_audit_log a
--   where a.entity_type='pos_sales'
--     and a.user_identifier is not null and btrim(a.user_identifier)<>''
--   group by a.entity_id
-- )
-- select
--   (select count(*) from pos_sales where created_by is null or btrim(created_by)='') as "NULL الآن",
--   (select count(*) from pos_sales s
--      where (s.created_by is null or btrim(s.created_by)='')
--        and (select coalesce(max(c.n_users),0) from cand c where c.entity_id=s.id::text)=1) as "ستُعبَّأ (مستخدم واحد في السجل)",
--   (select count(*) from pos_sales s
--      where (s.created_by is null or btrim(s.created_by)='')
--        and (select coalesce(max(c.n_users),0) from cand c where c.entity_id=s.id::text)<>1) as "تبقى NULL (لا سجل أو أكثر من مستخدم)",
--   (select count(*) from pos_sales where created_by is not null and btrim(created_by)<>'') as "معبّأة أصلاً (لن تُمسّ)";
-- ═══════════════════════════════════════════════════════════════════════

do $$
declare
  v_null_before int;
  v_nonnull_before int;
  v_filled int;
  v_null_after int;
  v_nonnull_after int;
begin
  select count(*) into v_null_before from public.pos_sales
   where created_by is null or btrim(created_by)='';
  select count(*) into v_nonnull_before from public.pos_sales
   where created_by is not null and btrim(created_by)<>'';

  update public.pos_sales s
  set created_by = c.uid
  from (
    select a.entity_id,
           count(distinct btrim(a.user_identifier)) as n_users,
           min(btrim(a.user_identifier)) as uid
    from public.pos_audit_log a
    where a.entity_type = 'pos_sales'
      and a.user_identifier is not null
      and btrim(a.user_identifier) <> ''
    group by a.entity_id
  ) c
  where c.entity_id = s.id::text
    and c.n_users = 1
    and (s.created_by is null or btrim(s.created_by) = '');
  get diagnostics v_filled = row_count;

  select count(*) into v_null_after from public.pos_sales
   where created_by is null or btrim(created_by)='';
  select count(*) into v_nonnull_after from public.pos_sales
   where created_by is not null and btrim(created_by)<>'';

  -- الحارس: لا فاتورة كان لها created_by فتغيّرت، ولا فاتورة عُبّئت خطأً
  if v_nonnull_after <> v_nonnull_before + v_filled then
    raise exception 'CREATED_BY_BACKFILL_CORRUPTED: غير الخالية كانت % وعُبّئت % فصارت % — لا يصح، تراجع كل شيء', v_nonnull_before, v_filled, v_nonnull_after;
  end if;
  if v_null_after <> v_null_before - v_filled then
    raise exception 'CREATED_BY_BACKFILL_COUNT_MISMATCH: NULL قبل % وبعد % وعُبّئت % — لا يتطابق، تراجع كل شيء', v_null_before, v_null_after, v_filled;
  end if;

  raise notice 'CREATED_BY_BACKFILL ✓ NULL: % ⇒ % (عُبّئت % من سجل التدقيق بمستخدم واحد موحّد) · غير الخالية: % (لم تُمسّ)', v_null_before, v_null_after, v_filled, v_nonnull_after;
end $$;
