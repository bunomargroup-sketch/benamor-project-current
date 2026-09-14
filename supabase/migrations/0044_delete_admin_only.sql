-- ═══ 0044 — الحذف للمدير فقط (فصل DELETE)
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-delete-admin-only.sql
-- الترتيب داخل supabase/migrations هو ترتيب التنفيذ المعتمد لقاعدة فارغة

-- ═══════════════════════════════════════════════════════════════════
-- Benamor POS — الحذف النهائي للمدير فقط (DELETE admin-only)
-- يغلق ثغرة: دور «البيع والشراء» كان يستطيع DELETE مباشر عبر REST
-- على صف الفاتورة نفسه (pos_sales) وصفوف المخزون (pos_stock) —
-- متجاوزاً admin_delete_sale الذرّية (إرجاع المخزون + الفحوص).
--
-- ما الذي يتغير؟
--   • pos_sales:  INSERT/UPDATE كما هي تماماً (مدير، بيع-وشراء،
--                 بائع لفواتيره التي أنشأها) — DELETE: المدير فقط
--   • pos_stock:  INSERT/UPDATE كما هي تماماً (مدير، بيع-وشراء،
--                 مستودع، بائع في فرعه) — DELETE: المدير فقط
--   • لا يتأثر أي مسار في الواجهة:
--       - حذف الفاتورة من الواجهة يتم عبر RPC ‏admin_delete_sale
--         (security definer — لا تمر عبر RLS أصلاً)
--       - تعديل الفاتورة يفعل PATCH على pos_sales ولا يحذف صفّها أبداً
--       - شاشات الجرد/التحويل تفعل PATCH/POST على pos_stock ولا تحذف صفوفه
--       - مزامنة الطابور غير المتصل تمر عبر post_sale_transaction
--         (security definer — لا تتأثر)
--   • ما لم يُغيَّر عمداً (مسارات التعديل تحتاجها):
--       pos_sale_items / pos_sale_payments / pos_stock_movements /
--       pos_finance_movements / قيود الزبائن والموردين — حذفها متاح
--       لأصحاب التعديل كالسابق لأن تدفق «تعديل الفاتورة/الشراء/التحويل»
--       يحذف البنود ثم يعيد إدراجها.
--
-- الترتيب: شغّله بعد supabase-pos-role-policies-phase3.sql
--          (وفوق أي تشغيل سابق لـ seller-edit-own)
-- التراجع: القسم «استرجاع الحالة السابقة» آخر الملف.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────────
-- 1) فواتير البيع — فصل الحذف عن باقي العمليات
-- ───────────────────────────────────────────────────────────────────
drop policy if exists pos_role_sales_write on public.pos_sales;

create policy pos_role_sales_insert on public.pos_sales
  for insert to authenticated
  with check (
    public.pos_policy_role() in ('admin','sales_purchase')
    or (public.pos_policy_role() in ('seller_11','seller_sarraj')
        and created_by = public.pos_current_identifier())
  );

create policy pos_role_sales_update on public.pos_sales
  for update to authenticated
  using (
    public.pos_policy_role() in ('admin','sales_purchase')
    or (public.pos_policy_role() in ('seller_11','seller_sarraj')
        and created_by = public.pos_current_identifier())
  )
  with check (
    public.pos_policy_role() in ('admin','sales_purchase')
    or (public.pos_policy_role() in ('seller_11','seller_sarraj')
        and created_by = public.pos_current_identifier())
  );

-- الحذف النهائي: المدير فقط (والواجهة تستعمل admin_delete_sale الذرّية)
create policy pos_role_sales_delete on public.pos_sales
  for delete to authenticated
  using (public.pos_policy_role() = 'admin');

-- ───────────────────────────────────────────────────────────────────
-- 2) المخزون — فصل الحذف عن باقي العمليات
--    (الشاشات تعدّل الكميات بـ PATCH/POST ولا تحذف صفوف المخزون)
-- ───────────────────────────────────────────────────────────────────
drop policy if exists pos_role_stock_write on public.pos_stock;

create policy pos_role_stock_insert on public.pos_stock
  for insert to authenticated
  with check (
    public.pos_policy_role() in ('admin','sales_purchase','warehouse')
    or (public.pos_policy_role() in ('seller_11','seller_sarraj')
        and location_id = public.pos_current_branch_id())
  );

create policy pos_role_stock_update on public.pos_stock
  for update to authenticated
  using (
    public.pos_policy_role() in ('admin','sales_purchase','warehouse')
    or (public.pos_policy_role() in ('seller_11','seller_sarraj')
        and location_id = public.pos_current_branch_id())
  )
  with check (
    public.pos_policy_role() in ('admin','sales_purchase','warehouse')
    or (public.pos_policy_role() in ('seller_11','seller_sarraj')
        and location_id = public.pos_current_branch_id())
  );

-- حذف صف مخزون = إتلاف سجل كمية كامل: المدير فقط
create policy pos_role_stock_delete on public.pos_stock
  for delete to authenticated
  using (public.pos_policy_role() = 'admin');

commit;

-- ═══════════════════════════════════════════════════════════════════
-- التحقق بعد التشغيل — نفّذ في SQL Editor:
--
-- (١) سياسات pos_sales الجديدة (تظهر ٤: read + insert + update + delete):
--   select policyname, cmd from pg_policies
--   where schemaname='public' and tablename='pos_sales' order by policyname;
--
-- (٢) سياسات pos_stock الجديدة (تظهر ٤):
--   select policyname, cmd from pg_policies
--   where schemaname='public' and tablename='pos_stock' order by policyname;
--
-- (٣) DELETE محصور بالمدير في الجدولين:
--   select tablename, policyname, roles, cmd from pg_policies
--   where schemaname='public' and cmd='DELETE'
--     and tablename in ('pos_sales','pos_stock');
--   ⇒ يجب أن تكون using للمدير فقط في كليهما.
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
-- استرجاع الحالة السابقة (لو احتجت التراجع) — شغّل هذا القسم وحده:
-- ═══════════════════════════════════════════════════════════════════
-- begin;
-- drop policy if exists pos_role_sales_insert on public.pos_sales;
-- drop policy if exists pos_role_sales_update on public.pos_sales;
-- drop policy if exists pos_role_sales_delete on public.pos_sales;
-- create policy pos_role_sales_write on public.pos_sales
--   for all to authenticated
--   using (public.pos_policy_role() in ('admin','sales_purchase')
--          or (public.pos_policy_role() in ('seller_11','seller_sarraj')
--              and created_by = public.pos_current_identifier()))
--   with check (public.pos_policy_role() in ('admin','sales_purchase')
--          or (public.pos_policy_role() in ('seller_11','seller_sarraj')
--              and created_by = public.pos_current_identifier()));
-- drop policy if exists pos_role_stock_insert on public.pos_stock;
-- drop policy if exists pos_role_stock_update on public.pos_stock;
-- drop policy if exists pos_role_stock_delete on public.pos_stock;
-- create policy pos_role_stock_write on public.pos_stock
--   for all to authenticated
--   using (public.pos_policy_role() in ('admin','sales_purchase','warehouse')
--          or (public.pos_policy_role() in ('seller_11','seller_sarraj')
--              and location_id = public.pos_current_branch_id()))
--   with check (public.pos_policy_role() in ('admin','sales_purchase','warehouse')
--          or (public.pos_policy_role() in ('seller_11','seller_sarraj')
--              and location_id = public.pos_current_branch_id()));
-- commit;
