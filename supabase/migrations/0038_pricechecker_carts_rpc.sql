-- ═══ 0038 — قراءة سلالات العارض من الـPOS
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-pricechecker-carts-rpc.sql

-- Benamor POS - Read Price Checker saved carts by branch and mark converted
-- Run once in Supabase SQL Editor.

begin;

drop function if exists public.pos_get_branch_pricechecker_carts();
create or replace function public.pos_get_branch_pricechecker_carts(p_dummy jsonb default '{}'::jsonb)
returns table(
  id uuid,
  customer_name text,
  customer_phone text,
  notes text,
  discount_percent numeric,
  subtotal numeric,
  total numeric,
  status text,
  updated_at timestamptz,
  owner_identifier text,
  owner_role text,
  branch_name text,
  items jsonb
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role text := public.pos_current_role();
begin
  return query
  with cart_rows as (
    select
      c.*,
      lower(split_part(u.email,'@',1)) as owner_identifier,
      r.role as owner_role
    from public.carts c
    left join auth.users u on u.id = c.user_id
    left join public.pos_user_roles r on lower(r.identifier)=lower(split_part(u.email,'@',1))
    where coalesce(c.status,'open')='open'
      and (
        v_role='admin'
        or v_role='sales_purchase'
        or (v_role='seller_11' and (c.branch_name='فرع 11 يونيو' or (c.branch_name is null and r.role='seller_11')))
        or (v_role='seller_sarraj' and (c.branch_name='فرع السراج' or (c.branch_name is null and r.role='seller_sarraj')))
      )
  )
  select
    c.id,
    c.customer_name,
    c.customer_phone,
    c.notes,
    c.discount_percent,
    c.subtotal,
    c.total,
    c.status,
    c.updated_at,
    c.owner_identifier,
    c.owner_role,
    c.branch_name,
    coalesce(jsonb_agg(to_jsonb(i) order by i.created_at) filter (where i.id is not null),'[]'::jsonb) as items
  from cart_rows c
  left join public.cart_items i on i.cart_id=c.id
  group by c.id,c.customer_name,c.customer_phone,c.notes,c.discount_percent,c.subtotal,c.total,c.status,c.updated_at,c.owner_identifier,c.owner_role,c.branch_name
  order by c.updated_at desc nulls last
  limit 200;
end;
$$;

create or replace function public.mark_pricechecker_cart_converted(p_cart_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role text := public.pos_current_role();
  v_owner_role text;
begin
  select r.role into v_owner_role
  from public.carts c
  left join auth.users u on u.id=c.user_id
  left join public.pos_user_roles r on lower(r.identifier)=lower(split_part(u.email,'@',1))
  where c.id=p_cart_id;

  if not (
    v_role='admin'
    or v_role='sales_purchase'
    or (v_role='seller_11' and v_owner_role='seller_11')
    or (v_role='seller_sarraj' and v_owner_role='seller_sarraj')
  ) then
    raise exception 'CART_NOT_ALLOWED_FOR_ROLE';
  end if;

  update public.carts
  set status='converted', updated_at=now()
  where id=p_cart_id;
end;
$$;

grant execute on function public.pos_get_branch_pricechecker_carts(jsonb) to authenticated;
grant execute on function public.mark_pricechecker_cart_converted(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
