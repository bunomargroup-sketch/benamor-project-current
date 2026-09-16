-- ═══ 0034 — إنشاء/تحديث حسابات الموظفين
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-user-credentials-rpc.sql

-- ===================================================================
-- Benamor POS — إدارة بيانات دخول المستخدمين من داخل النظام (مدير فقط)
--
-- ماذا يفعل هذا الملف؟
--   1) create_app_user        : إنشاء مستخدم دخول جديد في Supabase Auth
--                                (يحل مشكلة إنشاء المستخدمين من النظام)
--   2) update_app_user_credentials : تغيير المعرّف و/أو كود الدخول لمستخدم
--                                موجود + مزامنة جدول الصلاحيات تلقائياً
--   3) إعادة تعريف دوال الصلاحيات المساعدة إن لم تكن موجودة
--      (pos_current_identifier / pos_current_role / upsert_pos_user_role)
--
-- الأمان:
--   - كل دالة تتحقق أولاً أن المتصل مدير (admin) عبر جلسة الدخول نفسها
--   - لا يوجد أي مفتاح خدمة (service key) — آمن للواجهة
--   - كلمة المرور تُخزَّن مشفّرة (bcrypt) كما يفعل Supabase نفسه
--
-- ⚠️ شغّله في Supabase SQL Editor
-- ⚠️ بعد تغيير معرّف أو كود مستخدم: عليه أن يخرج من النظام ويدخل من جديد
-- ===================================================================

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ============================================================
-- إصلاح فوري: أي مستخدم أُنشئ يدوياً بأعمدة رموز NULL يفشل دخوله
-- برسالة "Database error querying schema" — نحوّلها لنص فارغ
-- (لا يمس المستخدمين السليمين — فقط صفوف NULL)
-- ============================================================
update auth.users set
  confirmation_token         = coalesce(confirmation_token, ''),
  email_change               = coalesce(email_change, ''),
  email_change_token_new     = coalesce(email_change_token_new, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  recovery_token             = coalesce(recovery_token, '')
where confirmation_token is null
   or email_change is null
   or email_change_token_new is null
   or email_change_token_current is null
   or recovery_token is null;

-- ============================================================
-- دوال مساعدة (نفس تعريفات ملف الصلاحيات — create or replace آمن)
-- ============================================================
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

-- ============================================================
-- 1) إنشاء مستخدم دخول جديد (مدير فقط)
--    البريد الناتج: <المعرّف>@bag.com — مؤكد تلقائياً بدون أي بريد حقيقي
-- ============================================================
create or replace function public.create_app_user(
  p_identifier text,
  p_code text
)
returns uuid
language plpgsql
security definer
set search_path = auth, public, extensions
as $$
declare
  v_identifier text := lower(trim(coalesce(p_identifier,'')));
  v_email text := v_identifier || '@bag.com';
  v_uid uuid;
begin
  if public.pos_current_role() <> 'admin' then
    raise exception 'ONLY_ADMIN_CAN_CREATE_USERS';
  end if;

  if v_identifier !~ '^[a-z0-9._-]{2,40}$' then
    raise exception 'INVALID_IDENTIFIER (حروف إنجليزية وأرقام فقط، 2-40)';
  end if;

  if length(coalesce(p_code,'')) < 6 then
    raise exception 'CODE_TOO_SHORT (6 أحرف على الأقل)';
  end if;

  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'USER_ALREADY_EXISTS: %', v_email;
  end if;

  v_uid := gen_random_uuid();

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
        confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_email,
    crypt(p_code, gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        '', '', '', ''
  );

  insert into auth.identities (
    id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_uid::text, v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
    'email', now(), now(), now()
  );

  return v_uid;
end;
$$;

-- ============================================================
-- 2) تغيير المعرّف و/أو الكود لمستخدم موجود (مدير فقط)
--    يحدّث Supabase Auth + يزامن جدول الصلاحيات تلقائياً
-- ============================================================
create or replace function public.update_app_user_credentials(
  p_old_identifier text,
  p_new_identifier text default null,
  p_new_code text default null
)
returns text
language plpgsql
security definer
set search_path = auth, public, extensions
as $$
declare
  v_old_id text := lower(trim(coalesce(p_old_identifier,'')));
  v_old_email text := v_old_id || '@bag.com';
  v_new_id text := lower(trim(coalesce(p_new_identifier,'')));
  v_target_id text;
  v_target_email text;
  v_uid uuid;
