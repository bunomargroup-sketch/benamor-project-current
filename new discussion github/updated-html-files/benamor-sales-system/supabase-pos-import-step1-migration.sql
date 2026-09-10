-- Benamor POS — إضافة عمود النوع (description)
begin;
alter table public.pos_products add column if not exists description text;
commit;
