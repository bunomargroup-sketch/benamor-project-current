-- ═══ 0039 — إقفال anon (النسخة النهائية v4)
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-rls-lockdown.sql

-- ═══════════════════════════════════════════════════════════════════
-- إغلاق ثغرة RLS المفتوحة لـ anon — benamor-sales-system
-- النسخة النهائية — بعد ثلاث جولات مراجعة متبادلة
-- ═══════════════════════════════════════════════════════════════════
-- سجل المراجعات:
--   • ج1: النسخة 1 ظنت أن عارض الأسعار لا يتأثر (جداوله ليست pos_)
--     — خطأ: العارض يقرأ pos_products و pos_stock و pos_locations بدور anon.
--   • ج2: النسخة 2 منحت anon قراءة pos_products كاملاً والـ View
--     pos_product_stock_summary — وكلاهما يكشف purchase_price و
--     wholesale_price. أُصلح بمنح على مستوى الأعمدة وإغلاق كل الـ views.
--   • ج3: اكتُشف أن REVOKE ALL ON TABLE لا يسحب منح الأعمدة
--     (column-level grants) — فكان المسار «ب» في النسخة 3 سيترك
--     المنتجات مقروءة رغم حذف سطرَيها. أُضيفت الكتلة 3ب لسحبها صراحةً.
--   • ج4 (إصلاح التشغيل): استُبدل الجدول المؤقت _anon_read بقائمة
--     VALUES داخل الكتلة 4 نفسها — بعض أوضاع SQL Editor تنفّذ الأسطر
--     منفصلةً فيُسقط الجدول المؤقت (on commit drop) قبل استخدامه
--     ويظهر خطأ relation "_anon_read" does not exist. النسخة الحالية
--     محصّنة ضد ذلك وقابلة لإعادة التشغيل في أي وضع.
--
-- المشكلة الأصلية: supabase-pos-setup.sql (الأسطر 187–206) ينشئ سياسات
--   `for all to anon using (true)` على كل جداول pos_ — إن شُغِّلت.
--   مفتاح anon عام في app.js والمستودع عام.
--
-- ℹ️ المؤكَّد مقابل المستنتَج:
--    فحصٌ حيّ بالمفتاح العام أعاد [] من pos_products و pos_locations و
--    pos_suppliers و pos_user_roles و pos_finance_accounts و pos_customers
--    — أي أن كتلة السياسات تلك لم تُشغَّل على تلك الجداول على الأرجح.
--    لكن [] في SELECT لا تُثبت منع UPDATE (السياسات مستقلة لكل أمر)،
--    وجداول أخرى (pos_sales, pos_stock, pos_finance_movements) لم تُفحص.
--    ⇒ لقطة الخطوة 0 هي الحكم، واختبار PATCH آخر الملف يحسم الكتابة.
--    الإغلاق مطلوب في الحالتين.
--
-- ⚠️ هذا الملف يُلغي ملف supabase-pos-pricechecker-public-read.sql
--    (يعيد بناء سياساته بنفس الأعمدة لكن ضمن إطار مغلق). لا تُعد تشغيل
--    ذلك الملف بعد اليوم.
--
-- طريقة التشغيل:
--   1) شغّل استعلام الخطوة 0 وحده واحفظ نتيجته (لقطة «قبل»).
--   2) الصق الملف كاملاً من begin; حتى commit; دفعةً واحدة.
--   3) شغّل استعلامات التحقق ثم اختبارات curl في الأسفل.
-- ═══════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────
-- الخطوة 0: صوّر الحالة الحالية أولاً — شغّلها وحدها واحفظ النتيجة
-- ───────────────────────────────────────────────────────────────────
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename like 'pos_%'
order by tablename, policyname;


