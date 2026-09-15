-- ═══════════════════════════════════════════════════════════════════════
--  فحص التركيب — شغّله في Supabase ← SQL Editor بعد تشغيل 0049…0052
--  استعلام واحد (بيان واحد) يفحص كل شيء. قراءة فقط، لا يغيّر شيئاً.
--  عمود «الحالة»:  ✅ مطابق   ·   🔴 راجع قبل أن تكمل   ·   ℹ️ للاطّلاع
--
--  🔧 نسخة v2 بعد المراجعة (تعديلان، الباقي حرفياً كما هو):
--   (١) الفحص ١١: اسم جدول 0052 الصحيح pos_suggestion_dismissals
--       (كان مكتوباً pos_transfer_dismissals — اسم غير موجود ⇒ الفحص كان
--        يرجع «لا شيء» و✅ دون أن يفحص الجدول أصلاً).
--   (٢) فحص جديد (رقم ١٣): anon لا ينفّذ دالة التسجيل pos_record_stock_request
--       — الدالة الوحيدة الجديدة القابلة للاستدعاء عبر PostgREST.
-- ═══════════════════════════════════════════════════════════════════════

with checks(ord, الفحص, المتوقع, الفعلي, حرج) as (

  -- ── 0049 · تنظيف الموردين ──────────────────────────────────────────
  select 1, '0049 · عدد الموردين', '90',
         (select count(*)::text from pos_suppliers), true
  union all
  select 2, '0049 · منتجات لها مورّد', '4445',
         (select count(*)::text from pos_products where supplier_id is not null), true
  union all
  select 3, '0049 · 🔴 منتجات بمورّد محذوف (يتيمة)', '0',
         (select count(*)::text from pos_products p
           where p.supplier_id is not null
             and not exists (select 1 from pos_suppliers s where s.id = p.supplier_id)), true
  union all
  select 4, '0049 · فهرس يمنع تكرار الأسماء', 'موجود',
         (select case when count(*) > 0 then 'موجود' else 'غير موجود' end
            from pg_indexes
           where schemaname = 'public' and tablename = 'pos_suppliers'
             and indexdef ilike '%unique%' and indexdef ilike '%name%'), true

  -- ── 0050 · قواعد الأقسام ───────────────────────────────────────────
  union all
  select 5, '0050 · مجموع صفوف قواعد الأقسام', '471',
         (select count(*)::text from pos_location_category_rules), true
  union all
  select 6, '0050 · لا موقع بلا صفوف (فجوات)', '0 فجوة',
         (select case when count(*) = 0 then '0 فجوة' else count(*)::text || ' فجوة' end
            from (select l.id
                    from pos_locations l
                    cross join (select distinct category from pos_products where category is not null) c
                   except
                  select location_id from pos_location_category_rules) g), true
  union all
  select 7, '0050 · أقسام محمولة لكل موقع (≈ 154 / 75 / 22)', 'تقريبي',
         coalesce((select string_agg(l.name || ': ' || x.n::text, '  |  ' order by x.n desc)
                     from (select location_id, count(*) n
                             from pos_location_category_rules
                            where carried group by location_id) x
                     join pos_locations l on l.id = x.location_id), '—'), false

  -- ── 0051 · طلبات المخزون ───────────────────────────────────────────
  union all
  select 8, '0051 · عمودا hit_count و last_requested_at', 'كلاهما موجود',
         (select case when count(*) = 2 then 'كلاهما موجود'
                      else 'ناقص — الموجود: ' || coalesce(string_agg(column_name, ', '), 'لا شيء') end
            from information_schema.columns
           where table_schema = 'public' and table_name = 'pos_stock_requests'
             and column_name in ('hit_count','last_requested_at')), true
  union all
  select 9, '0051 · حدّ اليوم بتوقيت طرابلس', 'Africa/Tripoli',
         coalesce((select case when pg_get_expr(d.adbin, d.adrelid) ilike '%Africa/Tripoli%'
                               then 'Africa/Tripoli' else pg_get_expr(d.adbin, d.adrelid) end
                     from pg_attrdef d
                     join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
                     join pg_class c on c.oid = d.adrelid
                    where c.relname = 'pos_stock_requests' and a.attname = 'request_date'),
                  'لا قيمة افتراضية'), true
  union all
  select 10, '0051 · فهرس فريد (منتج، فرع، يوم)', 'موجود',
         (select case when count(*) > 0 then 'موجود' else 'غير موجود' end
            from pg_indexes
           where schemaname = 'public' and tablename = 'pos_stock_requests'
             and indexdef ilike '%unique%'), true

  -- ── الأمان · هذا أهمّ فحص في القائمة ───────────────────────────────
  union all
  select 11, '🔴 صلاحيات anon على الجداول الجديدة', 'لا شيء',
         coalesce((select string_agg(distinct table_name || ' → ' || privilege_type, ' · ')
                     from information_schema.role_table_grants
                    where grantee = 'anon' and table_schema = 'public'
                      and table_name in ('pos_location_category_rules',
                                         'pos_stock_requests',
                                         'pos_suggestion_dismissals')), /* 🔧 v2: الاسم الصحيح لجدول 0052 */
                  'لا شيء'), true
  union all
  select 12, 'ℹ️ كل صلاحيات anon في القاعدة (راجعها بعينك)', 'المعروف فقط',
         coalesce((select string_agg(distinct table_name || '→' || privilege_type, ' · '
                                     order by table_name || '→' || privilege_type)
                     from information_schema.role_table_grants
                    where grantee = 'anon' and table_schema = 'public'), 'لا شيء'), false
  union all
  -- 🔧 فحص جديد في v2: الدالة الجديدة (0051) قابلة للاستدعاء عبر PostgREST
  -- بأي مفتاح anon — منحها لـ anon يعني سباماً مجهولاً في pos_stock_requests
  select 13, '🔴 anon يُنفّذ دالة التسجيل pos_record_stock_request؟', 'لا شيء',
         coalesce((select string_agg(distinct p.proname, ' · ')
                     from pg_proc p
                     join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public'
                      and p.proname in ('pos_record_stock_request')
                      and has_function_privilege('anon', p.oid, 'EXECUTE')),
                  'لا شيء'), true

  -- ── الدوال · تحقّق من دعوى STABLE ──────────────────────────────────
  union all
  select 14, 'دوال الصلاحيات STABLE؟', 'الثلاث STABLE',
         coalesce((select string_agg(p.proname || '=' ||
                        case p.provolatile when 's' then 'STABLE'
                                           when 'i' then 'IMMUTABLE'
                                           else 'VOLATILE' end, ' · ' order by p.proname)
                     from pg_proc p
                     join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public'
                      and p.proname in ('pos_current_identifier',
                                        'pos_policy_role',
                                        'pos_current_branch_id')), 'غير موجودة'), false

  -- ── خطّ الأساس للمهمة ٤ ────────────────────────────────────────────
  union all
  select 15, 'ℹ️ صفوف مخزون سالبة (خطّ الأساس: 222 صفاً / 215 منتجاً)', 'للاطّلاع',
         (select count(*)::text || ' صفاً · ' ||
                 count(distinct product_code)::text || ' منتجاً'
            from pos_stock where qty < 0), false
  union all
  select 16, 'ℹ️ طلبات مخزون مسجّلة حتى الآن', 'تبدأ من صفر',
         coalesce((select count(*)::text || ' طلباً · مفتوحة: ' ||
                          count(*) filter (where not resolved)::text
                     from pos_stock_requests), '0'), false
)
select الفحص,
       المتوقع,
       الفعلي,
       case when not حرج then 'ℹ️'
            when المتوقع = 'تقريبي' then 'ℹ️'
            when الفعلي = المتوقع then '✅'
            else '🔴 راجع' end as الحالة
  from checks
 order by ord;
