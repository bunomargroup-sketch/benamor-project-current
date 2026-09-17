#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Static validation of benamor-migration CSVs against live pos_* constraints
(constraints transcribed from supabase/migrations 0001..0056)."""
import csv, re, sys, uuid as uuidlib
from collections import Counter, defaultdict

D = "/home/user/benamor-project-current/benamor-migration"
csv.field_size_limit(100 * 1024 * 1024)
problems, notes = [], []

def load(name):
    with open(f"{D}/{name}", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))

def is_uuid(s):
    if s is None or s == "": return None
    try: uuidlib.UUID(s); return True
    except ValueError: return False

def num(s):
    if s is None or s == "": return None
    try: return float(s)
    except ValueError: return "BAD"

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TS_RE   = re.compile(r"^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?(\+\d{2}(:\d{2})?|Z)?$")

def check_uuid(rows, col, file):
    bad = [(r.get("old_id","?"), r[col]) for r in rows if r.get(col) not in (None,"") and not is_uuid(r[col])]
    if bad: problems.append(f"{file}.{col}: {len(bad)} invalid uuid e.g. {bad[:3]}")

def check_nn(rows, col, file, treat_empty_null=True):
    n = sum(1 for r in rows if r.get(col) in (None,"") if treat_empty_null)
    if n: problems.append(f"{file}.{col}: {n} empty (NOT NULL target) e.g. old_id={[r.get('old_id','?') for r in rows if r.get(col) in (None,'')][:5]}")

def domain(rows, col, allowed, file):
    vals = Counter(r.get(col,"") for r in rows)
    bad = {v:c for v,c in vals.items() if v not in allowed}
    if bad: problems.append(f"{file}.{col}: values outside {sorted(allowed)}: {bad}")
    return vals

def dupcheck(rows, keyfn, label, file):
    c = Counter(keyfn(r) for r in rows)
    c = {k:v for k,v in c.items() if v > 1 and k not in (None,"")}
    if c: problems.append(f"{file}: {len(c)} duplicate {label} e.g. {dict(list(c.items())[:5])}")
    return c

sales   = load("pos_sales.csv")
items   = load("pos_sale_items.csv")
pays    = load("pos_sale_payments.csv")
custs   = load("pos_customers.csv")
cledg   = load("pos_customer_ledger.csv")
prods   = load("pos_products.csv")
supps   = load("pos_suppliers.csv")
purch   = load("pos_purchases.csv")
pitems  = load("pos_purchase_items.csv")
sledg   = load("pos_supplier_ledger.csv")
profs   = load("pos_proformas.csv")
pfitms  = load("pos_proforma_items.csv")
trs     = load("pos_stock_transfers.csv")
trits   = load("pos_stock_transfer_items.csv")
stock   = load("pos_stock.csv")
exps    = load("pos_expenses.csv")

# ---------- 1. uuid validity
for rows, cols, f in [
    (sales,["id","customer_id"],"pos_sales"), (items,["id","sale_id"],"pos_sale_items"),
    (pays,["id","sale_id"],"pos_sale_payments"), (custs,["id"],"pos_customers"),
    (cledg,["id","customer_id","reference_id"],"pos_customer_ledger"),
    (prods,["supplier_id"],"pos_products"), (supps,["id"],"pos_suppliers"),
    (purch,["id","supplier_id"],"pos_purchases"), (pitems,["id","purchase_id"],"pos_purchase_items"),
    (sledg,["id","supplier_id","reference_id"],"pos_supplier_ledger"),
    (profs,["id","customer_id"],"pos_proformas"), (pfitms,["id","proforma_id"],"pos_proforma_items"),
    (trs,["id"],"pos_stock_transfers"), (trits,["id","transfer_id"],"pos_stock_transfer_items"),
    (exps,["id"],"pos_expenses")]:
    for c in cols: check_uuid(rows, c, f)

# ---------- 2. NOT NULL targets
check_nn(sales,"sale_date","pos_sales"); check_nn(sales,"payment_method","pos_sales"); check_nn(sales,"status","pos_sales")
check_nn(sales,"sale_date","pos_sales")
check_nn(items,"sale_id","pos_sale_items"); check_nn(items,"product_code","pos_sale_items"); check_nn(items,"product_name","pos_sale_items")
check_nn(pays,"sale_id","pos_sale_payments"); check_nn(pays,"payment_date","pos_sale_payments"); check_nn(pays,"payment_method","pos_sale_payments"); check_nn(pays,"amount","pos_sale_payments")
check_nn(custs,"name","pos_customers")
check_nn(cledg,"customer_id","pos_customer_ledger"); check_nn(cledg,"entry_type","pos_customer_ledger")
check_nn(prods,"name","pos_products")
check_nn(supps,"name","pos_suppliers")
check_nn(purch,"purchase_date","pos_purchases"); check_nn(purch,"status","pos_purchases")
check_nn(pitems,"purchase_id","pos_purchase_items"); check_nn(pitems,"product_name","pos_purchase_items")
check_nn(sledg,"supplier_id","pos_supplier_ledger"); check_nn(sledg,"entry_type","pos_supplier_ledger")
check_nn(profs,"proforma_date","pos_proformas"); check_nn(profs,"status","pos_proformas")
check_nn(pfitms,"proforma_id","pos_proforma_items"); check_nn(pfitms,"product_code","pos_proforma_items"); check_nn(pfitms,"product_name","pos_proforma_items")
check_nn(trs,"transfer_date","pos_stock_transfers"); check_nn(trs,"status","pos_stock_transfers")
check_nn(trits,"transfer_id","pos_stock_transfer_items"); check_nn(trits,"product_code","pos_stock_transfer_items")
check_nn(exps,"expense_date","pos_expenses"); check_nn(exps,"title","pos_expenses"); check_nn(exps,"amount","pos_expenses")

# ---------- 3. CHECK domains
v = domain(sales,"payment_method",{"cash","bank_transfer","card","mixed","credit"},"pos_sales"); notes.append(f"sales.payment_method: {dict(v)}")
v = domain(sales,"status",{"draft","posted","cancelled"},"pos_sales"); notes.append(f"sales.status: {dict(v)}")
v = domain(pays,"payment_method",{"cash","bank_transfer","card"},"pos_sale_payments"); notes.append(f"sale_payments.payment_method: {dict(v)}")
v = domain(cledg,"entry_type",{"opening","sale","payment","return","adjustment"},"pos_customer_ledger"); notes.append(f"customer_ledger.entry_type: {dict(v)}")
v = domain(sledg,"entry_type",{"opening","purchase","payment","return","adjustment"},"pos_supplier_ledger"); notes.append(f"supplier_ledger.entry_type: {dict(v)}")
v = domain(purch,"status",{"draft","posted","cancelled"},"pos_purchases"); notes.append(f"purchases.status: {dict(v)}")
v = domain(profs,"status",{"draft","converted","cancelled"},"pos_proformas"); notes.append(f"proformas.status: {dict(v)}")
v = domain(trs,"status",{"draft","posted","cancelled"},"pos_stock_transfers"); notes.append(f"transfers.status: {dict(v)}")
for rows,col,f in [(custs,"active","pos_customers"),(supps,"active","pos_suppliers"),(prods,"active","pos_products")]:
    v = Counter(r.get(col,"").lower() for r in rows)
    bad = {k:c for k,c in v.items() if k not in ("true","false","t","f","1","0")}
    if bad: problems.append(f"{f}.{col}: non-boolean {bad}")

# ---------- 4. numeric domains
def chknum(rows,col,file,gt=None,ge=None,ne=None):
    bad = []
    for r in rows:
        v = num(r.get(col))
        if v == "BAD": bad.append((r.get("old_id","?"), r.get(col))); continue
        if v is None: continue
        if gt is not None and not v > gt: bad.append((r.get("old_id","?"), v))
        if ge is not None and not v >= ge: bad.append((r.get("old_id","?"), v))
        if ne is not None and v == ne: bad.append((r.get("old_id","?"), v))
    if bad: problems.append(f"{file}.{col}: {len(bad)} violate gt={gt} ge={ge} ne={ne} e.g. {bad[:5]}")

chknum(items,"qty","pos_sale_items",ne=0)
chknum(items,"unit_price","pos_sale_items",ge=0)
chknum(pays,"amount","pos_sale_payments",gt=0)
chknum(cledg,"debit","pos_customer_ledger",ge=0); chknum(cledg,"credit","pos_customer_ledger",ge=0)
chknum(sledg,"debit","pos_supplier_ledger",ge=0); chknum(sledg,"credit","pos_supplier_ledger",ge=0)
chknum(pitems,"qty","pos_purchase_items",gt=0); chknum(pitems,"unit_cost","pos_purchase_items",ge=0)
chknum(pfitms,"qty","pos_proforma_items",gt=0)   # script filters qty>0
chknum(trits,"qty","pos_stock_transfer_items",gt=0)
chknum(exps,"amount","pos_expenses",gt=0)
for rows,cols,f in [(sales,["subtotal","discount","total","paid_amount","balance_due"],"pos_sales"),
                    (items,["line_discount","line_total","unit_cost_at_sale"],"pos_sale_items"),
                    (purch,["subtotal","discount","total","paid_amount"],"pos_purchases"),
                    (profs,["subtotal","discount","total"],"pos_proformas"),
                    (prods,["purchase_price","retail_price"],"pos_products"),
                    (stock,["qty"],"pos_stock"),(supps,["opening_balance"],"pos_suppliers")]:
    for c in cols:
        bad = [(r.get("old_id","?"), r.get(c)) for r in rows if num(r.get(c)) == "BAD"]
        if bad: problems.append(f"{f}.{c}: {len(bad)} non-numeric e.g. {bad[:3]}")

# ---------- 5. dates
for rows,col,f in [(sales,"sale_date","pos_sales"),(pays,"payment_date","pos_sale_payments"),
                   (cledg,"entry_date","pos_customer_ledger"),(sledg,"entry_date","pos_supplier_ledger"),
                   (purch,"purchase_date","pos_purchases"),(profs,"proforma_date","pos_proformas"),
                   (trs,"transfer_date","pos_stock_transfers"),(exps,"expense_date","pos_expenses")]:
    bad = [(r.get("old_id","?"), r.get(col)) for r in rows if r.get(col) and not DATE_RE.match(r[col])]
    if bad: problems.append(f"{f}.{col}: {len(bad)} bad date e.g. {bad[:5]}")
bad = [(r.get("old_id","?"), r.get("created_at")) for r in sales if r.get("created_at") and not TS_RE.match(r["created_at"]) and not DATE_RE.match(r["created_at"])]
if bad: problems.append(f"pos_sales.created_at: {len(bad)} bad ts e.g. {bad[:5]}")

# ---------- 6. uniqueness
dupcheck(sales, lambda r: r["id"], "id", "pos_sales")
inv_dup = dupcheck(sales, lambda r: r["invoice_no"], "invoice_no", "pos_sales")
dupcheck(items, lambda r: r["id"], "id", "pos_sale_items")
dupcheck(pays, lambda r: r["id"], "id", "pos_sale_payments")
dupcheck(custs, lambda r: r["id"], "id", "pos_customers")
dupcheck(cledg, lambda r: r["id"], "id", "pos_customer_ledger")
dupcheck(prods, lambda r: r["code"], "code", "pos_products")
dupcheck(supps, lambda r: r["id"], "id", "pos_suppliers")
dupcheck(purch, lambda r: r["id"], "id", "pos_purchases")
dupcheck(pitems, lambda r: r["id"], "id", "pos_purchase_items")
dupcheck(sledg, lambda r: r["id"], "id", "pos_supplier_ledger")
dupcheck(profs, lambda r: r["id"], "id", "pos_proformas")
dupcheck(pfitms, lambda r: r["id"], "id", "pos_proforma_items")
dupcheck(trs, lambda r: r["id"], "id", "pos_stock_transfers")
dupcheck(trits, lambda r: r["id"], "id", "pos_stock_transfer_items")
dupcheck(exps, lambda r: r["id"], "id", "pos_expenses")
stock_pair_dup = dupcheck(stock, lambda r: (r["location_name"], r["product_code"]), "(location,product)", "pos_stock")

# ---------- 7. FK closure
sale_ids = {r["id"] for r in sales}; cust_ids = {r["id"] for r in custs}
supp_ids = {r["id"] for r in supps}; purch_ids = {r["id"] for r in purch}
prof_ids = {r["id"] for r in profs}; tr_ids = {r["id"] for r in trs}
prod_codes = {r["code"] for r in prods}
missing = [(r["sale_id"]) for r in items if r["sale_id"] not in sale_ids]
if missing: problems.append(f"pos_sale_items.sale_id: {len(missing)} not in sales e.g. {missing[:3]}")
missing = [(r["sale_id"]) for r in pays if r["sale_id"] not in sale_ids]
if missing: problems.append(f"pos_sale_payments.sale_id: {len(missing)} not in sales e.g. {missing[:3]}")
missing = [r["customer_id"] for r in sales if r.get("customer_id") and r["customer_id"] not in cust_ids]
if missing: problems.append(f"pos_sales.customer_id: {len(missing)} not in customers e.g. {missing[:3]}")
missing = [r["customer_id"] for r in cledg if r["customer_id"] not in cust_ids]
if missing: problems.append(f"pos_customer_ledger.customer_id: {len(missing)} not in customers")
missing = [r["supplier_id"] for r in purch if r.get("supplier_id") and r["supplier_id"] not in supp_ids]
if missing: problems.append(f"pos_purchases.supplier_id: {len(missing)} not in suppliers")
missing = [r["supplier_id"] for r in sledg if r["supplier_id"] not in supp_ids]
if missing: problems.append(f"pos_supplier_ledger.supplier_id: {len(missing)} not in suppliers")
missing = [r["supplier_id"] for r in prods if r.get("supplier_id") and r["supplier_id"] not in supp_ids]
if missing: problems.append(f"pos_products.supplier_id: {len(missing)} not in suppliers e.g. {missing[:3]}")
missing = [r["purchase_id"] for r in pitems if r["purchase_id"] not in purch_ids]
if missing: problems.append(f"pos_purchase_items.purchase_id: {len(missing)} not in purchases")
missing = [r["proforma_id"] for r in pfitms if r["proforma_id"] not in prof_ids]
if missing: problems.append(f"pos_proforma_items.proforma_id: {len(missing)} not in proformas")
missing = [r["transfer_id"] for r in trits if r["transfer_id"] not in tr_ids]
if missing: problems.append(f"pos_stock_transfer_items.transfer_id: {len(missing)} not in transfers")
arch = Counter(r["product_code"] for r in items if r["product_code"] not in prod_codes)
notes.append(f"sale_items with product_code NOT in products.csv: {sum(arch.values())} rows / {len(arch)} codes: {dict(arch)}")
arch2 = Counter(r["product_code"] for r in stock if r["product_code"] not in prod_codes)
notes.append(f"stock rows with product_code NOT in products.csv (script silently skips): {sum(arch2.values())} rows / {len(arch2)} codes: {dict(list(arch2.items())[:10])}")
arch3 = sum(1 for r in pitems if r.get("product_code") and r["product_code"] not in prod_codes)
notes.append(f"purchase_items with code not in products.csv: {arch3} (kept as text, no FK)")

# ---------- 8. locations
LOCS = {"فرع 11 يونيو","فرع السراج","مخزن جنزور"}
for rows, cols, f in [(sales,["location_name"],"pos_sales"), (purch,["location_name"],"pos_purchases"),
                      (stock,["location_name"],"pos_stock"), (trs,["from_location_name","to_location_name"],"pos_stock_transfers"),
                      (exps,["location_name"],"pos_expenses"), (profs,["location_name"],"pos_proformas")]:
    for c in cols:
        bad = Counter(r[c] for r in rows if r.get(c) and r[c] not in LOCS)
        if bad: problems.append(f"{f}.{c}: unknown locations {dict(bad)}")

# ---------- 9. ledger references
for rows, f, targets in [(cledg,"pos_customer_ledger",{"pos_sales":sale_ids,"pos_customers":cust_ids}),
                         (sledg,"pos_supplier_ledger",{"pos_purchases":purch_ids,"pos_suppliers":supp_ids})]:
    rt = Counter(r["reference_table"] for r in rows)
    notes.append(f"{f}.reference_table values: {dict(rt)}")
    noref = sum(1 for r in rows if not r["reference_table"] and r.get("reference_id"))
    if noref: problems.append(f"{f}: {noref} rows have reference_id but no reference_table")
    for r in rows:
        rt_v, rid = r["reference_table"], r.get("reference_id")
        if rt_v in targets and rid and rid not in targets[rt_v]:
            problems.append(f"{f}: reference {rt_v}/{rid} not found in CSV set (old_id={r.get('old_id','?')})"); break

# ---------- 10. notes markers used by verification queries
m = sum(1 for r in sales if r["notes"].startswith("old_ticket_id=") or r["notes"].startswith("old_invoice_id="))
notes.append(f"sales notes matching verification filter: {m}/{len(sales)}")
mc = sum(1 for r in custs if r["notes"].startswith("old_id="))
notes.append(f"customers notes 'old_id=%': {mc}/{len(custs)}  (verification counts these as 'customers_new' — includes merged ones?)")
ms = sum(1 for r in supps if "old_id=" in r["notes"])
notes.append(f"suppliers notes '%old_id=%': {ms}/{len(supps)}")
mp = sum(1 for r in purch if r["notes"].startswith("old_id="))
notes.append(f"purchases notes 'old_id=%': {mp}/{len(purch)}")
me = sum(1 for r in exps if r["notes"].startswith("old_id="))
notes.append(f"expenses notes 'old_id=%': {me}/{len(exps)}")

# ---------- 11. customer phone dedup simulation (match script's cleaning)
def clean(p): 
    p2 = re.sub(r"[^0-9]","",p or "").lstrip("0")
    return p2 or None
ph = defaultdict(list)
for r in custs:
    c = clean(r["phone"])
    if c: ph[c].append(r)
dups = {k:v for k,v in ph.items() if len(v) > 1}
notes.append(f"customer cleaned-phone groups with >1 old customer (merged onto first): {len(dups)} groups covering {sum(len(v) for v in dups.values())} rows")
cn = Counter(r["customer_no"] for r in custs)
cn_dups = {k:v for k,v in cn.items() if v > 1 and k}
notes.append(f"customer_no appearing >1 in old data: {len(cn_dups)} (suffix logic applies to new ones) e.g. {dict(list(cn_dups.items())[:6])}")
# how the script renames: new rows sharing customer_no → all but first get -old_id; ALSO any whose customer_no exists live
notes.append(f"distinct cleaned phones: {len(ph)}")

# supplier name dup groups
sn = defaultdict(list)
for r in supps: sn[(r["name"] or "").strip().lower()].append(r["old_id"])
snd = {k:v for k,v in sn.items() if len(v) > 1}
notes.append(f"supplier name dup groups: {len(snd)}: {dict(list(snd.items())[:8])}")

# ---------- 12. cross-file accounting sanity
tot_credit_sales = sum(float(r["total"]) for r in sales if r["status"] != "cancelled")
ledger_rec = sum(float(r["debit"]) - float(r["credit"]) for r in cledg)
notes.append(f"customer ledger net receivable (debit-credit): {ledger_rec:.3f} (README claims ≈ 46,962)")
bd = sum(float(r["balance_due"]) for r in sales)
notes.append(f"sum(sales.balance_due): {bd:.3f}")
sl = sum(float(r["credit"]) - float(r["debit"]) for r in sledg)
notes.append(f"supplier ledger net (credit-debit = owed to suppliers): {sl:.3f}")
# header vs lines
ls = defaultdict(float)
for r in items: ls[r["sale_id"]] += float(r["line_total"])
mism = [(r["invoice_no"], r["subtotal"], round(ls[r["id"]],3)) for r in sales if r["id"] in ls and abs(float(r["subtotal"]) - ls[r["id"]]) > 0.01]
notes.append(f"sales where subtotal != sum(line_total) (README says 5 with items + 11 empty): {len(mism)}: {mism[:8]}")
noitems = [r["invoice_no"] for r in sales if r["id"] not in ls]
notes.append(f"sales with NO items: {len(noitems)}: {noitems[:15]}")

print("="*70); print("PROBLEMS (blockers/violations):"); print("="*70)
for p in problems: print("  ✗", p)
if not problems: print("  (none)")
print(); print("="*70); print("NOTES:"); print("="*70)
for n in notes: print("  •", n)
print(f"\nrow counts: sales={len(sales)} items={len(items)} pays={len(pays)} custs={len(custs)} cledger={len(cledg)} prods={len(prods)} supps={len(supps)} purch={len(purch)} pitems={len(pitems)} sledg={len(sledg)} profs={len(profs)} pfitms={len(pfitms)} trs={len(trs)} trits={len(trits)} stock={len(stock)} exps={len(exps)}")
