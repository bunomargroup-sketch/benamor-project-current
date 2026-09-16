set search_path = mig, "OpenConcerto68";

-- payments per ticket (already rebuilt via element/echeance link)
drop view if exists mig.pos_customer_ledger;
drop view if exists mig.pos_sales cascade;

create or replace view mig.pos_sales as
with pay as (
  select sale_id, sum(amount) paid,
         sum(amount) filter (where payment_method = 'card') card_paid
  from mig.pos_sale_payments group by 1
),
tk as (
  select mig.uid('sale', t."ID") as id, nullif(trim(t."NUMERO"),'') as invoice_no, t."DATE"::date as sale_date,
         lm.new_name as location_name,
         case when t."ID_CLIENT" > 1 and cl."CODE" <> '9999' then mig.uid('customer', t."ID_CLIENT") end as customer_id,
         mig.lyd(t."TOTAL_TTC_SANS_REMISE") as subtotal, mig.lyd(t."MONTANT_REMISE_TTC") as discount, mig.lyd(t."TOTAL_TTC") as total,
         0::numeric as open_balance_override,
         concat_ws(' | ', 'old_ticket_id=' || t."ID", 'caisse=' || coalesce(ca."NOM",''), nullif(trim(t."NOM_CLIENT"),'')) as notes,
         t."CREATION_DATE" as created_at, t."ID" as old_id, 'ticket' as source
  from "TICKET_CAISSE" t
  left join "CAISSE" ca on ca."ID" = t."ID_CAISSE"
  left join "CLIENT" cl on cl."ID" = t."ID_CLIENT"
  left join mig.location_map lm on lm.kind = 'caisse' and lm.old_id = coalesce(nullif(t."ID_CAISSE",0),1)
  where t."ARCHIVE" = 0 and t."ID" > 1 and t."DATE" is not null
  union all
  select mig.uid('invoice', f."ID"), nullif(trim(f."NUMERO"),''), f."DATE"::date,
         lm.new_name,
         case when f."ID_CLIENT" > 1 then mig.uid('customer', f."ID_CLIENT") end,
         mig.lyd(f."MONTANT_TTC_BRUT"), mig.lyd(f."MONTANT_TTC_BRUT") - mig.lyd(f."T_TTC"), mig.lyd(f."T_TTC"),
         coalesce((select mig.lyd(sum(e."MONTANT")) from "ECHEANCE_CLIENT" e where e."ID_SAISIE_VENTE_FACTURE" = f."ID" and not e."REGLE" and e."ARCHIVE" = 0), 0),
         concat_ws(' | ', 'old_invoice_id=' || f."ID", nullif(trim(f."INFOS"),'')),
         f."DATE", f."ID", 'invoice'
  from "SAISIE_VENTE_FACTURE" f
  left join mig.location_map lm on lm.kind = 'depot' and lm.old_id = coalesce(nullif(f."ID_DEPOT",0),1)
  where f."ARCHIVE" = 0 and f."ID" > 1 and f."DATE" is not null and f."T_TTC" <> 0
)
select tk.id, tk.invoice_no, tk.sale_date, tk.location_name, tk.customer_id,
       case when bal > 0 and paid_amt > 0 then 'mixed'
            when bal > 0 then 'credit'
            when coalesce(p.card_paid,0) > 0 then 'card'
            else 'cash' end as payment_method,
       tk.subtotal, tk.discount, tk.total,
       paid_amt as paid_amount,
       bal as balance_due,
       'posted' as status, tk.notes, tk.created_at, tk.old_id, tk.source
from tk
left join pay p on p.sale_id = tk.id
cross join lateral (
  select case when tk.source = 'invoice' then tk.total - tk.open_balance_override
              else least(coalesce(p.paid,0), greatest(tk.total,0)) end as paid_amt,
         case when tk.source = 'invoice' then tk.open_balance_override
              else greatest(tk.total - coalesce(p.paid,0), 0) end as bal
) x;

-- invoice lines for the formal invoices
create or replace view mig.pos_sale_items as
select mig.uid('sale_item', e."ID") as id,
       case when e."ID_TICKET_CAISSE" > 1 then mig.uid('sale', e."ID_TICKET_CAISSE") else mig.uid('invoice', e."ID_SAISIE_VENTE_FACTURE") end as sale_id,
       trim(e."CODE") as product_code, trim(e."NOM") as product_name,
       e."QTE"::numeric as qty, round(e."PV_TTC"::numeric, 3) as unit_price,
       round((e."QTE" * e."PV_TTC" * coalesce(e."POURCENT_REMISE",0) / 100.0)::numeric, 3) as line_discount,
       case when coalesce(e."POURCENT_REMISE",0) <> 0 then e."POURCENT_REMISE" || '%' else '' end as discount_text,
       round(e."T_PV_TTC"::numeric, 3) as line_total, round(e."PA_HT"::numeric, 3) as unit_cost_at_sale, e."ID" as old_id
from "SAISIE_VENTE_FACTURE_ELEMENT" e
where e."ARCHIVE" = 0 and trim(e."CODE") <> '' and e."QTE" <> 0
  and ( (e."ID_TICKET_CAISSE" > 1 and exists (select 1 from "TICKET_CAISSE" t where t."ID" = e."ID_TICKET_CAISSE" and t."ARCHIVE" = 0))
     or (e."ID_TICKET_CAISSE" <= 1 and e."ID_SAISIE_VENTE_FACTURE" > 1 and exists (select 1 from "SAISIE_VENTE_FACTURE" f where f."ID" = e."ID_SAISIE_VENTE_FACTURE" and f."ARCHIVE" = 0 and f."T_TTC" <> 0)) );

-- customer ledger: debit at sale for the part not paid on the sale day; credit for payments made on later days
create or replace view mig.pos_customer_ledger as
with later as (
  select p.sale_id, p.id pay_id, p.payment_date, p.amount from mig.pos_sale_payments p
  join mig.pos_sales s on s.id = p.sale_id where p.payment_date > s.sale_date and s.customer_id is not null
)
select mig.uid('cl_sale', s.old_id) as id, s.customer_id, s.sale_date as entry_date, 'sale' as entry_type,
       'فاتورة بيع رقم ' || coalesce(s.invoice_no,'') as description,
       s.balance_due + coalesce((select sum(amount) from later l where l.sale_id = s.id),0) as debit, 0::numeric as credit,
       'pos_sales' as reference_table, s.id as reference_id
from mig.pos_sales s
where s.customer_id is not null and s.balance_due + coalesce((select sum(amount) from later l where l.sale_id = s.id),0) > 0
union all
select l.pay_id, s.customer_id, l.payment_date, 'payment', 'دفعة على فاتورة ' || coalesce(s.invoice_no,''), 0, l.amount, 'pos_sale_payments', l.pay_id
from later l join mig.pos_sales s on s.id = l.sale_id;

drop table if exists mig.t_pos_sales; create table mig.t_pos_sales as select * from mig.pos_sales; create index on mig.t_pos_sales(id);
drop table if exists mig.t_pos_sale_items; create table mig.t_pos_sale_items as select * from mig.pos_sale_items; create index on mig.t_pos_sale_items(sale_id);
drop table if exists mig.t_pos_customer_ledger; create table mig.t_pos_customer_ledger as select * from mig.pos_customer_ledger;
