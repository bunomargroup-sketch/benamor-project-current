-- ===================================================================
-- Benamor POS — صلاحية التحويل بين الفروع والمخازن للبائعين والبيع والشراء
--
-- الجديد:
--   • seller_11 / seller_sarraj : شاشة التحويلات متاحة — بشرط أن يكون
--     أحد طرفي التحويل فرعهم (إرسال من فرعهم أو استلام إليه)
--   • sales_purchase : تحويل حر بين أي فروع/مخازن
--   • admin / warehouse : كما هم (حرية كاملة)
--
-- هذا الملف يعيد تعريف دالة التحويل post_stock_transfer_transaction
-- مع فحص الأطراف الجديد pos_assert_transfer_ends_allowed
-- ⚠️ شغّله في Supabase SQL Editor (آمن لإعادة التشغيل)
-- ===================================================================

begin;
-- ============================================================
-- فحص أطراف التحويل حسب الدور:
--   admin / warehouse / sales_purchase : أي فرعين أو مخزنين
--   seller_11 / seller_sarraj : أحد الطرفين يجب أن يكون فرعهم
--     (يستطيع الإرسال من فرعه أو الاستلام إليه)
-- ============================================================
create or replace function public.pos_assert_transfer_ends_allowed(
  p_from uuid,
  p_to uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.pos_current_role();
  v_from_name text;
  v_to_name text;
begin
  if p_from is null or p_to is null then raise exception 'LOCATION_REQUIRED'; end if;
  if v_role in ('admin','warehouse','sales_purchase') then return; end if;
  select name into v_from_name from public.pos_locations where id = p_from;
  select name into v_to_name from public.pos_locations where id = p_to;
  if v_role='seller_11' and (v_from_name='فرع 11 يونيو' or v_to_name='فرع 11 يونيو') then return; end if;
  if v_role='seller_sarraj' and (v_from_name='فرع السراج' or v_to_name='فرع السراج') then return; end if;
  raise exception 'TRANSFER_LOCATION_NOT_ALLOWED_FOR_ROLE: % (أحد طرفي التحويل يجب أن يكون فرعك)', v_role;
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
  perform public.pos_assert_role(array['admin','warehouse','seller_11','seller_sarraj','sales_purchase']);
  -- البائعون: يجب أن يكون أحد طرفي التحويل فرعهم (إرسال أو استلام)
  -- المدير/المخزن/البيع والشراء: أي طرفين
  perform public.pos_assert_transfer_ends_allowed(v_from, v_to);

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

grant execute on function public.pos_assert_transfer_ends_allowed(uuid,uuid) to authenticated;
grant execute on function public.post_stock_transfer_transaction(jsonb,jsonb,text,text) to authenticated;

commit;

-- ============================================================
-- التحقق بعد التشغيل:
--   select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--   where n.nspname='public' and proname in ('pos_assert_transfer_ends_allowed','post_stock_transfer_transaction');
-- ============================================================
