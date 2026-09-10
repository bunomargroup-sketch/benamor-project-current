-- Benamor POS — تحسين الزبائن: رقم تلقائي + هاتف ثاني
-- Run this in Supabase SQL Editor

begin;

-- 1. إضافة عمود الهاتف الثاني
alter table public.pos_customers add column if not exists phone2 text;

-- 2. إضافة تسلسل لتوليد أرقام الزبائن تلقائياً
create sequence if not exists pos_customer_no_seq start 1;

-- 3. دالة توليد رقم الزبون
create or replace function public.pos_generate_customer_no()
returns trigger
language plpgsql
as $$
begin
  if new.customer_no is null or trim(new.customer_no) = '' then
    new.customer_no := 'C' || lpad(nextval('pos_customer_no_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

-- 4. تشغيل الدالة قبل الإدراج
drop trigger if exists pos_customer_no_trigger on public.pos_customers;
create trigger pos_customer_no_trigger
  before insert on public.pos_customers
  for each row execute function public.pos_generate_customer_no();

-- 5. توليد أرقام للزبائن الحاليين (الذين ليس لديهم رقم)
update public.pos_customers 
set customer_no = 'C' || lpad(nextval('pos_customer_no_seq')::text, 5, '0')
where customer_no is null or trim(customer_no) = '';

commit;

-- التحقق:
-- select customer_no, name, phone, phone2 from pos_customers order by customer_no limit 10;
