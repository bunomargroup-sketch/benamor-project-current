-- ═══ 0031 — السماح بالمخزون السالب
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-allow-negative-stock.sql
-- الترتيب داخل supabase/migrations هو ترتيب التنفيذ المعتمد لقاعدة فارغة

-- ===================================================================
-- Benamor POS — السماح بالبيع بدون مخزون كافٍ (كمية 0 أو سالبة)
-- يعيد تعريف دالة تعديل المخزون pos_adjust_stock_checked
-- بحيث تسمح بنزول الكمية تحت الصفر بدل رفض العملية
--
-- لماذا؟ الواجهة تسأل "هل تريد البيع بدون مخزون؟" لكن قاعدة البيانات
-- كانت ترفض العملية برسالة INSUFFICIENT_STOCK بعد التأكيد.
-- الآن: التأكيد في الواجهة يكفي، والكمية تنزل سالبة إن لزم
-- (وكل الحركات تُسجَّل في pos_stock_movements كالمعتاد — سجل التدقيق سليم).
--
-- ⚠️ شغّل هذا الملف في Supabase SQL Editor
-- ⚠️ شغّله في النهاية (بعد أي ملف SQL آخر للنظام) — لأن بعض الملفات
--    القديمة تعيد تعريف نفس الدالة بالمنع القديم، وآخر ملف يشغَّل هو المعمول به
-- ===================================================================

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
  if p_location_id is null then raise exception 'LOCATION_REQUIRED'; end if;
  if p_product_code is null or trim(p_product_code) = '' then raise exception 'PRODUCT_CODE_REQUIRED'; end if;
  if p_qty_change is null or p_qty_change = 0 then raise exception 'QTY_CHANGE_REQUIRED'; end if;

  select id, qty into v_id, v_qty
  from public.pos_stock
  where location_id = p_location_id and lower(product_code) = lower(p_product_code)
  for update;

  -- التغيير: لا يوجد منع للكمية السالبة بعد الآن
  -- (سابقاً: raise exception 'INSUFFICIENT_STOCK ...' في الحالتين التاليتين)
  if v_id is null then
    insert into public.pos_stock(location_id, product_code, product_name, qty, updated_at)
    values (p_location_id, p_product_code, p_product_name, p_qty_change, now())
    returning qty into v_new_qty;
  else
    v_new_qty := coalesce(v_qty,0) + p_qty_change;
    update public.pos_stock
      set qty = v_new_qty,
          product_name = coalesce(p_product_name, product_name),
          updated_at = now()
    where id = v_id;
  end if;

  -- تسجيل الحركة يبقى إلزامياً (سجل التدقيق / حركات المخزون)
  insert into public.pos_stock_movements(location_id, product_code, product_name, movement_type, qty_change, reference_table, reference_id, notes)
  values (p_location_id, p_product_code, p_product_name, p_movement_type, p_qty_change, p_reference_table, p_reference_id, p_notes);

  return v_new_qty;
end;
$$;

grant execute on function public.pos_adjust_stock_checked(uuid,text,text,numeric,text,text,uuid,text) to authenticated;

commit;

-- ============================================================
-- التحقق بعد التشغيل — نفّذ هذا الاستعلام:
--
--   select p.product_code, p.qty
--   from pos_stock p
--   order by p.qty asc
--   limit 10;
--
-- يجب أن يعمل بدون خطأ (يعرض أقل الكميات).
--
-- اختبار فعلي: سجّل فاتورة بيع لصنف كميته 0 من الواجهة،
-- أكّد "البيع بدون مخزون"، ثم يجب أن تُحفظ الفاتورة
-- وتظهر الكمية -1 في شاشة المخزون.
-- ============================================================
