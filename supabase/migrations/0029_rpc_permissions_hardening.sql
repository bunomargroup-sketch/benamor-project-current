-- ═══ 0029 — فحوص الدور داخل كل معاملات RPC
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-phase1-rpc-permissions-hardening.sql
-- الترتيب داخل supabase/migrations هو ترتيب التنفيذ المعتمد لقاعدة فارغة

-- Benamor POS - Phase 1 RPC permissions/branch + strict finance hardening
-- Run in Supabase SQL Editor after Phase 1 RPC files, or use this as a combined redefinition patch.



-- ===== supabase-pos-rpc-permission-helpers.sql =====
-- begin removed for combined file
-- Benamor POS - RPC permissions and branch enforcement helpers
-- Run before/redefine transactional RPCs.

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
  where lower(identifier)=v_identifier and coalesce(active,true)=true
  limit 1;
  if v_role is null then
    raise exception 'ROLE_NOT_ASSIGNED: %', v_identifier;
  end if;
  return v_role;
end;
$$;

create or replace function public.pos_assert_role(p_allowed text[])
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.pos_current_role();
begin
  if not (v_role = any(p_allowed)) then
    raise exception 'ROLE_NOT_ALLOWED: %', v_role;
  end if;
  return v_role;
end;
$$;

create or replace function public.pos_assert_location_allowed(p_location_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.pos_current_role();
  v_name text;
begin
  if p_location_id is null then raise exception 'LOCATION_REQUIRED'; end if;
  if v_role in ('admin','warehouse','accountant') then return; end if;
  select name into v_name from public.pos_locations where id=p_location_id;
  if v_role='seller_11' and v_name='فرع 11 يونيو' then return; end if;
  if v_role='seller_sarraj' and v_name='فرع السراج' then return; end if;
  raise exception 'LOCATION_NOT_ALLOWED_FOR_ROLE: %', v_role;
end;
$$;

grant execute on function public.pos_current_identifier() to authenticated;
grant execute on function public.pos_current_role() to authenticated;
grant execute on function public.pos_assert_role(text[]) to authenticated;
grant execute on function public.pos_assert_location_allowed(uuid) to authenticated;

-- commit removed for combined file


-- ===== supabase-pos-post-sale-transaction.sql =====
-- Benamor POS - Atomic sale/refund transaction RPC
-- Run once in Supabase SQL Editor.
-- Saves sale header, items, payments, finance movements, customer ledger and stock mutations in ONE DB transaction.

-- begin removed for combined file

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

-- commit removed for combined file


-- ===== supabase-pos-post-purchase-transaction.sql =====
-- Benamor POS - Atomic purchase transaction RPC
-- Run once in Supabase SQL Editor.
-- Saves purchase header, items, stock increases, stock movements, supplier ledger, supplier payment and finance movement in ONE DB transaction.

-- begin removed for combined file

alter table if exists public.pos_purchases
  add column if not exists idempotency_key text;

create unique index if not exists pos_purchases_idempotency_key_uidx
on public.pos_purchases(idempotency_key)
where idempotency_key is not null and trim(idempotency_key) <> '';

-- Atomic checked stock mutation helper, included here so the file can be run alone.
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

create or replace function public.post_purchase_transaction(
  p_purchase jsonb,
  p_items jsonb,
  p_payment jsonb default '{}'::jsonb,
  p_idempotency_key text default null,
  p_user_identifier text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.pos_purchases%rowtype;
  v_purchase public.pos_purchases%rowtype;
  v_item jsonb;
  v_supplier uuid;
  v_location uuid;
  v_purchase_date date;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_payment_method text := 'cash';
  v_payment_account uuid;
  v_line_total numeric;
  v_qty numeric;
  v_unit_cost numeric;
  v_has_items boolean;
begin
  if p_idempotency_key is not null and trim(p_idempotency_key) <> '' then
    select * into v_existing from public.pos_purchases where idempotency_key = p_idempotency_key limit 1;
    if found then
      return to_jsonb(v_existing) || jsonb_build_object('idempotent_replay', true);
    end if;
  end if;

  v_has_items := jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0;
  if not v_has_items then raise exception 'PURCHASE_HAS_NO_ITEMS'; end if;

  v_supplier := nullif(p_purchase->>'supplier_id','')::uuid;
  v_location := nullif(p_purchase->>'location_id','')::uuid;
  if v_supplier is null then raise exception 'SUPPLIER_REQUIRED'; end if;
  if v_location is null then raise exception 'LOCATION_REQUIRED'; end if;
  perform public.pos_assert_role(array['admin','warehouse']);
  perform public.pos_assert_location_allowed(v_location);

  v_purchase_date := coalesce(nullif(p_purchase->>'purchase_date','')::date, current_date);
  v_discount := coalesce(nullif(p_purchase->>'discount','')::numeric, 0);
  if v_discount < 0 then raise exception 'NEGATIVE_DISCOUNT_NOT_ALLOWED'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce(nullif(v_item->>'qty','')::numeric, 0);
    v_unit_cost := coalesce(nullif(v_item->>'unit_cost','')::numeric, 0);
    if v_qty <= 0 then raise exception 'PURCHASE_QTY_MUST_BE_POSITIVE'; end if;
    if v_unit_cost < 0 then raise exception 'NEGATIVE_UNIT_COST_NOT_ALLOWED'; end if;
    v_line_total := coalesce(nullif(v_item->>'line_total','')::numeric, v_qty * v_unit_cost);
    v_subtotal := v_subtotal + v_line_total;
  end loop;

  if v_discount > v_subtotal then raise exception 'DISCOUNT_EXCEEDS_SUBTOTAL'; end if;
  v_total := v_subtotal - v_discount;

  v_paid := coalesce(nullif(p_payment->>'amount','')::numeric, coalesce(nullif(p_purchase->>'paid_amount','')::numeric, 0));
  v_payment_method := coalesce(nullif(p_payment->>'payment_method',''), 'cash');
  v_payment_account := nullif(p_payment->>'account_id','')::uuid;

  if v_paid < 0 then raise exception 'NEGATIVE_PAYMENT_NOT_ALLOWED'; end if;
  if v_paid > v_total then raise exception 'PURCHASE_PAID_EXCEEDS_TOTAL'; end if;
  if v_paid > 0 and v_payment_method not in ('cash','bank_transfer','card') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
  if v_paid > 0 and v_payment_account is null then
    raise exception 'FINANCE_ACCOUNT_REQUIRED_FOR_PURCHASE_PAYMENT';
  end if;

  insert into public.pos_purchases(
    supplier_id, location_id, invoice_no, purchase_date,
    subtotal, discount, total, paid_amount, status, notes, idempotency_key
  ) values (
    v_supplier,
    v_location,
    nullif(p_purchase->>'invoice_no',''),
    v_purchase_date,
    v_subtotal,
    v_discount,
    v_total,
    v_paid,
    'posted',
    nullif(p_purchase->>'notes',''),
    nullif(p_idempotency_key,'')
  ) returning * into v_purchase;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'qty')::numeric;
    v_unit_cost := coalesce(nullif(v_item->>'unit_cost','')::numeric,0);
    v_line_total := coalesce(nullif(v_item->>'line_total','')::numeric, v_qty * v_unit_cost);

    insert into public.pos_purchase_items(purchase_id, product_code, product_name, qty, unit_cost, line_total)
    values (v_purchase.id, v_item->>'product_code', v_item->>'product_name', v_qty, v_unit_cost, v_line_total);

    perform public.pos_adjust_stock_checked(
      v_location,
      v_item->>'product_code',
      v_item->>'product_name',
      v_qty,
      'purchase',
      'pos_purchases',
      v_purchase.id,
      'فاتورة شراء' || coalesce(' | المستخدم: '||p_user_identifier,'')
    );
  end loop;

  if v_total > 0 then
    insert into public.pos_supplier_ledger(supplier_id, entry_date, entry_type, description, debit, credit, reference_table, reference_id)
    values (v_supplier, v_purchase_date, 'purchase', 'فاتورة شراء رقم '||coalesce(v_purchase.invoice_no,''), 0, v_total, 'pos_purchases', v_purchase.id);
  end if;

  if v_paid > 0 then
    insert into public.pos_supplier_ledger(supplier_id, entry_date, entry_type, description, debit, credit, reference_table, reference_id)
    values (v_supplier, v_purchase_date, 'payment', 'دفعة على فاتورة شراء', v_paid, 0, 'pos_purchases', v_purchase.id);

    if v_payment_account is not null then
      insert into public.pos_finance_movements(account_id, direction, movement_type, amount, movement_date, reference_table, reference_id, notes)
      values (v_payment_account, 'out', 'supplier_payment', v_paid, v_purchase_date, 'pos_purchases', v_purchase.id,
              'دفع فاتورة شراء '||coalesce(v_purchase.invoice_no,'')||coalesce(' - المستخدم: '||p_user_identifier,''));
    end if;
  end if;

  return to_jsonb(v_purchase) || jsonb_build_object('idempotent_replay', false);
exception when unique_violation then
  if p_idempotency_key is not null and trim(p_idempotency_key) <> '' then
    select * into v_existing from public.pos_purchases where idempotency_key = p_idempotency_key limit 1;
    if found then return to_jsonb(v_existing) || jsonb_build_object('idempotent_replay', true); end if;
  end if;
  raise;
end;
$$;

grant execute on function public.post_purchase_transaction(jsonb,jsonb,jsonb,text,text) to authenticated;

-- commit removed for combined file


-- ===== supabase-pos-post-stock-transfer-transaction.sql =====
-- Benamor POS - Atomic stock transfer transaction RPC
-- Run once in Supabase SQL Editor.
-- Saves transfer header, grouped items, source stock decrease, destination stock increase, and movements in ONE DB transaction.

-- begin removed for combined file

alter table if exists public.pos_stock_transfers
  add column if not exists idempotency_key text;

create unique index if not exists pos_stock_transfers_idempotency_key_uidx
on public.pos_stock_transfers(idempotency_key)
where idempotency_key is not null and trim(idempotency_key) <> '';

-- Atomic checked stock mutation helper, included here so this file can be run alone.
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

create or replace function public.post_stock_transfer_transaction(
  p_transfer jsonb,
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
  v_existing public.pos_stock_transfers%rowtype;
  v_transfer public.pos_stock_transfers%rowtype;
  v_from uuid;
  v_to uuid;
  v_date date;
  v_item record;
  v_has_items boolean;
begin
  if p_idempotency_key is not null and trim(p_idempotency_key) <> '' then
    select * into v_existing from public.pos_stock_transfers where idempotency_key = p_idempotency_key limit 1;
    if found then
      return to_jsonb(v_existing) || jsonb_build_object('idempotent_replay', true);
    end if;
  end if;

  v_from := nullif(p_transfer->>'from_location_id','')::uuid;
  v_to := nullif(p_transfer->>'to_location_id','')::uuid;
  v_date := coalesce(nullif(p_transfer->>'transfer_date','')::date, current_date);

  if v_from is null or v_to is null then raise exception 'TRANSFER_LOCATIONS_REQUIRED'; end if;
  if v_from = v_to then raise exception 'TRANSFER_SAME_LOCATION_NOT_ALLOWED'; end if;
  perform public.pos_assert_role(array['admin','warehouse']);
  perform public.pos_assert_location_allowed(v_from);
  perform public.pos_assert_location_allowed(v_to);

  v_has_items := jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0;
  if not v_has_items then raise exception 'TRANSFER_HAS_NO_ITEMS'; end if;

  -- Validate grouped quantities before writing the header.
  for v_item in
    select
      lower(x.product_code) as k,
      max(x.product_code) as product_code,
      max(x.product_name) as product_name,
      sum(x.qty) as qty
    from jsonb_to_recordset(p_items) as x(product_code text, product_name text, qty numeric)
    group by lower(x.product_code)
  loop
    if v_item.product_code is null or trim(v_item.product_code) = '' then raise exception 'PRODUCT_CODE_REQUIRED'; end if;
    if v_item.qty <= 0 then raise exception 'TRANSFER_QTY_MUST_BE_POSITIVE'; end if;
  end loop;

  insert into public.pos_stock_transfers(from_location_id, to_location_id, transfer_date, status, notes, idempotency_key)
  values (v_from, v_to, v_date, 'posted', nullif(p_transfer->>'notes',''), nullif(p_idempotency_key,''))
  returning * into v_transfer;

  for v_item in
    select
      lower(x.product_code) as k,
      max(x.product_code) as product_code,
      max(x.product_name) as product_name,
      sum(x.qty) as qty
    from jsonb_to_recordset(p_items) as x(product_code text, product_name text, qty numeric)
    group by lower(x.product_code)
  loop
    insert into public.pos_stock_transfer_items(transfer_id, product_code, product_name, qty)
    values (v_transfer.id, v_item.product_code, v_item.product_name, v_item.qty);

    perform public.pos_adjust_stock_checked(
      v_from,
      v_item.product_code,
      v_item.product_name,
      -abs(v_item.qty),
      'transfer_out',
      'pos_stock_transfers',
      v_transfer.id,
      'تحويل مخزون صادر' || coalesce(' | المستخدم: '||p_user_identifier,'')
    );

    perform public.pos_adjust_stock_checked(
      v_to,
      v_item.product_code,
      v_item.product_name,
      abs(v_item.qty),
      'transfer_in',
      'pos_stock_transfers',
      v_transfer.id,
      'تحويل مخزون وارد' || coalesce(' | المستخدم: '||p_user_identifier,'')
    );
  end loop;

  return to_jsonb(v_transfer) || jsonb_build_object('idempotent_replay', false);
exception when unique_violation then
  if p_idempotency_key is not null and trim(p_idempotency_key) <> '' then
    select * into v_existing from public.pos_stock_transfers where idempotency_key = p_idempotency_key limit 1;
    if found then return to_jsonb(v_existing) || jsonb_build_object('idempotent_replay', true); end if;
  end if;
  raise;
end;
$$;

grant execute on function public.post_stock_transfer_transaction(jsonb,jsonb,text,text) to authenticated;

-- commit removed for combined file


-- ===== supabase-pos-post-sale-return-transaction.sql =====
-- Benamor POS - Atomic sale return transaction RPC
-- Run once in Supabase SQL Editor.
-- Saves return header, return items, stock restoration, customer ledger and refund finance movement in ONE DB transaction.
-- Also prevents cumulative returned quantity from exceeding the original sold quantity.

-- begin removed for combined file

alter table if exists public.pos_sale_returns
  add column if not exists idempotency_key text;

create unique index if not exists pos_sale_returns_idempotency_key_uidx
on public.pos_sale_returns(idempotency_key)
where idempotency_key is not null and trim(idempotency_key) <> '';

-- Ensure finance movement type supports refunds.
alter table if exists public.pos_finance_movements
  drop constraint if exists pos_finance_movements_movement_type_check;

alter table if exists public.pos_finance_movements
  add constraint pos_finance_movements_movement_type_check
  check (movement_type in (
    'opening','sale_payment','supplier_payment','customer_payment',
    'transfer_in','transfer_out','expense','salary','adjustment','customer_refund'
  ));

-- Atomic checked stock mutation helper, included here so this file can be run alone.
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

grant execute on function public.post_sale_return_transaction(jsonb,jsonb,text,text) to authenticated;

-- commit removed for combined file


-- ===== supabase-pos-phase1-cost-and-return-hardening.sql =====
-- Benamor POS - Phase 1: historical cost snapshot + block unlinked negative sale lines
-- Run after post_sale_transaction SQL. This replaces post_sale_transaction with unit_cost_at_sale support
-- and rejects negative sale item quantities. Returns should use post_sale_return_transaction.

-- begin removed for combined file

alter table if exists public.pos_sale_items
  add column if not exists unit_cost_at_sale numeric not null default 0;

-- Keep qty <> 0 for legacy data compatibility, but RPC below rejects negative qty for new normal sales.
alter table if exists public.pos_sale_items
  drop constraint if exists pos_sale_items_unit_cost_at_sale_check;

alter table if exists public.pos_sale_items
  add constraint pos_sale_items_unit_cost_at_sale_check check (unit_cost_at_sale >= 0);

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
    subtotal, discount, total, paid_amount, balance_due, status, notes, idempotency_key
  ) values (
    nullif(p_sale->>'invoice_no',''), v_sale_date, v_location, v_customer, v_method,
    v_subtotal, v_discount, v_total, v_paid_signed, v_balance_due, 'posted', nullif(p_sale->>'notes',''), nullif(p_idempotency_key,'')
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

-- commit removed for combined file
