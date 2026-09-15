-- ═══════════════════════════════════════════════════════════════════════
-- 0053 — إقفال anon النهائي (المهمة «ب» — تُطبَّق بعد نجاح المهمة «أ» حصراً)
--
-- 🔴 الشرط المسبق الملزم: نسخة العارض الموقَّعة (b20260915-1957 أو أحدث)
--    مثبَّتة على تابلت المحل، ودخولٌ ناجح، والكميات من كل فرع تظهر.
--    قبل ذلك لا تُطبَّق هذه — وإلا عَمِيَ العارض في المحل.
--
-- ما يُسحب من anon (كله):
--   app_users (بما فيها منحة عمود code_hash) · login_app_user ·
--   product_costs · staff_roles · carts · cart_items ·
--   next_pos_invoice_number · pos_stock · pos_locations ·
--   pos_products (منح الأعمدة + سياسة pos_anon_read_pos_products) ·
--   web_orders و web_order_items: كل شيء ما عدا INSERT ·
--   web_products: كل شيء ما عدا SELECT (منح الأعمدة تبقى)
--
-- ما يبقى لـanon — وهذا كل ما يبقى:
--   • web_products: SELECT + سياسة "public read active web products"
--   • web_orders و web_order_items: INSERT + سياستاهما
--   • دوال المشغّلات الثلاث (pos_policy_role · pos_current_branch_id ·
--     pos_current_identifier) لم تُمسّ إطلاقاً — ممنوع سحب EXECUTE منها
--     (وهي مغلقة أمام anon أصلاً منذ 0039، وبقيت كما هي)
--
-- بعد هذا لا يبقى لـanon أي وصول إلى أي جدول يبدأ بـ pos_ — الحارس
-- في نهاية الملف، داخل نفس المعاملة، يفشل صراحةً إن بقي شيء أو انكسر
-- شيء من المتبقّيات (طلب الموقع يجب أن يُحفظ ومنتجاته تُقرأ).
-- الملف كله بيان واحد (كتلة DO واحدة) لا يمكن لـSQL Editor تقسيمه —
-- آمن للتشغيل اليدوي ولـ supabase db push على السواء، وذرّي بالكامل.
-- 🔴 يُطبَّق بـ supabase db push — لا SQL من المتصفّح
-- ═══════════════════════════════════════════════════════════════════════

do $$
declare
  r record;
  t text;
