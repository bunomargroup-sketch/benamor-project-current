-- ═══ 0037 — سلالات عارض الأسعار: الجداول + السياسات + RPC الحفظ
-- ⚠️ إعادة بناء حرفية (RECONSTRUCTED-EXACT) من قاعدة الإنتاج عبر
-- extract-live-schema.sql — تطابق التعريفات الحية عموداً بعمود وسياسة بسياسة
-- (النسخة السابقة كانت تخميناً من كود التطبيق — هذه هي الحقيقة الأرضية)
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ترتيب الأعمدة مطابق للحي
create table if not exists public.carts (
  id uuid primary key default gen_random_uuid(),
  customer_name text,
  customer_phone text,
  notes text,
  discount_percent numeric default 0,
  subtotal numeric default 0,
  discount_amount numeric default 0,
  total numeric default 0,
  total_margin numeric default 0,
  total_margin_rate numeric default 0,
  status text default 'open'::text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  user_id uuid references auth.users(id) on delete cascade,
  app_user_id uuid references app_users(id) on delete cascade,
  branch_name text
);
alter table public.carts enable row level security;

create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid references carts(id) on delete cascade,
  product_code text not null,
  product_name text,
  brand text,
  model text,
  quantity numeric default 1,
  unit_price numeric default 0,
  unit_cost numeric default 0,
  line_total numeric default 0,
  margin_value numeric default 0,
  margin_rate numeric default 0,
  created_at timestamptz default now(),
  user_id uuid references auth.users(id)
);
alter table public.cart_items enable row level security;

-- السياسات الثماني بأسمائها الحية (لكل أمر سياسة باسمه كما في الإنتاج)
drop policy if exists "owner read carts" on public.carts;
create policy "owner read carts" on public.carts
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "owner insert carts" on public.carts;
create policy "owner insert carts" on public.carts
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "owner update carts" on public.carts;
create policy "owner update carts" on public.carts
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "owner delete carts" on public.carts;
create policy "owner delete carts" on public.carts
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "owner read cart items" on public.cart_items;
create policy "owner read cart items" on public.cart_items
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "owner insert cart items" on public.cart_items;
create policy "owner insert cart items" on public.cart_items
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "owner update cart items" on public.cart_items;
create policy "owner update cart items" on public.cart_items
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "owner delete cart items" on public.cart_items;
create policy "owner delete cart items" on public.cart_items
  for delete to authenticated using (user_id = auth.uid());

-- الدالة الحية (تُرجع jsonb للسلة كاملة — upsert بملكية المستخدم)
CREATE OR REPLACE FUNCTION public.save_pricechecker_cart(p_cart jsonb, p_items jsonb, p_cart_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_user uuid := auth.uid();
  v_cart public.carts%rowtype;
  v_item jsonb;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then
    raise exception 'CART_HAS_NO_ITEMS';
  end if;

  if p_cart_id is not null then
    update public.carts
      set user_id = v_user,
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
    where id = p_cart_id and (user_id = v_user or user_id is null)
    returning * into v_cart;
  end if;

  if v_cart.id is null then
    insert into public.carts(
      user_id, branch_name, customer_name, customer_phone, notes,
      discount_percent, subtotal, discount_amount, total,
      total_margin, total_margin_rate, status, updated_at
    ) values (
      v_user, nullif(p_cart->>'branch_name',''), nullif(p_cart->>'customer_name',''), nullif(p_cart->>'customer_phone',''), nullif(p_cart->>'notes',''),
      coalesce(nullif(p_cart->>'discount_percent','')::numeric,0),
      coalesce(nullif(p_cart->>'subtotal','')::numeric,0),
      coalesce(nullif(p_cart->>'discount_amount','')::numeric,0),
      coalesce(nullif(p_cart->>'total','')::numeric,0),
      coalesce(nullif(p_cart->>'total_margin','')::numeric,0),
      coalesce(nullif(p_cart->>'total_margin_rate','')::numeric,0),
      coalesce(nullif(p_cart->>'status',''),'open'),
      now()
    ) returning * into v_cart;
  end if;

  delete from public.cart_items
  where cart_id = v_cart.id and (user_id = v_user or user_id is null);

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.cart_items(
      user_id, cart_id, product_code, product_name, brand, model,
      quantity, unit_price, unit_cost, line_total, margin_value, margin_rate
    ) values (
      v_user,
      v_cart.id,
      v_item->>'product_code',
      v_item->>'product_name',
      nullif(v_item->>'brand',''),
      nullif(v_item->>'model',''),
      coalesce(nullif(v_item->>'quantity','')::numeric,0),
      coalesce(nullif(v_item->>'unit_price','')::numeric,0),
      coalesce(nullif(v_item->>'unit_cost','')::numeric,0),
      coalesce(nullif(v_item->>'line_total','')::numeric,0),
      coalesce(nullif(v_item->>'margin_value','')::numeric,0),
      coalesce(nullif(v_item->>'margin_rate','')::numeric,0)
    );
  end loop;

  return to_jsonb(v_cart);
end;
$$;

grant execute on function public.save_pricechecker_cart(jsonb,jsonb,uuid) to authenticated;

commit;
