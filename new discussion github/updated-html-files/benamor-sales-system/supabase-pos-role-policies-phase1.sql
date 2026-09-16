-- ═══════════════════════════════════════════════════════════════════
-- سياسات الأدوار — المرحلة 1 — benamor-sales-system
-- ═══════════════════════════════════════════════════════════════════
-- تعمل فوق ملف الإغلاق supabase-pos-rls-lockdown.sql (يجب تشغيله أولاً).
--
-- ماذا تفعل هذه المرحلة؟
--   تستبدل سياسة "كل مسجّل يرى ويعدّل كل شيء" (pos_auth_all) بسياسات
--   لكل دور على الجداول الحساسة:
--
--   • pos_salary_payments + pos_employees  → المدير فقط (قراءة وكتابة)
--   • pos_finance_accounts                 → قراءة للجميع، كتابة: مدير/محاسب
--   • pos_finance_movements                → قراءة: مدير/محاسب/بائعون/
--     بيع-شراء/viewer — إضافة: هؤلاء عدا viewer — تعديل/حذف: المدير
--   • pos_sales + بنودها ودفعاتها          → البائع يرى فواتير فرعه فقط،
--     والتعديل والحذف للمدير والبيع-والشراء فقط
--   • pos_audit_log                        → إضافة من النظام للجميع،
--     قراءة: مدير/محاسب، ولا تعديل ولا حذف لأحد إطلاقاً (سجل غير قابل للتلاعب)
--   • pos_stock + pos_stock_movements + pos_customer_ledger (كتابة مباشرة)
--     → المدير والبيع-والشراء فقط — حتى لا يفسد تعديلُ فاتورة مرفوضٌ
--       مخزونَها جزئياً (حماية من الفشل في منتصف العملية)
--
--   القراءة العامة (كل مسجّل) تبقى على: pos_stock, pos_stock_movements,
--   pos_customer_ledger — لا تتأثر أي شاشة.
--
-- ⚠️ البائع الذي يحاول تعديل فاتورة (من نسخة قديمة من التطبيق) سيفشل
--    فوراً وبنظافة عند أول خطوة (إرجاع المخزون) — لا فساد جزئي.
--
-- التراجع: أعد تشغيل القسم 2 من ملف supabase-pos-rls-lockdown.sql
-- (يعيد إنشاء pos_auth_all على كل الجداول = الوضع السابق).
--
-- شغّله في: Supabase ← SQL Editor ← دفعة واحدة من begin; حتى commit;
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────────
-- 0) الأساس: دوال الدور (STABLE = تُقيَّم مرة واحدة لكل استعلام)
-- ───────────────────────────────────────────────────────────────────

-- المعرّف من جلسة الدخول (موجودة أصلاً — إعادة تعريف ثابتة)
create or replace function public.pos_current_identifier()
returns text
language sql
stable
as $$
  select lower(split_part(coalesce(auth.jwt()->>'email',''),'@',1));
$$;

-- الدور الحالي (ترفع استثناء لو لا دور — تستعملها دوال RPC)
create or replace function public.pos_current_role()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_identifier text := public.pos_current_identifier();
  v_role text;
begin
  if v_identifier is null or v_identifier = '' then
    raise exception 'AUTH_REQUIRED';
  end if;
  select role into v_role
  from public.pos_user_roles
  where lower(identifier) = v_identifier and coalesce(active,true) = true
  limit 1;
  if v_role is null then
    raise exception 'ROLE_NOT_ASSIGNED: %', v_identifier;
  end if;
  return v_role;
end;
$$;

-- نسخة آمنة للسياسات: لا ترفع استثناء (بلا دور = NULL = ممنوع من كل شيء)
create or replace function public.pos_policy_role()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_identifier text := public.pos_current_identifier();
  v_role text;
begin
  if v_identifier is null or v_identifier = '' then return null; end if;
  select role into v_role
  from public.pos_user_roles
  where lower(identifier) = v_identifier and coalesce(active,true) = true
  limit 1;
  return v_role;
end;
$$;

-- فرع البائع الحالي (NULL لغير البائعين) — لنطاق فواتير فرعه
create or replace function public.pos_current_branch_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.pos_policy_role();
  v_id uuid;
begin
  if v_role = 'seller_11' then
    select id into v_id from public.pos_locations where name = 'فرع 11 يونيو' limit 1;
  elsif v_role = 'seller_sarraj' then
    select id into v_id from public.pos_locations where name = 'فرع السراج' limit 1;
  end if;
  return v_id;
end;
$$;

grant execute on function public.pos_current_identifier() to authenticated;
grant execute on function public.pos_current_role() to authenticated;
grant execute on function public.pos_policy_role() to authenticated;
grant execute on function public.pos_current_branch_id() to authenticated;

