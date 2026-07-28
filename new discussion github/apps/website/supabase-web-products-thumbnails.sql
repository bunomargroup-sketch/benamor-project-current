-- Website products thumbnails support
-- Run once in Supabase SQL Editor.

begin;

alter table public.web_products
  add column if not exists thumbnail_paths text[];

-- Ensure public anon can read thumbnails, but not cost.
grant select (code, name, brand, model, category, main_category, price,
              description, image_paths, thumbnail_paths, active, featured,
              sort_order, created_at, updated_at)
  on public.web_products to anon;

grant select (code, name, brand, model, category, main_category, price,
              description, image_paths, thumbnail_paths, active, featured,
              sort_order, created_at, updated_at)
  on public.web_products to authenticated;

commit;
