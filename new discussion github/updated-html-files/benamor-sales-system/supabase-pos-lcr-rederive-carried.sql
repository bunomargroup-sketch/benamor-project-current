-- ═══════════════════════════════════════════════════════════════════════
-- 0056 — تصحيح «محمول» في قواعد أقسام المواقع (إعادة اشتقاق من المخزون)
--
-- الواقعة المشخَّصة (2026-09-16): بعد تطبيق 0050 فُتحت شاشة قواعد الأقسام
-- وضُغط «حدد الكل» لعمود فرع 11 يونيو ثم حُفظ (إمضاء 1993 الساعة 10:25:10)
-- فصار 152 تصنيفاً «محمولاً» فيه بينما مخزونه الفعلي لا يسند إلا 74.
-- الدليل القاطع: حركات مخزون 11 يونيو منذ 14-09 ≈ 75 حركة صغيرة (بيع
-- وتحويل فقط) — فالمخزون لم يحتمل 152 تصنيفاً موجباً وقت الهجرة؛ بينما
-- السراج (154=154) وجنزور (22=22) مطابقان للمخزون بالضبط لأن عموديهما
-- لم يُمسّ. القيمة 152 = عدد التصنيفات المعروضة لحظة «حدد الكل».
--
-- الإصلاح: إعادة اشتقاق carried من المخزون الحالي — **للصفوف المتغيّرة
-- فقط** (فالسراج وجنزور لن يتغيّرا إطلاقاً: قيمهما مطابقة أصلاً، ويبقى
-- إمشاء الهجرة عليهما). التصنيفات التي يريدها المدير «محمولة» رغم نفاد
-- مخزونها تُضاف من الشاشة بعد هذا التصحيح — قراراً صريحاً لا بالخطأ.
--
-- الملف بيان واحد (كتلة DO واحدة) — لا يقسّمه SQL Editor، وآمن لإعادة
-- التشغيل (التشغيل الثاني لا يجد شيئاً يتغيّر).
-- 🔴 يُطبَّق بـ supabase db push — لا SQL من المتصفّح
-- ═══════════════════════════════════════════════════════════════════════

do $$
declare
  v_changed int;
  r record;
begin
  update public.pos_location_category_rules t
  set carried = exists (
    select 1
    from public.pos_stock s
    join public.pos_products p on p.code = s.product_code
    where s.location_id = t.location_id
      and p.category = t.category
      and s.qty > 0
  ),
  updated_at = now(),
  updated_by = 'correction-0056'
  where t.carried <> exists (
    select 1
    from public.pos_stock s
    join public.pos_products p on p.code = s.product_code
    where s.location_id = t.location_id
      and p.category = t.category
      and s.qty > 0
  );
  get diagnostics v_changed = row_count;

  for r in
    select l.name,
           count(*) filter (where t.carried) as carried_now
    from public.pos_location_category_rules t
    join public.pos_locations l on l.id = t.location_id
    group by l.name
  loop
    raise notice 'CORRECTION_0056 — %: المحمول الآن %', r.name, r.carried_now;
  end loop;

  if v_changed = 0 then
    raise notice 'CORRECTION_0056 ✓ لا تغيير — القواعد مطابقة للمخزون أصلاً';
  else
    raise notice 'CORRECTION_0056 ✓ صُحّحت % خانة لتطابق المخزون الفعلي', v_changed;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════
-- التحقق بعد التطبيق (قراءة فقط) — المتوقع على الإنتاج بعد التصحيح:
--   فرع السراج: 154 · فرع 11 يونيو: ≈74-75 · مخزن جنزور: 22
--   وكل «محمول» يسنده مخزون موجب (لا «محمول بلا مخزون» إلا بقرار لاحق)
-- ═══════════════════════════════════════════════════════════════════
-- select l.name,
--        count(*) filter (where r.carried) as carried,
--        count(*) filter (where r.carried and exists (
--          select 1 from pos_stock s join pos_products p on p.code=s.product_code
--          where s.location_id=r.location_id and p.category=r.category and s.qty>0)) as carried_with_stock
-- from pos_location_category_rules r join pos_locations l on l.id=r.location_id
-- group by l.name order by carried desc;
