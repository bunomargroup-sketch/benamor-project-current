-- ═══ 0046 — سجل مَن أنشأ المصروف + تعديل/حذف ذرّي مع الحركة المالية
-- المصدر: apps/pos/benamor-sales-system/supabase-pos-expenses-audit-list.sql

-- ═══════════════════════════════════════════════════════════════════
-- Benamor POS — سجل مَن أنشأ المصروف + تعديل/حذف ذرّي مع الحركة المالية
-- + دعمان لقائمة المصاريف (شاشة جديدة تحت نموذج الإدخال)
--
-- يُشغَّل بعد supabase-pos-role-policies-phase3.sql (وعلى قاعدة جديدة
-- بعد سلسلة supabase/migrations حتى 0045)
--
-- ماذا يفعل:
--   1) عمود created_by في pos_expenses (created_at موجود أصلاً بـ default now())
--   2) تريغر يعبّئ created_by من جلسة الدخول إن لم يرسله العميل
--      (يحمي أثناء الانتقال — متصفحات عليها نسخة app.js قديمة مخبأة)
--   3) تعبئة الصفوف القديمة من pos_audit_log حصرياً حيث يوجد تطابق مؤكد
--      (entity_type='pos_expenses' AND entity_id=id) — وما لا يُعرف يبقى
--      فارغاً بلا أي تخمين ⇒ لا يعدّله غير المدير أبداً
--   4) pos_delete_expense: للمدير فقط — يحذف المصروف وحركته المالية
--      في معاملة واحدة (لا حركة يتيمة تبقى تخصم من الخزينة)
--   5) pos_update_expense: للمدير، أو منشئ المصروف في نفس يوم تسجيله فقط
--      (العبرة بـ created_at لا expense_date) — يحدّث الصف ويزامن الحركة
--      المالية (حذف القديمة وإدراج المطابقة) في نفس المعاملة
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────────
-- 1) عمود مُنشئ المصروف
-- ───────────────────────────────────────────────────────────────────
alter table public.pos_expenses
  add column if not exists created_by text;

-- ───────────────────────────────────────────────────────────────────
-- 2) تريغر التعبئة من الجلسة (إن لم يُرسِله العميل)
-- ───────────────────────────────────────────────────────────────────
create or replace function public.pos_expenses_set_creator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is null or trim(new.created_by) = '' then
    new.created_by := nullif(public.pos_current_identifier(), '');
  end if;
  return new;
end;
$$;

drop trigger if exists pos_expenses_set_creator_trg on public.pos_expenses;
create trigger pos_expenses_set_creator_trg
  before insert on public.pos_expenses
  for each row execute function public.pos_expenses_set_creator();

-- ───────────────────────────────────────────────────────────────────
-- 3) تعبئة تاريخية من سجل التدقيق فقط (بلا تخمين)
--    أقدم قيد تدقيق مطابق للمصروف نفسه = منشئه.
--    ما لا قيد له يبقى created_by فارغاً.
-- ───────────────────────────────────────────────────────────────────
update public.pos_expenses e
set created_by = (
  select a.user_identifier
  from public.pos_audit_log a
  where a.entity_type = 'pos_expenses'
    and a.entity_id = e.id::text
    and coalesce(a.user_identifier, '') <> ''
  order by a.created_at asc
  limit 1
)
where e.created_by is null;

