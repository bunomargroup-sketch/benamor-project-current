-- Benamor POS - Customer Refund finance movement type
-- Run once in Supabase SQL Editor before using negative/refund invoices.

begin;

alter table if exists public.pos_finance_movements
  drop constraint if exists pos_finance_movements_movement_type_check;

alter table if exists public.pos_finance_movements
  add constraint pos_finance_movements_movement_type_check
  check (movement_type in (
    'opening',
    'sale_payment',
    'supplier_payment',
    'customer_payment',
    'transfer_in',
    'transfer_out',
    'expense',
    'salary',
    'adjustment',
    'customer_refund'
  ));

comment on constraint pos_finance_movements_movement_type_check on public.pos_finance_movements
  is 'Allowed POS finance movement types, including customer_refund for negative return invoices.';

commit;
