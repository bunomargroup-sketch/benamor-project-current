-- ═══ 0032 — دور البيع-والشراء
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-sales-purchase-role.sql

-- Benamor POS - Add role: sales_purchase
-- This role can sell and create purchase invoices in both sales branches, but is not admin.
-- Run once in Supabase SQL Editor.

begin;

-- Update role check constraint
alter table if exists public.pos_user_roles
  drop constraint if exists pos_user_roles_role_check;

alter table if exists public.pos_user_roles
  add constraint pos_user_roles_role_check
  check (role in ('admin','seller_11','seller_sarraj','sales_purchase','warehouse','accountant','viewer'));

-- Recreate branch/location helper to allow sales_purchase in all sales locations only.
create or replace function public.pos_assert_location_allowed(p_location_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.pos_current_role();
  v_name text;
  v_is_sales boolean;
begin
  if p_location_id is null then raise exception 'LOCATION_REQUIRED'; end if;

  if v_role in ('admin','warehouse','accountant') then
    return;
  end if;

  select name, coalesce(is_sales_location,false)
    into v_name, v_is_sales
  from public.pos_locations
  where id=p_location_id;

  if v_role='sales_purchase' and v_is_sales then
    return;
  end if;

  if v_role='seller_11' and v_name='فرع 11 يونيو' then return; end if;
  if v_role='seller_sarraj' and v_name='فرع السراج' then return; end if;

  raise exception 'LOCATION_NOT_ALLOWED_FOR_ROLE: %', v_role;
end;
$$;

-- Recreate role management RPC validation with the new role.
create or replace function public.upsert_pos_user_role(
  p_identifier text,
  p_display_name text default null,
  p_role text default 'viewer',
  p_notes text default null,
  p_active boolean default true
)
returns public.pos_user_roles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_role text;
  v_row public.pos_user_roles;
begin
  v_admin_role := public.pos_current_role();
  if v_admin_role <> 'admin' then
    raise exception 'ONLY_ADMIN_CAN_MANAGE_POS_ROLES';
  end if;

  if p_identifier is null or trim(p_identifier) = '' then
    raise exception 'IDENTIFIER_REQUIRED';
  end if;

  if p_role not in ('admin','seller_11','seller_sarraj','sales_purchase','warehouse','accountant','viewer') then
    raise exception 'INVALID_ROLE: %', p_role;
  end if;

  insert into public.pos_user_roles(identifier, display_name, role, active, notes, updated_at)
  values (lower(trim(p_identifier)), nullif(trim(coalesce(p_display_name,'')),''), p_role, coalesce(p_active,true), nullif(trim(coalesce(p_notes,'')),''), now())
  on conflict (identifier) do update
    set display_name = excluded.display_name,
        role = excluded.role,
        active = excluded.active,
        notes = excluded.notes,
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

-- Recreate transaction RPC permission checks by replacing allowed role arrays.
-- If the RPCs already exist, these ALTERs are not enough; run the latest full RPC files after this if needed.
-- The current SQL files in the workspace were updated to include sales_purchase.

grant execute on function public.pos_assert_location_allowed(uuid) to authenticated;
grant execute on function public.upsert_pos_user_role(text,text,text,text,boolean) to authenticated;

commit;