-- ═══════════════════════════════════════════════════════════════════
-- ⚙️ القرار الوحيد المطلوب منك — قبل التشغيل
-- ═══════════════════════════════════════════════════════════════════
-- القائمة أدناه = الجداول التي تبقى **مقروءة فقط** لـ anon.
-- الكتابة ممنوعة عليها في كل الأحوال.
--
--   المسار «أ» (الافتراضي — لا يحتاج تعديل العارض، شغّله الآن):
--     pos_locations   ← شاشة دخول POS
--     pos_products    ← عارض الأسعار
--     pos_stock       ← عارض الأسعار
--   المخاطرة: أسماء المنتجات وأسعار البيع والكميات تبقى مقروءة للعامة
--   (بدون أسعار الشراء أو الجملة — محجوبة على مستوى الأعمدة).
--
--   المسار «ب» (بعد تحديث العارض ليرسل Authorization: Bearer):
--     احذف سطرَي pos_products و pos_stock من القائمة وأعد التشغيل.
--     (الكتلة 3ب تضمن أن منح الأعمدة القديمة تُسحب فعلاً عند التبديل.)
--   ⚠️ قبل اختياره: جهاز العارض سيحمل توكن موظف في localStorage،
--      وهو توكن يفتح pos_sales و pos_finance_accounts و
--      pos_salary_payments كاملةً. لا تختره إن كان الجهاز في متناول
--      الزبائن أو الموظفين المؤقتين.
-- ═══════════════════════════════════════════════════════════════════

begin;
-- (القائمة البيضاء انتقلت إلى داخل الكتلة 4 — انظر التعليمات هناك)


-- ───────────────────────────────────────────────────────────────────
-- 1) احذف كل سياسة تمنح anon أي شيء على جداول pos_
-- ───────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename like 'pos_%'
      and 'anon' = any(roles)
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
    raise notice 'أُسقطت سياسة anon: % على %', r.policyname, r.tablename;
  end loop;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- 2) فعّل RLS وأنشئ سياسة للمستخدمين المسجَّلين فقط
-- ───────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename like 'pos_%'
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', 'pos_auth_all_' || t, t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      'pos_auth_all_' || t, t);
  end loop;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- 3) اسحب كل صلاحيات anon على مستوى الجدول (الـ GRANT طبقة مستقلة عن RLS)
-- ───────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename like 'pos_%'
  loop
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- 3ب) منح الأعمدة لا يمسّها REVOKE ALL ON TABLE — تُسحب صراحةً
--     (بدون هذه الكتلة يبقى المسار «ب» مكسوراً: منح الأعمدة القديمة
--      من ملف العارض السابق تَنجو وتُبقي المنتجات مقروءة للعامة)
-- ───────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select distinct table_name, column_name
    from information_schema.column_privileges
    where grantee = 'anon'
      and table_schema = 'public'
      and table_name like 'pos_%'
  loop
    execute format('revoke all (%I) on public.%I from anon', r.column_name, r.table_name);
  end loop;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- 4) أعِد **القراءة فقط** للجداول المذكورة في القائمة أعلاه
--    لا INSERT ولا UPDATE ولا DELETE — حتى لو كانت مفتوحة قبل اليوم
-- ───────────────────────────────────────────────────────────────────
do $$
declare
  r record;
  want text[];
  ok_cols text;
  missing text;
begin
  -- ⚙️ القائمة البيضاء: الجداول التي تبقى مقروءة فقط لـ anon.
  --    العمود الثاني = الأعمدة المسموح بها (NULL = كل الأعمدة).
  --    ⚠️ pos_products بأعمدة محددة: منح الجدول كاملاً يسرّب
  --       purchase_price و wholesale_price.
  --    المسار «ب» (بعد تحديث العارض ليرسل توكن الدخول): احذف سطرَي
  --    pos_products و pos_stock من القائمة ثم أعد تشغيل الملف.
  for r in
    select *
    from (values
      ('pos_locations', null::text),
      ('pos_products',  'code,name,brand,model,color,category,description,barcode,retail_price,active'),
      ('pos_stock',     null::text)
    ) as whitelist(tbl, cols)
  loop
    if not exists (select 1 from pg_tables where schemaname='public' and tablename=r.tbl) then
      raise notice '⚠️ الجدول % غير موجود — تخطّيته', r.tbl;
      continue;
    end if;

    -- السياسة لازمة حتى مع منح الأعمدة: الـ GRANT وحده لا يتجاوز RLS
    execute format('drop policy if exists %I on public.%I', 'pos_anon_read_' || r.tbl, r.tbl);
    execute format('create policy %I on public.%I for select to anon using (true)',
                   'pos_anon_read_' || r.tbl, r.tbl);

    if r.cols is null then
      execute format('grant select on public.%I to anon', r.tbl);
      raise notice '✔ قراءة كل الأعمدة على %', r.tbl;
    else
      want := string_to_array(replace(r.cols, ' ', ''), ',');

      -- امنح الأعمدة الموجودة فعلاً فقط — لا تفترض المخطّط
      select string_agg(quote_ident(c.column_name), ', ')
        into ok_cols
        from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = r.tbl
         and c.column_name = any(want);

      select string_agg(x, ', ')
        into missing
        from unnest(want) x
       where not exists (select 1 from information_schema.columns c
                          where c.table_schema='public' and c.table_name=r.tbl
                            and c.column_name = x);

      if ok_cols is null then
        raise exception 'لا يوجد أي عمود مطابق في % — راجع القائمة', r.tbl;
      end if;

      execute format('grant select (%s) on public.%I to anon', ok_cols, r.tbl);
      raise notice '✔ قراءة أعمدة محددة على %: %', r.tbl, ok_cols;
      if missing is not null then
        raise notice '  ⚠️ أعمدة مذكورة وغير موجودة (تُجوهلت): %', missing;
      end if;
    end if;
  end loop;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- 5) الـ Views — تتجاوز RLS للجداول تحتها ما لم يُضبط security_invoker
