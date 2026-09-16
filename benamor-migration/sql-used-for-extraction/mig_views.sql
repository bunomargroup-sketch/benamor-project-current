-- Migration views: OpenConcerto68 (old Cadence/SCom) -> pos_* shape (new Supabase POS)
-- Runs only inside the temporary database migration_tmp. Read-only on the source.
set search_path = mig, "OpenConcerto68";
create schema if not exists mig;

-- deterministic UUIDs so re-runs produce identical ids
create or replace function mig.uid(kind text, id bigint) returns uuid language sql immutable as
$$ select md5('benamor-mig:' || kind || ':' || id)::uuid $$;

-- amounts in document headers are stored x1000 (LYD, 3 decimals)
create or replace function mig.lyd(v numeric) returns numeric language sql immutable as
$$ select round(coalesce(v,0) / 1000.0, 3) $$;

-- ---------------------------------------------------------------- locations
drop table if exists mig.location_map cascade;
create table mig.location_map (kind text, old_id bigint, old_name text, new_name text, primary key (kind, old_id));
insert into mig.location_map values
 ('depot', 13,        'مخزن 11 يونيو',     'فرع 11 يونيو'),
 ('depot', 12,        'مخزن السراج',       'فرع السراج'),
 ('depot', 210000014, 'جنزور',             'مخزن جنزور'),
 ('depot', 1,         'Indéfini',          'فرع السراج'),
 ('caisse', 4,         'الخزينة الرئيسية',  'فرع السراج'),
 ('caisse', 210000005, 'خزينة مواد البناء', 'فرع السراج'),
 ('caisse', 310000005, 'خزينة 11 يونيو',    'فرع 11 يونيو'),
 ('caisse', 1,         '(none)',            'فرع السراج');

-- ---------------------------------------------------------------- suppliers
create or replace view mig.pos_suppliers as
select mig.uid('supplier', f."ID") as id,
       trim(f."NOM") as name,
       nullif(trim(coalesce(f."TEL", f."TEL_P")), '') as phone,
       nullif(trim(f."ADRESSE"), '') as address,
       concat_ws(' | ', nullif(trim(f."CODE"),''), nullif(trim(f."INFOS"),''), 'old_id=' || f."ID") as notes,
       0::numeric as opening_balance,
       true as active,
       f."ID" as old_id, f."CODE" as old_code
from "FOURNISSEUR" f
where f."ARCHIVE" = 0 and f."ID" > 1 and trim(f."NOM") <> '';

-- ---------------------------------------------------------------- products
create or replace view mig.pos_products as
select a."CODE" as code,
       trim(a."NOM") as name,
       nullif(trim(m."DESIGNATION"), '') as brand,
       nullif(trim(md."DESIGNATION"), '') as model,
       nullif(trim(fa."NOM"), '') as category,
       case when a."ID_FOURNISSEUR" > 1 then mig.uid('supplier', a."ID_FOURNISSEUR") end as supplier_id,
       round(a."PA_HT"::numeric, 3) as purchase_price,
       round(a."PV_TTC"::numeric, 3) as retail_price,
       not coalesce(a."OBSOLETE", false) as active,
       nullif(trim(a."CODE_BARRE"), '') as barcode,
       a."ID" as old_id
from "ARTICLE" a
left join "ATTRIBUT1_ARTICLE" m  on m."ID" = a."ID_ATTRIBUT1_ARTICLE" and m."ID" > 1
left join "ATTRIBUT3_ARTICLE" md on md."ID" = a."ID_ATTRIBUT3_ARTICLE" and md."ID" > 1
left join "FAMILLE_ARTICLE" fa on fa."ID" = a."ID_FAMILLE_ARTICLE" and fa."ID" > 1
where a."ARCHIVE" = 0 and a."ID" > 1 and trim(a."CODE") <> '';

-- ---------------------------------------------------------------- customers
create or replace view mig.pos_customers as
select mig.uid('customer', c."ID") as id,
       ltrim(trim(c."CODE"), '0') as customer_no,   -- CSV import stripped leading zeros
       trim(c."CODE") as old_code,
       trim(c."NOM") as name,
       nullif(trim(c."TEL"), '') as phone,
       null::text as address,
       'old_id=' || c."ID" as notes,
       true as active,
       c."ID" as old_id
