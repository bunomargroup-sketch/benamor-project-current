-- ═══════════════════════════════════════════════════════════════════
-- سياسات الأدوار — المرحلة 3 (الأخيرة) — المنتجات والتشغيلية
-- ═══════════════════════════════════════════════════════════════════
-- يعمل فوق: rls-lockdown ثم phase1 ثم seller-edit-own ثم phase2
--
-- هذه المرحلة تكمل التغطية لكل جداول pos_ المتبقية:
--   • المنتجات: البائعون يعدّلون «الاسم وأسعار البيع/الجملة» فقط
--     (تفعيل عمودي عبر TRIGGER — لا يمكن تجاوزه حتى بالـ API)
--   • المخزون وحركاته: + المستودع (مسار تعديل المشتريات)
--     + البائعون يعدّلون حركات تحويلات فرعهم
--   • التحويلات وبنودها: البائع يرى ويعدّل تحويلات فرعه (طرفاً)
--   • المرتجعات وبنودها: البائع يرى مرتجعات فرعه
--   • المصاريف والإغلاقات اليومية: البائع في فرعه
--   • المكوّنات المركبة: قراءة للجميع، كتابة مدير/بيع-شراء/مخزن
--   • الفروع/الأدوار/تصنيفات المصاريف/العدادات/الاستيراد: مدير فقط
--
-- ⚠️ تعديلان تشغيليان عن المصفوفة (مسبّبان وموثّقان):
--   1) المصاريف والإغلاقات لبيع-والشراء: كل الفروع (وليس فرع
--      الدخول) — لأن دورهما شرعي في الفرعين معاً والفرع ليس في التوكن
--   2) قراءة المكوّنات المركبة لـ viewer — شاشة المنتجات تحتاجها
--      لعرض شارة «مركّب» والمخزون الافتراضي
--
-- التراجع: أعد تشغيل القسم 2 من rls-lockdown.
--
-- شغّله في: Supabase ← SQL Editor ← دفعة واحدة
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────────
-- 1) المنتجات + التفعيل العمودي للبائعين
-- ───────────────────────────────────────────────────────────────────
drop policy if exists pos_auth_all_pos_products on public.pos_products;
drop policy if exists "auth insert pos_products" on public.pos_products;
drop policy if exists "auth select pos_products" on public.pos_products;
drop policy if exists "auth update pos_products" on public.pos_products;

create policy pos_role_prod_read on public.pos_products
  for select to authenticated using (true);

create policy pos_role_prod_insert on public.pos_products
  for insert to authenticated
  with check (public.pos_policy_role() in ('admin','sales_purchase','warehouse'));

create policy pos_role_prod_update on public.pos_products
  for update to authenticated
  using (public.pos_policy_role() in ('admin','sales_purchase','warehouse','seller_11','seller_sarraj'))
  with check (public.pos_policy_role() in ('admin','sales_purchase','warehouse','seller_11','seller_sarraj'));

create policy pos_role_prod_delete on public.pos_products
  for delete to authenticated
  using (public.pos_policy_role() in ('admin','sales_purchase','warehouse'));

-- التفعيل العمودي: البائع يغيّر الاسم وسعر البيع وسعر الجملة فقط
-- (to_jsonb يقارن كل الأعمدة عدا المسموحة — محصّن ضد تغيّر المخطط)
create or replace function public.pos_products_seller_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_role text := public.pos_policy_role();
begin
  if v_role in ('seller_11','seller_sarraj') then
    if (to_jsonb(new) - 'name' - 'retail_price' - 'wholesale_price' - 'updated_at')
       is distinct from
       (to_jsonb(old) - 'name' - 'retail_price' - 'wholesale_price' - 'updated_at')
    then
      raise exception 'SELLER_PRODUCT_EDIT_LIMITED — البائع يعدّل الاسم والأسعار فقط';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists pos_products_seller_guard_trg on public.pos_products;
create trigger pos_products_seller_guard_trg
  before update on public.pos_products
  for each row execute function public.pos_products_seller_guard();

