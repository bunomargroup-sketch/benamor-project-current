-- ⛔ ⚠️ هذا الملف مُلغى — لا تعد تشغيله بعد اليوم
-- تم تجاوزه بملف supabase-pos-rls-lockdown.sql (الإغلاق الشامل)
-- الذي يعيد بناء نفس سياسات القراءة للعارض ضمن إطار مغلق وآمن.
-- إعادة تشغيل هذا الملف بعد الإغلاق ستعيد فتح أبواب أُغلقت.

-- ===================================================================
-- Benamor POS — صلاحيات القراءة العامة لعارض الأسعار (Price Checker)
--
-- المشكلة: عارض الأسعار يقرأ pos_products و pos_stock و pos_locations
-- بالمفتاح العام (anon) — وبلا سياسات قراءة لهذا الدور تظهر النتائج فارغة
-- (قاعدة البيانات ترد [] بدل رسالة خطأ فيبدو أن الجداول فارغة وهي ليست فارغة).
--
-- هذا الملف ينشئ سياسات قراءة ONLY (بدون كتابة/تعديل/حذف):
--   - pos_products: أعمدة العرض فقط (بدون أسعار الشراء/الجملة/المورد)
--   - pos_stock: قراءة كاملة (كميات فقط)
--   - pos_locations: قراءة كاملة (أسماء الفروع)
--
-- ⚠️ شغّله في Supabase SQL Editor — لا يحتاج أي ترتيب مع ملفات أخرى
-- ===================================================================

begin;

-- ============================================================
-- 1) المنتجات — قراءة عامة للأعمدة الآمنة فقط
--    (لا يشمل: purchase_price / wholesale_price / supplier_id)
-- ============================================================
revoke select on public.pos_products from anon;
grant select (code, name, brand, model, color, category, description, barcode, retail_price, active)
  on public.pos_products to anon;

drop policy if exists "POS public select pos_products" on public.pos_products;
create policy "POS public select pos_products"
  on public.pos_products
  for select
  to anon
  using (true);

-- ============================================================
-- 2) المخزون — قراءة عامة (الكميات حسب الفرع)
-- ============================================================
drop policy if exists "POS public select pos_stock" on public.pos_stock;
create policy "POS public select pos_stock"
  on public.pos_stock
  for select
  to anon
  using (true);

-- ============================================================
-- 3) الفروع — قراءة عامة (الأسماء والأنواع)
-- ============================================================
drop policy if exists "POS public select pos_locations" on public.pos_locations;
create policy "POS public select pos_locations"
  on public.pos_locations
  for select
  to anon
  using (true);

commit;

-- ============================================================
-- التحقق بعد التشغيل — نفّذ كل استعلام:
--
-- 1) يجب أن يرجع 3 فروع:
--    select name from pos_locations order by name;
--
-- 2) يجب أن يرجع صفوفاً (وليس فارغاً):
--    select count(*) from pos_products;
--
-- 3) اختبار المتصفح: افتح الرابط التالي — يجب أن ترى منتجات JSON:
--    https://kkqbkumobeimwuscxztu.supabase.co/rest/v1/pos_products?select=code,name&limit=3&apikey=<المفتاح-العام>
--
-- ثم افتح عارض الأسعار وحدّث الصفحة — ستظهر المنتجات والكميات حسب الفرع.
-- ============================================================