from "CLIENT" c
where c."ARCHIVE" = 0 and c."ID" > 1 and trim(c."NOM") <> '';

-- ---------------------------------------------------------------- sales (TICKET_CAISSE = the POS tickets)
create or replace view mig.pos_sales as
select mig.uid('sale', t."ID") as id,
       nullif(trim(t."NUMERO"), '') as invoice_no,
       t."DATE"::date as sale_date,
       lm.new_name as location_name,
       case when t."ID_CLIENT" > 1 and cl."CODE" <> '9999' then mig.uid('customer', t."ID_CLIENT") end as customer_id,
       case when mig.lyd(t."RESTE_PAYER") > 0 and mig.lyd(t."MONTANT_RECUE") - mig.lyd(t."MONTANT_RENDUE") > 0 then 'mixed'
            when mig.lyd(t."RESTE_PAYER") > 0 then 'credit'
            when exists (select 1 from "ENCAISSER_TICKET_MONTANT" e where e."ID_TICKET_CAISSE" = t."ID" and e."ARCHIVE" = 0 and e."ID_TYPE_REGLEMENT" = 3) then 'card'
            else 'cash' end as payment_method,
       mig.lyd(t."TOTAL_TTC_SANS_REMISE") as subtotal,
       mig.lyd(t."MONTANT_REMISE_TTC") as discount,
       mig.lyd(t."TOTAL_TTC") as total,
       mig.lyd(t."TOTAL_TTC") - mig.lyd(t."RESTE_PAYER") as paid_amount,
       mig.lyd(t."RESTE_PAYER") as balance_due,
       'posted' as status,
       concat_ws(' | ', 'old_ticket_id=' || t."ID", 'caisse=' || coalesce(ca."NOM",''), nullif(trim(t."NOM_CLIENT"),'')) as notes,
       t."CREATION_DATE" as created_at,
       t."ID" as old_id
from "TICKET_CAISSE" t
left join "CAISSE" ca on ca."ID" = t."ID_CAISSE"
left join "CLIENT" cl on cl."ID" = t."ID_CLIENT"
left join mig.location_map lm on lm.kind = 'caisse' and lm.old_id = coalesce(nullif(t."ID_CAISSE",0),1)
where t."ARCHIVE" = 0 and t."ID" > 1 and t."DATE" is not null;

create or replace view mig.pos_sale_items as
select mig.uid('sale_item', e."ID") as id,
       mig.uid('sale', e."ID_TICKET_CAISSE") as sale_id,
       trim(e."CODE") as product_code,
       trim(e."NOM") as product_name,
       e."QTE"::numeric as qty,
       round(e."PV_TTC"::numeric, 3) as unit_price,
       round((e."QTE" * e."PV_TTC" * coalesce(e."POURCENT_REMISE",0) / 100.0)::numeric, 3) as line_discount,
       case when coalesce(e."POURCENT_REMISE",0) <> 0 then e."POURCENT_REMISE" || '%' else '' end as discount_text,
       round(e."T_PV_TTC"::numeric, 3) as line_total,
       round(e."PA_HT"::numeric, 3) as unit_cost_at_sale,
       e."ID" as old_id
from "SAISIE_VENTE_FACTURE_ELEMENT" e
join "TICKET_CAISSE" t on t."ID" = e."ID_TICKET_CAISSE" and t."ARCHIVE" = 0 and t."ID" > 1
where e."ARCHIVE" = 0 and e."ID_TICKET_CAISSE" > 1 and trim(e."CODE") <> '';

-- ---------------------------------------------------------------- sale payments
create or replace view mig.pos_sale_payments as
select mig.uid('sale_payment', e."ID") as id,
       mig.uid('sale', e."ID_TICKET_CAISSE") as sale_id,
       e."DATE"::date as payment_date,
       case e."ID_TYPE_REGLEMENT" when 3 then 'card' when 4 then 'bank_transfer' else 'cash' end as payment_method,
       mig.lyd(e."MONTANT") as amount,
       concat_ws(' | ', 'old_id=' || e."ID", tr."NOM") as notes,
       e."ID" as old_id
