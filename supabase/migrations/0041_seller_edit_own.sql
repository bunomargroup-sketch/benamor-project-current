-- ═══ 0041 — البائع يعدّل فواتيره (created_by)
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-seller-edit-own.sql
-- الترتيب داخل supabase/migrations هو ترتيب التنفيذ المعتمد لقاعدة فارغة

-- ═══════════════════════════════════════════════════════════════════
-- البائع يعدّل فواتيره التي أنشأها هو + إشعار المدراء — benamor-sales-system
-- ═══════════════════════════════════════════════════════════════════
-- يعمل فوق ملفي: supabase-pos-rls-lockdown.sql ثم supabase-pos-role-policies-phase1.sql
--
-- ماذا يفعل؟
--   1) يضيف عمود created_by إلى pos_sales ويخزّنه من جلسة الدخول
--      (كل فاتورة جديدة تُسجَّل باسم منشئها)
--   2) البائع يستطيع تعديل/حذف فواتيره التي أنشأها فقط —
--      عبر كل الجداول المرتبطة (البنود، الدفعات، الحركات المالية،
--      المخزون في فرعه، حركات المخزون، قيود الزبون)
--   3) المدير والبيع-والشراء: كما هم (تعديل كل الفواتير)
--   4) كل تعديل فاتورة (من أي دور) يُسجَّل في سجل التدقيق
--      والواجهة تعرض إشعاراً للمدير عند دخوله بعدد تعديلات البائعين
--
-- ⚠️ الفواتير القديمة (قبل هذا الملف) ليس لها created_by ⇒
--    البائعون لا يعدّلوها — المدير/البيع-والشراء يعدّلوها.
--
-- التراجع: أعد تشغيل القسم 2 من rls-lockdown ثم ملف phase1.
--
-- شغّله في: Supabase ← SQL Editor ← دفعة واحدة
-- ═══════════════════════════════════════════════════════════════════

begin;

-- 1) عمود منشئ الفاتورة
alter table public.pos_sales add column if not exists created_by text;
create index if not exists pos_sales_created_by_idx on public.pos_sales(created_by);