-- ───────────────────────────────────────────────────────────────────
-- 2) المخزون وحركاته (يوسّع نطاقات الملف السابق: + المستودع،
--    + حركات تحويلات فرع البائع)
-- ───────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname='public' and tablename in ('pos_stock','pos_stock_movements')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy pos_role_stock_read on public.pos_stock
  for select to authenticated using (true);

create policy pos_role_stock_write on public.pos_stock
  for all to authenticated
  using (public.pos_policy_role() in ('admin','sales_purchase','warehouse')
         or (public.pos_policy_role() in ('seller_11','seller_sarraj')
             and location_id = public.pos_current_branch_id()))
  with check (public.pos_policy_role() in ('admin','sales_purchase','warehouse')
         or (public.pos_policy_role() in ('seller_11','seller_sarraj')
             and location_id = public.pos_current_branch_id()));

create policy pos_role_stkmv_read on public.pos_stock_movements
  for select to authenticated using (true);

create policy pos_role_stkmv_write on public.pos_stock_movements
  for all to authenticated
  using (public.pos_policy_role() in ('admin','sales_purchase','warehouse')
         or (public.pos_policy_role() in ('seller_11','seller_sarraj')
             and ((reference_table = 'pos_sales'
                   and exists (select 1 from public.pos_sales s
                               where s.id = pos_stock_movements.reference_id
                                 and s.created_by = public.pos_current_identifier()))
                  or (reference_table = 'pos_stock_transfers'
                      and exists (select 1 from public.pos_stock_transfers t
                                  where t.id = pos_stock_movements.reference_id
                                    and (t.from_location_id = public.pos_current_branch_id()
                                         or t.to_location_id = public.pos_current_branch_id()))))))
  with check (public.pos_policy_role() in ('admin','sales_purchase','warehouse')
         or (public.pos_policy_role() in ('seller_11','seller_sarraj')
             and ((reference_table = 'pos_sales'
                   and exists (select 1 from public.pos_sales s
                               where s.id = pos_stock_movements.reference_id
                                 and s.created_by = public.pos_current_identifier()))
                  or (reference_table = 'pos_stock_transfers'
                      and exists (select 1 from public.pos_stock_transfers t
                                  where t.id = pos_stock_movements.reference_id
                                    and (t.from_location_id = public.pos_current_branch_id()
                                         or t.to_location_id = public.pos_current_branch_id()))))));

-- ───────────────────────────────────────────────────────────────────
-- 3) التحويلات وبنودها — البائع: تحويلات فرعه (أحد الطرفين)
-- ───────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname='public' and tablename in ('pos_stock_transfers','pos_stock_transfer_items')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy pos_role_tr_read on public.pos_stock_transfers
  for select to authenticated
  using (public.pos_policy_role() in ('admin','sales_purchase','warehouse')
         or (public.pos_policy_role() in ('seller_11','seller_sarraj')
             and (from_location_id = public.pos_current_branch_id()
                  or to_location_id = public.pos_current_branch_id())));

create policy pos_role_tr_write on public.pos_stock_transfers
  for all to authenticated
  using (public.pos_policy_role() in ('admin','sales_purchase','warehouse')
         or (public.pos_policy_role() in ('seller_11','seller_sarraj')
             and (from_location_id = public.pos_current_branch_id()
                  or to_location_id = public.pos_current_branch_id())))
  with check (public.pos_policy_role() in ('admin','sales_purchase','warehouse')
         or (public.pos_policy_role() in ('seller_11','seller_sarraj')
             and (from_location_id = public.pos_current_branch_id()
                  or to_location_id = public.pos_current_branch_id())));

create policy pos_role_tritems_read on public.pos_stock_transfer_items
  for select to authenticated
  using (public.pos_policy_role() in ('admin','sales_purchase','warehouse')
         or exists (select 1 from public.pos_stock_transfers t
                    where t.id = pos_stock_transfer_items.transfer_id
                      and (t.from_location_id = public.pos_current_branch_id()
                           or t.to_location_id = public.pos_current_branch_id())));

