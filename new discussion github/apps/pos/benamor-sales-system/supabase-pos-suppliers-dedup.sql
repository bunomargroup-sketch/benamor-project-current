-- ═══ 0049 (v2) — تنظيف الموردين المكرّرين + فهرس فريد يمنع التكرار مستقبلاً
--
-- ⚠️ لماذا v2؟ النسخة الأولى استعملت جداول مؤقتة على مستوى الملف، وSQL Editor
--    في Supabase يفصل البيانات ويُسلّم كل بيان وحده — فالجدول المؤقت ON COMMIT DROP
--    يُسقط بعد أول بيان (الخطأ: relation "_dedup_pre" does not exist).
--    هذه النسخة **بيان واحد** (كتلة DO واحدة) — لا يمكن تقسيمها:
--    تعمل في SQL Editor وفي supabase db push على السواء، وذرّية بالكامل
--    (أي استثناء يفشل الكتلة كلها ويلغي كل شيء).
--
-- الوقائع المقيسة على الإنتاج (2026-09-15) التي تتحقق منها الكتلة:
--   • pos_suppliers = 175 صفاً، منها 85 اسماً مكرّراً مرّتين بالضبط
--   • pos_purchases و pos_supplier_ledger و pos_supplier_payments = صفر صف
--   • لا مورّد برصيد افتتاحي ≠ 0
--   • 4445 من 4453 منتجاً لها supplier_id
--
-- القواعد: الباقي = الأكثر منتجات (وعند التساوي الأقدم created_at) ·
--   النقل يمسّ pos_products.supplier_id فقط · الحذف للنسخ المكرّرة الفارغة
--   بعد النقل حصراً · لا يُحذف صف لا يطابق اسمه أي صف آخر.
--
-- 🔄 آمن للإعادة بعد الفشل الجزئي: كل الخطوات قابلة لإعادة التنفيذ —
--    إن كانت دفعة سابقة نقلت منتجات ثم توقفت، ستجد هذه الكتلة نفس الباقين
--    وتكمل بلا ازدواج.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_suppliers_before int; v_products_before int;
  v_purchases int; v_ledger int; v_payments int; v_opening int;
  v_groups int; v_losers int; v_losers_with_products int;
  v_deleted int; v_suppliers_after int; v_products_after int;
  v_orphans int; v_remaining_dups int;
