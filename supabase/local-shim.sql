-- ═══════════════════════════════════════════════════════════════════
-- local-shim.sql — بيئة الاختبار المحلية فقط (PGlite) — ⚠️ ليس migration
-- يحاكي ما توفره Supabase أصلاً: الأدوار anon/authenticated/service_role
-- ومخطط auth (users/identities) ومخطط extensions مع pgcrypto.
-- لا يشغَّل على Supabase إطلاقاً — مشروع Supabase جديد فيه هذه كلها جاهزة.
-- ═══════════════════════════════════════════════════════════════════

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema if not exists auth;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- الحد الأدنى الذي تلمسه ملفات السلسلة/الاختبارات من مخطط auth
create table if not exists auth.users (
  id uuid primary key,
  instance_id uuid,
  aud text,
  role text,
  email text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  confirmation_token text default '',
  email_change text default '',
  email_change_token_new text default '',
  email_change_token_current text default '',
  recovery_token text default ''
);

create table if not exists auth.identities (
  id uuid primary key,
  provider_id text,
  user_id uuid references auth.users(id) on delete cascade,
  identity_data jsonb,
  provider text,
  last_sign_in_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- stubs تُستبدل في الاختبارات حسب الدور المُحاكى
create or replace function auth.jwt() returns jsonb language sql stable as $$ select null::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