create policy pos_role_tritems_write on public.pos_stock_transfer_items
  for all to authenticated
  using (public.pos_policy_role() in ('admin','sales_purchase','warehouse')
         or exists (select 1 from public.pos_stock_transfers t
                    where t.id = pos_stock_transfer_items.transfer_id
                      and (t.from_location_id = public.pos_current_branch_id()
                           or t.to_location_id = public.pos_current_branch_id())))
  with check (public.pos_policy_role() in ('admin','sales_purchase','warehouse')
         or exists (select 1 from public.pos_stock_transfers t
                    where t.id = pos_stock_transfer_items.transfer_id
                      and (t.from_location_id = public.pos_current_branch_id()
                           or t.to_location_id = public.pos_current_branch_id())));

-- ───────────────────────────────────────────────────────────────────
-- 4) المرتجعات وبنودها — البائع: مرتجعات فرعه
-- ───────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname='public' and tablename in ('pos_sale_returns','pos_sale_return_items')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy pos_role_ret_read on public.pos_sale_returns
  for select to authenticated
  using (public.pos_policy_role() in ('admin','accountant','sales_purchase','viewer')
         or location_id = public.pos_current_branch_id());

create policy pos_role_ret_admin on public.pos_sale_returns
  for all to authenticated
  using (public.pos_policy_role() = 'admin')
  with check (public.pos_policy_role() = 'admin');

create policy pos_role_retitems_read on public.pos_sale_return_items
  for select to authenticated
  using (public.pos_policy_role() in ('admin','accountant','sales_purchase','viewer')
         or exists (select 1 from public.pos_sale_returns r
                    where r.id = pos_sale_return_items.return_id
                      and r.location_id = public.pos_current_branch_id()));

create policy pos_role_retitems_admin on public.pos_sale_return_items
  for all to authenticated
  using (public.pos_policy_role() = 'admin')
  with check (public.pos_policy_role() = 'admin');

-- ───────────────────────────────────────────────────────────────────
-- 5) المصاريف — البائع في فرعه (بيع-والشراء: كل الفروع — ملاحظة أعلاه)
-- ───────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname='public' and tablename = 'pos_expenses'
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy pos_role_exp_read on public.pos_expenses
  for select to authenticated
  using (public.pos_policy_role() in ('admin','accountant','sales_purchase','viewer')
         or (public.pos_policy_role() in ('seller_11','seller_sarraj')
             and location_id = public.pos_current_branch_id()));

create policy pos_role_exp_write on public.pos_expenses
  for all to authenticated
  using (public.pos_policy_role() in ('admin','accountant','sales_purchase')
         or (public.pos_policy_role() in ('seller_11','seller_sarraj')
             and location_id = public.pos_current_branch_id()))
  with check (public.pos_policy_role() in ('admin','accountant','sales_purchase')
         or (public.pos_policy_role() in ('seller_11','seller_sarraj')
             and location_id = public.pos_current_branch_id()));

-- ───────────────────────────────────────────────────────────────────
-- 6) الإغلاقات اليومية — البائع في فرعه
-- ───────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname='public' and tablename = 'pos_daily_cash_closings'
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy pos_role_dcc_read on public.pos_daily_cash_closings
  for select to authenticated
  using (public.pos_policy_role() in ('admin','accountant','sales_purchase')
         or branch_id = public.pos_current_branch_id());

create policy pos_role_dcc_write on public.pos_daily_cash_closings
  for all to authenticated
  using (public.pos_policy_role() in ('admin','accountant','sales_purchase')
         or branch_id = public.pos_current_branch_id())
  with check (public.pos_policy_role() in ('admin','accountant','sales_purchase')
         or branch_id = public.pos_current_branch_id());

