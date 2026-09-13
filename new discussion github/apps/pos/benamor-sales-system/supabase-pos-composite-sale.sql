-- ===================================================================
-- Benamor POS — المنتجات المركّبة في فواتير البيع (سطر واحد + خصم المكوّنات)
--
-- ماذا يتغير؟
--   • فاتورة البيع تحتفظ بسطر المنتج المركّب نفسه (وليس مكوّناته)
--   • خصم المخزون يتم من المكوّنات تلقائياً عند حفظ الفاتورة
--   • مرتجع الزبون يرجع الكميات إلى المكوّنات تلقائياً
--   • الفواتير القديمة (المحفوظة بمكوّناتها) تبقى تعمل كما هي
--
-- هذا الملف يعيد تعريف:
--   post_sale_transaction        (خصم مكوّنات المركّب)
--   post_sale_return_transaction (إرجاع مكوّنات المركّب)
--
-- ⚠️ شغّله في Supabase SQL Editor
-- ⚠️ شغّله بعد supabase-pos-allow-negative-stock.sql إن كنت تستعمله
-- ===================================================================

begin;

-- جدول المكوّنات (إن لم يكن موجوداً)
create table if not exists public.pos_composite_items (
  id uuid primary key default gen_random_uuid(),
  composite_code text not null,
  component_code text not null,
  component_name text,
  qty numeric not null default 1,
  created_at timestamptz not null default now()
);

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
    if v_qty = 0 then raise exception 'ITEM_QTY_CANNOT_BE_ZERO'; end if;
    if coalesce(nullif(v_item->>'unit_price','')::numeric, 0) < 0 then raise exception 'NEGATIVE_PRICE_NOT_ALLOWED'; end if;
    v_line_total := coalesce(nullif(v_item->>'line_total','')::numeric, 0);
    v_subtotal := v_subtotal + v_line_total;
  end loop;

  v_total := v_subtotal - v_discount;
  if v_total > 0 and v_customer is null and coalesce(nullif(p_sale->>'balance_due','')::numeric,0) > 0 then
    raise exception 'CUSTOMER_REQUIRED_FOR_CREDIT_SALE';
  end if;

  -- Validate and total payments
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

  if v_total < 0 and v_paid_abs <> abs(v_total) then
    raise exception 'REFUND_AMOUNT_MUST_EQUAL_NEGATIVE_TOTAL: expected %, got %', abs(v_total), v_paid_abs;
  end if;
  if v_total >= 0 and v_paid_abs > v_total then
    raise exception 'PAID_AMOUNT_EXCEEDS_TOTAL';
  end if;

  v_paid_signed := case when v_total < 0 then -v_paid_abs else v_paid_abs end;
  v_balance_due := case when v_total > 0 then greatest(0, v_total - v_paid_abs) else 0 end;
  v_method := case
    when v_balance_due > 0 then 'credit'
    when jsonb_array_length(coalesce(p_payments,'[]'::jsonb)) > 1 then 'mixed'
    when jsonb_array_length(coalesce(p_payments,'[]'::jsonb)) = 1 then (p_payments->0->>'payment_method')
    else coalesce(nullif(p_sale->>'payment_method',''),'cash')
  end;

  insert into public.pos_sales(
    invoice_no, sale_date, location_id, customer_id, payment_method,
    subtotal, discount, total, paid_amount, balance_due, status, notes, idempotency_key
  ) values (
    nullif(p_sale->>'invoice_no',''), v_sale_date, v_location, v_customer, v_method,
    v_subtotal, v_discount, v_total, v_paid_signed, v_balance_due, 'posted', nullif(p_sale->>'notes',''), nullif(p_idempotency_key,'')
  ) returning * into v_sale;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'qty')::numeric;
    insert into public.pos_sale_items(sale_id, product_code, product_name, qty, unit_price, line_discount, discount_text, line_total)
    values (
      v_sale.id,
      v_item->>'product_code',
      v_item->>'product_name',
      v_qty,
      coalesce(nullif(v_item->>'unit_price','')::numeric,0),
      coalesce(nullif(v_item->>'line_discount','')::numeric,0),
      nullif(v_item->>'discount_text',''),
      coalesce(nullif(v_item->>'line_total','')::numeric,0)
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
        case when v_qty < 0 then 'مرتجع داخل فاتورة بيع' else 'فاتورة بيع' end || coalesce(' | المستخدم: '||p_user_identifier,'')
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
      values (
        v_account,
        case when v_total < 0 then 'out' else 'in' end,
        case when v_total < 0 then 'customer_refund' else 'sale_payment' end,
        v_amount,
        v_sale_date,
        'pos_sales',
        v_sale.id,
        case when v_total < 0 then 'Customer Refund / استرداد للزبون' else 'تحصيل فاتورة بيع' end || ' - فاتورة ' || coalesce(v_sale.invoice_no,'') || coalesce(' - المستخدم: '||p_user_identifier,'')
      );
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

create or replace function public.post_sale_return_transaction(
  p_return jsonb,
  p_items jsonb,
  p_idempotency_key text default null,
  p_user_identifier text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.pos_sale_returns%rowtype;
  v_return public.pos_sale_returns%rowtype;
  v_sale public.pos_sales%rowtype;
  v_item jsonb;
  v_sale_item public.pos_sale_items%rowtype;
  v_return_date date;
  v_location uuid;
  v_customer uuid;
  v_method text;
  v_account uuid;
  v_total numeric := 0;
  v_qty numeric;
  v_already_returned numeric;
  v_base numeric;
  v_line_discount numeric;
  v_line_total numeric;
  v_has_items boolean;
  v_comp record;
begin
  if p_idempotency_key is not null and trim(p_idempotency_key) <> '' then
    select * into v_existing from public.pos_sale_returns where idempotency_key = p_idempotency_key limit 1;
    if found then
      return to_jsonb(v_existing) || jsonb_build_object('idempotent_replay', true);
    end if;
  end if;

  select * into v_sale
  from public.pos_sales
  where id = nullif(p_return->>'sale_id','')::uuid
  for update;

  if not found then raise exception 'ORIGINAL_SALE_NOT_FOUND'; end if;

  v_return_date := coalesce(nullif(p_return->>'return_date','')::date, current_date);
  v_location := coalesce(nullif(p_return->>'location_id','')::uuid, v_sale.location_id);
  v_customer := coalesce(nullif(p_return->>'customer_id','')::uuid, v_sale.customer_id);
  v_method := coalesce(nullif(p_return->>'refund_method',''), 'cash');
  v_account := nullif(p_return->>'account_id','')::uuid;

  perform public.pos_assert_role(array['admin','seller_11','seller_sarraj','sales_purchase']);
  perform public.pos_assert_location_allowed(v_location);

  if v_method not in ('cash','bank_transfer','card','credit_reduction','none') then
    raise exception 'INVALID_REFUND_METHOD';
  end if;
  if v_method in ('cash','bank_transfer','card') and v_account is null then
    raise exception 'REFUND_ACCOUNT_REQUIRED';
  end if;
  if v_method = 'credit_reduction' and v_customer is null then
    raise exception 'CUSTOMER_REQUIRED_FOR_CREDIT_REDUCTION';
  end if;

  v_has_items := jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0;
  if not v_has_items then raise exception 'RETURN_HAS_NO_ITEMS'; end if;

  -- Validate all items and calculate total before writing.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce(nullif(v_item->>'qty','')::numeric, 0);
    if v_qty <= 0 then raise exception 'RETURN_QTY_MUST_BE_POSITIVE'; end if;

    select * into v_sale_item
    from public.pos_sale_items
    where id = nullif(v_item->>'sale_item_id','')::uuid
    for update;

    if not found then raise exception 'ORIGINAL_SALE_ITEM_NOT_FOUND'; end if;
    if v_sale_item.sale_id <> v_sale.id then raise exception 'RETURN_ITEM_DOES_NOT_BELONG_TO_SALE'; end if;
    if v_sale_item.qty <= 0 then raise exception 'CANNOT_RETURN_A_RETURN_LINE'; end if;

    select coalesce(sum(ri.qty),0) into v_already_returned
    from public.pos_sale_return_items ri
    join public.pos_sale_returns r on r.id = ri.return_id
    where ri.sale_item_id = v_sale_item.id;

    if v_already_returned + v_qty > v_sale_item.qty then
      raise exception 'RETURN_QTY_EXCEEDS_SOLD_QTY: product %, sold %, already returned %, requested %',
        v_sale_item.product_code, v_sale_item.qty, v_already_returned, v_qty;
    end if;

    v_base := v_qty * v_sale_item.unit_price;
    v_line_discount := least(v_base, coalesce(v_sale_item.line_discount,0) / nullif(v_sale_item.qty,0) * v_qty);
    v_line_total := greatest(0, v_base - coalesce(v_line_discount,0));
    v_total := v_total + v_line_total;
  end loop;

  if v_total <= 0 then raise exception 'RETURN_TOTAL_MUST_BE_POSITIVE'; end if;

  insert into public.pos_sale_returns(sale_id, return_date, location_id, customer_id, total, refund_method, notes, idempotency_key)
  values (v_sale.id, v_return_date, v_location, v_customer, v_total, v_method, nullif(p_return->>'notes',''), nullif(p_idempotency_key,''))
  returning * into v_return;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'qty')::numeric;

    select * into v_sale_item
    from public.pos_sale_items
    where id = nullif(v_item->>'sale_item_id','')::uuid
    for update;

    v_base := v_qty * v_sale_item.unit_price;
    v_line_discount := least(v_base, coalesce(v_sale_item.line_discount,0) / nullif(v_sale_item.qty,0) * v_qty);
    v_line_total := greatest(0, v_base - coalesce(v_line_discount,0));

    insert into public.pos_sale_return_items(return_id, sale_item_id, product_code, product_name, qty, unit_price, line_discount, line_total)
    values (v_return.id, v_sale_item.id, v_sale_item.product_code, v_sale_item.product_name, v_qty, v_sale_item.unit_price, coalesce(v_line_discount,0), v_line_total);

    -- منتج مركّب: يُرجع المخزون إلى مكوّناته وليس لسطر المركّب نفسه
    if exists (select 1 from public.pos_composite_items where composite_code = v_sale_item.product_code) then
      for v_comp in select component_code, qty as comp_qty from public.pos_composite_items where composite_code = v_sale_item.product_code loop
        perform public.pos_adjust_stock_checked(
          v_location,
          v_comp.component_code,
          v_comp.component_code,
          v_qty * coalesce(v_comp.comp_qty,1),
          'return_customer',
          'pos_sale_returns',
          v_return.id,
          'مكوّن منتج مركّب (مرتجع) ' || coalesce(v_sale_item.product_code,'') || coalesce(' | المستخدم: '||p_user_identifier,'')
        );
      end loop;
    else
      perform public.pos_adjust_stock_checked(
        v_location,
        v_sale_item.product_code,
        v_sale_item.product_name,
        v_qty,
        'return_customer',
        'pos_sale_returns',
        v_return.id,
        'مرتجع زبون' || coalesce(' | المستخدم: '||p_user_identifier,'')
      );
    end if;
  end loop;

  if v_method = 'credit_reduction' then
    insert into public.pos_customer_ledger(customer_id, entry_date, entry_type, description, debit, credit, reference_table, reference_id)
    values (v_customer, v_return_date, 'return', 'فاتورة مرتجع بيع رقم '||coalesce(v_sale.invoice_no,''), 0, v_total, 'pos_sale_returns', v_return.id);
  elsif v_method in ('cash','bank_transfer','card') then
    insert into public.pos_finance_movements(account_id, direction, movement_type, amount, movement_date, reference_table, reference_id, notes)
    values (v_account, 'out', 'customer_refund', v_total, v_return_date, 'pos_sale_returns', v_return.id,
            'Customer Refund / استرداد للزبون - مرتجع فاتورة '||coalesce(v_sale.invoice_no,'')||coalesce(' - المستخدم: '||p_user_identifier,''));
  end if;

  return to_jsonb(v_return) || jsonb_build_object('idempotent_replay', false);
exception when unique_violation then
  if p_idempotency_key is not null and trim(p_idempotency_key) <> '' then
    select * into v_existing from public.pos_sale_returns where idempotency_key = p_idempotency_key limit 1;
    if found then return to_jsonb(v_existing) || jsonb_build_object('idempotent_replay', true); end if;
  end if;
  raise;
end;
$$;

grant execute on function public.post_sale_transaction(jsonb,jsonb,jsonb,text,text) to authenticated;
grant execute on function public.post_sale_return_transaction(jsonb,jsonb,text,text) to authenticated;

commit;

-- ============================================================
-- التحقق بعد التشغيل:
--   select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--   where n.nspname='public' and proname in ('post_sale_transaction','post_sale_return_transaction');
--
-- اختبار فعلي: أضف منتجاً مركّباً لفاتورة (سيظهر كسطر واحد) → احفظ
-- → شاشة المخزون: كميات المكوّنات نقصت (وليس سطر المركّب)
-- ============================================================
