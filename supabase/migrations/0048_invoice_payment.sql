-- ═══ 0048 — سداد دفعة على فاتورة قائمة (ذرّي) + تدقيق
-- المصدر: apps/pos/benamor-sales-system/supabase-pos-invoice-payment.sql

-- ═══════════════════════════════════════════════════════════════════
-- Benamor POS — سداد دفعة على فاتورة قائمة (ذرّي) + تدقيق البيانات القائمة
--
-- المشكلة التي يعالجها: «دفعة زبون» تضيف credit في كشف الحساب بلا ربط
-- بالفاتورة، وbalance_due في pos_sales لا يُحدَّث أبداً ⇒ الفواتير تُظهر
-- مستحقات محصّلة فعلاً وإجمالي الديون المعروض منتفخ.
--
-- post_invoice_payment تفعل في معاملة واحدة:
--   صفوف pos_sale_payments + تحديث paid_amount/balance_due في pos_sales
--   + حركة مالية داخلية لكل طريقة دفع + قيد credit في كشف الزبون مربوط
--   بالفاتورة + قيد في سجل التدقيق — على نمط post_sale_transaction
--   وبمفتاح idempotency (عمود جديد في pos_sale_payments).
--
-- المخطّط المؤكد من قاعدة الإنتاج (استخراج 2026-09-14):
--   pos_sales: id, invoice_no, sale_date, location_id, customer_id,
--     payment_method, subtotal, discount, total, paid_amount, balance_due,
--     status, notes, created_at, updated_at, idempotency_key, created_by
--   pos_sale_payments: id, sale_id, payment_date, payment_method, amount,
--     notes, created_at  (+ idempotency_key الجديد أدناه)
--
-- شغّله في Supabase SQL Editor (دفعة واحدة). لا يصلح أي بيانات قائمة —
-- استعلامات التدقيق آخر الملف تعرض لك الحالة فقط والقرار قرارك.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- 1) عمود مفتاح idempotency للدفعات (لا يوجد أصلاً — مؤكد من الاستخراج الحي)
alter table public.pos_sale_payments
  add column if not exists idempotency_key text;

create unique index if not exists pos_sale_payments_idempotency_key_uidx
  on public.pos_sale_payments(idempotency_key)
  where idempotency_key is not null and trim(idempotency_key) <> '';

