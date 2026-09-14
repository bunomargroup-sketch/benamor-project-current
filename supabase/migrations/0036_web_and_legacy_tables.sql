-- ═══ 0036 — جداول الموقع + بقايا النظام القديم (تعريفات حرفية من قاعدة الإنتاج)
-- استُخرجت بـ extract-live-schema.sql وأُعيد بناؤها هنا حرفياً لتكتمل مطابقة
-- السلسلة للحي. هذه الجداول كانت موجودة في الإنتاج فقط (بلا ملفات في المستودع):
--   • app_users + login_app_user: نظام دخول النموذج الأولي (قبل اعتماد auth.users)
--     — لا يستعمله أي كود حالياً؛ يبقى لأن carts.app_user_id يشير إليه بـ FK
--   • product_costs: تكاليف المنتجات (قراءة للمسجلين)
--   • staff_roles: أدوار الموظفين القديمة (user_id→auth.users)
--   • web_products / web_orders / web_order_items: كتالوج وطلبات الموقع العام
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ───────────── app_users (نظام الدخول القديم) ─────────────
create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  identifier text not null unique,
  code_hash text not null,
  created_at timestamptz default now()
);
alter table public.app_users enable row level security;

CREATE OR REPLACE FUNCTION public.login_app_user(p_identifier text, p_code text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $$
declare
  found_user_id uuid;
begin
  select id
  into found_user_id
  from app_users
  where identifier = lower(trim(p_identifier))
  and code_hash = crypt(trim(p_code), code_hash);

  if found_user_id is null then
    raise exception 'Wrong identifier or code';
  end if;

  return found_user_id;
end;
$$;


-- ───────────── product_costs ─────────────
create table if not exists public.product_costs (
  code text primary key,
  cost numeric not null
);
alter table public.product_costs enable row level security;

drop policy if exists "authenticated can read product costs" on public.product_costs;
create policy "authenticated can read product costs" on public.product_costs
  for select to authenticated using (true);

-- ───────────── staff_roles ─────────────
create table if not exists public.staff_roles (
  user_id uuid not null primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','seller'))
);
alter table public.staff_roles enable row level security;

drop policy if exists "staff can read own role" on public.staff_roles;
create policy "staff can read own role" on public.staff_roles
  for select to authenticated using (user_id = auth.uid());

-- ───────────── web_products (كتالوج الموقع) ─────────────
create table if not exists public.web_products (
  code text primary key,
  name text,
  brand text,
  model text,
  category text,
  price numeric default 0,
  description text,
  image_paths jsonb default '[]'::jsonb,
  active boolean default true,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  main_category text,
  featured boolean default false,
  cost numeric default 0,
  thumbnail_paths text[]
);
alter table public.web_products enable row level security;

drop policy if exists "public read active web products" on public.web_products;
create policy "public read active web products" on public.web_products
  for select to anon, authenticated using (coalesce(active, true) = true);
drop policy if exists "staff insert web products" on public.web_products;
create policy "staff insert web products" on public.web_products
  for insert to authenticated with check (true);
drop policy if exists "staff update web products" on public.web_products;
create policy "staff update web products" on public.web_products
  for update to authenticated using (true) with check (true);
drop policy if exists "staff delete web products" on public.web_products;
create policy "staff delete web products" on public.web_products
  for delete to authenticated using (true);

-- ───────────── web_orders (طلبات الموقع) ─────────────
create table if not exists public.web_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique,
  customer_name text not null,
  customer_phone text not null,
  city text,
  address text,
  notes text,
  subtotal numeric default 0,
  total numeric default 0,
  status text default 'جديد'::text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.web_orders enable row level security;

drop policy if exists "public create web orders" on public.web_orders;
create policy "public create web orders" on public.web_orders
  for insert to anon with check ((status is null) or (status = any (array['جديد'::text, 'new'::text])));
drop policy if exists "staff read web orders" on public.web_orders;
create policy "staff read web orders" on public.web_orders
  for select to authenticated using (true);
drop policy if exists "staff update web orders" on public.web_orders;
create policy "staff update web orders" on public.web_orders
  for update to authenticated using (true) with check (true);

-- ───────────── web_order_items ─────────────
create table if not exists public.web_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references web_orders(id) on delete cascade,
  product_code text not null,
  product_name text,
  quantity numeric default 1,
  unit_price numeric default 0,
  line_total numeric default 0,
  created_at timestamptz default now()
);
alter table public.web_order_items enable row level security;

drop policy if exists "public create web order items" on public.web_order_items;
create policy "public create web order items" on public.web_order_items
  for insert to anon with check (true);
drop policy if exists "staff read web order items" on public.web_order_items;
create policy "staff read web order items" on public.web_order_items
  for select to authenticated using (true);

commit;