-- 3) دالة الحفظ المحدّثة (تخزّن منشئ الفاتورة)
create or replace function public.post_sale_transaction(
  p_sale jsonb,
  p_items jsonb,
  p_payments jsonb default '[]'::jsonb,
  p_idempotency_key text default null,
  p_user_identifier text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.pos_sales%rowtype;
  v_sale public.pos_sales%rowtype;
  v_item jsonb;
  v_payment jsonb;
  v_location uuid;
  v_customer uuid;
  v_sale_date date;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_total numeric := 0;
  v_paid_abs numeric := 0;
  v_paid_signed numeric := 0;
  v_balance_due numeric := 0;
  v_method text := 'cash';
  v_line_total numeric;
  v_qty numeric;
  v_account uuid;
  v_amount numeric;
  v_payment_method text;
  v_has_items boolean;
  v_unit_cost numeric;
  v_comp record;
begin
  if p_idempotency_key is not null and trim(p_idempotency_key) <> '' then
    select * into v_existing from public.pos_sales where idempotency_key = p_idempotency_key limit 1;
    if found then
      return to_jsonb(v_existing) || jsonb_build_object('idempotent_replay', true);
    end if;
  end if;

  v_has_items := jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0;
  if not v_has_items then raise exception 'SALE_HAS_NO_ITEMS'; end if;

  v_location := nullif(p_sale->>'location_id','')::uuid;
  if v_location is null then raise exception 'LOCATION_REQUIRED'; end if;
  perform public.pos_assert_role(array['admin','seller_11','seller_sarraj','sales_purchase']);
  perform public.pos_assert_location_allowed(v_location);

  v_customer := nullif(p_sale->>'customer_id','')::uuid;
  v_sale_date := coalesce(nullif(p_sale->>'sale_date','')::date, current_date);
  v_discount := coalesce(nullif(p_sale->>'discount','')::numeric, 0);
  if v_discount < 0 then raise exception 'NEGATIVE_DISCOUNT_NOT_ALLOWED'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce(nullif(v_item->>'qty','')::numeric, 0);
    -- Phase 1 hardening: normal checkout must not contain unlinked return lines.
    -- All customer returns must go through post_sale_return_transaction with original sale item IDs.
    if v_qty <= 0 then raise exception 'NEGATIVE_OR_ZERO_SALE_QTY_NOT_ALLOWED_USE_RETURN_WORKFLOW'; end if;
    if coalesce(nullif(v_item->>'unit_price','')::numeric, 0) < 0 then raise exception 'NEGATIVE_PRICE_NOT_ALLOWED'; end if;
    v_line_total := coalesce(nullif(v_item->>'line_total','')::numeric, 0);
    if v_line_total < 0 then raise exception 'NEGATIVE_LINE_TOTAL_NOT_ALLOWED'; end if;
    v_subtotal := v_subtotal + v_line_total;
  end loop;

  if v_discount > v_subtotal then raise exception 'DISCOUNT_EXCEEDS_SUBTOTAL'; end if;
  v_total := v_subtotal - v_discount;
  if v_total > 0 and v_customer is null and coalesce(nullif(p_sale->>'balance_due','')::numeric,0) > 0 then
    raise exception 'CUSTOMER_REQUIRED_FOR_CREDIT_SALE';
  end if;

  for v_payment in select * from jsonb_array_elements(coalesce(p_payments,'[]'::jsonb)) loop
    v_amount := coalesce(nullif(v_payment->>'amount','')::numeric, 0);
    v_payment_method := v_payment->>'payment_method';
    if v_amount <= 0 then raise exception 'PAYMENT_AMOUNT_MUST_BE_POSITIVE'; end if;
    if v_payment_method not in ('cash','bank_transfer','card') then raise exception 'INVALID_PAYMENT_METHOD: %', v_payment_method; end if;
    if nullif(v_payment->>'account_id','') is null then
      raise exception 'FINANCE_ACCOUNT_REQUIRED_FOR_PAYMENT_METHOD: %', v_payment_method;
    end if;
    v_paid_abs := v_paid_abs + v_amount;
  end loop;

  if v_paid_abs > v_total then raise exception 'PAID_AMOUNT_EXCEEDS_TOTAL'; end if;

  v_paid_signed := v_paid_abs;
  v_balance_due := greatest(0, v_total - v_paid_abs);
  v_method := case
    when v_balance_due > 0 then 'credit'
    when jsonb_array_length(coalesce(p_payments,'[]'::jsonb)) > 1 then 'mixed'
    when jsonb_array_length(coalesce(p_payments,'[]'::jsonb)) = 1 then (p_payments->0->>'payment_method')
    else coalesce(nullif(p_sale->>'payment_method',''),'cash')
  end;

  insert into public.pos_sales(
    invoice_no, sale_date, location_id, customer_id, payment_method,
    subtotal, discount, total, paid_amount, balance_due, status, notes, idempotency_key, created_by
  ) values (
    nullif(p_sale->>'invoice_no',''), v_sale_date, v_location, v_customer, v_method,
    v_subtotal, v_discount, v_total, v_paid_signed, v_balance_due, 'posted', nullif(p_sale->>'notes',''), nullif(p_idempotency_key,''), nullif(p_user_identifier,'')
  ) returning * into v_sale;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'qty')::numeric;
    select coalesce(p.purchase_price,0) into v_unit_cost
    from public.pos_products p
    where lower(p.code)=lower(v_item->>'product_code')
    limit 1;
    v_unit_cost := coalesce(v_unit_cost,0);

    insert into public.pos_sale_items(sale_id, product_code, product_name, qty, unit_price, line_discount, discount_text, line_total, unit_cost_at_sale)
    values (
      v_sale.id,
      v_item->>'product_code',
      v_item->>'product_name',
      v_qty,
      coalesce(nullif(v_item->>'unit_price','')::numeric,0),
      coalesce(nullif(v_item->>'line_discount','')::numeric,0),
      nullif(v_item->>'discount_text',''),
      coalesce(nullif(v_item->>'line_total','')::numeric,0),
      v_unit_cost
    );

    -- منتج مركّب: يُخصم المخزون من مكوّناته (والفاتورة تحتفظ بسطر المركّب نفسه)
    if exists (select 1 from public.pos_composite_items where composite_code = (v_item->>'product_code')) then
      for v_comp in select component_code, qty as comp_qty from public.pos_composite_items where composite_code = (v_item->>'product_code') loop
        perform public.pos_adjust_stock_checked(
          v_location,
          v_comp.component_code,
          v_comp.component_code,
          -(v_qty * coalesce(v_comp.comp_qty,1)),
          'sale',
          'pos_sales',
          v_sale.id,
          'مكوّن منتج مركّب ' || coalesce(v_item->>'product_code','') || coalesce(' | المستخدم: '||p_user_identifier,'')
        );
      end loop;
    else
      perform public.pos_adjust_stock_checked(
        v_location,
        v_item->>'product_code',
        v_item->>'product_name',
        -v_qty,
        'sale',
        'pos_sales',
        v_sale.id,
        'فاتورة بيع' || coalesce(' | المستخدم: '||p_user_identifier,'')
      );
    end if;
  end loop;

  for v_payment in select * from jsonb_array_elements(coalesce(p_payments,'[]'::jsonb)) loop
    v_amount := (v_payment->>'amount')::numeric;
    v_payment_method := v_payment->>'payment_method';
    v_account := nullif(v_payment->>'account_id','')::uuid;

    insert into public.pos_sale_payments(sale_id, payment_date, payment_method, amount, notes)
    values (v_sale.id, v_sale_date, v_payment_method, v_amount, nullif(v_payment->>'notes',''));

    if v_account is not null then
      insert into public.pos_finance_movements(account_id, direction, movement_type, amount, movement_date, reference_table, reference_id, notes)
      values (v_account,'in','sale_payment',v_amount,v_sale_date,'pos_sales',v_sale.id,
        'تحصيل فاتورة بيع - فاتورة ' || coalesce(v_sale.invoice_no,'') || coalesce(' - المستخدم: '||p_user_identifier,''));
    end if;
  end loop;

  if v_balance_due > 0 then
    insert into public.pos_customer_ledger(customer_id, entry_date, entry_type, description, debit, credit, reference_table, reference_id)
    values (v_customer, v_sale_date, 'sale', 'فاتورة بيع رقم '||coalesce(v_sale.invoice_no,''), v_balance_due, 0, 'pos_sales', v_sale.id);
  end if;

  return to_jsonb(v_sale) || jsonb_build_object('idempotent_replay', false);