--    تُغلق كلها أمام anon بلا استثناء.
-- ───────────────────────────────────────────────────────────────────
do $$
declare v text;
begin
  for v in
    select viewname from pg_views
    where schemaname = 'public' and viewname like 'pos_%'
  loop
    begin
      execute format('alter view public.%I set (security_invoker = true)', v);
    exception when others then
      raise notice '⚠️ تعذّر ضبط security_invoker على %: %', v, sqlerrm;
    end;
    execute format('revoke all on public.%I from anon', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;
-- ⛔ لا استثناء لأي view. pos_product_stock_summary تحديداً تكشف
--    purchase_price، والعارض لا يستخدمها أصلاً (يقرأ pos_products
--    و pos_stock مباشرةً).

-- ───────────────────────────────────────────────────────────────────
-- 6) دوال RPC — الطبقة الأخطر
--    دالة SECURITY DEFINER مع EXECUTE لـ anon تعني أن أي شخص
--    ينشئ مستخدماً أو يحذف فاتورة دون تسجيل دخول.
-- ───────────────────────────────────────────────────────────────────
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        p.proname like 'pos_%'
        or p.proname in (
          'post_sale_transaction', 'post_sale_return_transaction',
          'post_purchase_transaction', 'post_stock_transfer_transaction',
          'admin_delete_sale', 'create_app_user',
          'update_app_user_credentials', 'upsert_pos_user_role',
          -- تُستدعيان بتوكن الموظف لا بدور anon (مؤكَّد من كود العارض)
          'save_pricechecker_cart', 'mark_pricechecker_cart_converted'
        )
      )
  loop
    execute format('revoke all on function %s from anon, public', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
    raise notice 'أُغلقت الدالة: %', f.proname;
  end loop;
end $$;

-- ⚠️ أي دالة أخرى مفتوحة لـ anon لم تُذكر أعلاه: افحصها قبل إغلاقها:
--      select proname, prosecdef from pg_proc p
--      join pg_namespace n on n.oid=p.pronamespace
--      where n.nspname='public' and has_function_privilege('anon', p.oid, 'execute');

commit;


-- ═══════════════════════════════════════════════════════════════════
-- التحقّق — شغّله بعد الإصلاح
-- ═══════════════════════════════════════════════════════════════════

-- (أ) سياسات anon المتبقية: SELECT فقط، وعلى جداول القائمة فقط
select tablename, policyname, cmd
from pg_policies
where schemaname='public' and tablename like 'pos_%' and 'anon' = any(roles)
order by tablename;

-- (ب) صلاحيات anon: يجب ألّا يظهر إلا SELECT
select table_name, privilege_type
from information_schema.role_table_grants
where grantee='anon' and table_schema='public' and table_name like 'pos_%'
order by table_name, privilege_type;

-- (ج) دوال ما زالت مفتوحة لـ anon — راجع كل اسم يظهر هنا
select p.proname, p.prosecdef as security_definer
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and has_function_privilege('anon', p.oid, 'execute')
  and (p.proname like 'pos_%' or p.proname like 'post_%' or p.proname like '%app_user%');

-- (ج2) الأعمدة المكشوفة لـ anon — يجب ألّا يظهر purchase_price أو wholesale_price
select table_name, string_agg(column_name, ', ' order by column_name) as anon_columns
from information_schema.column_privileges
where grantee='anon' and table_schema='public' and privilege_type='SELECT'
group by table_name
union all
select table_name, '(كل الأعمدة — منحة على مستوى الجدول)'
from information_schema.role_table_grants
where grantee='anon' and table_schema='public' and table_name like 'pos_%'
  and privilege_type='SELECT'
  and table_name not in (select table_name from information_schema.column_privileges
                         where grantee='anon' and table_schema='public')
order by 1;

-- (د) جداول pos_ بلا RLS: يجب أن تكون فارغة
select tablename from pg_tables t
where schemaname='public' and tablename like 'pos_%'
  and not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=t.tablename and c.relrowsecurity);


