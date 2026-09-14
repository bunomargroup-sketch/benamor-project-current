-- ═══ 0016 — قيد الهاتف المنظّف الفريد
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-fix-phone-constraint.sql

-- إصلاح قيد الهاتف الفريد لاستثناء الهواتف الفارغة بعد التنظيف
begin;

drop index if exists pos_customers_phone_clean_uidx;

create unique index pos_customers_phone_clean_uidx
  on public.pos_customers((regexp_replace(coalesce(phone,''), '[^0-9+]', '', 'g')))
  where phone is not null
    and trim(phone) <> ''
    and regexp_replace(coalesce(phone,''), '[^0-9+]', '', 'g') <> ''
    and regexp_replace(coalesce(phone,''), '[^0-9+]', '', 'g') not in ('0','00','000');

commit;