exception when unique_violation then
  if p_idempotency_key is not null and trim(p_idempotency_key) <> '' then
    select * into v_existing from public.pos_sales where idempotency_key = p_idempotency_key limit 1;
    if found then return to_jsonb(v_existing) || jsonb_build_object('idempotent_replay', true); end if;
  end if;
  raise;
end;
$$;

grant execute on function public.post_sale_transaction(jsonb,jsonb,jsonb,text,text) to authenticated;


-- ───────────────────────────────────────────────────────────────────
-- 2) السياسات المحدّثة (تستبدل سياسات phase1 على هذه الجداول)
-- ───────────────────────────────────────────────────────────────────

do $$
declare r record;
begin
  for r in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('pos_sales','pos_sale_items','pos_sale_payments',
                        'pos_finance_movements','pos_stock','pos_stock_movements',
                        'pos_customer_ledger')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- فواتير البيع: البائع يعدّل فواتيره فقط (created_by = معرّفه)
create policy pos_role_sales_read on public.pos_sales
  for select to authenticated
  using (public.pos_policy_role() in ('admin','accountant','sales_purchase','viewer')
         or location_id = public.pos_current_branch_id());

create policy pos_role_sales_write on public.pos_sales
  for all to authenticated
  using (public.pos_policy_role() in ('admin','sales_purchase')
         or (public.pos_policy_role() in ('seller_11','seller_sarraj')
             and created_by = public.pos_current_identifier()))
  with check (public.pos_policy_role() in ('admin','sales_purchase')
         or (public.pos_policy_role() in ('seller_11','seller_sarraj')
             and created_by = public.pos_current_identifier()));

