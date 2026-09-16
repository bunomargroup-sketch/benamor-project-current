-- ═══ 0019 — إدارة الزبائن + دوال الدور
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-customer-manage.sql

-- Benamor POS - إدارة الزبائن: صلاحية حذف للمدير فقط
-- Customer management: admin-only DELETE policy on pos_customers
--
-- متى يُشغّل: قبل رفع ملف الـPOS الذي يحتوي زر "حذف الزبون".
-- يعتمد على دالة pos_current_role() (من supabase-pos-rpc-permission-helpers.sql).
-- هنا أعيد تعريف الدوال بالكامل (create or replace) ليكون الملف مكتفٍ ذاتيًا ومأمونًا.
--
-- When to run: BEFORE uploading the POS file that contains the customer delete button.
-- Safe and idempotent. Edit (UPDATE) already works for any logged-in user via existing RLS.

begin;

-- المعرف الحالي من بريد المستخدم (identifier قبل @)
create or replace function public.pos_current_identifier()
returns text
language sql
stable
as $$
  select lower(split_part(coalesce(auth.jwt()->>'email',''),'@',1));
$$;
grant execute on function public.pos_current_identifier() to authenticated;

-- دور المستخدم الحالي (security definer لقراءة pos_user_roles)
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
grant execute on function public.pos_current_role() to authenticated;

-- صلاحية الحذف: للمدير (admin) فقط. باقي الأدوار لا تزال تملك select/insert/update الحالية.
-- Admin-only DELETE. Other roles keep their existing select/insert/update policies (no delete).
alter table public.pos_customers enable row level security;
drop policy if exists "admin delete pos_customers" on public.pos_customers;
create policy "admin delete pos_customers"
  on public.pos_customers
  for delete to authenticated
  using (public.pos_current_role() = 'admin');

commit;

-- ملاحظة: لا حاجة لإعادة تحميل الـschema بعد تغيير سياسات RLS.
-- Note: RLS policy changes do not require `notify pgrst, 'reload schema';`.
