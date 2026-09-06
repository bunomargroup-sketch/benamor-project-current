-- Benamor POS - المنتجات المركبة (Composite Products)
-- جدول مكوّنات المنتج المركب: يربط المنتج المركب بمكوّناته
-- Run BEFORE uploading the new HTML.

begin;

create table if not exists public.pos_composite_items (
  id uuid primary key default gen_random_uuid(),
  composite_code text not null,
  component_code text not null,
  component_name text,
  qty numeric not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists pos_composite_items_idx on public.pos_composite_items(composite_code);

alter table public.pos_composite_items enable row level security;
drop policy if exists "auth select pos_composite_items" on public.pos_composite_items;
drop policy if exists "auth insert pos_composite_items" on public.pos_composite_items;
drop policy if exists "auth delete pos_composite_items" on public.pos_composite_items;
create policy "auth select pos_composite_items" on public.pos_composite_items for select to authenticated using (true);
create policy "auth insert pos_composite_items" on public.pos_composite_items for insert to authenticated with check (true);
create policy "auth delete pos_composite_items" on public.pos_composite_items for delete to authenticated using (true);

commit;
