-- ═══ 0024 — معاملة الشراء الذرّية
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-post-purchase-transaction.sql
-- الترتيب داخل supabase/migrations هو ترتيب التنفيذ المعتمد لقاعدة فارغة

-- Benamor POS - Atomic purchase transaction RPC
-- Run once in Supabase SQL Editor.
-- Saves purchase header, items, stock increases, stock movements, supplier ledger, supplier payment and finance movement in ONE DB transaction.

begin;

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
  perform public.pos_assert_role(array['admin','warehouse','sales_purchase']);
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

commit;
