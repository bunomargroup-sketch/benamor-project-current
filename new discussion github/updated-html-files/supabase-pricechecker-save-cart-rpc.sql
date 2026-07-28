-- Price Checker - secure saved cart RPC for RLS-locked carts/cart_items
-- Run once in Supabase SQL Editor.

begin;

alter table if exists public.carts
  add column if not exists branch_name text;

create or replace function public.save_pricechecker_cart(
  p_cart jsonb,
  p_items jsonb,
  p_cart_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
