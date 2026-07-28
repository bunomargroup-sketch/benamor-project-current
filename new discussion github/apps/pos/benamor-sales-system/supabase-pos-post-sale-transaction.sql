-- Benamor POS - Atomic sale/refund transaction RPC
-- Run once in Supabase SQL Editor.
-- Saves sale header, items, payments, finance movements, customer ledger and stock mutations in ONE DB transaction.

begin;

-- Required columns / constraints for safe idempotent posting
alter table if exists public.pos_sales
  add column if not exists idempotency_key text;

create unique index if not exists pos_sales_idempotency_key_uidx
on public.pos_sales(idempotency_key)
where idempotency_key is not null and trim(idempotency_key) <> '';

-- Sale item discount fields used by the POS
alter table if exists public.pos_sale_items
  add column if not exists line_discount numeric not null default 0,
  add column if not exists discount_text text;

-- Allow return lines in sale invoices; zero remains invalid
alter table if exists public.pos_sale_items
  drop constraint if exists pos_sale_items_qty_check;

alter table if exists public.pos_sale_items
  add constraint pos_sale_items_qty_check check (qty <> 0);

-- Finance movement type must include customer_refund
alter table if exists public.pos_finance_movements
  drop constraint if exists pos_finance_movements_movement_type_check;

alter table if exists public.pos_finance_movements
  add constraint pos_finance_movements_movement_type_check
  check (movement_type in (
    'opening','sale_payment','supplier_payment','customer_payment',
    'transfer_in','transfer_out','expense','salary','adjustment','customer_refund'
  ));

-- Atomic checked stock mutation helper, included here so this file is self-contained.
create or replace function public.pos_adjust_stock_checked(
  p_location_id uuid,
  p_product_code text,
  p_product_name text,
  p_qty_change numeric,
  p_movement_type text,
  p_reference_table text,
  p_reference_id uuid,
  p_notes text default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_qty numeric;
  v_new_qty numeric;
begin
  if p_location_id is null then raise exception 'LOCATION_REQUIRED'; end if;
  if p_product_code is null or trim(p_product_code) = '' then raise exception 'PRODUCT_CODE_REQUIRED'; end if;
  if p_qty_change is null or p_qty_change = 0 then raise exception 'QTY_CHANGE_REQUIRED'; end if;

  select id, qty into v_id, v_qty
  from public.pos_stock
  where location_id = p_location_id and lower(product_code) = lower(p_product_code)
  for update;

  if v_id is null then
    if p_qty_change < 0 then
      raise exception 'INSUFFICIENT_STOCK: % available 0 requested %', p_product_code, abs(p_qty_change);
    end if;
    insert into public.pos_stock(location_id, product_code, product_name, qty, updated_at)
    values (p_location_id, p_product_code, p_product_name, p_qty_change, now())
    returning qty into v_new_qty;
  else
    v_new_qty := coalesce(v_qty,0) + p_qty_change;
    if v_new_qty < 0 then
      raise exception 'INSUFFICIENT_STOCK: % available % requested %', p_product_code, v_qty, abs(p_qty_change);
    end if;
    update public.pos_stock
      set qty = v_new_qty,
          product_name = coalesce(p_product_name, product_name),
          updated_at = now()
    where id = v_id;
  end if;

  insert into public.pos_stock_movements(location_id, product_code, product_name, movement_type, qty_change, reference_table, reference_id, notes)
  values (p_location_id, p_product_code, p_product_name, p_movement_type, p_qty_change, p_reference_table, p_reference_id, p_notes);

  return v_new_qty;
end;
$$;

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

grant execute on function public.post_sale_transaction(jsonb,jsonb,jsonb,text,text) to authenticated;

commit;
