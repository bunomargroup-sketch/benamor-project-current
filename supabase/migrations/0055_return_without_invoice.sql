-- ═══════════════════════════════════════════════════════════════════════
-- 0055 — مرتجع بلا فاتورة (بضاعة بيعت قبل دخول المنظومة تعود اليوم)
--
-- قرارات صاحب العمل — ملزمة:
--   • كل المستخدمين يسجّلون مرتجعاً بلا فاتورة، بلا حدّ مبلغ ولا موافقة
--   • السعر يُملأ من سعر البيع الحالي (في الواجهة) والكاشير يستطيع تعديله
--   • التعويض عن غياب الموافقة = الرؤية: سجل تدقيق بالسبب واسم المستخدم
--     وتعديل السعر + وسم «بلا فاتورة» في قائمة المرتجعات + سطر في لوحة
--     المدير + دخول إغلاق الخزينة اليومي كأي مرتجع (حركة customer_refund)
--
-- التغييرات:
--   1) pos_sale_returns.sale_id ⇒ nullable (الفاتورة الأصلية لم تعد شرطاً)
--   2) pos_sale_returns.reason text — إلزامي للمرتجعات بلا فاتورة
--      (قيد CHECK: sale_id IS NOT NULL OR reason غير فارغ)
--   3) pos_sale_return_items.price_edited boolean — true حين حرّر المستخدم السعر
--   4) post_sale_return_transaction: فرع بلا فاتورة — sale_id=NULL يتخطى
--      التحقق من بنود الفاتورة الأصلية، وكل ما عداه كما هو: المخزون
--      يستقبل الكمية + حركة الخزينة customer_refund مرجعها pos_sale_returns
--      (لا pos_sales) + idempotency كما هي. مسار الفاتورة الأصلية
--      محفوظ حرفياً بلا أي تغيير.
--
-- الملف بيان واحد (كتلة DO واحدة) — لا يقسّمه SQL Editor.
-- 🔴 يُطبَّق بـ supabase db push — لا SQL من المتصفّح
-- ═══════════════════════════════════════════════════════════════════════

do $mig$
declare
  v_has_reason boolean;
  v_has_price_edited boolean;
begin
  -- 1) الفاتورة الأصلية اختيارية
  alter table public.pos_sale_returns alter column sale_id drop not null;

  -- 2) سبب المرتجع (إلزامي لبلا فاتورة — القيد أدناه يحرسه على مستوى القاعدة)
  alter table public.pos_sale_returns add column if not exists reason text;
  select count(*)>0 into v_has_reason from information_schema.columns
   where table_schema='public' and table_name='pos_sale_returns' and column_name='reason';

  -- 3) تعديل السعر على البنود
  alter table public.pos_sale_return_items add column if not exists price_edited boolean;
  select count(*)>0 into v_has_price_edited from information_schema.columns
   where table_schema='public' and table_name='pos_sale_return_items' and column_name='price_edited';
  alter table public.pos_sale_return_items alter column price_edited set default false;
  -- أصلح أي صفوف NULL (عمود مضاف يدوياً سابقاً في بيئة ما)
  update public.pos_sale_return_items set price_edited=false where price_edited is null;
  alter table public.pos_sale_return_items alter column price_edited set not null;

  -- 4) القيد: بلا فاتورة ⇒ سبب مطلوب
  alter table public.pos_sale_returns drop constraint if exists pos_sale_returns_reason_required_check;
  alter table public.pos_sale_returns add constraint pos_sale_returns_reason_required_check
    check (sale_id is not null or (reason is not null and btrim(reason) <> ''));

  if not v_has_reason or not v_has_price_edited then
    raise notice '⚠ أعمدة جديدة أُنشئت الآن (reason=% · price_edited=%)', v_has_reason, v_has_price_edited;
  end if;
end
$mig$;

