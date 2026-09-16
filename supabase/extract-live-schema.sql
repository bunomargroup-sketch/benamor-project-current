-- ═══════════════════════════════════════════════════════════════════
-- استخراج المخطّط الكامل (قراءة فقط — لا يعدّل شيئاً)
-- ═══════════════════════════════════════════════════════════════════
-- الاستخدام:
--   1) على قاعدة الإنتاج: شغّل هذا الملف في Supabase ← SQL Editor
--      ثم نزّل النتيجة CSV (زر Download) واحفظها باسم schema-live.csv
--   2) محلياً: node supabase/local-verify.js  (ينتج schema-local.json
--      بنفس الاستعلام تماماً)
--   3) قارن: node supabase/compare-schemas.js schema-live.csv supabase/schema-local.json
--
-- ماذا يستخرج (بترتيب ثابت للتفريع): الجداول بأعمدتها وقيودها وفهارسها
-- وحالة RLS، والـ views، والدوال بنصها الكامل، وسياسات RLS،
-- والـ triggers، والتسلسلات.
-- ⚠ كل تعبيرات العمود name تُحوَّل صراحةً إلى ::text — بدونها يرث العمود نوع
--   name من pg_catalog (63 بايت) فتُقتطع الأسماء الطويلة في UNION بصمت.
-- ماذا لا يستخرج عمداً: البيانات، والمنح (GRANTs) — تختلف بين البيئات
-- بحكم أدوار Supabase — والتعليقات.
-- ═══════════════════════════════════════════════════════════════════

with objs as (
  -- الجداول: أعمدة + قيود + فهارس (غير المدموجة بقيود) + حالة RLS
  select 'table' as kind, t.tablename::text as name,
    jsonb_build_object(
      'columns', coalesce((
        select string_agg(
          a.attname || ' ' || pg_catalog.format_type(a.atttypid, a.atttypmod)
          || case when a.attnotnull then ' not null' else '' end
          || case when ad.oid is not null then ' default ' || pg_get_expr(ad.adbin, ad.adrelid) else '' end,
          ', ' order by a.attnum)
        from pg_attribute a
        left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
        where a.attrelid = (('public.' || t.tablename)::regclass)
          and a.attnum > 0 and not a.attisdropped), ''),
      'constraints', coalesce((
        select string_agg(pg_get_constraintdef(c.oid), '; ' order by c.conname)
        from pg_constraint c
        where c.conrelid = (('public.' || t.tablename)::regclass)), ''),
      'indexes', coalesce((
        select string_agg(pg_get_indexdef(ix.indexrelid), '; ' order by ix.indexrelid::regclass::text)
        from pg_index ix
        where ix.indrelid = (('public.' || t.tablename)::regclass)
          and not exists (select 1 from pg_constraint c where c.conindid = ix.indexrelid)), ''),
      'rls', (select relrowsecurity from pg_class where oid = (('public.' || t.tablename)::regclass))
    )::text as definition
  from pg_tables t
  where t.schemaname = 'public'

  union all
  -- الـ views
  select 'view', c.relname::text, pg_get_viewdef(c.oid, true)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'

  union all
  -- الدوال بنصها الكامل (pg_get_functiondef يشمل security definer وsearch_path)
  select 'function',
    (p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')::text,
    pg_get_functiondef(p.oid)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'

  union all
  -- سياسات RLS
  select 'policy', (po.tablename || ' / ' || po.policyname)::text,
    'cmd=' || po.cmd || ' roles=' || array_to_string(po.roles, ',')
    || ' using=' || coalesce(po.qual, '') || ' with_check=' || coalesce(po.with_check, '')
  from pg_policies po
  where po.schemaname = 'public'

  union all
  -- الـ triggers
  select 'trigger', tg.tgname::text, pg_get_triggerdef(tg.oid, true)
  from pg_trigger tg
  join pg_class c on c.oid = tg.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not tg.tgisinternal

  union all
  -- التسلسلات (أسماء فقط — القيم تختلف بين البيئات بحكم البيانات)
  select 'sequence', c.relname::text, 'sequence'
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'S'
)
select kind, name, definition
from objs
order by kind, name;
