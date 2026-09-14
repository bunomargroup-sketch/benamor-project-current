-- ═══ 0025 — معاملة مرتجع البيع
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-post-sale-return-transaction.sql
-- الترتيب داخل supabase/migrations هو ترتيب التنفيذ المعتمد لقاعدة فارغة

-- Benamor POS - Atomic sale return transaction RPC
-- Run once in Supabase SQL Editor.
-- Saves return header, return items, stock restoration, customer ledger and refund finance movement in ONE DB transaction.
-- Also prevents cumulative returned quantity from exceeding the original sold quantity.

begin;

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

commit;