-- بنود الفاتورة: تتبع ملكية الفاتورة
create policy pos_role_items_read on public.pos_sale_items
  for select to authenticated
  using (public.pos_policy_role() in ('admin','accountant','sales_purchase','viewer')
         or exists (select 1 from public.pos_sales s
                    where s.id = pos_sale_items.sale_id
                      and s.location_id = public.pos_current_branch_id()));

create policy pos_role_items_write on public.pos_sale_items
  for all to authenticated
  using (public.pos_policy_role() in ('admin','sales_purchase')
         or exists (select 1 from public.pos_sales s
                    where s.id = pos_sale_items.sale_id
                      and s.created_by = public.pos_current_identifier()
                      and s.location_id = public.pos_current_branch_id()))
  with check (public.pos_policy_role() in ('admin','sales_purchase')
         or exists (select 1 from public.pos_sales s
                    where s.id = pos_sale_items.sale_id
                      and s.created_by = public.pos_current_identifier()
                      and s.location_id = public.pos_current_branch_id()));

-- دفعات الفاتورة: نفس النمط
create policy pos_role_payread on public.pos_sale_payments
  for select to authenticated
  using (public.pos_policy_role() in ('admin','accountant','sales_purchase','viewer')
         or exists (select 1 from public.pos_sales s
                    where s.id = pos_sale_payments.sale_id
                      and s.location_id = public.pos_current_branch_id()));

create policy pos_role_paywrite on public.pos_sale_payments
  for all to authenticated
  using (public.pos_policy_role() in ('admin','sales_purchase')
         or exists (select 1 from public.pos_sales s
                    where s.id = pos_sale_payments.sale_id
                      and s.created_by = public.pos_current_identifier()
                      and s.location_id = public.pos_current_branch_id()))
  with check (public.pos_policy_role() in ('admin','sales_purchase')
         or exists (select 1 from public.pos_sales s
                    where s.id = pos_sale_payments.sale_id
                      and s.created_by = public.pos_current_identifier()
                      and s.location_id = public.pos_current_branch_id()));

-- الحركات المالية: حذف حركات فاتورته فقط للبائع
create policy pos_role_finmv_read on public.pos_finance_movements
  for select to authenticated
  using (public.pos_policy_role() in ('admin','accountant','seller_11','seller_sarraj','sales_purchase','viewer'));

create policy pos_role_finmv_insert on public.pos_finance_movements
  for insert to authenticated
  with check (public.pos_policy_role() in ('admin','accountant','seller_11','seller_sarraj','sales_purchase'));

create policy pos_role_finmv_update on public.pos_finance_movements
  for update to authenticated
  using (public.pos_policy_role() = 'admin')
  with check (public.pos_policy_role() = 'admin');

create policy pos_role_finmv_delete on public.pos_finance_movements
  for delete to authenticated
  using (public.pos_policy_role() = 'admin'
         or (public.pos_policy_role() in ('seller_11','seller_sarraj')
             and reference_table = 'pos_sales'
             and exists (select 1 from public.pos_sales s
                         where s.id = pos_finance_movements.reference_id
                           and s.created_by = public.pos_current_identifier())));

-- المخزون: البائع يعدّل مخزون فرعه فقط (لمسار تعديل فواتيره)
create policy pos_role_stock_read on public.pos_stock
  for select to authenticated using (true);

