-- Security lockdown round 2
-- Hides web_products.cost from anon and prevents POS role self-promotion.

begin;

-- hide cost column from public API
revoke select on table public.web_products from anon;
grant select (code, name, brand, model, category, main_category, price,
              description, image_paths, active, featured, sort_order,
              created_at, updated_at)
  on public.web_products to anon;

-- stop staff self-promotion
-- Keep SELECT policy only; remove write policies.
drop policy if exists "auth insert pos_user_roles" on public.pos_user_roles;
drop policy if exists "auth update pos_user_roles" on public.pos_user_roles;
drop policy if exists "auth delete pos_user_roles" on public.pos_user_roles;

commit;

-- Verification
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname='public' and tablename in ('web_products','pos_user_roles')
order by schemaname, tablename, policyname;
