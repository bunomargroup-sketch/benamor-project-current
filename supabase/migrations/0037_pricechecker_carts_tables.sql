-- ═══ 0037 — سلالات عارض الأسعار: الجداول + RPC الحفظ
-- ⚠️⚠️ ملف مُعاد البناء (RECONSTRUCTED) — ليس نسخة حرفية ⚠️⚠️
-- هذا الكائن لم يكن في المستودع إطلاقاً (كان موجوداً في قاعدة البيانات الحيّة
-- فقط). أُعيد بناؤه من كود التطبيق (apps/pricechecker/index.html + دوال
-- 0038_pricechecker_carts_rpc.sql) ليكتمل بناء القاعدة من الصفر.
--
-- ⚠ لتأكيد المطابقة الحرفية مع الحيّ: شغّل supabase/extract-live-schema.sql
--   على الإنتاج وقارن الناتج بـ schema-local.json — أي فرق في الأعمدة/الأنواع
--   سيظهر وسنصحّح هذا الملف ليطابق.
--
-- الاستخدام المرصود من كود التطبيق:
--   carts:        حفظ سلة زبون لعارض الأسعار (payload + status open/converted)
--   cart_items:   بنود السلة مع الهوامش
--   save_pricechecker_cart: تُستدعى من عارض الأسعار (upsert سلة + استبدال بنودها)
-- ═══════════════════════════════════════════════════════════════════

begin;

create table if not exists public.carts (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid,
  user_id uuid,
  branch_name text,
  customer_name text,
  customer_phone text,
  notes text,
  discount_percent numeric not null default 0,
  subtotal numeric not null default 0,
  discount_amount numeric not null default 0,
  total numeric not null default 0,
  total_margin numeric not null default 0,
  total_margin_rate numeric not null default 0,
  status text not null default 'open',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists carts_user_updated_idx
  on public.carts(user_id, updated_at desc);

create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  user_id uuid,
  product_code text,
  product_name text,
  brand text,
  model text,
  quantity numeric not null default 0,
  unit_price numeric not null default 0,
  unit_cost numeric not null default 0,
  line_total numeric not null default 0,
  margin_value numeric not null default 0,
  margin_rate numeric not null default 0
);

create index if not exists cart_items_cart_idx
  on public.cart_items(cart_id);

-- RLS: كل مستخدم مسجّل يرى ويعدّل سلاله فقط
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;

drop policy if exists carts_owner on public.carts;
create policy carts_owner on public.carts
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists cart_items_owner on public.cart_items;
create policy cart_items_owner on public.cart_items
  for all to authenticated
  using (cart_id in (select id from public.carts where user_id = auth.uid()))
  with check (cart_id in (select id from public.carts where user_id = auth.uid()));

-- حفظ السلة (upsert) — يستدعيها عارض الأسعار بجلسة مستخدمه
create or replace function public.save_pricechecker_cart(
  p_cart jsonb,
  p_items jsonb default '[]'::jsonb,
  p_cart_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_id uuid := p_cart_id;
  v_user uuid := nullif(p_cart->>'user_id','')::uuid;
begin
  if v_user is null then
    v_user := auth.uid();
  end if;
  if v_user is null or v_user <> auth.uid() then
    raise exception 'CART_USER_MISMATCH';
  end if;

  if v_id is not null then
    update public.carts set
      app_user_id = nullif(p_cart->>'app_user_id','')::uuid,
      user_id = v_user,
      branch_name = nullif(p_cart->>'branch_name',''),
      customer_name = nullif(p_cart->>'customer_name',''),
      customer_phone = nullif(p_cart->>'customer_phone',''),
      notes = nullif(p_cart->>'notes',''),
      discount_percent = coalesce(nullif(p_cart->>'discount_percent','')::numeric,0),
      subtotal = coalesce(nullif(p_cart->>'subtotal','')::numeric,0),
      discount_amount = coalesce(nullif(p_cart->>'discount_amount','')::numeric,0),
      total = coalesce(nullif(p_cart->>'total','')::numeric,0),
      total_margin = coalesce(nullif(p_cart->>'total_margin','')::numeric,0),
      total_margin_rate = coalesce(nullif(p_cart->>'total_margin_rate','')::numeric,0),
      status = coalesce(nullif(p_cart->>'status',''),'open'),
      updated_at = now()
    where id = v_id and user_id = v_user;
    if not found then
      raise exception 'CART_NOT_FOUND_OR_NOT_OWNED';
    end if;
    delete from public.cart_items where cart_id = v_id;
  else
    insert into public.carts (
      app_user_id, user_id, branch_name, customer_name, customer_phone, notes,
      discount_percent, subtotal, discount_amount, total, total_margin, total_margin_rate, status
    ) values (
      nullif(p_cart->>'app_user_id','')::uuid, v_user, nullif(p_cart->>'branch_name',''),
      nullif(p_cart->>'customer_name',''), nullif(p_cart->>'customer_phone',''), nullif(p_cart->>'notes',''),
      coalesce(nullif(p_cart->>'discount_percent','')::numeric,0),
      coalesce(nullif(p_cart->>'subtotal','')::numeric,0),
      coalesce(nullif(p_cart->>'discount_amount','')::numeric,0),
      coalesce(nullif(p_cart->>'total','')::numeric,0),
      coalesce(nullif(p_cart->>'total_margin','')::numeric,0),
      coalesce(nullif(p_cart->>'total_margin_rate','')::numeric,0),
      coalesce(nullif(p_cart->>'status',''),'open')
    ) returning id into v_id;
  end if;

  insert into public.cart_items (
    cart_id, user_id, product_code, product_name, brand, model,
    quantity, unit_price, unit_cost, line_total, margin_value, margin_rate
  )
  select
    v_id,
    v_user,
    i->>'product_code',
    i->>'product_name',
    i->>'brand',
    i->>'model',
    coalesce(nullif(i->>'quantity','')::numeric,0),
    coalesce(nullif(i->>'unit_price','')::numeric,0),
    coalesce(nullif(i->>'unit_cost','')::numeric,0),
    coalesce(nullif(i->>'line_total','')::numeric,0),
    coalesce(nullif(i->>'margin_value','')::numeric,0),
    coalesce(nullif(i->>'margin_rate','')::numeric,0)
  from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) i;

  return v_id;
end;
$$;

grant execute on function public.save_pricechecker_cart(jsonb,jsonb,uuid) to authenticated;

commit;