create policy pos_role_stock_write on public.pos_stock
  for all to authenticated
  using (public.pos_policy_role() in ('admin','sales_purchase')
         or (public.pos_policy_role() in ('seller_11','seller_sarraj')
             and location_id = public.pos_current_branch_id()))
  with check (public.pos_policy_role() in ('admin','sales_purchase')
         or (public.pos_policy_role() in ('seller_11','seller_sarraj')
             and location_id = public.pos_current_branch_id()));

-- حركات المخزون: حذف حركات فاتورته فقط للبائع
create policy pos_role_stkmv_read on public.pos_stock_movements
  for select to authenticated using (true);

create policy pos_role_stkmv_write on public.pos_stock_movements
  for all to authenticated
  using (public.pos_policy_role() in ('admin','sales_purchase')
         or (public.pos_policy_role() in ('seller_11','seller_sarraj')
             and reference_table = 'pos_sales'
             and exists (select 1 from public.pos_sales s
                         where s.id = pos_stock_movements.reference_id
                           and s.created_by = public.pos_current_identifier())))
  with check (public.pos_policy_role() in ('admin','sales_purchase')
         or (public.pos_policy_role() in ('seller_11','seller_sarraj')
             and reference_table = 'pos_sales'
             and exists (select 1 from public.pos_sales s
                         where s.id = pos_stock_movements.reference_id
                           and s.created_by = public.pos_current_identifier())));

-- قيود الزبائن: إضافة/حذف قيود فاتورته فقط للبائع
create policy pos_role_cledger_read on public.pos_customer_ledger
  for select to authenticated using (true);

create policy pos_role_cledger_insert on public.pos_customer_ledger
  for insert to authenticated
  with check (public.pos_policy_role() in ('admin','accountant','sales_purchase')
              or (public.pos_policy_role() in ('seller_11','seller_sarraj')
                  and reference_table = 'pos_sales'
                  and exists (select 1 from public.pos_sales s
                              where s.id = pos_customer_ledger.reference_id
                                and s.created_by = public.pos_current_identifier())));

create policy pos_role_cledger_delete on public.pos_customer_ledger
  for delete to authenticated
  using (public.pos_policy_role() in ('admin','sales_purchase')
         or (public.pos_policy_role() in ('seller_11','seller_sarraj')
             and reference_table = 'pos_sales'
             and exists (select 1 from public.pos_sales s
                         where s.id = pos_customer_ledger.reference_id
                           and s.created_by = public.pos_current_identifier())));

commit;


-- ═══════════════════════════════════════════════════════════════════
-- التحقّق — شغّله بعد التنفيذ
-- ═══════════════════════════════════════════════════════════════════

-- (أ) العمود الجديد + الفواتير المسجّلة بمنشئها
select count(*) filter (where created_by is not null) as with_creator,
       count(*) as total
from pos_sales;

-- (ب) السياسات المحدّثة
select tablename, policyname, cmd from pg_policies
where schemaname='public' and tablename in ('pos_sales','pos_sale_items','pos_sale_payments')
order by tablename, policyname;

-- ═══════════════════════════════════════════════════════════════════
-- اختبارات القبول
-- ═══════════════════════════════════════════════════════════════════
-- 1) بائع يسجّل فاتورة جديدة ⇒ تُخزَّن باسمه (created_by = معرّفه)
-- 2) البائع يعدّل فاتورته ⇒ تنجح، ويظهر في سجل التدقيق (sale_edit)
-- 3) البائع يحاول تعديل فاتورة زميله/فرع آخر ⇒ مرفوض من الواجهة
--    (وفحص سلبي: PATCH بمفتاحه على فاتورة غيره ⇒ 42501)
-- 4) المدير يدخل بعدها ⇒ إشعار: "N تعديل فاتورة بواسطة: فلان"
-- 5) المدير يفتح سجل التدقيق ⇒ يرى تفاصيل كل تعديل
