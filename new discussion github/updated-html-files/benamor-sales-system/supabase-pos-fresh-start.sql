-- ===================================================================
-- Benamor POS — إعادة ضبط كاملة للإنتاج (Fresh Start)
-- يمسح كل البيانات التجريبية ويحتفظ بالإعدادات
-- Run this in Supabase SQL Editor
-- ⚠️ لا يمكن التراجع — تأكد من وجود نسخة احتياطية أولاً
-- ===================================================================

begin;

-- ============================================================
-- المرحلة 1: مسح الفواتير والحركات (البيانات التجريبية)
-- ============================================================

-- مسح المرتجعات
delete from public.pos_sale_return_items;
delete from public.pos_sale_returns;

-- مسح فواتير البيع
delete from public.pos_sale_payments;
delete from public.pos_sale_items;
delete from public.pos_sales;

-- مسح الفواتير المبدئية
delete from public.pos_proforma_items;
delete from public.pos_proformas;

-- مسح فواتير الشراء
delete from public.pos_purchase_items;
delete from public.pos_purchases;

-- مسح التحويلات
delete from public.pos_stock_transfer_items;
delete from public.pos_stock_transfers;

-- مسح حركات المخزون
delete from public.pos_stock_movements;

-- مسح كشوف الحسابات
delete from public.pos_customer_ledger;
delete from public.pos_supplier_ledger;
delete from public.pos_supplier_payments;

-- مسح الحركات المالية والمصاريف
delete from public.pos_finance_movements;
delete from public.pos_expenses;
delete from public.pos_salary_payments;

-- مسح الإغلاقات اليومية
delete from public.pos_daily_cash_closings;

-- مسح سجل التدقيق
delete from public.pos_audit_log;

-- ============================================================
-- المرحلة 2: مسح المنتجات والزبائن والمخزون (لإعادة الاستيراد)
-- ============================================================

-- مسح مكوّنات المنتجات المركبة
delete from public.pos_composite_items;

-- مسح المخزون
delete from public.pos_stock;

-- مسح الزبائن
delete from public.pos_customers;

-- مسح المنتجات
delete from public.pos_products;

-- ============================================================
-- المرحلة 3: تصفير أرصدة الحسابات المالية (الخزائن والمصارف)
-- ============================================================

update public.pos_finance_accounts 
set opening_balance = 0;

-- ============================================================
-- ما يبقى كما هو (لا يُمسح):
-- ✅ pos_locations (الفروع والمخازن)
-- ✅ pos_suppliers (الموردون — أزل التعليق أدناه لمسحهم)
-- ✅ pos_user_roles (المستخدمون والصلاحيات)
-- ✅ pos_finance_accounts (تعريفات الخزائن — تم تصفير الأرصدة فقط)
-- ✅ pos_expense_categories (تصنيفات المصاريف)
-- ✅ pos_employees (الموظفون)
-- ============================================================

-- لإمساح الموردين أيضاً، أزل التعليق من السطر التالي:
-- delete from public.pos_suppliers;

commit;

-- ============================================================
-- التحقق بعد التشغيل
-- ============================================================

-- عدد الفواتير المتبقية (يجب أن يكون 0):
-- select count(*) from pos_sales;

-- عدد المنتجات المتبقية (يجب أن يكون 0):
-- select count(*) from pos_products;

-- عدد الزبائن المتبقين (يجب أن يكون 0):
-- select count(*) from pos_customers;

-- عدد الفروع (يجب أن يبقى كما هو):
-- select count(*) from pos_locations;
