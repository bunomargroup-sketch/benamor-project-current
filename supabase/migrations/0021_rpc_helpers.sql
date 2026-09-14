-- ═══ 0021 — دوال الدور/التحقق المساعدة
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-rpc-permission-helpers.sql

begin;
-- Benamor POS - RPC permissions and branch enforcement helpers
-- Run before/redefine transactional RPCs.

create or replace function public.pos_current_identifier()
returns text
language sql
stable
as $$
  select lower(split_part(coalesce(auth.jwt()->>'email',''),'@',1));
$$;

create or replace function public.pos_current_role()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identifier text := public.pos_current_identifier();
  v_role text;
begin
  if v_identifier is null or v_identifier = '' then
    raise exception 'AUTH_REQUIRED';
  end if;
  select role into v_role
  from public.pos_user_roles
  where lower(identifier)=v_identifier and coalesce(active,true)=true
  limit 1;
  if v_role is null then
    raise exception 'ROLE_NOT_ASSIGNED: %', v_identifier;
  end if;
  return v_role;
end;
$$;

create or replace function public.pos_assert_role(p_allowed text[])
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.pos_current_role();
begin
  if not (v_role = any(p_allowed)) then
    raise exception 'ROLE_NOT_ALLOWED: %', v_role;
  end if;
  return v_role;
end;
$$;

create or replace function public.pos_assert_location_allowed(p_location_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.pos_current_role();
  v_name text;
begin
  if p_location_id is null then raise exception 'LOCATION_REQUIRED'; end if;
  if v_role in ('admin','warehouse','accountant') then return; end if;
  select name into v_name from public.pos_locations where id=p_location_id;
  if v_role='seller_11' and v_name='فرع 11 يونيو' then return; end if;
  if v_role='seller_sarraj' and v_name='فرع السراج' then return; end if;
  raise exception 'LOCATION_NOT_ALLOWED_FOR_ROLE: %', v_role;
end;
$$;

grant execute on function public.pos_current_identifier() to authenticated;
grant execute on function public.pos_current_role() to authenticated;
grant execute on function public.pos_assert_role(text[]) to authenticated;
grant execute on function public.pos_assert_location_allowed(uuid) to authenticated;

commit;