begin
  if public.pos_current_role() <> 'admin' then
    raise exception 'ONLY_ADMIN_CAN_UPDATE_CREDENTIALS';
  end if;

  if v_old_id = '' then
    raise exception 'OLD_IDENTIFIER_REQUIRED';
  end if;

  -- المعرّف الهدف: الجديد إن قُدّم وصالحاً، وإلا القديم
  if v_new_id <> '' and v_new_id <> v_old_id then
    if v_new_id !~ '^[a-z0-9._-]{2,40}$' then
      raise exception 'INVALID_IDENTIFIER (حروف إنجليزية وأرقام فقط، 2-40)';
    end if;
    v_target_id := v_new_id;
  else
    v_target_id := v_old_id;
  end if;
  v_target_email := v_target_id || '@bag.com';

  if coalesce(p_new_code,'') <> '' and length(p_new_code) < 6 then
    raise exception 'CODE_TOO_SHORT (6 أحرف على الأقل)';
  end if;

  select id into v_uid from auth.users where lower(email) = v_old_email limit 1;

  if v_uid is not null then
    -- حساب موجود: تحديث البريد و/أو الكود
    if v_target_id <> v_old_id then
      if exists (select 1 from auth.users where lower(email) = v_target_email and id <> v_uid) then
        raise exception 'IDENTIFIER_ALREADY_EXISTS: %', v_target_email;
      end if;
      update auth.users set email = v_target_email, updated_at = now() where id = v_uid;
      update auth.identities
         set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(v_target_email)), updated_at = now()
       where user_id = v_uid;
    end if;
    if coalesce(p_new_code,'') <> '' then
      update auth.users set encrypted_password = crypt(p_new_code, gen_salt('bf')), updated_at = now() where id = v_uid;
    end if;
  else
    -- لا يوجد حساب دخول لهذا المعرّف (دور بدون حساب — مثل مستخدم أُضيف يدوياً):
    -- أدخل كوداً جديداً وسيُنشأ حساب الدخول ويرتبط بالدور الموجود تلقائياً
    if coalesce(p_new_code,'') = '' then
      raise exception 'USER_NOT_FOUND: % — لا يوجد حساب دخول بهذا المعرّف. أدخل كوداً جديداً لإنشائه.', v_old_email;
    end if;
    if exists (select 1 from auth.users where lower(email) = v_target_email) then
      raise exception 'IDENTIFIER_ALREADY_EXISTS: %', v_target_email;
    end if;
    v_uid := gen_random_uuid();
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
          confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_target_email,
      crypt(p_new_code, gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
          '', '', '', ''
    );

    insert into auth.identities (
      id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_uid::text, v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', v_target_email, 'email_verified', true),
      'email', now(), now(), now()
    );
  end if;

  -- مزامنة جدول الصلاحيات عند تغيير المعرّف
  if v_target_id <> v_old_id then
    update public.pos_user_roles set identifier = v_target_id, updated_at = now() where lower(identifier) = v_old_id;
  end if;

  return v_target_email;
end;
$$;

grant execute on function public.pos_current_identifier() to authenticated;
grant execute on function public.pos_current_role() to authenticated;
grant execute on function public.upsert_pos_user_role(text,text,text,text,boolean) to authenticated;
grant execute on function public.create_app_user(text,text) to authenticated;
grant execute on function public.update_app_user_credentials(text,text,text) to authenticated;

commit;

-- ============================================================
-- التحقق بعد التشغيل:
--   select proname from pg_proc p
--   join pg_namespace n on n.oid=p.pronamespace
--   where n.nspname='public' and proname in
--   ('create_app_user','update_app_user_credentials','upsert_pos_user_role');
--   يجب أن ترى الدوال الثلاث.
--
-- اختبار فعلي (من النظام كمدير):
--   شاشة المستخدمون والصلاحيات → زر 🔑 الدخول بجانب أي مستخدم
-- ============================================================
