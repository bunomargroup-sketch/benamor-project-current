-- ═══ 0035 — حذف المدير الذرّي للفواتير
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-admin-delete-sale.sql

-- ===================================================================
-- Benamor POS — حذف فاتورة بيع (مدير فقط) — معاملة واحدة ذرّية
--
-- ماذا تفعل الدالة admin_delete_sale؟
--   1) تتحقق أن المتصل مدير (admin) من جلسة الدخول نفسها
--   2) ترفض الحذف إذا كانت على الفاتورة مرتجعات مسجّلة
--   3) تُرجع المخزون (المنتج المركّب تُرجع مكوّناته — مع اتجاه الكمية)
--   4) تلغي كل الآثار: حركات المخزون، قيود الزبون، الحركات المالية،
--      الدفعات، بنود الفاتورة، ثم الفاتورة نفسها
--
-- الأمان: التحقق من الدور يتم في الخادم — لا يمكن لبائع تنفيذها
-- ⚠️ شغّله في Supabase SQL Editor (آمن لإعادة التشغيل)
-- ===================================================================

begin;

-- (تعريف احتياطي — موجود أصلاً من ملف الصلاحيات)
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
  where lower(identifier) = v_identifier
    and coalesce(active,true) = true
  limit 1;
  if v_role is null then
    raise exception 'ROLE_NOT_ASSIGNED: %', v_identifier;
  end if;
  return v_role;
end;
$$;

-- ============================================================
-- حذف فاتورة بيع (مدير فقط)
-- ============================================================
create or replace function public.admin_delete_sale(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.pos_sales%rowtype;
  v_item public.pos_sale_items%rowtype;
  v_comp record;
  v_inv text;
begin
  if public.pos_current_role() <> 'admin' then
    raise exception 'ONLY_ADMIN_CAN_DELETE_SALES';
  end if;

  select * into v_sale from public.pos_sales where id = p_sale_id for update;
  if not found then
    raise exception 'SALE_NOT_FOUND';
  end if;
  v_inv := coalesce(v_sale.invoice_no, '');

  -- لا حذف لفواتورة عليها مرتجعات
  if exists (select 1 from public.pos_sale_returns where sale_id = p_sale_id) then
    raise exception 'SALE_HAS_RETURNS_DELETE_THEM_FIRST';
  end if;

  -- إرجاع المخزون: مركّب → مكوّناته / عادي → نفسه (اتجاه الكمية محفوظ:
  -- السالب داخل الفاتورة كان أضاف مخزوناً فيُخصم عند الحذف)
  for v_item in select * from public.pos_sale_items where sale_id = p_sale_id loop
    if exists (select 1 from public.pos_composite_items where composite_code = v_item.product_code) then
      for v_comp in select component_code, qty as comp_qty
                    from public.pos_composite_items where composite_code = v_item.product_code loop
        perform public.pos_adjust_stock_checked(
          v_sale.location_id, v_comp.component_code, v_comp.component_code,
          v_item.qty * coalesce(v_comp.comp_qty,1),
          'adjustment', 'pos_sales', p_sale_id,
          'إرجاع مكوّن منتج مركّب — حذف فاتورة ' || v_inv
        );
      end loop;
    else
      perform public.pos_adjust_stock_checked(
        v_sale.location_id, v_item.product_code, v_item.product_name,
        v_item.qty,
        'adjustment', 'pos_sales', p_sale_id,
        'إرجاع مخزون — حذف فاتورة ' || v_inv
      );
    end if;
  end loop;

  -- إلغاء كل الآثار ثم الحذف
  delete from public.pos_stock_movements  where reference_table='pos_sales' and reference_id=p_sale_id;
  delete from public.pos_customer_ledger where reference_table='pos_sales' and reference_id=p_sale_id;
  delete from public.pos_finance_movements where reference_table='pos_sales' and reference_id=p_sale_id;
  delete from public.pos_sale_payments   where sale_id=p_sale_id;
  delete from public.pos_sale_items     where sale_id=p_sale_id;
  delete from public.pos_sales          where id=p_sale_id;

  return jsonb_build_object('deleted', true, 'invoice_no', v_inv);
end;
$$;

grant execute on function public.pos_current_identifier() to authenticated;
grant execute on function public.pos_current_role() to authenticated;
grant execute on function public.admin_delete_sale(uuid) to authenticated;

commit;

-- ============================================================
-- التحقق بعد التشغيل:
--   select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--   where n.nspname='public' and proname='admin_delete_sale';
--
-- الاستخدام من النظام: قائمة الفواتير → زر أيمن على فاتورة
-- → «حذف الفاتورة (مدير)» → تأكيد بكتابة رقم الفاتورة
-- ============================================================
