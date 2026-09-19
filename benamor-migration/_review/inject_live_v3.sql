-- simulated kkqb live state for import_v3_corrected.sql rehearsal:
-- dirty customers (incl. a '000000' placeholder like prod), 3 live twin sales
-- (double-entered 09-09), 1 live-only post-snapshot sale (18-09),
-- 1 live transfer twin, 1 live expense twin
insert into public.pos_customers (id, customer_no, name, phone, active)
values (gen_random_uuid(), 'C-9001', 'hand sherif 1', '0943450896', true),
       (gen_random_uuid(), 'C-9002', 'hand sherif 2', '+218943450896', true),
       (gen_random_uuid(), 'C-9003', 'walk-in placeholder', '000000', true);

with l as (select (select id from public.pos_locations where name='فرع 11 يونيو') b11,
                  (select id from public.pos_locations where name='فرع السراج') sar)
insert into public.pos_sales (id, invoice_no, sale_date, location_id, customer_id, payment_method, subtotal, discount, total, paid_amount, balance_due, status, created_at)
select md5('live-twin-1')::uuid, 'تج-1', date '2026-09-09', b11, null::uuid, 'cash', 110, 0, 110, 110, 0, 'posted', now() from l
union all select md5('live-twin-2')::uuid, 'تج-2', date '2026-09-09', b11, null::uuid, 'cash', 40, 0, 40, 40, 0, 'posted', now() from l
union all select md5('live-twin-3')::uuid, 'تج-3', date '2026-09-09', (select sar from l), null::uuid, 'cash', 1400, 0, 1400, 1400, 0, 'posted', now() from l
union all select md5('live-twin-4')::uuid, 'تج-4', date '2026-09-18', b11, null::uuid, 'cash', 77.7, 0, 77.7, 77.7, 0, 'posted', now() from l;

-- live movement rows mirror the staged twin effects exactly (faithful re-entry)
insert into public.pos_stock_movements (id, movement_date, location_id, product_code, product_name, movement_type, qty_change, reference_table, reference_id, notes)
select md5('live-mv-a1')::uuid, timestamptz '2026-09-09 10:00', (select id from public.pos_locations where name='فرع السراج'), 'MC10643', 'x', 'sale', -1, 'pos_sales', md5('live-twin-1')::uuid, null
union all select md5('live-mv-a2')::uuid, timestamptz '2026-09-09 10:01', (select id from public.pos_locations where name='فرع السراج'), 'PA30370', 'x', 'sale', -3, 'pos_sales', md5('live-twin-2')::uuid, null
union all select md5('live-mv-a3')::uuid, timestamptz '2026-09-09 10:02', (select id from public.pos_locations where name='فرع السراج'), 'ALVM50206', 'x', 'sale', -1, 'pos_sales', md5('live-twin-3')::uuid, null
union all select md5('live-mv-a4')::uuid, timestamptz '2026-09-09 10:02', (select id from public.pos_locations where name='فرع السراج'), 'PLSA0550', 'x', 'sale', -6, 'pos_sales', md5('live-twin-3')::uuid, null
union all select md5('live-mv-a5')::uuid, timestamptz '2026-09-09 10:02', (select id from public.pos_locations where name='فرع السراج'), 'ARSB80270', 'x', 'sale', -1, 'pos_sales', md5('live-twin-3')::uuid, null
union all select md5('live-mv-a6')::uuid, timestamptz '2026-09-09 10:02', (select id from public.pos_locations where name='فرع السراج'), 'ARSB80660', 'x', 'sale', -1, 'pos_sales', md5('live-twin-3')::uuid, null
union all select md5('live-mv-a7')::uuid, timestamptz '2026-09-09 10:02', (select id from public.pos_locations where name='فرع السراج'), 'ARSB80139', 'x', 'sale', -1, 'pos_sales', md5('live-twin-3')::uuid, null
union all select md5('live-mv-a8')::uuid, timestamptz '2026-09-09 10:02', (select id from public.pos_locations where name='فرع السراج'), 'ARSB80029', 'x', 'sale', -1, 'pos_sales', md5('live-twin-3')::uuid, null
union all select md5('live-mv-a9')::uuid, timestamptz '2026-09-09 10:02', (select id from public.pos_locations where name='فرع السراج'), 'ML10283', 'x', 'sale', -1, 'pos_sales', md5('live-twin-3')::uuid, null
union all select md5('live-mv-a10')::uuid, timestamptz '2026-09-09 10:02', (select id from public.pos_locations where name='فرع السراج'), 'PS20515', 'x', 'sale', -1, 'pos_sales', md5('live-twin-3')::uuid, null
union all select md5('live-mv-a11')::uuid, timestamptz '2026-09-09 10:02', (select id from public.pos_locations where name='فرع السراج'), 'AASB30062', 'x', 'sale', -1, 'pos_sales', md5('live-twin-3')::uuid, null
union all select md5('live-mv-a12')::uuid, timestamptz '2026-09-09 10:02', (select id from public.pos_locations where name='فرع السراج'), 'ARSB80795', 'x', 'sale', -1, 'pos_sales', md5('live-twin-3')::uuid, null
union all select md5('live-mv-b1')::uuid, timestamptz '2026-09-18 10:00', (select id from public.pos_locations where name='فرع 11 يونيو'), 'PE30193', 'لصقة', 'sale', -1, 'pos_sales', md5('live-twin-4')::uuid, null;

