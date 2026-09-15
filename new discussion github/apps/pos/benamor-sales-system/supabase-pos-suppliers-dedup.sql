-- ═══ 0049 — تنظيف الموردين المكرّرين (بيانات) + فهرس فريد يمنع التكرار مستقبلاً
-- المصدر: apps/pos/benamor-sales-system/supabase-pos-suppliers-dedup.sql
--
-- الوقائع المقيسة على الإنتاج (2026-09-15) التي يتحقق منها هذا الملف داخل المعاملة:
--   • pos_suppliers = 175 صفاً، منها 85 اسماً مكرّراً مرّتين بالضبط
--   • pos_purchases و pos_supplier_ledger و pos_supplier_payments = صفر صف
--   • لا مورّد برصيد افتتاحي ≠ 0
--   • 4445 من 4453 منتجاً لها supplier_id
--   • في 84 مجموعة: كل المنتجات على نسخة واحدة والأخرى فارغة
--   • في مجموعة واحدة فقط («دار الخزف للمواد الصحية (11 يونيو)») مقسّمة 687/1
--
-- القواعد:
--   الباقي في كل مجموعة = النسخة ذات المنتجات الأكثر (وعند التساوي: الأقدم created_at)
--   النقل: pos_products.supplier_id من المحذوفة إلى الباقية — لا شيء آخر في المنتجات
--   الحذف: النسخ التي اسمها مكرّر ومنتجاتها صفر بعد النقل — حصراً
--   لا يُحذف أي صف لا يطابق اسمه (المطابقة بمفتاح مطبّع lower(btrim(name)))
--
-- 🔴 يُطبَّق بـ supabase db push (أو تنزيل الملف raw وتشغيله دفعة واحدة) — ليس من المتصفح
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ─────────────────────────────────────────────
-- 0) عدّادات ما قبل التنظيف
-- ─────────────────────────────────────────────
create temp table _dedup_pre on commit drop as
  select
    (select count(*) from public.pos_suppliers) as suppliers_before,
    (select count(*) from public.pos_products where supplier_id is not null) as products_with_supplier_before,
    (select count(*) from public.pos_purchases) as purchases_count,
    (select count(*) from public.pos_supplier_ledger) as ledger_count,
    (select count(*) from public.pos_supplier_payments) as payments_count,
    (select count(*) from public.pos_suppliers where coalesce(opening_balance,0) <> 0) as with_opening_balance;

-- ─────────────────────────────────────────────
-- 1) مجموعات التكرار بالمفتاح المطبّع
-- ─────────────────────────────────────────────
create temp table _dupkeys on commit drop as
  select lower(btrim(name)) as key, count(*) as copies
  from public.pos_suppliers
  group by lower(btrim(name))
  having count(*) > 1;

-- ─────────────────────────────────────────────
-- 2) كل نسخة مكررة وعدد منتجاتها
-- ─────────────────────────────────────────────
create temp table _copies on commit drop as
  select s.id, d.key, s.name, s.created_at,
         (select count(*) from public.pos_products p where p.supplier_id = s.id) as n_products
  from public.pos_suppliers s
  join _dupkeys d on d.key = lower(btrim(s.name));

-- الباقية: الأكثر منتجات، وعند التساوي الأقدم
create temp table _keeper on commit drop as
  select distinct on (key) key, id as keep_id
  from _copies
  order by key, n_products desc, created_at asc;

-- المحذوفة المرشّحة: كل نسخة غير باقية في مجموعتها
create temp table _losers on commit drop as
  select c.id, c.key, c.n_products
  from _copies c
  join _keeper k on k.key = c.key
  where c.id <> k.keep_id;

-- ─────────────────────────────────────────────
-- 3) النقل: منتجات النسخ المحذوفة ← النسخة الباقية
--    (لا يُلمس من pos_products غير عمود supplier_id)
-- ─────────────────────────────────────────────
update public.pos_products p
set supplier_id = k.keep_id
from _losers l
join _keeper k on k.key = l.key
where p.supplier_id = l.id;

-- ─────────────────────────────────────────────
-- 4) الحذف: النسخ المكرّرة التي صارت بلا منتجات بعد النقل
-- ─────────────────────────────────────────────
create temp table _deleted (id uuid, name text) on commit drop;

with del as (
  delete from public.pos_suppliers s
  using _losers l
  where s.id = l.id
    and not exists (select 1 from public.pos_products p where p.supplier_id = s.id)
  returning s.id, s.name
)
insert into _deleted select id, name from del;

-- ─────────────────────────────────────────────
-- 5) التحقّق داخل المعاملة — أي اختلال يفشل صراحةً ويلغي كل شيء
-- ─────────────────────────────────────────────
do $$
declare
  v_suppliers_before int; v_products_before int;
  v_purchases int; v_ledger int; v_payments int; v_opening int;
  v_groups int; v_losers int; v_deleted int; v_survivors int;
  v_suppliers_after int; v_products_after int;
  v_orphans int; v_remaining_dups int;
  v_moved_missing int;  -- منتجات نُقلت ثم ضاعت (يجب أن يكون 0 بنيوياً)