-- ═══════════════════════════════════════════════════════════════════
-- الاختبار الحقيقي — من سطر الأوامر بمفتاح anon
-- ═══════════════════════════════════════════════════════════════════
-- استبدل ANON_KEY بالمفتاح من app.js
--
-- يجب أن **يفشل** (‏[] أو 401):
--   curl -s ".../rest/v1/pos_sales?select=*&limit=1"            -H "apikey: ANON" -H "Authorization: Bearer ANON"
--   curl -s ".../rest/v1/pos_finance_accounts?select=*"         -H "apikey: ANON" -H "Authorization: Bearer ANON"
--   curl -s ".../rest/v1/pos_salary_payments?select=*"          -H "apikey: ANON" -H "Authorization: Bearer ANON"
--
-- يجب أن **ينجح** (المسار «أ»):
--   curl -s ".../rest/v1/pos_locations?select=id,name"          -H "apikey: ANON" -H "Authorization: Bearer ANON"
--   curl -s ".../rest/v1/pos_products?select=code,name,retail_price&limit=3" -H "apikey: ANON" -H "Authorization: Bearer ANON"
--
-- 🔴 يجب أن **يفشل** — هذا هو اختبار تسريب أسعار الشراء:
--   curl -s ".../rest/v1/pos_products?select=code,purchase_price&limit=1" -H "apikey: ANON" -H "Authorization: Bearer ANON"
--   curl -s ".../rest/v1/pos_products?select=*&limit=1"                   -H "apikey: ANON" -H "Authorization: Bearer ANON"
--   curl -s ".../rest/v1/pos_product_stock_summary?select=*&limit=1"      -H "apikey: ANON" -H "Authorization: Bearer ANON"
--
-- يجب أن **يفشل** حتى في المسار «أ» (الكتابة ممنوعة):
--   curl -s -X PATCH ".../rest/v1/pos_products?code=eq.XXX" -H "apikey: ANON" \
--        -H "Authorization: Bearer ANON" -H "Content-Type: application/json" -d '{"name":"اختراق"}'


-- ═══════════════════════════════════════════════════════════════════
-- التراجع الطارئ — ⛔ يعيد فتح قاعدتك للإنترنت. لا تتركه أكثر من دقائق.
-- ═══════════════════════════════════════════════════════════════════
-- do $$
-- declare t text;
-- begin
--   for t in select tablename from pg_tables where schemaname='public' and tablename like 'pos_%' loop
--     execute format('grant all on public.%I to anon', t);
--     execute format('create policy %I on public.%I for all to anon using (true) with check (true)',
--                    'tmp_rollback_' || t, t);
--   end loop;
-- end $$;


-- ═══════════════════════════════════════════════════════════════════
-- بعد التشغيل — خطوتان تاليتان (بالترتيب)
-- ═══════════════════════════════════════════════════════════════════
-- 1) تدقيق ماضٍ سريع: راجع pos_stock_movements و pos_finance_movements
--    و pos_products.updated_at للأسابيع الماضية بحثاً عن أي حركة لا تعرفها.
--    (pos_audit_log تغطيته جزئية — أُضيف حديثاً.)
-- 2) المرحلة التالية من التحصين: سياسات على مستوى الأدوار (role-aware RLS)
--    بدل using (true) للجميع — خاصة للجداول الحساسة (pos_salary_payments،
--    pos_finance_*، pos_sales، pos_customers) — لأن توكن الموظف على جهاز
--    الصالة يصبح بعدها أكبر خطر متبقٍّ.