-- ───────────────────────────────────────────────────────────────────
-- 1) أسقط كل السياسات القديمة على جداول هذه المرحلة
--    (pos_auth_all + سياسات auth القديمة — تُستبدل بالسياسات أدناه)
-- ───────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'pos_salary_payments','pos_employees','pos_finance_accounts',
        'pos_finance_movements','pos_sales','pos_sale_items',
        'pos_sale_payments','pos_audit_log',
        'pos_stock','pos_stock_movements','pos_customer_ledger'
      )
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
    raise notice 'أُسقطت: % على %', r.policyname, r.tablename;
  end loop;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- 2) المرتبات والموظفون — المدير فقط
-- ───────────────────────────────────────────────────────────────────
create policy pos_role_salary_payments on public.pos_salary_payments
  for all to authenticated
  using (public.pos_policy_role() = 'admin')
  with check (public.pos_policy_role() = 'admin');

create policy pos_role_employees on public.pos_employees
  for all to authenticated
  using (public.pos_policy_role() = 'admin')
  with check (public.pos_policy_role() = 'admin');

-- ───────────────────────────────────────────────────────────────────
-- 3) حسابات الخزائن — قراءة للجميع المسجّلين، كتابة: مدير/محاسب
-- ───────────────────────────────────────────────────────────────────
create policy pos_role_finacc_read on public.pos_finance_accounts
  for select to authenticated using (true);

create policy pos_role_finacc_write on public.pos_finance_accounts
  for all to authenticated
  using (public.pos_policy_role() in ('admin','accountant'))
  with check (public.pos_policy_role() in ('admin','accountant'));

-- ───────────────────────────────────────────────────────────────────
-- 4) الحركات المالية
-- ───────────────────────────────────────────────────────────────────
create policy pos_role_finmv_read on public.pos_finance_movements
  for select to authenticated
  using (public.pos_policy_role() in ('admin','accountant','seller_11','seller_sarraj','sales_purchase','viewer'));

create policy pos_role_finmv_insert on public.pos_finance_movements
  for insert to authenticated
  with check (public.pos_policy_role() in ('admin','accountant','seller_11','seller_sarraj','sales_purchase'));

create policy pos_role_finmv_update on public.pos_finance_movements
  for update to authenticated
  using (public.pos_policy_role() = 'admin')
  with check (public.pos_policy_role() = 'admin');

create policy pos_role_finmv_delete on public.pos_finance_movements
  for delete to authenticated
  using (public.pos_policy_role() = 'admin');

-- ───────────────────────────────────────────────────────────────────
-- 5) فواتير البيع — البائع يرى فرعه فقط، والتعديل للمدير والبيع-والشراء
-- ───────────────────────────────────────────────────────────────────
create policy pos_role_sales_read on public.pos_sales
  for select to authenticated
  using (public.pos_policy_role() in ('admin','accountant','sales_purchase','viewer')
         or location_id = public.pos_current_branch_id());

create policy pos_role_sales_write on public.pos_sales
  for all to authenticated
  using (public.pos_policy_role() in ('admin','sales_purchase'))
  with check (public.pos_policy_role() in ('admin','sales_purchase'));

-- ───────────────────────────────────────────────────────────────────
-- 6) بنود ودفعات الفواتير — تتبع رؤية الفاتورة (فرع البائع عبر استعلام فرعي)
-- ───────────────────────────────────────────────────────────────────
create policy pos_role_items_read on public.pos_sale_items
  for select to authenticated
  using (public.pos_policy_role() in ('admin','accountant','sales_purchase','viewer')
         or exists (select 1 from public.pos_sales s
                    where s.id = pos_sale_items.sale_id
                      and s.location_id = public.pos_current_branch_id()));

create policy pos_role_items_write on public.pos_sale_items
  for all to authenticated
  using (public.pos_policy_role() in ('admin','sales_purchase'))
  with check (public.pos_policy_role() in ('admin','sales_purchase'));

create policy pos_role_payread on public.pos_sale_payments
  for select to authenticated
  using (public.pos_policy_role() in ('admin','accountant','sales_purchase','viewer')
         or exists (select 1 from public.pos_sales s
                    where s.id = pos_sale_payments.sale_id
                      and s.location_id = public.pos_current_branch_id()));

create policy pos_role_paywrite on public.pos_sale_payments
  for all to authenticated
  using (public.pos_policy_role() in ('admin','sales_purchase'))
  with check (public.pos_policy_role() in ('admin','sales_purchase'));