begin
  select suppliers_before, products_with_supplier_before, purchases_count, ledger_count, payments_count, with_opening_balance
    into v_suppliers_before, v_products_before, v_purchases, v_ledger, v_payments, v_opening
  from _dedup_pre;
  select count(*) into v_groups from _dupkeys;
  select count(*) into v_losers from _losers;
  select count(*) into v_deleted from _deleted;
  select count(*) into v_suppliers_after from public.pos_suppliers;
  select count(*) into v_products_after from public.pos_products where supplier_id is not null;
  select count(*) into v_orphans from public.pos_products p
    where p.supplier_id is not null
      and not exists (select 1 from public.pos_suppliers s where s.id = p.supplier_id);
  select count(*) into v_remaining_dups from (
    select lower(btrim(name)) from public.pos_suppliers
    group by lower(btrim(name)) having count(*) > 1
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

  -- (٤) لم يُحذف أي مورّد له منتجات (كل محذوف كان صفر المنتجات بعد النقل)
  if v_deleted <> v_losers then
    raise exception 'SUPPLIER_DEDUP_LOSER_SURVIVED: مرشّحو الحذف % والمحذوفون % — نسخة لها منتجات لم تُحذف (راجع)', v_losers, v_deleted;
  end if;

  -- (٥) لا تكرار مطبّع متبقٍّ (الفهرس الفريد أدناه سيفرضه هيكلياً أيضاً)
  if v_remaining_dups <> 0 then
    raise exception 'SUPPLIER_DEDUP_REMAINING_DUPS: %', v_remaining_dups;
  end if;

  -- توقيع الإنتاج المقيس: إذا كانت البيانات هي بيانات الإنتاج المقيسة فيتفق العدد بدقة
  if v_suppliers_before = 175 then
    if v_groups <> 85 then
      raise exception 'SUPPLIER_DEDUP_SNAPSHOT_DRIFT: توقّعنا 85 مجموعة مكررة ووجدنا % — أعد القياس قبل المتابعة', v_groups;
    end if;
    if v_deleted <> 85 then
      raise exception 'SUPPLIER_DEDUP_SNAPSHOT_DRIFT: توقّعنا حذف 85 ووجدنا %', v_deleted;
    end if;
    if v_products_before <> 4445 then
      raise exception 'SUPPLIER_DEDUP_SNAPSHOT_DRIFT: توقّعنا 4445 منتجاً بمورد ووجدنا %', v_products_before;
    end if;
    if v_purchases <> 0 or v_ledger <> 0 or v_payments <> 0 then
      raise exception 'SUPPLIER_DEDUP_SNAPSHOT_DRIFT: فواتير/قيود/دفعات الموردين لم تعد صفراً (%/%/%) — أعد القياس', v_purchases, v_ledger, v_payments;
    end if;
    if v_opening <> 0 then
      raise exception 'SUPPLIER_DEDUP_SNAPSHOT_DRIFT: يوجد % مورداً برصيد افتتاحي ≠ 0 — أعد القياس', v_opening;
    end if;
  else
    raise notice 'SUPPLIER_DEDUP: قاعدة ليست توقيع الإنتاج (موردون=%، مجموعات=%) — فحوص اللقطة التقديرية تُتخطى والثوابت كلها مفحوصة', v_suppliers_before, v_groups;
  end if;

  raise notice 'SUPPLIER_DEDUP ✓ موردون: % ⇒ % (حُذف %)، منتجات بمورد: % (ثابت)، يتامى: 0', v_suppliers_before, v_suppliers_after, v_deleted, v_products_after;
end $$;

-- ─────────────────────────────────────────────
-- 6) منع التكرار مستقبلاً: فهرس فريد على الاسم المطبّع
--    (فشله = التنظيف لم يكتمل — لا تتجاوزه؛ المعاملة كلها تُلغى)
-- ─────────────────────────────────────────────
create unique index if not exists pos_suppliers_name_norm_uidx
  on public.pos_suppliers (lower(btrim(name)));

commit;

-- ═══════════════════════════════════════════
-- التحقق البصري بعد التطبيق (اختياري — قراءة فقط):
--
-- (١) لا تكرار متبقٍّ:
--   select count(*) from (select lower(btrim(name)) from pos_suppliers group by 1 having count(*)>1) x;
--   ⇒ 0
--
-- (٢) عدد الموردين المتوقع: 175 − 85 = 90
--   select count(*) from pos_suppliers;  ⇒ 90
--
-- (٣) المنتجات بمورد لم تتغير:
--   select count(*) from pos_products where supplier_id is not null;  ⇒ 4445
--
-- (٤) محاولة إدخال اسم مكرر (بأي حالة أحرف/مسافات) يجب أن تُرفض:
--   insert into pos_suppliers(name) values ('  دار الخزف للمواد الصحية (11 يونيو) ');
--   ⇒ ERROR: duplicate key value violates unique constraint "pos_suppliers_name_norm_uidx"
-- ═══════════════════════════════════════════
