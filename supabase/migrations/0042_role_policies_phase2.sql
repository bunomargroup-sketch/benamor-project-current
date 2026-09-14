-- ═══ 0042 — سياسات الأدوار ٢
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-role-policies-phase2.sql

-- ═══════════════════════════════════════════════════════════════════
-- سياسات الأدوار — المرحلة 2 — الزبائن والموردون والمشتريات والمبدئيات
-- ═══════════════════════════════════════════════════════════════════
-- يعمل فوق: rls-lockdown ثم role-policies-phase1 ثم seller-edit-own
--
-- الجداول المغطاة هنا:
--   pos_customers, pos_customer_ledger,
--   pos_suppliers, pos_supplier_ledger, pos_supplier_payments,
--   pos_purchases, pos_purchase_items,
--   pos_proformas, pos_proforma_items
--
-- القواعد (حسب المصفوفة المعتمدة):
--   • الزبائن: قراءة+إضافة للبائعين (شاشة البيع) — التعديل الكامل
--     للمدير/المحاسب/البيع-والشراء — الحذف للمدير فقط
--   • دفتر الزبون: قراءة للأدوار المالية والبائعين، والإضافة تشمل
--     تسوية عجز الصندوق من البائعين (بدون مرجع فاتورة)
--   • الموردون ودفترهم ودفعاتهم: المدير/المحاسب/البيع-والشراء،
--     والمستودع يقرأ الموردين ويكتب الدفتر (مسار تعديل المشتريات)
--   • المشتريات وبنودها: مدير/بيع-شراء/مخزن (كتابة)، محاسب/viewer (قراءة)
--   • المبدئيات: البائعون + البيع-والشراء + المدير
--
-- ⚠️ تأثير جانبي معتمد من المصفوفة: عمود «المورد» في شاشة المنتجات
--    سيظهر فارغاً للبائعين (لا يقرؤون جدول الموردين). إن أردت إظهار
--    أسماء الموردين للبائعين أخبرني — استثناء صغير بملف لاحق.
--
-- التراجع: أعد تشغيل القسم 2 من rls-lockdown (يعيد pos_auth_all).
--
-- شغّله في: Supabase ← SQL Editor ← دفعة واحدة
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────────
-- 1) أسقط كل السياسات القديمة على جداول هذه المرحلة
-- ───────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('pos_customers','pos_customer_ledger',
                        'pos_suppliers','pos_supplier_ledger','pos_supplier_payments',
                        'pos_purchases','pos_purchase_items',
                        'pos_proformas','pos_proforma_items')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
    raise notice 'أُسقطت: % على %', r.policyname, r.tablename;
  end loop;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- 2) الزبائن
-- ───────────────────────────────────────────────────────────────────
create policy pos_role_cust_read on public.pos_customers
  for select to authenticated
  using (public.pos_policy_role() in ('admin','accountant','seller_11','seller_sarraj','sales_purchase'));

create policy pos_role_cust_insert on public.pos_customers
  for insert to authenticated
  with check (public.pos_policy_role() in ('admin','accountant','seller_11','seller_sarraj','sales_purchase'));

create policy pos_role_cust_update on public.pos_customers
  for update to authenticated
  using (public.pos_policy_role() in ('admin','accountant','sales_purchase'))
  with check (public.pos_policy_role() in ('admin','accountant','sales_purchase'));

create policy pos_role_cust_delete on public.pos_customers
  for delete to authenticated
  using (public.pos_policy_role() = 'admin');

-- ───────────────────────────────────────────────────────────────────
-- 3) دفتر الزبون (يحافظ على نطاقات تعديل الفواتير من الملف السابق)
--    + استثناء: تسوية عجز الصندوق (entry_type='adjustment' بدون مرجع)
-- ───────────────────────────────────────────────────────────────────
create policy pos_role_cledger_read on public.pos_customer_ledger
  for select to authenticated
  using (public.pos_policy_role() in ('admin','accountant','seller_11','seller_sarraj','sales_purchase'));

create policy pos_role_cledger_insert on public.pos_customer_ledger
  for insert to authenticated
  with check (public.pos_policy_role() in ('admin','accountant','sales_purchase')
              or (public.pos_policy_role() in ('seller_11','seller_sarraj')
                  and ((reference_table = 'pos_sales'
                        and exists (select 1 from public.pos_sales s
                                    where s.id = pos_customer_ledger.reference_id
                                      and s.created_by = public.pos_current_identifier()))
                       or (entry_type = 'adjustment' and reference_table is null))));

create policy pos_role_cledger_delete on public.pos_customer_ledger
  for delete to authenticated
  using (public.pos_policy_role() in ('admin','sales_purchase')
         or (public.pos_policy_role() in ('seller_11','seller_sarraj')
             and reference_table = 'pos_sales'
             and exists (select 1 from public.pos_sales s
                         where s.id = pos_customer_ledger.reference_id
                           and s.created_by = public.pos_current_identifier())));

-- ───────────────────────────────────────────────────────────────────
-- 4) الموردون
-- ───────────────────────────────────────────────────────────────────
create policy pos_role_supp_read on public.pos_suppliers
  for select to authenticated
  using (public.pos_policy_role() in ('admin','accountant','sales_purchase','warehouse'));

create policy pos_role_supp_write on public.pos_suppliers
  for all to authenticated
  using (public.pos_policy_role() in ('admin','accountant','sales_purchase'))
  with check (public.pos_policy_role() in ('admin','accountant','sales_purchase'));

