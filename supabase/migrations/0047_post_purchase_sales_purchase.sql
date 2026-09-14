-- ═══ 0047 — مطابقة معاملة الشراء للإنتاج: دور «بيع-وشراء» مسموح
-- الفرق الوحيد بين السلسلة والإنتاج في هذه الدالة (اكتشفته المقارنة الحية):
-- الإنتاج يسمح لـ sales_purchase بترحيل فواتير الشراء والسلسلة (من ملف
-- phase1-rpc-permissions-hardening) لم تكن تشمله. هذه النسخة = نسخة الإنتاج
-- حرفياً. لا يُشغَّل على الإنتاج (هو فيه أصلاً) — للسلسلة/البيئات الجديدة فقط.
-- ═══════════════════════════════════════════════════════════════════

begin;

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
