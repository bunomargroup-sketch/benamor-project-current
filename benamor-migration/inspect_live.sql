-- READ-ONLY inspection of live production state before the corrected re-run. Writes nothing.
\set ON_ERROR_STOP on
\echo '=== live vs imported profile'
select 'live_sales (notes not old-ticket)' t, count(*) from public.pos_sales where notes is null or notes not like 'old_ticket_id=%'
union all select '  of which dated 2026-09-16 or later', count(*) from public.pos_sales where (notes is null or notes not like 'old_ticket_id=%') and sale_date >= date '2026-09-16'
union all select 'imported_sales (old-ticket)', count(*) from public.pos_sales where notes like 'old_ticket_id=%'
union all select 'live_sale_payments', count(*) from public.pos_sale_payments p join public.pos_sales s on s.id = p.sale_id where (s.notes is null or s.notes not like 'old_ticket_id=%')
union all select 'live_stock_rows', count(*) from public.pos_stock st where not exists (select 1 from public.pos_products p where p.code = st.product_code and p.created_at >= now() - interval '30 days') and true
union all select 'live_stock_rows_qty_zero', count(*) from public.pos_stock where qty = 0
union all select 'live_stock_rows_qty_nonzero', count(*) from public.pos_stock where qty <> 0
union all select 'live_movement_rows', count(*) from public.pos_stock_movements where notes is null or notes not like 'حركة 2026 من النظام القديم%'
union all select 'live_purchases', count(*) from public.pos_purchases where notes is null or notes not like 'old_id=%'
\echo '=== duplicate candidates: live sales matching staged old invoice by date+total'
create temp table cmp_probe as
select s_old.id as old_id, s_live.id as live_id, s_old.invoice_no, s_old.sale_date, s_old.total, s_old.customer_id, s_live.customer_id as live_cust
from public.pos_sales s_old
join public.pos_sales s_live on s_live.sale_date = s_old.sale_date and s_live.total = s_old.total
where s_old.notes like 'old_ticket_id=%' and (s_live.notes is null or s_live.notes not like 'old_ticket_id=%');
select 'candidate_pairs_by_date_total' t, count(*) from cmp_probe
union all select '  of which same_customer (mapped)', count(*) from cmp_probe c join public.pos_customers cu_old on cu_old.id = c.customer_id and cu_old.id = c.live_cust;
\echo '=== sample of a few pairs for eyeball'
select invoice_no, sale_date, total from cmp_probe order by sale_date limit 10;
\echo '=== stock provenance probe: a product the old system moved a lot in 2026'
select st.qty as live_qty, (select count(*) from public.pos_stock_movements m where m.product_code='PE30193' and m.location_id=st.location_id) as live_movement_rows
from public.pos_stock st join public.pos_locations l on l.id = st.location_id
where st.product_code='PE30193' order by l.name;
