-- ═══ 0034 — إدارة الأدوار RPC
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-role-management-rpc.sql
-- الترتيب داخل supabase/migrations هو ترتيب التنفيذ المعتمد لقاعدة فارغة

-- Benamor POS - Secure admin role management RPC
-- Fixes RLS errors when admins edit pos_user_roles from the POS UI.
-- Run once in Supabase SQL Editor.

begin;

-- Keep RLS enabled. Direct self-promotion remains blocked.
alter table public.pos_user_roles enable row level security;

-- Allow authenticated users to read roles for app permission loading.
drop policy if exists "auth select pos_user_roles" on public.pos_user_roles;
create policy "auth select pos_user_roles"
  on public.pos_user_roles
  for select
  to authenticated
  using (true);

-- Remove direct writes from browser clients.
drop policy if exists "POS public insert pos_user_roles" on public.pos_user_roles;
drop policy if exists "POS public update pos_user_roles" on public.pos_user_roles;
drop policy if exists "POS public delete pos_user_roles" on public.pos_user_roles;
drop policy if exists "auth insert pos_user_roles" on public.pos_user_roles;
drop policy if exists "auth update pos_user_roles" on public.pos_user_roles;
drop policy if exists "auth delete pos_user_roles" on public.pos_user_roles;

-- Helper if not already installed by Phase 1 hardening.
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
  where lower(identifier) = v_identifier
    and coalesce(active,true) = true
  limit 1;

  if v_role is null then
    raise exception 'ROLE_NOT_ASSIGNED: %', v_identifier;
  end if;

  return v_role;
end;
$$;

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

grant execute on function public.pos_current_identifier() to authenticated;
grant execute on function public.pos_current_role() to authenticated;
grant execute on function public.upsert_pos_user_role(text,text,text,text,boolean) to authenticated;

commit;