begin
  -- ─── 1) جداول pos_: مسح شامل — السياسات ثم منح الجدول ثم منح الأعمدة ───
  -- (يشمل القائمة البيضاء من 0039: pos_locations · pos_products · pos_stock
  --  — هذا هو «المسار ب» الذي وثّقته 0039 نفسها)
  for r in
    select tablename, policyname
    from pg_policies
    where schemaname='public' and tablename like 'pos\_%' and 'anon'=any(roles)
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    raise notice 'أُسقطت سياسة anon: % على %', r.policyname, r.tablename;
  end loop;

  for t in
    select tablename from pg_tables
    where schemaname='public' and tablename like 'pos\_%'
  loop
    execute format('revoke all on public.%I from anon', t);
  end loop;

  for r in
    select distinct table_name, column_name
    from information_schema.column_privileges
    where grantee='anon' and table_schema='public' and table_name like 'pos\_%'
  loop
    execute format('revoke all (%I) on public.%I from anon', r.column_name, r.table_name);
    raise notice 'سُحبت منحة عمود anon: % على %', r.column_name, r.table_name;
  end loop;

  -- الـViews أيضاً — تتجاوز RLS للجداول تحتها
  for t in
    select viewname from pg_views
    where schemaname='public' and viewname like 'pos\_%'
  loop
    execute format('revoke all on public.%I from anon', t);
  end loop;

  -- ─── 2) جداول النموذج الأولي: app_users · product_costs · staff_roles · carts · cart_items ───
  -- (على الإنتاج هذه عليها منح anon الافتراضية من Supabase + منحة عمود
  --  code_hash على app_users — تُسحب جميعاً، جدولاً وأعمدة)
  for t in
    select unnest(array['app_users','product_costs','staff_roles','carts','cart_items'])
  loop
    if exists (select 1 from pg_tables where schemaname='public' and tablename=t) then
      execute format('revoke all on public.%I from anon', t);
      for r in
        select distinct column_name
        from information_schema.column_privileges
        where grantee='anon' and table_schema='public' and table_name=t
      loop
        execute format('revoke all (%I) on public.%I from anon', r.column_name, t);
        raise notice 'سُحبت منحة عمود anon: % على %', r.column_name, t;
      end loop;
      raise notice 'أُقفل % أمام anon', t;
    end if;
  end loop;

  -- ─── 3) الدالتان المفتوحتان: login_app_user و next_pos_invoice_number ───
  -- (لا العارض ولا المنظومة تستدعيان أيّاً منهما بمفتاح anon — مؤكَّد من الكود)
  revoke all on function public.login_app_user(text,text) from anon, public;
  revoke all on function public.next_pos_invoice_number() from anon, public;
  grant execute on function public.login_app_user(text,text) to authenticated;
  grant execute on function public.next_pos_invoice_number() to authenticated;

  -- ─── 4) طلبات الموقع: يبقى INSERT فقط (الموقع يحفظ الطلبات بمفتاح anon) ───
  revoke all on table public.web_orders from anon;
  revoke all on table public.web_order_items from anon;
  grant insert on table public.web_orders to anon;
  grant insert on table public.web_order_items to anon;

  -- ─── 5) منتجات الموقع: يبقى SELECT فقط، على أعمدة الكتالوج العام (بلا cost) ───
  -- (الموقع يقرأ 15 عموداً محددة — منح الجدول كاملاً يكشف cost للعامة.
  --  هذا يجعل المتبقّي حتمياً بدل الاعتماد على منح Supabase الافتراضية)
  revoke all on table public.web_products from anon;
  grant select (code,name,brand,model,category,main_category,price,description,image_paths,thumbnail_paths,active,featured,sort_order,created_at,updated_at) on public.web_products to anon;

  -- [GUARD-START] الحارس — داخل نفس المعاملة، وقسم مستقل يُنسخ وحده لفحص أي قاعدة لاحقاً
  declare
    v_grants int; v_cols int; v_pols int;
    v_wo_ins boolean; v_woi_ins boolean; v_wp_sel boolean;
    v_p1 boolean; v_p2 boolean; v_p3 boolean;
    v_fn1 boolean; v_fn2 boolean;
  begin
    select count(*) into v_grants from information_schema.role_table_grants
     where grantee='anon' and table_schema='public' and table_name like 'pos\_%';
    select count(*) into v_cols from information_schema.column_privileges
     where grantee='anon' and table_schema='public' and table_name like 'pos\_%';
    select count(*) into v_pols from pg_policies
     where schemaname='public' and tablename like 'pos\_%' and 'anon'=any(roles);
    if v_grants+v_cols+v_pols > 0 then
      raise exception 'ANON_STILL_ON_POS_TABLES: منح=% · منح أعمدة=% · سياسات=% — توقّف وراجع قبل الإكمال', v_grants, v_cols, v_pols;
    end if;

    select count(*)>0 into v_wo_ins from information_schema.role_table_grants
     where grantee='anon' and table_schema='public' and table_name='web_orders' and privilege_type='INSERT';
    select count(*)>0 into v_woi_ins from information_schema.role_table_grants
     where grantee='anon' and table_schema='public' and table_name='web_order_items' and privilege_type='INSERT';
    select count(*)>0 into v_wp_sel from information_schema.column_privileges
     where grantee='anon' and table_schema='public' and table_name='web_products' and privilege_type='SELECT';
    if exists(select 1 from information_schema.role_table_grants
               where grantee='anon' and table_schema='public' and table_name='web_products') then
      raise exception 'WEB_PRODUCTS_TABLE_GRANT_LEFT: يجب أن تكون قراءة الموقع عبر منح الأعمدة فقط (بلا cost)';
    end if;
    select exists(select 1 from pg_policies where schemaname='public' and tablename='web_orders' and policyname='public create web orders') into v_p1;
    select exists(select 1 from pg_policies where schemaname='public' and tablename='web_order_items' and policyname='public create web order items') into v_p2;
    select exists(select 1 from pg_policies where schemaname='public' and tablename='web_products' and policyname='public read active web products') into v_p3;
    if not (v_wo_ins and v_woi_ins and v_wp_sel and v_p1 and v_p2 and v_p3) then
      raise exception 'WEB_KEEPERS_BROKEN: المتبقّيات انكسرت (إدراج الطلبات=% · إدراج البنود=% · قراءة المنتجات=% · السياسات=%/%/%) — لا يصح الإكمال', v_wo_ins, v_woi_ins, v_wp_sel, v_p1, v_p2, v_p3;
    end if;

    v_fn1 := has_function_privilege('anon','public.login_app_user(text,text)','EXECUTE');
    v_fn2 := has_function_privilege('anon','public.next_pos_invoice_number()','EXECUTE');
    if v_fn1 or v_fn2 then
      raise exception 'RPC_STILL_OPEN_TO_ANON: login_app_user=% · next_pos_invoice_number=%', v_fn1, v_fn2;
    end if;

    raise notice 'الحارس ✓ anon بلا أي وصول إلى جداول pos_ (منح=% · أعمدة=% · سياسات=%) · إدراج طلبات الموقع محفوظ · قراءة منتجات الموقع محفوظة · الدالتان مقفلتان', v_grants, v_cols, v_pols;
  end;
  -- [GUARD-END]
end $$;

-- ═══════════════════════════════════════════════════════════════════
-- ناتج الحارس (قراءة فقط — شغّله بعد التطبيق لترى الحالة بعينك):
--   المتوقع: pos_ منح/أعمدة/سياسات = 0 · الدالتان = false ·
--            إدراج الطلبات وبنودها = 1 · قراءة منتجات الموقع = 1
-- ═══════════════════════════════════════════════════════════════════
select
  (select count(*) from information_schema.role_table_grants where grantee='anon' and table_schema='public' and table_name like 'pos\_%') as "منح anon على pos_",
  (select count(*) from information_schema.column_privileges where grantee='anon' and table_schema='public' and table_name like 'pos\_%') as "منح أعمدة anon",
  (select count(*) from pg_policies where schemaname='public' and tablename like 'pos\_%' and 'anon'=any(roles)) as "سياسات anon",
  has_function_privilege('anon','public.login_app_user(text,text)','EXECUTE') as "login_app_user مفتوحة",
  has_function_privilege('anon','public.next_pos_invoice_number()','EXECUTE') as "next_invoice مفتوحة",
  (select count(*) from information_schema.role_table_grants where grantee='anon' and table_schema='public' and table_name='web_orders' and privilege_type='INSERT') as "إدراج الطلبات",
  (select count(*) from information_schema.role_table_grants where grantee='anon' and table_schema='public' and table_name='web_order_items' and privilege_type='INSERT') as "إدراج بنود الطلبات",
  (select count(*) from information_schema.column_privileges where grantee='anon' and table_schema='public' and table_name='web_products' and privilege_type='SELECT') as "أعمدة كتالوج الموقع",
  (select count(*) from information_schema.role_table_grants where grantee='anon' and table_schema='public' and table_name='web_products') as "منح جدول web_products (المتوقع 0)";