-- ───────────────────────────────────────────────────────────────────
-- 5) دفتر المورد (المستودع يكتب فيه عند تعديل فواتير الشراء)
-- ───────────────────────────────────────────────────────────────────
create policy pos_role_sledger_read on public.pos_supplier_ledger
  for select to authenticated
  using (public.pos_policy_role() in ('admin','accountant','sales_purchase'));

create policy pos_role_sledger_insert on public.pos_supplier_ledger
  for insert to authenticated
  with check (public.pos_policy_role() in ('admin','accountant','sales_purchase','warehouse'));

create policy pos_role_sledger_delete on public.pos_supplier_ledger
  for delete to authenticated
  using (public.pos_policy_role() in ('admin','sales_purchase','warehouse'));

-- ───────────────────────────────────────────────────────────────────
-- 6) دفعات الموردين
-- ───────────────────────────────────────────────────────────────────
create policy pos_role_spay_read on public.pos_supplier_payments
  for select to authenticated
  using (public.pos_policy_role() in ('admin','accountant','sales_purchase'));

create policy pos_role_spay_insert on public.pos_supplier_payments
  for insert to authenticated
  with check (public.pos_policy_role() in ('admin','accountant','sales_purchase'));

create policy pos_role_spay_admin on public.pos_supplier_payments
  for update to authenticated
  using (public.pos_policy_role() = 'admin')
  with check (public.pos_policy_role() = 'admin');

-- ───────────────────────────────────────────────────────────────────
-- 7) المشتريات وبنودها
-- ───────────────────────────────────────────────────────────────────
create policy pos_role_purch_read on public.pos_purchases
  for select to authenticated
  using (public.pos_policy_role() in ('admin','accountant','sales_purchase','warehouse','viewer'));

create policy pos_role_purch_write on public.pos_purchases
  for all to authenticated
  using (public.pos_policy_role() in ('admin','sales_purchase','warehouse'))
  with check (public.pos_policy_role() in ('admin','sales_purchase','warehouse'));

create policy pos_role_pitems_read on public.pos_purchase_items
  for select to authenticated
  using (public.pos_policy_role() in ('admin','accountant','sales_purchase','warehouse','viewer'));

create policy pos_role_pitems_write on public.pos_purchase_items
  for all to authenticated
  using (public.pos_policy_role() in ('admin','sales_purchase','warehouse'))
  with check (public.pos_policy_role() in ('admin','sales_purchase','warehouse'));

-- ───────────────────────────────────────────────────────────────────
-- 8) الفواتير المبدئية وبنودا
-- ───────────────────────────────────────────────────────────────────
create policy pos_role_prof_read on public.pos_proformas
  for select to authenticated
  using (public.pos_policy_role() in ('admin','seller_11','seller_sarraj','sales_purchase'));

create policy pos_role_prof_write on public.pos_proformas
  for all to authenticated
  using (public.pos_policy_role() in ('admin','seller_11','seller_sarraj','sales_purchase'))
  with check (public.pos_policy_role() in ('admin','seller_11','seller_sarraj','sales_purchase'));

create policy pos_role_profitems_read on public.pos_proforma_items
  for select to authenticated
  using (public.pos_policy_role() in ('admin','seller_11','seller_sarraj','sales_purchase'));

create policy pos_role_profitems_write on public.pos_proforma_items
  for all to authenticated
  using (public.pos_policy_role() in ('admin','seller_11','seller_sarraj','sales_purchase'))
  with check (public.pos_policy_role() in ('admin','seller_11','seller_sarraj','sales_purchase'));

commit;


-- ═══════════════════════════════════════════════════════════════════
-- التحقّق — شغّله بعد التنفيذ
-- ═══════════════════════════════════════════════════════════════════

-- (أ) سياسات هذه المرحلة
select tablename, policyname, cmd from pg_policies
where schemaname='public' and tablename in (
  'pos_customers','pos_customer_ledger','pos_suppliers','pos_supplier_ledger',
  'pos_supplier_payments','pos_purchases','pos_purchase_items',
  'pos_proformas','pos_proforma_items')
order by tablename, policyname;

-- (ب) لا سياسات عامة متبقية على هذه الجداول
select tablename, policyname from pg_policies
where schemaname='public' and policyname like 'pos_auth_all%'
  and tablename in ('pos_customers','pos_customer_ledger','pos_suppliers',
                    'pos_supplier_ledger','pos_supplier_payments',
                    'pos_purchases','pos_purchase_items','pos_proformas','pos_proforma_items');

-- ═══════════════════════════════════════════════════════════════════
-- اختبارات القبول
-- ═══════════════════════════════════════════════════════════════════
-- 1) بائع: شاشة البيع — اختيار زبون موجود + إنشاء زبون جديد ⇒ يعمل
-- 2) بائع: شاشة المنتجات — عمود المورد فارغ (مؤقت — متوقع)
-- 3) بائع: المبدئيات — إنشاء/تعديل/تحويل ⇒ يعمل
-- 4) بائع: إقفال يومي بعجز وتسويته ⇒ يعمل (قيود التعديل مسموحة)
-- 5) محاسب: الزبائن + الموردون + الدفعات + كشوف الحسابات ⇒ تعمل
-- 6) مخزن: المشتريات (إنشاء/تعديل) + التحويلات ⇒ تعمل
-- 7) viewer: التقارير تعمل (المشتريات مرئية، الزبائن بدون أسماء في
--    تقرير ربحية الزبائن — مقبول لدور مشاهدة فقط)
-- 8) فحص سلبي بتوكن بائع: pos_suppliers?select=* ⇒ []
