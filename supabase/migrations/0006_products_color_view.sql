-- ═══ 0006 — عمود اللون + فهرسه + تحديث view الملخص
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-products-color-update.sql
-- الترتيب داخل supabase/migrations هو ترتيب التنفيذ المعتمد لقاعدة فارغة

-- Benamor Sales System - Product color support
-- FIXED VERSION
-- Run this once in Supabase SQL Editor.
-- Adds color to products and recreates the product stock summary view.

begin;

alter table public.pos_products
add column if not exists color text;

create index if not exists pos_products_color_idx on public.pos_products using btree (color);

-- Important:
-- We DROP the view first because PostgreSQL does not allow changing the column order
-- of an existing view with CREATE OR REPLACE VIEW.
drop view if exists public.pos_product_stock_summary;

create view public.pos_product_stock_summary as
select
  p.code,
  p.name,
  p.brand,
  p.model,
  p.color,
  p.category,
  p.purchase_price,
  p.retail_price,
  s.name as supplier_name,
  coalesce(sum(st.qty) filter (where l.name = 'فرع 11 يونيو'), 0) as stock_11_june,
  coalesce(sum(st.qty) filter (where l.name = 'فرع السراج'), 0) as stock_sarraj,
  coalesce(sum(st.qty) filter (where l.name = 'مخزن جنزور'), 0) as stock_janzour,
  coalesce(sum(st.qty), 0) as total_stock
from public.pos_products p
left join public.pos_suppliers s on s.id = p.supplier_id
left join public.pos_stock st on st.product_code = p.code
left join public.pos_locations l on l.id = st.location_id
group by p.code, p.name, p.brand, p.model, p.color, p.category, p.purchase_price, p.retail_price, s.name;

commit;
