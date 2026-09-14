-- ═══ 0012 — فهرس المصاريف بالفرع
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-expenses-branch.sql
-- الترتيب داخل supabase/migrations هو ترتيب التنفيذ المعتمد لقاعدة فارغة

-- Benamor POS - Branch attribution for expenses
-- Run once in Supabase SQL Editor.

begin;

alter table if exists public.pos_expenses
  add column if not exists location_id uuid references public.pos_locations(id) on delete set null;

create index if not exists pos_expenses_location_date_idx
on public.pos_expenses(location_id, expense_date desc, created_at desc);

commit;