from "ENCAISSER_TICKET_MONTANT" e
join "TICKET_CAISSE" t on t."ID" = e."ID_TICKET_CAISSE" and t."ARCHIVE" = 0
left join "TYPE_REGLEMENT" tr on tr."ID" = e."ID_TYPE_REGLEMENT"
where e."ARCHIVE" = 0 and mig.lyd(e."MONTANT") > 0;

-- ---------------------------------------------------------------- customer ledger
create or replace view mig.pos_customer_ledger as
-- credit sales
select mig.uid('cl_sale', s.old_id) as id, s.customer_id, s.sale_date as entry_date, 'sale' as entry_type,
       'فاتورة بيع رقم ' || coalesce(s.invoice_no,'') as description, s.balance_due as debit, 0::numeric as credit,
       'pos_sales' as reference_table, s.id as reference_id
from mig.pos_sales s where s.customer_id is not null and s.balance_due > 0
union all
-- later payments on account (ENCAISSER_MONTANT)
select mig.uid('cl_pay', e."ID"), mig.uid('customer', e."ID_CLIENT"), e."DATE"::date, 'payment',
       concat_ws(' ', 'دفعة', nullif(trim(e."NOM"),'')), 0, mig.lyd(e."MONTANT"), null, null
from "ENCAISSER_MONTANT" e
where e."ARCHIVE" = 0 and e."ID_CLIENT" > 1 and mig.lyd(e."MONTANT") > 0;

-- ---------------------------------------------------------------- purchases (BON_RECEPTION)
create or replace view mig.pos_purchases as
select mig.uid('purchase', b."ID") as id,
       nullif(trim(b."NUMERO"), '') as purchase_no,
       case when b."ID_FOURNISSEUR" > 1 then mig.uid('supplier', b."ID_FOURNISSEUR") end as supplier_id,
       lm.new_name as location_name,
       nullif(trim(b."REF_MANUELLE"), '') as invoice_no,
       b."DATE"::date as purchase_date,
       mig.lyd(b."MONTANT_HT_BRUT") as subtotal,
       mig.lyd(b."MONTANT_HT_REMISE") as discount,
       mig.lyd(b."TOTAL_HT") as total,
       0::numeric as paid_amount,
       'posted' as status,
       concat_ws(' | ', 'old_id=' || b."ID", nullif(trim(b."INFOS"),'')) as notes,
       b."ID" as old_id
from "BON_RECEPTION" b
left join mig.location_map lm on lm.kind = 'depot' and lm.old_id = coalesce(nullif(b."ID_DEPOT",0),1)
where b."ARCHIVE" = 0 and b."ID" > 1 and b."DATE" is not null;

create or replace view mig.pos_purchase_items as
select mig.uid('purchase_item', e."ID") as id,
       mig.uid('purchase', e."ID_BON_RECEPTION") as purchase_id,
       trim(e."CODE") as product_code, trim(e."NOM") as product_name,
       e."QTE"::numeric as qty, round(e."PA_HT"::numeric,3) as unit_cost, round(e."T_PA_HT"::numeric,3) as line_total,
       e."ID" as old_id
from "BON_RECEPTION_ELEMENT" e
join "BON_RECEPTION" b on b."ID" = e."ID_BON_RECEPTION" and b."ARCHIVE" = 0 and b."ID" > 1
where e."ARCHIVE" = 0 and e."QTE" > 0 and trim(e."CODE") <> '';

create or replace view mig.pos_supplier_ledger as
select mig.uid('sl_purchase', p.old_id) as id, p.supplier_id, p.purchase_date as entry_date, 'purchase' as entry_type,
       'إيراد رقم ' || coalesce(p.purchase_no,'') as description, 0::numeric as debit, p.total as credit,
       'pos_purchases' as reference_table, p.id as reference_id
from mig.pos_purchases p where p.supplier_id is not null and p.total > 0;

-- ---------------------------------------------------------------- proformas (DEVIS)
create or replace view mig.pos_proformas as
select mig.uid('proforma', d."ID") as id, nullif(trim(d."NUMERO"),'') as proforma_no, d."DATE"::date as proforma_date,
       'فرع السراج' as location_name,
       case when d."ID_CLIENT" > 1 then mig.uid('customer', d."ID_CLIENT") end as customer_id,
       nullif(trim(d."NOM_CLIENT"),'') as customer_name, nullif(trim(d."TEL_CLIENT"),'') as customer_phone,
       mig.lyd(d."MONTANT_TTC_BRUT") as subtotal, mig.lyd(d."MONTANT_TTC_REMISE") as discount, mig.lyd(d."T_TTC") as total,
       'draft' as status, 'old_id=' || d."ID" as notes, d."ID" as old_id
