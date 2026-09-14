-- ═══ 0015 — العدّادات المركزية + تريغرات الترقيم + تحديث الـ views
-- المصدر (نسخة حرفية بلا تعديل إلا ما يوسم بـ ⚙️ إصلاح سلسلة): apps/pos/benamor-sales-system/supabase-pos-numbering-setup.sql
-- الترتيب داخل supabase/migrations هو ترتيب التنفيذ المعتمد لقاعدة فارغة

-- Benamor Sales System - SAFE unique numbering setup
-- This version is safe even if optional modules (like proformas) are not installed yet.
-- Run in Supabase SQL Editor.

begin;

create table if not exists public.pos_number_counters (
  key text primary key,
  last_value bigint not null default 0,
  updated_at timestamptz not null default now()
);

create or replace function public.next_pos_number(p_key text, p_prefix text, p_width int default 6)
returns text
language plpgsql
security definer
as $$
declare n bigint;
begin
  insert into public.pos_number_counters(key,last_value,updated_at)
  values (p_key, 1, now())
  on conflict (key) do update
    set last_value = public.pos_number_counters.last_value + 1,
        updated_at = now()
  returning last_value into n;
  return p_prefix || lpad(n::text, p_width, '0');
end;
$$;

-- Trigger functions
create or replace function public.trg_pos_products_number() returns trigger language plpgsql as $$
begin if new.product_no is null or trim(new.product_no)='' then new.product_no := public.next_pos_number('product','P-',6); end if; return new; end; $$;

create or replace function public.trg_pos_customers_number() returns trigger language plpgsql as $$
begin if new.customer_no is null or trim(new.customer_no)='' then new.customer_no := public.next_pos_number('customer','C-',6); end if; return new; end; $$;

create or replace function public.trg_pos_sales_number() returns trigger language plpgsql as $$
begin if new.invoice_no is null or trim(new.invoice_no)='' then new.invoice_no := public.next_pos_number('sale','S-',6); end if; return new; end; $$;

create or replace function public.trg_pos_purchases_number() returns trigger language plpgsql as $$
begin if new.purchase_no is null or trim(new.purchase_no)='' then new.purchase_no := public.next_pos_number('purchase','PU-',6); end if; return new; end; $$;

create or replace function public.trg_pos_proformas_number() returns trigger language plpgsql as $$
begin if new.proforma_no is null or trim(new.proforma_no)='' then new.proforma_no := public.next_pos_number('proforma','PF-',6); end if; return new; end; $$;

create or replace function public.trg_pos_sale_returns_number() returns trigger language plpgsql as $$
begin if new.return_no is null or trim(new.return_no)='' then new.return_no := public.next_pos_number('sale_return','SR-',6); end if; return new; end; $$;

create or replace function public.trg_pos_stock_transfers_number() returns trigger language plpgsql as $$
begin if new.transfer_no is null or trim(new.transfer_no)='' then new.transfer_no := public.next_pos_number('stock_transfer','TR-',6); end if; return new; end; $$;

-- Products
DO $$
begin
  if to_regclass('public.pos_products') is not null then
    execute 'alter table public.pos_products add column if not exists product_no text';
    execute 'update public.pos_products set product_no = public.next_pos_number(''product'',''P-'',6) where product_no is null or trim(product_no)='''' ';
    execute 'create unique index if not exists pos_products_product_no_uidx on public.pos_products(product_no) where product_no is not null and trim(product_no) <> '''' ';
    execute 'drop trigger if exists set_pos_products_number on public.pos_products';
    execute 'create trigger set_pos_products_number before insert on public.pos_products for each row execute function public.trg_pos_products_number()';
  end if;
end $$;

-- Customers
-- ⚙️ إصلاح سلسلة: إسقاط الـ views قبل إعادة تعريفها — النسخ الجديدة تضيف أعمدة (customer_no/product_no)
--    بترتيب مختلف فترفض Postgres الاستبدال المباشر
drop view if exists public.pos_customer_balances;
drop view if exists public.pos_product_stock_summary;
DO $$
begin
  if to_regclass('public.pos_customers') is not null then
    execute 'alter table public.pos_customers add column if not exists customer_no text';
    execute 'update public.pos_customers set customer_no = public.next_pos_number(''customer'',''C-'',6) where customer_no is null or trim(customer_no)='''' ';
    execute 'create unique index if not exists pos_customers_customer_no_uidx on public.pos_customers(customer_no) where customer_no is not null and trim(customer_no) <> '''' ';
    execute 'drop trigger if exists set_pos_customers_number on public.pos_customers';
    execute 'create trigger set_pos_customers_number before insert on public.pos_customers for each row execute function public.trg_pos_customers_number()';
  end if;
end $$;

