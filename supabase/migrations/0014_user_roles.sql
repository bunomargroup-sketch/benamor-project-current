-- ═══ 0014 — أدوار المستخدمين
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-users-setup.sql
-- الترتيب داخل supabase/migrations هو ترتيب التنفيذ المعتمد لقاعدة فارغة

-- Benamor Sales System - POS users and permissions setup
-- Run this in Supabase SQL Editor.
-- This uses the existing custom login functions create_app_user/login_app_user.

begin;

create table if not exists public.pos_user_roles (
  id uuid primary key default gen_random_uuid(),
  identifier text not null unique,
  display_name text,
  role text not null default 'seller_11' check (role in ('admin','seller_11','seller_sarraj','sales_purchase','warehouse','accountant','viewer')),
  location_name text,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pos_user_roles_identifier_idx on public.pos_user_roles(identifier);
create index if not exists pos_user_roles_role_idx on public.pos_user_roles(role);

alter table public.pos_user_roles enable row level security;

drop policy if exists "POS public select pos_user_roles" on public.pos_user_roles;
drop policy if exists "POS public insert pos_user_roles" on public.pos_user_roles;
drop policy if exists "POS public update pos_user_roles" on public.pos_user_roles;
drop policy if exists "POS public delete pos_user_roles" on public.pos_user_roles;

create policy "POS public select pos_user_roles" on public.pos_user_roles for select to anon using (true);
create policy "POS public insert pos_user_roles" on public.pos_user_roles for insert to anon with check (true);
create policy "POS public update pos_user_roles" on public.pos_user_roles for update to anon using (true) with check (true);
create policy "POS public delete pos_user_roles" on public.pos_user_roles for delete to anon using (true);

commit;

-- Role meanings used by the app:
-- admin          = كل الصلاحيات
-- seller_11      = بيع فرع 11 يونيو + منتجات/مخزون فقط
-- seller_sarraj  = بيع فرع السراج + منتجات/مخزون فقط
-- warehouse      = مخزون + تحويلات + منتجات
-- accountant     = موردين + عملاء + دفعات + تقارير
-- viewer         = مشاهدة فقط