from "DEVIS" d where d."ARCHIVE" = 0 and d."ID" > 1 and d."DATE" is not null;

create or replace view mig.pos_proforma_items as
select mig.uid('proforma_item', e."ID") as id, mig.uid('proforma', e."ID_DEVIS") as proforma_id,
       trim(e."CODE") as product_code, trim(e."NOM") as product_name, e."QTE"::numeric as qty,
       round(e."PV_TTC"::numeric,3) as unit_price, round(e."T_PV_TTC"::numeric,3) as line_total
from "DEVIS_ELEMENT" e join "DEVIS" d on d."ID" = e."ID_DEVIS" and d."ARCHIVE" = 0
where e."ARCHIVE" = 0 and trim(e."CODE") <> '';

-- ---------------------------------------------------------------- stock transfers
create or replace view mig.pos_stock_transfers as
select mig.uid('transfer', b."ID") as id, nullif(trim(b."NUMERO"),'') as transfer_no, b."DATE"::date as transfer_date,
       f.new_name as from_location_name, t.new_name as to_location_name,
       'posted' as status, concat_ws(' | ', 'old_id=' || b."ID", nullif(trim(b."INFOS"),'')) as notes, b."ID" as old_id
from "BON_TRANSFERT_DIRECT" b
left join mig.location_map f on f.kind='depot' and f.old_id = b."ID_DEPOT"
left join mig.location_map t on t.kind='depot' and t.old_id = b."ID_DEPOT_DESTINATAIRE"
where b."ARCHIVE" = 0 and b."ID" > 1 and b."DATE" is not null;

create or replace view mig.pos_stock_transfer_items as
select mig.uid('transfer_item', e."ID") as id, mig.uid('transfer', e."ID_BON_TRANSFERT_DIRECT") as transfer_id,
       trim(e."CODE") as product_code, trim(e."NOM") as product_name, e."QTE"::numeric as qty
from "BON_TRANSFERT_DIRECT_ELEMENT" e join "BON_TRANSFERT_DIRECT" b on b."ID" = e."ID_BON_TRANSFERT_DIRECT" and b."ARCHIVE" = 0
where e."ARCHIVE" = 0 and e."QTE" > 0 and trim(e."CODE") <> '';

-- ---------------------------------------------------------------- stock (closing quantity per location)
create or replace view mig.pos_stock as
select lm.new_name as location_name, a."CODE" as product_code, trim(a."NOM") as product_name,
       round(sum(m."QTE")::numeric, 3) as qty
from "MOUVEMENT_STOCK" m
join "ARTICLE" a on a."ID" = m."ID_ARTICLE" and a."ARCHIVE" = 0
join mig.location_map lm on lm.kind='depot' and lm.old_id = m."ID_DEPOT"
where m."ARCHIVE" = 0
group by 1,2,3
having round(sum(m."QTE")::numeric, 3) <> 0;

-- ---------------------------------------------------------------- expenses (DEPENSE)
create or replace view mig.pos_expenses as
select mig.uid('expense', d."ID") as id, d."DATE"::date as expense_date,
       lm.new_name as location_name,
       coalesce(nullif(trim(d."NOM"),''), nullif(trim(d."COMMENTAIRE_DEPENSE"),''), 'مصروف') as title,
       mig.lyd(d."MONTANT") as amount,
       concat_ws(' | ', 'old_id=' || d."ID", nullif(trim(d."COMMENTAIRE_DEPENSE"),''), nullif(trim(d."NUM_FACTURE"),'')) as notes,
       d."ID" as old_id
from "DEPENSE" d
left join mig.location_map lm on lm.kind='caisse' and lm.old_id = coalesce(nullif(d."ID_CAISSE",0),1)
where d."ARCHIVE" = 0 and d."ID" > 1 and d."DATE" is not null and mig.lyd(d."MONTANT") > 0 and not coalesce(d."TRANSFERT_CAISSE", false);