-- ─── الدالة: فرع بلا فاتورة + المسار الأصلي كما هو ───
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
as $fn$
declare
  v_existing public.pos_sale_returns%rowtype;
  v_return public.pos_sale_returns%rowtype;
  v_sale public.pos_sales%rowtype;
  v_item jsonb;
  v_sale_item public.pos_sale_items%rowtype;
  v_no_invoice boolean;
  v_return_date date;
  v_location uuid;
  v_customer uuid;
  v_method text;
  v_account uuid;
  v_reason text;
  v_total numeric := 0;
  v_qty numeric;
  v_price numeric;
  v_already_returned numeric;
  v_base numeric;
  v_line_discount numeric;
  v_line_total numeric;
  v_has_items boolean;
  v_code text;
  v_name text;
  v_price_edited boolean;
begin
  if p_idempotency_key is not null and trim(p_idempotency_key) <> '' then
    select * into v_existing from public.pos_sale_returns where idempotency_key = p_idempotency_key limit 1;
    if found then
      return to_jsonb(v_existing) || jsonb_build_object('idempotent_replay', true);
    end if;
  end if;

  v_no_invoice := nullif(p_return->>'sale_id','') is null;

  if not v_no_invoice then
    select * into v_sale
    from public.pos_sales
    where id = nullif(p_return->>'sale_id','')::uuid
    for update;

    if not found then raise exception 'ORIGINAL_SALE_NOT_FOUND'; end if;
  end if;

  v_return_date := coalesce(nullif(p_return->>'return_date','')::date, current_date);
  if v_no_invoice then
    v_location := nullif(p_return->>'location_id','')::uuid;
    if v_location is null then raise exception 'LOCATION_REQUIRED_FOR_NO_INVOICE_RETURN'; end if;
    v_reason := btrim(coalesce(p_return->>'reason',''));
    if v_reason = '' then raise exception 'RETURN_REASON_REQUIRED'; end if;
  else
    v_location := coalesce(nullif(p_return->>'location_id','')::uuid, v_sale.location_id);
  end if;
  v_customer := coalesce(nullif(p_return->>'customer_id','')::uuid, v_sale.customer_id);
  v_method := coalesce(nullif(p_return->>'refund_method',''), 'cash');
  v_account := nullif(p_return->>'account_id','')::uuid;

  if not v_no_invoice then
    perform public.pos_assert_role(array['admin','seller_11','seller_sarraj','sales_purchase']);
  end if; /* مرتجع بلا فاتورة: كل المستخدمين بلا موافقة (قرار صاحب العمل) — الضابط هو الرؤية: تدقيق + وسم + لوحة المدير */
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

  if v_no_invoice then
    -- ─── بلا فاتورة: بنود بمواصفات المستخدم (السعر مملوء من الكتالوج وقابل للتعديل) ───
    for v_item in select * from jsonb_array_elements(p_items) loop
      v_qty := coalesce(nullif(v_item->>'qty','')::numeric, 0);
      if v_qty <= 0 then raise exception 'RETURN_QTY_MUST_BE_POSITIVE'; end if;
      v_price := coalesce(nullif(v_item->>'unit_price','')::numeric, 0);
      if v_price < 0 then raise exception 'RETURN_PRICE_CANNOT_BE_NEGATIVE'; end if;
      v_code := btrim(coalesce(v_item->>'product_code',''));
      if v_code = '' then raise exception 'RETURN_PRODUCT_CODE_REQUIRED'; end if;
      if not exists (select 1 from public.pos_products where lower(code) = lower(v_code)) then
        raise exception 'PRODUCT_NOT_FOUND: %', v_code;
      end if;
      v_line_total := v_qty * v_price;
      if v_line_total <= 0 then raise exception 'RETURN_TOTAL_MUST_BE_POSITIVE'; end if;
      v_total := v_total + v_line_total;
    end loop;

    if v_total <= 0 then raise exception 'RETURN_TOTAL_MUST_BE_POSITIVE'; end if;

    insert into public.pos_sale_returns(sale_id, return_date, location_id, customer_id, total, refund_method, notes, reason, idempotency_key)
    values (null, v_return_date, v_location, v_customer, v_total, v_method, nullif(p_return->>'notes',''), v_reason, nullif(p_idempotency_key,''))
    returning * into v_return;

    for v_item in select * from jsonb_array_elements(p_items) loop
      v_qty := coalesce(nullif(v_item->>'qty','')::numeric, 0);
      v_price := coalesce(nullif(v_item->>'unit_price','')::numeric, 0);
      v_code := btrim(coalesce(v_item->>'product_code',''));
      v_name := coalesce(nullif(v_item->>'product_name',''), v_code);
      v_price_edited := coalesce((v_item->>'price_edited')::boolean, false);

      insert into public.pos_sale_return_items(return_id, sale_item_id, product_code, product_name, qty, unit_price, line_discount, line_total, price_edited)
      values (v_return.id, null, v_code, v_name, v_qty, v_price, 0, v_qty * v_price, v_price_edited);

      perform public.pos_adjust_stock_checked(
        v_location,
        v_code,
        v_name,
        v_qty,
        'return_customer',
        'pos_sale_returns',
        v_return.id,
        'مرتجع زبون بلا فاتورة | السبب: ' || v_reason || coalesce(' | المستخدم: '||p_user_identifier,'')
      );
    end loop;
  else
    -- ─── بفاتورة: كما كان حرفياً ───
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

    insert into public.pos_sale_returns(sale_id, return_date, location_id, customer_id, total, refund_method, notes, reason, idempotency_key)
    values (v_sale.id, v_return_date, v_location, v_customer, v_total, v_method, nullif(p_return->>'notes',''), nullif(p_return->>'reason',''), nullif(p_idempotency_key,''))
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

      insert into public.pos_sale_return_items(return_id, sale_item_id, product_code, product_name, qty, unit_price, line_discount, line_total, price_edited)
      values (v_return.id, v_sale_item.id, v_sale_item.product_code, v_sale_item.product_name, v_qty, v_sale_item.unit_price, coalesce(v_line_discount,0), v_line_total, false);

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
  end if;

  if v_method = 'credit_reduction' then
    insert into public.pos_customer_ledger(customer_id, entry_date, entry_type, description, debit, credit, reference_table, reference_id)
    values (v_customer, v_return_date, 'return',
            case when v_no_invoice then 'مرتجع بلا فاتورة - '||v_reason else 'فاتورة مرتجع بيع رقم '||coalesce(v_sale.invoice_no,'') end,
            0, v_total, 'pos_sale_returns', v_return.id);
  elsif v_method in ('cash','bank_transfer','card') then
    insert into public.pos_finance_movements(account_id, direction, movement_type, amount, movement_date, reference_table, reference_id, notes)
    values (v_account, 'out', 'customer_refund', v_total, v_return_date, 'pos_sale_returns', v_return.id,
            'Customer Refund / استرداد للزبون - ' ||
            case when v_no_invoice then 'مرتجع بلا فاتورة - السبب: '||v_reason||' ' else 'مرتجع فاتورة '||coalesce(v_sale.invoice_no,'')||' ' end ||
            coalesce(' - المستخدم: '||p_user_identifier,''));
  end if;

  return to_jsonb(v_return) || jsonb_build_object('idempotent_replay', false);
exception when unique_violation then
  if p_idempotency_key is not null and trim(p_idempotency_key) <> '' then
    select * into v_existing from public.pos_sale_returns where idempotency_key = p_idempotency_key limit 1;
    if found then return to_jsonb(v_existing) || jsonb_build_object('idempotent_replay', true); end if;
  end if;
  raise;
end;
$fn$;

revoke all on function public.post_sale_return_transaction(jsonb,jsonb,text,text) from anon, public;
grant execute on function public.post_sale_return_transaction(jsonb,jsonb,text,text) to authenticated;
