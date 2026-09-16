-- ═══ 0045 — حارس طابور البيع دون اتصال (بانتظار تشغيله في الإنتاج)
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-offline-queue.sql

-- ===================================================================
-- Benamor POS — حارس المخزون لطابور البيع دون اتصال (Offline Queue Guard)
--
-- الغرض:
--   الفاتورة التي حُفظت محليًا على جهاز الكاشير أثناء انقطاع الإنترنت
--   تُرفع لاحقًا مع العلامة offline_queued=true داخل p_sale.
--   عند مزامنتها يفحص الخادم المخزون الفعلي الحالي:
--     - إن كانت الكمية كافية ⇒ تُسجَّل طبيعيًا.
--     - إن كانت غير كافية (بيعت من جهاز آخر أثناء الانقطاع) ⇒ تُرفض
--       برسالة INSUFFICIENT_STOCK_QUEUED وتبقى في قائمة «تحتاج مراجعة»
--       على جهاز الكاشير حتى يقرر المدير: إعادة إرسال مع تجاوز الفحص
--       (يسمح بالسالب — قرار إداري) أو حذفها نهائيًا.
--
--   ⚠ البيع التفاعلي المباشر (أونلاين) لا يتغير: تأكيد المستخدم في
--     الواجهة يكفي، والكمية تنزل سالبة إن لزم — كما هو معمول به الآن.
--
-- هذا الملف يعيد تعريف post_sale_transaction بالنسخة الكاملة الأحدث
-- (المكوّنات المركّبة + snapshot التكلفة unit_cost_at_sale) مع إضافة
-- الحارس فقط. شغّله بعد كل ملفات SQL السابقة. آمن لإعادة التشغيل.
--
-- ⚠ شغّل هذا الملف في Supabase SQL Editor قبل رفع واجهة app.js الجديدة
--   (الواجهة الجديدة تعمل أيضًا بدون هذا الملف — لكن دون حارس المخزون
--   ستُرفع الفواتير المتعارضة بكمية سالبة بدل رفضها للمراجعة).
-- ===================================================================

begin;

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
  v_comp record;
  v_avail numeric;
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
    subtotal, discount, total, paid_amount, balance_due, status, notes, idempotency_key, created_by
  ) values (
    nullif(p_sale->>'invoice_no',''), v_sale_date, v_location, v_customer, v_method,
    v_subtotal, v_discount, v_total, v_paid_signed, v_balance_due, 'posted', nullif(p_sale->>'notes',''), nullif(p_idempotency_key,''), nullif(p_user_identifier,'')
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

    -- منتج مركّب: يُخصم المخزون من مكوّناته (والفاتورة تحتفظ بسطر المركّب نفسه)
    if exists (select 1 from public.pos_composite_items where composite_code = (v_item->>'product_code')) then
      for v_comp in select component_code, qty as comp_qty from public.pos_composite_items where composite_code = (v_item->>'product_code') loop
        -- ═══ حارس الطابور غير المتصل (المكوّنات) ═══
        if coalesce(p_sale->>'offline_queued','') = 'true' then
          select coalesce(sum(qty),0) into v_avail from (
            select qty from public.pos_stock
            where location_id = v_location and lower(product_code) = lower(v_comp.component_code)
            for update
          ) s;
          if coalesce(v_avail,0) - (v_qty * coalesce(v_comp.comp_qty,1)) < 0 then
            raise exception 'INSUFFICIENT_STOCK_QUEUED: % available % requested %', v_comp.component_code, coalesce(v_avail,0), (v_qty * coalesce(v_comp.comp_qty,1));
          end if;
        end if;
        perform public.pos_adjust_stock_checked(
          v_location,
          v_comp.component_code,
          v_comp.component_code,
          -(v_qty * coalesce(v_comp.comp_qty,1)),
          'sale',
          'pos_sales',
          v_sale.id,
          'مكوّن منتج مركّب ' || coalesce(v_item->>'product_code','') || coalesce(' | المستخدم: '||p_user_identifier,'')
        );
      end loop;
    else
      -- ═══ حارس الطابور غير المتصل ═══
      -- فاتورة انتظرت في طابور محلي (offline_queued=true) لا يُسمح لها بإنزال
      -- مخزون الخادم تحت الصفر — لأن جهازًا آخر ربما باع نفس الكمية أثناء
      -- الانقطاع. تُرفض برسالة INSUFFICIENT_STOCK_QUEUED وتعود للمراجعة.
      -- (قفل for update يمنع سباق جهازين يرفعان نفس الصنف في نفس اللحظة)
      if coalesce(p_sale->>'offline_queued','') = 'true' then
        select coalesce(sum(qty),0) into v_avail from (
          select qty from public.pos_stock
          where location_id = v_location and lower(product_code) = lower(v_item->>'product_code')
          for update
        ) s;
        if coalesce(v_avail,0) - v_qty < 0 then
          raise exception 'INSUFFICIENT_STOCK_QUEUED: % available % requested %', v_item->>'product_code', coalesce(v_avail,0), v_qty;
        end if;
      end if;
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
    end if;
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

commit;

-- ============================================================
-- التحقق بعد التشغيل — نفّذ هذا الاستعلام:
--
--   select p.proname, p.prosrc like '%INSUFFICIENT_STOCK_QUEUED%' as guard_installed
--   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--   where n.nspname='public' and p.proname='post_sale_transaction';
--
-- يجب أن يعيد: post_sale_transaction | t
--
-- اختبار سلوكي (اختياري، بيئة تجريبية):
--   1. أرسل فاتورة offline_queued=true لصنف كميته 0 ⇒ يجب أن تُرفض برسالة
--      INSUFFICIENT_STOCK_QUEUED.
--   2. أرسل نفس الفاتورة offline_queued=false ⇒ يجب أن تُقبل (كمية سالبة).
--   3. أعد إرسال نفس p_idempotency_key مرتين ⇒ صف واحد فقط في pos_sales
--      والاستجابة الثانية فيها "idempotent_replay": true.
-- ============================================================