-- Sales
DO $$
begin
  if to_regclass('public.pos_sales') is not null then
    execute 'update public.pos_sales set invoice_no = public.next_pos_number(''sale'',''S-'',6) where invoice_no is null or trim(invoice_no)='''' ';
    execute 'with d as (select id, invoice_no, row_number() over(partition by invoice_no order by created_at,id) rn from public.pos_sales where invoice_no is not null and trim(invoice_no) <> '''') update public.pos_sales s set invoice_no = public.next_pos_number(''sale'',''S-'',6) from d where s.id=d.id and d.rn>1';
    execute 'create unique index if not exists pos_sales_invoice_no_uidx on public.pos_sales(invoice_no) where invoice_no is not null and trim(invoice_no) <> '''' ';
    execute 'drop trigger if exists set_pos_sales_number on public.pos_sales';
    execute 'create trigger set_pos_sales_number before insert on public.pos_sales for each row execute function public.trg_pos_sales_number()';
  end if;
end $$;

-- Purchases
DO $$
begin
  if to_regclass('public.pos_purchases') is not null then
    execute 'alter table public.pos_purchases add column if not exists purchase_no text';
    execute 'update public.pos_purchases set purchase_no = public.next_pos_number(''purchase'',''PU-'',6) where purchase_no is null or trim(purchase_no)='''' ';
    execute 'create unique index if not exists pos_purchases_purchase_no_uidx on public.pos_purchases(purchase_no) where purchase_no is not null and trim(purchase_no) <> '''' ';
    execute 'drop trigger if exists set_pos_purchases_number on public.pos_purchases';
    execute 'create trigger set_pos_purchases_number before insert on public.pos_purchases for each row execute function public.trg_pos_purchases_number()';
  end if;
end $$;

-- Proformas - skipped safely if table does not exist
DO $$
begin
  if to_regclass('public.pos_proformas') is not null then
    execute 'update public.pos_proformas set proforma_no = public.next_pos_number(''proforma'',''PF-'',6) where proforma_no is null or trim(proforma_no)='''' ';
    execute 'with d as (select id, proforma_no, row_number() over(partition by proforma_no order by created_at,id) rn from public.pos_proformas where proforma_no is not null and trim(proforma_no) <> '''') update public.pos_proformas p set proforma_no = public.next_pos_number(''proforma'',''PF-'',6) from d where p.id=d.id and d.rn>1';
    execute 'create unique index if not exists pos_proformas_proforma_no_uidx on public.pos_proformas(proforma_no) where proforma_no is not null and trim(proforma_no) <> '''' ';
    execute 'drop trigger if exists set_pos_proformas_number on public.pos_proformas';
    execute 'create trigger set_pos_proformas_number before insert on public.pos_proformas for each row execute function public.trg_pos_proformas_number()';
  end if;
end $$;

-- Sale returns - skipped safely if table does not exist
DO $$
begin
  if to_regclass('public.pos_sale_returns') is not null then
    execute 'alter table public.pos_sale_returns add column if not exists return_no text';
    execute 'update public.pos_sale_returns set return_no = public.next_pos_number(''sale_return'',''SR-'',6) where return_no is null or trim(return_no)='''' ';
    execute 'create unique index if not exists pos_sale_returns_return_no_uidx on public.pos_sale_returns(return_no) where return_no is not null and trim(return_no) <> '''' ';
    execute 'drop trigger if exists set_pos_sale_returns_number on public.pos_sale_returns';
    execute 'create trigger set_pos_sale_returns_number before insert on public.pos_sale_returns for each row execute function public.trg_pos_sale_returns_number()';
  end if;
end $$;

-- Stock transfers
DO $$
begin
  if to_regclass('public.pos_stock_transfers') is not null then
    execute 'alter table public.pos_stock_transfers add column if not exists transfer_no text';
    execute 'update public.pos_stock_transfers set transfer_no = public.next_pos_number(''stock_transfer'',''TR-'',6) where transfer_no is null or trim(transfer_no)='''' ';
    execute 'create unique index if not exists pos_stock_transfers_transfer_no_uidx on public.pos_stock_transfers(transfer_no) where transfer_no is not null and trim(transfer_no) <> '''' ';
    execute 'drop trigger if exists set_pos_stock_transfers_number on public.pos_stock_transfers';
    execute 'create trigger set_pos_stock_transfers_number before insert on public.pos_stock_transfers for each row execute function public.trg_pos_stock_transfers_number()';
  end if;
end $$;

-- Recreate product summary view only if required tables exist
DO $$
begin
  if to_regclass('public.pos_products') is not null and to_regclass('public.pos_stock') is not null and to_regclass('public.pos_locations') is not null then
    execute 'drop view if exists public.pos_product_stock_summary';
    execute $v$
      create view public.pos_product_stock_summary as
      select
        p.product_no,
        p.code,
        p.name,
        p.brand,
        p.model,
        p.color,
        p.barcode,
        p.category,
        p.purchase_price,
        p.retail_price,
        p.reorder_point,
        s.name as supplier_name,
        coalesce(sum(st.qty) filter (where l.name = 'فرع 11 يونيو'), 0) as stock_11_june,
        coalesce(sum(st.qty) filter (where l.name = 'فرع السراج'), 0) as stock_sarraj,
        coalesce(sum(st.qty) filter (where l.name = 'مخزن جنزور'), 0) as stock_janzour,
        coalesce(sum(st.qty), 0) as total_stock
      from public.pos_products p
      left join public.pos_suppliers s on s.id = p.supplier_id
      left join public.pos_stock st on st.product_code = p.code
      left join public.pos_locations l on l.id = st.location_id
      group by p.product_no, p.code, p.name, p.brand, p.model, p.color, p.barcode, p.category, p.purchase_price, p.retail_price, p.reorder_point, s.name
    $v$;
  end if;
end $$;

-- Recreate customer balances view only if required tables exist
DO $$
begin
  if to_regclass('public.pos_customers') is not null and to_regclass('public.pos_customer_ledger') is not null then
    execute $v$
      create or replace view public.pos_customer_balances as
      select
        c.id,
        c.customer_no,
        c.name,
        c.phone,
        c.address,
        c.notes,
        c.active,
        coalesce(sum(l.debit - l.credit), 0) as balance,
        case
          when coalesce(sum(l.debit - l.credit), 0) > 0 then 'على الزبون'
          when coalesce(sum(l.debit - l.credit), 0) < 0 then 'للزبون رصيد'
          else 'متوازن'
        end as balance_status
      from public.pos_customers c
      left join public.pos_customer_ledger l on l.customer_id = c.id
      group by c.id, c.customer_no, c.name, c.phone, c.address, c.notes, c.active
    $v$;
  end if;
end $$;

commit;