begin
  -- ─── 0) عدّادات ما قبل التنظيف ───
  select count(*) into v_suppliers_before from public.pos_suppliers;
  select count(*) into v_products_before from public.pos_products where supplier_id is not null;
  select count(*) into v_purchases from public.pos_purchases;
  select count(*) into v_ledger from public.pos_supplier_ledger;
  select count(*) into v_payments from public.pos_supplier_payments;
  select count(*) into v_opening from public.pos_suppliers where coalesce(opening_balance,0) <> 0;

  -- ─── 1) مجموعات التكرار بالمفتاح المطبّع (تُنشأ من جديد دائماً — لا بقايا جلسات) ───
  drop table if exists _dupkeys;
  create temp table _dupkeys on commit drop as
    select lower(btrim(name)) as key
    from public.pos_suppliers
    group by lower(btrim(name))
    having count(*) > 1;

  drop table if exists _copies;
  create temp table _copies on commit drop as
    select s.id, d.key, s.created_at,
           (select count(*) from public.pos_products p where p.supplier_id = s.id) as n_products
    from public.pos_suppliers s
    join _dupkeys d on d.key = lower(btrim(s.name));

  -- الباقية: الأكثر منتجات، وعند التساوي الأقدم
  drop table if exists _keeper;
  create temp table _keeper on commit drop as
    select distinct on (key) key, id as keep_id
    from _copies
    order by key, n_products desc, created_at asc;

  -- المحذوفة المرشّحة: كل نسخة غير باقية في مجموعتها
  drop table if exists _losers;
  create temp table _losers on commit drop as
    select c.id, k.keep_id
    from _copies c
    join _keeper k on k.key = c.key
    where c.id <> k.keep_id;

  select count(*) into v_groups from _dupkeys;
  select count(*) into v_losers from _losers;

  -- ─── 2) النقل: منتجات النسخ المحذوفة ← النسخة الباقية ───
  update public.pos_products p
  set supplier_id = l.keep_id
  from _losers l
  where p.supplier_id = l.id;

  -- ─── 3) الحذف — بعد التحقّق أن كل محذوف صار فارغاً ───
  select count(*) into v_losers_with_products
  from _losers l join public.pos_products p on p.supplier_id = l.id;

  delete from public.pos_suppliers s
  using _losers l
  where s.id = l.id;
  get diagnostics v_deleted = row_count;

  -- ─── 4) العدّادات بعد + الفحوص الصارمة (أي اختلال ⇒ استثناء ⇒ إلغاء كل شيء) ───
  select count(*) into v_suppliers_after from public.pos_suppliers;
  select count(*) into v_products_after from public.pos_products where supplier_id is not null;
  select count(*) into v_orphans from public.pos_products p
    where p.supplier_id is not null
      and not exists (select 1 from public.pos_suppliers s where s.id = p.supplier_id);
  select count(*) into v_remaining_dups from (
    select 1 from public.pos_suppliers group by lower(btrim(name)) having count(*) > 1
  ) x;

  -- (١) عدد الموردين بعد = قبل − المحذوفون
  if v_suppliers_after <> v_suppliers_before - v_deleted then
    raise exception 'SUPPLIER_DEDUP_COUNT_MISMATCH: قبل %، محذوفون %، بعد %', v_suppliers_before, v_deleted, v_suppliers_after;
  end if;
  -- (٢) عدد المنتجات التي لها supplier_id لم يتغيّر إطلاقاً
  if v_products_after <> v_products_before then
    raise exception 'SUPPLIER_DEDUP_PRODUCTS_CHANGED: % ⇒ % (يجب ألا يتغيّر)', v_products_before, v_products_after;
  end if;
  -- (٣) المنتجات اليتيمة = 0
  if v_orphans <> 0 then
    raise exception 'SUPPLIER_DEDUP_ORPHAN_PRODUCTS: %', v_orphans;
  end if;
  -- (٤) لم يُحذف أي مورّد له منتجات
  if v_losers_with_products <> 0 then
    raise exception 'SUPPLIER_DEDUP_LOSER_WITH_PRODUCTS: % نسخة لها منتجات بعد النقل — لن تُحذف', v_losers_with_products;
  end if;
  if v_deleted <> v_losers then
    raise exception 'SUPPLIER_DEDUP_LOSER_SURVIVED: المرشّحون % والمحذوفون %', v_losers, v_deleted;
  end if;
  -- (٥) لا تكرار مطبّع متبقٍّ
  if v_remaining_dups <> 0 then
    raise exception 'SUPPLIER_DEDUP_REMAINING_DUPS: %', v_remaining_dups;
  end if;

  -- توقيع الإنتاج المقيس (يفحص حصراً إذا كانت البيانات هي بيانات الإنتاج المقيسة)
  if v_suppliers_before = 175 then
    if v_groups <> 85 then
      raise exception 'SUPPLIER_DEDUP_SNAPSHOT_DRIFT: توقّعنا 85 مجموعة ووجدنا % — أعد القياس قبل المتابعة', v_groups;
    end if;
    if v_deleted <> 85 then
      raise exception 'SUPPLIER_DEDUP_SNAPSHOT_DRIFT: توقّعنا حذف 85 ووجدنا %', v_deleted;
    end if;
    if v_products_before <> 4445 then
      raise exception 'SUPPLIER_DEDUP_SNAPSHOT_DRIFT: توقّعنا 4445 منتجاً بمورد ووجدنا %', v_products_before;
    end if;
    if v_purchases <> 0 or v_ledger <> 0 or v_payments <> 0 then
      raise exception 'SUPPLIER_DEDUP_SNAPSHOT_DRIFT: فواتير/قيود/دفعات الموردين لم تعد صفراً (%/%/%)', v_purchases, v_ledger, v_payments;
    end if;
    if v_opening <> 0 then
      raise exception 'SUPPLIER_DEDUP_SNAPSHOT_DRIFT: يوجد % مورداً برصيد افتتاحي ≠ 0', v_opening;
    end if;
  else
    raise notice 'SUPPLIER_DEDUP: قاعدة ليست توقيع الإنتاج (موردون=%، مجموعات=%) — فحوص اللقطة التقديرية تُتخطى والثوابت كلها مفحوصة', v_suppliers_before, v_groups;
  end if;

  -- ─── 5) منع التكرار مستقبلاً: فهرس فريد على الاسم المطبّع ───
  execute 'create unique index if not exists pos_suppliers_name_norm_uidx on public.pos_suppliers (lower(btrim(name)))';

  raise notice 'SUPPLIER_DEDUP ✓ موردون: % ⇒ % (حُذف %)، منتجات بمورد: % (ثابت)، يتامى: 0، مجموعات مكررة متبقية: 0', v_suppliers_before, v_suppliers_after, v_deleted, v_products_after;
end $$;

-- ═══════════════════════════════════════════
-- التحقق البصري بعد التطبيق (قراءة فقط):
--
-- (١) لا تكرار متبقٍّ ⇒ 0:
--   select count(*) from (select lower(btrim(name)) from pos_suppliers group by 1 having count(*)>1) x;
--
-- (٢) عدد الموردين المتوقع: 175 − 85 = 90:
--   select count(*) from pos_suppliers;
--
-- (٣) المنتجات بمورد لم تتغير ⇒ 4445:
--   select count(*) from pos_products where supplier_id is not null;
--
-- (٤) محاولة إدخال اسم مكرر (بأي حالة أحرف/مسافات) يجب أن تُرفض:
--   insert into pos_suppliers(name) values ('  دار الخزف للمواد الصحية (11 يونيو) ');
-- ═══════════════════════════════════════════
