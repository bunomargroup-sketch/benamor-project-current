-- ═══ 0027 — تعديل المخزون المحقون (نسخة تاريخية)
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-atomic-stock-rpc.sql
-- الترتيب داخل supabase/migrations هو ترتيب التنفيذ المعتمد لقاعدة فارغة

-- Benamor POS - Atomic stock mutation RPC
-- Run once in Supabase SQL Editor before enabling strict race-safe stock updates.
-- This function locks the stock row and rejects any mutation that would make stock negative.

begin;

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
  if p_location_id is null then
    raise exception 'LOCATION_REQUIRED';
  end if;
  if p_product_code is null or trim(p_product_code) = '' then
    raise exception 'PRODUCT_CODE_REQUIRED';
  end if;
  if p_qty_change is null or p_qty_change = 0 then
    raise exception 'QTY_CHANGE_REQUIRED';
  end if;

  select id, qty
    into v_id, v_qty
  from public.pos_stock
  where location_id = p_location_id
    and lower(product_code) = lower(p_product_code)
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

  insert into public.pos_stock_movements(
    location_id, product_code, product_name, movement_type, qty_change,
    reference_table, reference_id, notes
  ) values (
    p_location_id, p_product_code, p_product_name, p_movement_type, p_qty_change,
    p_reference_table, p_reference_id, p_notes
  );

  return v_new_qty;
end;
$$;

grant execute on function public.pos_adjust_stock_checked(uuid,text,text,numeric,text,text,uuid,text) to authenticated;

commit;