-- ───────────────────────────────────────────────────────────────────
-- 7) سجل التدقيق — إضافة من النظام للجميع، قراءة لمدير/محاسب،
--    ولا تعديل ولا حذف لأحد إطلاقاً (لا سياسات update/delete = ممنوع)
-- ───────────────────────────────────────────────────────────────────
create policy pos_role_audit_insert on public.pos_audit_log
  for insert to authenticated with check (true);

create policy pos_role_audit_read on public.pos_audit_log
  for select to authenticated
  using (public.pos_policy_role() in ('admin','accountant'));

-- ───────────────────────────────────────────────────────────────────
-- 8) حماية من الفساد الجزئي: الكتابة المباشرة على المخزون وحركاته
--    وقيود الزبائن = المدير والبيع-والشراء فقط
--    (القراءة تبقى لكل المسجّلين — كل الشاشات تعمل. البيع والجرد
--     والتحويل تمر عبر دوال RPC محصّنة ولا تتأثر)
-- ───────────────────────────────────────────────────────────────────
create policy pos_role_stock_read on public.pos_stock
  for select to authenticated using (true);

create policy pos_role_stock_write on public.pos_stock
  for all to authenticated
  using (public.pos_policy_role() in ('admin','sales_purchase'))
  with check (public.pos_policy_role() in ('admin','sales_purchase'));

create policy pos_role_stkmv_read on public.pos_stock_movements
  for select to authenticated using (true);

create policy pos_role_stkmv_write on public.pos_stock_movements
  for all to authenticated
  using (public.pos_policy_role() in ('admin','sales_purchase'))
  with check (public.pos_policy_role() in ('admin','sales_purchase'));

create policy pos_role_cledger_read on public.pos_customer_ledger
  for select to authenticated using (true);

create policy pos_role_cledger_insert on public.pos_customer_ledger
  for insert to authenticated
  with check (public.pos_policy_role() in ('admin','accountant','sales_purchase'));

create policy pos_role_cledger_delete on public.pos_customer_ledger
  for delete to authenticated
  using (public.pos_policy_role() in ('admin','sales_purchase'));

commit;


-- ═══════════════════════════════════════════════════════════════════
-- التحقّق — شغّله بعد التنفيذ
-- ═══════════════════════════════════════════════════════════════════

-- (أ) سياسات هذه الجداول — راجع القائمة
select tablename, policyname, cmd, roles
from pg_policies
where schemaname='public' and tablename in (
  'pos_salary_payments','pos_employees','pos_finance_accounts',
  'pos_finance_movements','pos_sales','pos_sale_items',
  'pos_sale_payments','pos_audit_log',
  'pos_stock','pos_stock_movements','pos_customer_ledger')
order by tablename, policyname;

-- (ب) يجب أن تكون النتيجة فارغة (لا سياسات عامة متبقية هنا)
select tablename, policyname from pg_policies
where schemaname='public' and policyname like 'pos_auth_all%'
  and tablename in (
    'pos_salary_payments','pos_employees','pos_finance_accounts',
    'pos_finance_movements','pos_sales','pos_sale_items',
    'pos_sale_payments','pos_audit_log',
    'pos_stock','pos_stock_movements','pos_customer_ledger');

-- (ج) الدوال الجديدة موجودة
select proname, prosecdef, provolatile
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and proname in ('pos_policy_role','pos_current_branch_id','pos_current_role');
-- المتوقع: pos_policy_role / pos_current_branch_id / pos_current_role = security definer + stable (s)


-- ═══════════════════════════════════════════════════════════════════
-- اختبارات القبول — من المتصفح (F12 ← Network خذ Authorization)
-- ═══════════════════════════════════════════════════════════════════
-- 1) بتوكن بائع (سجّل الدخول كبائع وانسخ التوكن):
--    • pos_salary_payments?select=* ⇒ []
--    • pos_sales?select=id,location_id&limit=20 ⇒ فواتير فرعه فقط
--    • PATCH على pos_sales أو pos_stock ⇒ خطأ صلاحيات (42501)
--    • pos_audit_log?select=* ⇒ []
-- 2) بتوكن مدير:
--    • pos_salary_payments?select=* ⇒ صفوف
--    • pos_sales?select=* ⇒ كل الفروع
--    • pos_audit_log?select=*&limit=5 ⇒ صفوف
-- 3) بتوكن محاسب:
--    • pos_sales?select=* ⇒ كل الفروع ✓
--    • pos_salary_payments?select=* ⇒ []
-- 4) دخول الدخان من التطبيق بكل الأدوار: البائع (بيع + جرد إقفال يومي
--    + مصروف + مرتجع)، المدير (كل شيء)، المحاسب (مالية + إقفال + تقارير)
