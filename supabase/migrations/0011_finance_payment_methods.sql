-- ═══ 0011 — أعمدة طرق الدفع المقبولة (مشغّل في الإنتاج — يضيف العمود آخر الجدول)
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-finance-payment-methods-setup.sql

-- Benamor POS - Finance account accepted payment methods
-- Run once in Supabase SQL Editor before using bank/card method configuration.

begin;

alter table if exists public.pos_finance_accounts
  add column if not exists accepted_methods text[];

update public.pos_finance_accounts
set accepted_methods = case
  when account_type = 'cash' then array['cash']::text[]
  when account_type = 'card' then array['card']::text[]
  when account_type = 'bank' and (accepted_methods is null or cardinality(accepted_methods)=0) then array['bank_transfer']::text[]
  else accepted_methods
end
where accepted_methods is null or cardinality(accepted_methods)=0;

alter table if exists public.pos_finance_accounts
  drop constraint if exists pos_finance_accounts_accepted_methods_check;

alter table if exists public.pos_finance_accounts
  add constraint pos_finance_accounts_accepted_methods_check
  check (
    accepted_methods is null or
    accepted_methods <@ array['cash','bank_transfer','card']::text[]
  );

commit;