-- 2) الدالة الذرّية
create or replace function public.post_invoice_payment(
  p_sale_id uuid,
  p_payments jsonb,
  p_payment_date date default current_date,
  p_notes text default null,
  p_idempotency_key text default null,
  p_user_identifier text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.pos_sales%rowtype;
  v_payment jsonb;
  v_amount numeric;
  v_method text;
  v_account uuid;
  v_total numeric := 0;
  v_new_paid numeric;
  v_new_balance numeric;
  v_inv text;
  v_key text := nullif(trim(coalesce(p_idempotency_key,'')),'');
  v_first boolean := true;
  v_has boolean;
begin
  -- إعادة تشغيل آمنة بنفس المفتاح ⇒ لا ازدواج
  if v_key is not null then
    select exists(select 1 from public.pos_sale_payments
                  where idempotency_key = v_key limit 1) into v_has;
    if v_has then
      select * into v_sale from public.pos_sales where id = p_sale_id;
      return to_jsonb(v_sale) || jsonb_build_object('idempotent_replay', true);
    end if;
  end if;

  select * into v_sale from public.pos_sales where id = p_sale_id for update;
  if not found then raise exception 'SALE_NOT_FOUND'; end if;
  if v_sale.status <> 'posted' then raise exception 'SALE_NOT_POSTED'; end if;
  perform public.pos_assert_role(array['admin','seller_11','seller_sarraj','sales_purchase','accountant']);
  perform public.pos_assert_location_allowed(v_sale.location_id);
  if coalesce(v_sale.balance_due,0) <= 0 then raise exception 'INVOICE_ALREADY_PAID'; end if;

  -- فحص الدفعات: مبلغ موجب، طريقة صحيحة، حساب مالي لكل طريقة
  if jsonb_typeof(coalesce(p_payments,'[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_payments,'[]'::jsonb)) = 0 then
    raise exception 'PAYMENT_HAS_NO_ROWS';
  end if;
  for v_payment in select * from jsonb_array_elements(p_payments) loop
    v_amount := coalesce(nullif(v_payment->>'amount','')::numeric, 0);
    v_method := v_payment->>'payment_method';
    v_account := nullif(v_payment->>'account_id','')::uuid;
    if v_amount <= 0 then raise exception 'PAYMENT_AMOUNT_MUST_BE_POSITIVE'; end if;
    if v_method not in ('cash','bank_transfer','card') then
      raise exception 'INVALID_PAYMENT_METHOD: %', v_method;
    end if;
    if v_account is null then
      raise exception 'FINANCE_ACCOUNT_REQUIRED_FOR_PAYMENT_METHOD: %', v_method;
    end if;
    v_total := v_total + v_amount;
  end loop;
  if v_total > v_sale.balance_due then
    raise exception 'OVERPAYMENT_NOT_ALLOWED: المتبقي على الفاتورة % والمطلوب تسجيله %',
      v_sale.balance_due, v_total;
  end if;

  v_new_paid := coalesce(v_sale.paid_amount,0) + v_total;
  v_new_balance := greatest(0, coalesce(v_sale.total,0) - v_new_paid);

  update public.pos_sales
  set paid_amount = v_new_paid,
      balance_due = v_new_balance,
      updated_at = now()
  where id = p_sale_id
  returning * into v_sale;
  v_inv := coalesce(v_sale.invoice_no,'');

  -- صفوف الدفع + الحركات المالية + قيد الكشف + التدقيق — كلها في نفس المعاملة
  for v_payment in select * from jsonb_array_elements(p_payments) loop
    v_amount := (v_payment->>'amount')::numeric;
    v_method := v_payment->>'payment_method';
    v_account := nullif(v_payment->>'account_id','')::uuid;

    insert into public.pos_sale_payments(sale_id, payment_date, payment_method, amount, notes, idempotency_key)
    values (p_sale_id, coalesce(p_payment_date, current_date), v_method, v_amount, nullif(p_notes,''),
            case when v_first then v_key end); -- المفتاح على أول صف فقط (علامة الدفعة)
    v_first := false;

    insert into public.pos_finance_movements(account_id, direction, movement_type, amount, movement_date, reference_table, reference_id, notes)
    values (v_account, 'in', 'sale_payment', v_amount, coalesce(p_payment_date, current_date), 'pos_sales', p_sale_id,
            'تحصيل دفعة على فاتورة ' || v_inv || coalesce(' | المستخدم: ' || p_user_identifier, ''));
  end loop;

  if v_sale.customer_id is not null then
    insert into public.pos_customer_ledger(customer_id, entry_date, entry_type, description, debit, credit, reference_table, reference_id)
    values (v_sale.customer_id, coalesce(p_payment_date, current_date), 'payment',
            'دفعة على فاتورة رقم ' || v_inv, 0, v_total, 'pos_sales', p_sale_id);
  end if;

  insert into public.pos_audit_log(user_identifier, action, entity_type, entity_id, details, branch_id)
  values (nullif(p_user_identifier,''), 'invoice_payment', 'pos_sales', p_sale_id::text,
          'تحصيل ' || v_total || ' على فاتورة ' || v_inv || ' — المتبقي ' || v_new_balance,
          v_sale.location_id);

  return to_jsonb(v_sale) || jsonb_build_object('idempotent_replay', false);
exception when unique_violation then
  if v_key is not null then
    select * into v_sale from public.pos_sales where id = p_sale_id;
    if found then return to_jsonb(v_sale) || jsonb_build_object('idempotent_replay', true); end if;
  end if;
  raise;
end;
$$;

revoke all on function public.post_invoice_payment(uuid,jsonb,date,text,text,text) from anon, public;
grant execute on function public.post_invoice_payment(uuid,jsonb,date,text,text,text) to authenticated;

commit;

-- ═══════════════════════════════════════════════════════════════════
-- استعلامات التدقيق — قراءة فقط، لا تُصلح شيئاً. نفّذها بعد الملف
-- (أو منفصلة) واعرض النتيجة على المدير ليقرّر.
-- ═══════════════════════════════════════════════════════════════════

-- (١) فواتير مستحقة عليها قيود سداد مربوطة بها مباشرة
--     (دفعات سُجلت على الفاتورة لكن balance_due لم يُحدَّث)
select s.id, s.invoice_no, s.sale_date, c.name as customer,
       s.total, s.paid_amount, s.balance_due,
       coalesce((select sum(l.credit) from public.pos_customer_ledger l
                 where l.reference_table='pos_sales' and l.reference_id=s.id
                   and l.entry_type='payment'),0) as ledger_credits_on_invoice,
       coalesce((select sum(p.amount) from public.pos_sale_payments p
                 where p.sale_id=s.id),0) as payments_rows_total
from public.pos_sales s
left join public.pos_customers c on c.id=s.customer_id
where s.balance_due > 0
  and exists (select 1 from public.pos_customer_ledger l
              where l.reference_table='pos_sales' and l.reference_id=s.id
                and l.entry_type='payment' and l.credit > 0)
order by s.sale_date desc;

-- (٢) زبائن رصيدهم في كشف الحساب ≠ مجموع مستحقات فواتيرهم المفتوحة
--     (يشير إلى دفعات عامة سددت الدين فعلاً بينما الفواتير تبقى «مستحقة»)
select c.id, c.name, c.phone,
       cb.balance as ledger_balance,
       coalesce((select sum(s.balance_due) from public.pos_sales s
                 where s.customer_id=c.id and s.balance_due > 0),0) as open_invoices_due,
       cb.balance - coalesce((select sum(s.balance_due) from public.pos_sales s
                 where s.customer_id=c.id and s.balance_due > 0),0) as mismatch
from public.pos_customer_balances cb
join public.pos_customers c on c.id=cb.id
where cb.balance <> coalesce((select sum(s.balance_due) from public.pos_sales s
                 where s.customer_id=c.id and s.balance_due > 0),0)
order by abs(cb.balance - coalesce((select sum(s.balance_due) from public.pos_sales s
                 where s.customer_id=c.id and s.balance_due > 0),0)) desc;