-- ───────────────────────────────────────────────────────────────────
-- 4) حذف مصروف — المدير فقط، ذرّي مع حركته المالية
-- ───────────────────────────────────────────────────────────────────
create or replace function public.pos_delete_expense(p_expense_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exp public.pos_expenses%rowtype;
begin
  if public.pos_current_role() <> 'admin' then
    raise exception 'EXPENSE_DELETE_ADMIN_ONLY';
  end if;

  select * into v_exp from public.pos_expenses
  where id = p_expense_id for update;
  if not found then
    raise exception 'EXPENSE_NOT_FOUND';
  end if;

  -- الحركة المالية المرتبطة تُحذف في نفس المعاملة — لا يتيمة تخصم للأبد
  delete from public.pos_finance_movements
  where reference_table = 'pos_expenses' and reference_id = p_expense_id;

  delete from public.pos_expenses where id = p_expense_id;

  return jsonb_build_object('id', p_expense_id, 'deleted', true,
                            'amount', v_exp.amount, 'account_id', v_exp.account_id);
end;
$$;

-- ───────────────────────────────────────────────────────────────────
-- 5) تعديل مصروف — المدير، أو المنشئ في نفس يوم التسجيل فقط
--    يزامن الحركة المالية بالمثل في نفس المعاملة
-- ───────────────────────────────────────────────────────────────────
create or replace function public.pos_update_expense(
  p_expense_id uuid,
  p_expense jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exp public.pos_expenses%rowtype;
  v_role text := public.pos_current_role();
  v_date date;
  v_location uuid;
  v_account uuid;
  v_category uuid;
  v_title text;
  v_amount numeric;
  v_notes text;
begin
  select * into v_exp from public.pos_expenses
  where id = p_expense_id for update;
  if not found then
    raise exception 'EXPENSE_NOT_FOUND';
  end if;

  -- الصلاحية: المدير دائماً، أو من سجّله هو وفي نفس يوم التسجيل
  -- (العبرة بوقت التسجيل created_at لا بتاريخ المصروف expense_date)
  if not (
    v_role = 'admin'
    or (
      coalesce(v_exp.created_by,'') <> ''
      and v_exp.created_by = public.pos_current_identifier()
      and v_exp.created_at::date = current_date
    )
  ) then
    raise exception 'EXPENSE_EDIT_NOT_ALLOWED — التعديل للمدير، أو لمنشئ المصروف في نفس يوم تسجيله فقط';
  end if;

  v_date     := coalesce(nullif(p_expense->>'expense_date','')::date, v_exp.expense_date);
  v_location := coalesce(nullif(p_expense->>'location_id','')::uuid, v_exp.location_id);
  v_account  := coalesce(nullif(p_expense->>'account_id','')::uuid, v_exp.account_id);
  v_category := nullif(p_expense->>'category_id','')::uuid; -- '' ⇒ بلا تصنيف
  if v_category is null and p_expense ? 'category_id' and p_expense->>'category_id' is null then
    v_category := v_exp.category_id;
  end if;
  v_title    := nullif(p_expense->>'title','');
  v_amount   := coalesce(nullif(p_expense->>'amount','')::numeric, v_exp.amount);
  v_notes    := nullif(p_expense->>'notes','');

  if v_title is null then raise exception 'EXPENSE_TITLE_REQUIRED'; end if;
  if v_amount is null or v_amount <= 0 then raise exception 'EXPENSE_AMOUNT_MUST_BE_POSITIVE'; end if;
  if not exists (select 1 from public.pos_finance_accounts where id = v_account) then
    raise exception 'EXPENSE_ACCOUNT_NOT_FOUND';
  end if;

  update public.pos_expenses set
    expense_date = v_date,
    location_id  = v_location,
    account_id   = v_account,
    category_id  = v_category,
    title        = v_title,
    amount       = v_amount,
    notes        = v_notes,
    updated_at   = now()
  where id = p_expense_id
  returning * into v_exp;

  -- مزامنة الحركة المالية: تُحذف المرتبطة القديمة وتُدرج المطابقة للقيم الجديدة
  -- (مبلغ/حساب/تاريخ/بيان) — في نفس المعاملة
  delete from public.pos_finance_movements
  where reference_table = 'pos_expenses' and reference_id = p_expense_id;

  insert into public.pos_finance_movements(
    account_id, direction, movement_type, amount, movement_date,
    reference_table, reference_id, notes
  ) values (
    v_account, 'out', 'expense', v_amount, v_date,
    'pos_expenses', p_expense_id,
    v_title || coalesce(' | عدّل: ' || public.pos_current_identifier(), '')
  );

  return to_jsonb(v_exp);
end;
$$;

-- ───────────────────────────────────────────────────────────────────
-- 6) الصلاحيات: authenticated فقط (مغلق عن anon/public)
-- ───────────────────────────────────────────────────────────────────
revoke all on function public.pos_delete_expense(uuid) from anon, public;
revoke all on function public.pos_update_expense(uuid,jsonb) from anon, public;
grant execute on function public.pos_delete_expense(uuid) to authenticated;
grant execute on function public.pos_update_expense(uuid,jsonb) to authenticated;

commit;

-- ═══════════════════════════════════════════════════════════════════
-- التحقق بعد التشغيل — نفّذ في SQL Editor:
--
-- (١) العمود والتريغر:
--   select column_name from information_schema.columns
--   where table_schema='public' and table_name='pos_expenses' and column_name='created_by';
--   select tgname from pg_trigger
--   where tgrelid='public.pos_expenses'::regclass and tgname='pos_expenses_set_creator_trg';
--
-- (٢) نتيجة التعبئة التاريخية (كم صفحة عُرف منشئها):
--   select count(*) filter (where created_by is not null) as known,
--          count(*) filter (where created_by is null)     as unknown
--   from public.pos_expenses;
--
-- (٣) الدالتان موجودتان:
--   select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--   where n.nspname='public' and proname in ('pos_delete_expense','pos_update_expense');
-- ═══════════════════════════════════════════════════════════════════