-- ───────────────────────────────────────────────────────────────────
-- 7) المكوّنات المركبة — قراءة للجميع (شاشة المنتجات)، كتابة تشغيلية
-- ───────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname='public' and tablename = 'pos_composite_items'
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy pos_role_comp_read on public.pos_composite_items
  for select to authenticated using (true);

create policy pos_role_comp_write on public.pos_composite_items
  for all to authenticated
  using (public.pos_policy_role() in ('admin','sales_purchase','warehouse'))
  with check (public.pos_policy_role() in ('admin','sales_purchase','warehouse'));

-- ───────────────────────────────────────────────────────────────────
-- 8) الجداول الإدارية — المدير فقط (قراءتها للجميع حيث تلزم الشاشات)
-- ───────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname='public' and tablename in ('pos_locations','pos_user_roles',
        'pos_expense_categories','pos_number_counters','pos_import_staging')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- الفروع: قراءة للجميع (الأنون لديها سياستها الخاصة من الإغلاق)، كتابة مدير
create policy pos_role_loc_read on public.pos_locations
  for select to authenticated using (true);
create policy pos_role_loc_write on public.pos_locations
  for all to authenticated
  using (public.pos_policy_role() = 'admin')
  with check (public.pos_policy_role() = 'admin');

-- الأدوار: قراءة للجميع (حلّ الدور بعد الدخول)، كتابة مدير
create policy pos_role_ur_read on public.pos_user_roles
  for select to authenticated using (true);
create policy pos_role_ur_write on public.pos_user_roles
  for all to authenticated
  using (public.pos_policy_role() = 'admin')
  with check (public.pos_policy_role() = 'admin');

-- تصنيفات المصاريف: قراءة للجميع (القوائم المنسدلة)، كتابة مدير
create policy pos_role_ec_read on public.pos_expense_categories
  for select to authenticated using (true);
create policy pos_role_ec_write on public.pos_expense_categories
  for all to authenticated
  using (public.pos_policy_role() = 'admin')
  with check (public.pos_policy_role() = 'admin');

-- العدادات: مدير فقط (الترقيم التلقائي يمر عبر دوال RPC)
create policy pos_role_nc_admin on public.pos_number_counters
  for all to authenticated
  using (public.pos_policy_role() = 'admin')
  with check (public.pos_policy_role() = 'admin');

-- جدول الاستيراد المؤقت: مدير فقط
create policy pos_role_imp_admin on public.pos_import_staging
  for all to authenticated
  using (public.pos_policy_role() = 'admin')
  with check (public.pos_policy_role() = 'admin');

commit;


-- ═══════════════════════════════════════════════════════════════════
-- التحقّق النهائي — بعد هذه المرحلة لا يجوز وجود أي pos_auth_all
-- على أي جدول pos_ (التغطية اكتملت)
-- ═══════════════════════════════════════════════════════════════════

-- (أ) يجب أن تكون النتيجة فارغة
select tablename from pg_policies
where schemaname='public' and policyname like 'pos_auth_all%'
  and tablename like 'pos_%';

-- (ب) التريغر موجود
select tgname from pg_trigger
where tgrelid = 'public.pos_products'::regclass and tgname = 'pos_products_seller_guard_trg';

-- ═══════════════════════════════════════════════════════════════════
-- اختبارات القبول
-- ═══════════════════════════════════════════════════════════════════
-- 1) بائع يعدّل سعر منتج من شاشة المنتجات ⇒ ينجح
-- 2) بائع يحاول تغيير الكود/الماركة/سعر الشراء ⇒ رفض واضح
--    (فحص سلبي: PATCH بتوكن بائع على purchase_price ⇒ خطأ)
-- 3) بائع: تحويلات فرعه فقط (إنشاء/تعديل) ✓
-- 4) مخزن: تعديل فاتورة شراء (يشمل المخزون) ⇒ ينجح
-- 5) بائع: إقفال يومي فرعه + مصروف فرعه ⇒ ينجح
-- 6) viewer: شاشة المنتجات تعمل (بما فيها شارة مركّب)
-- 7) مدير: كل الشاشات تعمل كالمعتاد