insert into public.pos_stock_transfers (id, transfer_date, from_location_id, to_location_id, status, notes)
select md5('live-tr-1')::uuid, date '2026-09-09',
       (select id from public.pos_locations where name='فرع السراج'),
       (select id from public.pos_locations where name='فرع 11 يونيو'), 'posted', null;
insert into public.pos_stock_transfer_items (id, transfer_id, product_code, product_name, qty) values
 (md5('live-tri-1')::uuid, md5('live-tr-1')::uuid, 'AECU50425', 'x', 10),
 (md5('live-tri-2')::uuid, md5('live-tr-1')::uuid, 'EG30863', 'x', 1),
 (md5('live-tri-3')::uuid, md5('live-tr-1')::uuid, 'ARSB80781', 'x', 4);
insert into public.pos_stock_movements (id, movement_date, location_id, product_code, product_name, movement_type, qty_change, reference_table, reference_id, notes)
select md5('live-mv-c1')::uuid, timestamptz '2026-09-09 11:00', (select id from public.pos_locations where name='فرع السراج'), 'AECU50425', 'x', 'transfer_out', -10, 'pos_stock_transfers', md5('live-tr-1')::uuid, null
union all select md5('live-mv-c2')::uuid, timestamptz '2026-09-09 11:00', (select id from public.pos_locations where name='فرع السراج'), 'EG30863', 'x', 'transfer_out', -1, 'pos_stock_transfers', md5('live-tr-1')::uuid, null
union all select md5('live-mv-c3')::uuid, timestamptz '2026-09-09 11:00', (select id from public.pos_locations where name='فرع السراج'), 'ARSB80781', 'x', 'transfer_out', -4, 'pos_stock_transfers', md5('live-tr-1')::uuid, null
union all select md5('live-mv-c4')::uuid, timestamptz '2026-09-09 11:00', (select id from public.pos_locations where name='فرع 11 يونيو'), 'AECU50425', 'x', 'transfer_in', 10, 'pos_stock_transfers', md5('live-tr-1')::uuid, null
union all select md5('live-mv-c5')::uuid, timestamptz '2026-09-09 11:00', (select id from public.pos_locations where name='فرع 11 يونيو'), 'EG30863', 'x', 'transfer_in', 1, 'pos_stock_transfers', md5('live-tr-1')::uuid, null
union all select md5('live-mv-c6')::uuid, timestamptz '2026-09-09 11:00', (select id from public.pos_locations where name='فرع 11 يونيو'), 'ARSB80781', 'x', 'transfer_in', 4, 'pos_stock_transfers', md5('live-tr-1')::uuid, null;

insert into public.pos_expenses (id, expense_date, location_id, account_id, title, amount, notes)
select md5('live-ex-1')::uuid, date '2026-09-09', (select id from public.pos_locations where name='فرع السراج'),
       (select id from public.pos_finance_accounts order by name limit 1), 'حواله', 70, null;
