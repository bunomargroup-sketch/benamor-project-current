-- Benamor POS - Customers code/phone uniqueness hardening
-- Run before importing customers.

begin;

alter table public.pos_customers
  add column if not exists customer_no text;

-- These indexes ignore empty values. If this fails, check duplicates in existing DB first.
create unique index if not exists pos_customers_customer_no_uidx
  on public.pos_customers(customer_no)
  where customer_no is not null and trim(customer_no) <> '';

create unique index if not exists pos_customers_phone_clean_uidx
  on public.pos_customers((regexp_replace(coalesce(phone,''), '[^0-9+]', '', 'g')))
  where phone is not null
    and trim(phone) <> ''
    and regexp_replace(coalesce(phone,''), '[^0-9+]', '', 'g') not in ('0','00','000');

commit;
