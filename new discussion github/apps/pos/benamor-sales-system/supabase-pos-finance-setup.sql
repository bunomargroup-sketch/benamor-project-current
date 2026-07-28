-- Benamor Sales System - Treasuries, bank accounts, expenses, salaries
-- Run once in Supabase SQL Editor.

begin;

create table if not exists public.pos_finance_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  account_type text not null check (account_type in ('cash','bank','card')),
  location_id uuid references public.pos_locations(id) on delete set null,
  bank_name text,
  account_no text,
  accepted_methods text[],
  opening_balance numeric not null default 0,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_finance_movements (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.pos_finance_accounts(id) on delete cascade,
  movement_date date not null default current_date,
  movement_type text not null check (movement_type in ('opening','sale_payment','supplier_payment','customer_payment','transfer_in','transfer_out','expense','salary','adjustment','customer_refund')),
  direction text not null check (direction in ('in','out')),
  amount numeric not null check (amount > 0),
  reference_table text,
  reference_id uuid,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.pos_expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.pos_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  account_id uuid not null references public.pos_finance_accounts(id),
  category_id uuid references public.pos_expense_categories(id),
  title text not null,
  amount numeric not null check (amount > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  position text,
  monthly_salary numeric not null default 0,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_salary_payments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.pos_employees(id) on delete set null,
  account_id uuid not null references public.pos_finance_accounts(id),
  payment_date date not null default current_date,
  period text,
  amount numeric not null check (amount > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pos_finance_accounts_type_idx on public.pos_finance_accounts(account_type, active);
create index if not exists pos_finance_movements_account_idx on public.pos_finance_movements(account_id, movement_date desc, created_at desc);
create index if not exists pos_expenses_date_idx on public.pos_expenses(expense_date desc, created_at desc);
create index if not exists pos_salary_payments_date_idx on public.pos_salary_payments(payment_date desc, created_at desc);

-- Default expense categories
insert into public.pos_expense_categories (name) values
  ('مصاريف تشغيلية'),('إيجار'),('كهرباء ومياه'),('إنترنت واتصالات'),('صيانة'),('وقود ونقل'),('مصروفات أخرى')
on conflict (name) do nothing;

-- Default cash treasuries for sales locations
insert into public.pos_finance_accounts (name, account_type, location_id, notes)
select 'خزينة ' || l.name, 'cash', l.id, 'خزينة نقدية تلقائية للفرع'
from public.pos_locations l
where l.is_sales_location = true
on conflict (name) do nothing;

-- Default main bank/card accounts, can be renamed later
insert into public.pos_finance_accounts (name, account_type, bank_name, notes) values
  ('الحساب المصرفي الرئيسي', 'bank', 'مصرف', 'حساب مصرفي افتراضي'),
  ('حساب البطاقة الرئيسي', 'card', 'بطاقة', 'حساب بطاقات افتراضي')
on conflict (name) do nothing;

create or replace view public.pos_finance_account_balances as
select
  a.id,
  a.name,
  a.account_type,
  a.location_id,
  a.bank_name,
  a.account_no,
  a.opening_balance,
  a.active,
  a.notes,
  coalesce(a.opening_balance,0) + coalesce(sum(case when m.direction='in' then m.amount else -m.amount end),0) as balance
from public.pos_finance_accounts a
left join public.pos_finance_movements m on m.account_id = a.id
group by a.id, a.name, a.account_type, a.location_id, a.bank_name, a.account_no, a.opening_balance, a.active, a.notes;

alter table public.pos_finance_accounts enable row level security;
alter table public.pos_finance_movements enable row level security;
alter table public.pos_expense_categories enable row level security;
alter table public.pos_expenses enable row level security;
alter table public.pos_employees enable row level security;
alter table public.pos_salary_payments enable row level security;

do $$
declare t text;
begin
  foreach t in array array['pos_finance_accounts','pos_finance_movements','pos_expense_categories','pos_expenses','pos_employees','pos_salary_payments'] loop
    execute format('drop policy if exists "POS public select %1$s" on public.%1$I', t);
    execute format('drop policy if exists "POS public insert %1$s" on public.%1$I', t);
    execute format('drop policy if exists "POS public update %1$s" on public.%1$I', t);
    execute format('drop policy if exists "POS public delete %1$s" on public.%1$I', t);
    execute format('create policy "POS public select %1$s" on public.%1$I for select to anon using (true)', t);
    execute format('create policy "POS public insert %1$s" on public.%1$I for insert to anon with check (true)', t);
    execute format('create policy "POS public update %1$s" on public.%1$I for update to anon using (true) with check (true)', t);
    execute format('create policy "POS public delete %1$s" on public.%1$I for delete to anon using (true)', t);
  end loop;
end $$;

commit;
