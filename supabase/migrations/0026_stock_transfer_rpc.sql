-- ═══ 0026 — معاملة التحويل
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-post-stock-transfer-transaction.sql
-- الترتيب داخل supabase/migrations هو ترتيب التنفيذ المعتمد لقاعدة فارغة

-- Benamor POS - Atomic stock transfer transaction RPC
-- Run once in Supabase SQL Editor.
-- Saves transfer header, grouped items, source stock decrease, destination stock increase, and movements in ONE DB transaction.

begin;

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

commit;
