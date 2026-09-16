-- ═══ 0017 — بنود سالبة داخل فاتورة البيع (sale_items فقط كما في الإنتاج)
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-negative-sale-items-setup.sql

-- Benamor POS - Allow negative sale item quantities for mixed sale/return invoices
-- Run once in Supabase SQL Editor after deploying the refund workflow.

begin;

-- Old constraint was: qty > 0
-- New behavior: sale lines can be positive (sale) or negative (return), but never zero.
alter table if exists public.pos_sale_items
  drop constraint if exists pos_sale_items_qty_check;

alter table if exists public.pos_sale_items
  add constraint pos_sale_items_qty_check
  check (qty <> 0);

comment on constraint pos_sale_items_qty_check on public.pos_sale_items
  is 'Allows positive sale quantities and negative return quantities inside the same POS invoice; zero is not allowed.';

commit;
