/* ═══════════════════════════════════════════════════════════════════
   اختبارات سداد الفواتير القائمة (post_invoice_payment) فوق السلسلة
   تغطي معايير القبول: ١ · ٤ · ٥ · ٦ · ٧ · ٨ (الجانب الخادمي)
   ═══════════════════════════════════════════════════════════════════ */
const test=require('node:test'), assert=require('node:assert');
const fs=require('fs'), path=require('path');
let PGlite,pgcrypto;
try{
  PGlite=require('@electric-sql/pglite').PGlite;
  pgcrypto=require('@electric-sql/pglite/contrib/pgcrypto').pgcrypto;
}catch(e){ console.error('⚠ شغّل npm install أولاً'); process.exit(1); }
const HERE=path.join(__dirname,'..','supabase');
let db;
const LOC='dddddddd-1111-1111-1111-111111111111', CUST='dddddddd-2222-2222-2222-222222222222',
      ACC_CASH='dddddddd-3333-3333-3333-333333333333', ACC_BANK='dddddddd-4444-4444-4444-444444444444';
async function q(sql,p){ return (await db.query(sql,p||[])).rows; }
async function one(sql,p){ return (await q(sql,p))[0]; }
async function bal(id){ return Number((await one(`select balance from public.pos_finance_account_balances where id=$1`,[id])).balance); }
async function custBal(){ return Number((await one(`select balance from public.pos_customer_balances where id='${CUST}'`)).balance); }
async function callPay(saleId,payments,key,date,notes){
  try{ const r=await one(`select public.post_invoice_payment($1::uuid,$2::jsonb,$3::date,$4::text,$5::text,$6::text) as row`,
    [saleId,payments,date||null,notes||null,key||null,'admin']); return {ok:true,row:r.row}; }
  catch(e){ return {ok:false,msg:String(e.message||e)}; }
}
async function resetSales(){ /* عزل الاختبارات: مسح كل المبيعات وآثارها */
  await db.exec(`delete from public.pos_customer_ledger; delete from public.pos_finance_movements;
    delete from public.pos_sale_payments; delete from public.pos_sale_items; delete from public.pos_sales;
    delete from public.pos_stock_movements; delete from public.pos_audit_log;`);
}
async function makeCreditSale(total,paid,customer){ /* فاتورة عبر معاملة البيع الحقيقية */
  const items=[{product_code:'T1',product_name:'صنبور',qty:total/100,unit_price:100,line_discount:0,line_total:total}];
  const payments=paid>0?[{payment_method:'cash',amount:paid,account_id:ACC_CASH}]:[];
  const r=await one(`select public.post_sale_transaction($1::jsonb,$2::jsonb,$3::jsonb,$4::text,$5::text) as row`,
    [{sale_date:'2026-09-14',location_id:LOC,customer_id:customer,subtotal:total,discount:0,total:total,paid_amount:paid,balance_due:total-paid,status:'posted',notes:''},
     items,payments,'key-sale-'+Math.random().toString(36).slice(2,8),'admin']);
  return r.row;
}

test.before(async ()=>{
  db=new PGlite({extensions:{pgcrypto}});
  await db.exec(fs.readFileSync(path.join(HERE,'local-shim.sql'),'utf8'));
  for(const f of fs.readdirSync(path.join(HERE,'migrations')).filter(f=>f.endsWith('.sql')).sort())
    await db.exec(fs.readFileSync(path.join(HERE,'migrations',f),'utf8'));
  await db.exec(`
    insert into public.pos_locations(id,name,is_sales_location,location_type) values ('${LOC}','فرع الاختبار',true,'branch');
    insert into public.pos_user_roles(identifier,role,active) values ('admin','admin',true);
    insert into auth.users(id,email) values ('eeeeeeee-1111-1111-1111-111111111111','admin@bag.com');
    create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{"email":"admin@bag.com"}'::jsonb $$;
    insert into public.pos_products(code,name,retail_price,purchase_price,active) values ('T1','صنبور',100,60,true);
    insert into public.pos_stock(location_id,product_code,product_name,qty) values ('${LOC}','T1','صنبور',10000);
    insert into public.pos_customers(id,name,phone,active) values ('${CUST}','زبون الاختبار','0911',true);
    insert into public.pos_finance_accounts(id,name,account_type,opening_balance) values ('${ACC_CASH}','صندوق','cash',0),('${ACC_BANK}','بنك','bank',0);
  `);
});

/* ── ١) بيع 1000 ودفع 400: المتبقي 600 والخزينة زادت 400 فقط ── */
test('١: دفعة 400 على فاتورة 1000 ⇒ متبقٍ 600 وخزينة +400 لا أكثر', async ()=>{
  await resetSales();
  const s=await makeCreditSale(1000,400,CUST);
  assert.equal(Number(s.balance_due),600);
  assert.equal(await bal(ACC_CASH),400,'الخزينة زادت 400 فقط (دفعة البيع الأولية)');
  assert.equal(await custBal(),600,'الكشف = 600');
  const r=await callPay(s.id,[{payment_method:'cash',amount:250,account_id:ACC_CASH}],'pay-t4-a');
  assert.ok(r.ok,r.msg);
  assert.equal(Number(r.row.balance_due),350);
  assert.equal(Number(r.row.paid_amount),650);
});

/* ── ٤) سداد 250 (150 كاش + 100 تحويل) على فاتورة متبقيها 600 ── */
test('٤: تحصيل مختلط 150+100 ⇒ الأرصدة والكشف كلها صحيحة', async ()=>{
  await resetSales();
  const s=await makeCreditSale(1000,400,CUST); /* متبقٍ 600 */
  const cash0=await bal(ACC_CASH), bank0=await bal(ACC_BANK), cb0=await custBal();
  const r=await callPay(s.id,[{payment_method:'cash',amount:150,account_id:ACC_CASH},{payment_method:'bank_transfer',amount:100,account_id:ACC_BANK}],'pay-t4-b','2026-09-14','دفعة مختلطة');
  assert.ok(r.ok,r.msg);
  assert.equal(Number(r.row.balance_due),350);
  assert.equal(Number(r.row.paid_amount),650);
  assert.equal(await bal(ACC_CASH),cash0+150);
  assert.equal(await bal(ACC_BANK),bank0+100);
  assert.equal(await custBal(),cb0-250,'كشف الزبون نقص 250');
  /* قيد credit واحد مربوط بالفاتورة */
  const led=await one(`select debit,credit from public.pos_customer_ledger where reference_table='pos_sales' and reference_id=$1 and entry_type='payment'`,[s.id]);
  assert.equal(Number(led.credit),250); assert.equal(Number(led.debit),0);
  /* حركتان ماليتان داخليتان */
  const mvs=await q(`select amount from public.pos_finance_movements where reference_id=$1 and movement_type='sale_payment' order by amount`,[s.id]);
  assert.equal(mvs.length,3,'حركات البيع 400 + الدفعة 150 + 100'); /* 400 الأولية + 150 + 100 */
  /* المعيار ٨: الكشف = مجموع المستحقات المفتوحة */
  const dues=await one(`select coalesce(sum(balance_due),0)::numeric d from public.pos_sales where customer_id='${CUST}' and balance_due>0`);
  assert.equal(Number(dues.d),await custBal(),'المعيار ٨: الكشف = مجموع المستحقات');
});

/* ── ٥) سداد الباقي كاملاً ⇒ متبقٍ 0 ── */
test('٥: سداد الباقي ⇒ balance_due=0', async ()=>{
  await resetSales();
  const s=await makeCreditSale(1000,400,CUST);
  let r=await callPay(s.id,[{payment_method:'cash',amount:250,account_id:ACC_CASH}],'pay-t5-a');
  assert.ok(r.ok,r.msg);
  r=await callPay(s.id,[{payment_method:'cash',amount:350,account_id:ACC_CASH}],'pay-t5-b');
  assert.ok(r.ok,r.msg);
  assert.equal(Number(r.row.balance_due),0);
  const dues=await one(`select coalesce(sum(balance_due),0)::numeric d from public.pos_sales where customer_id='${CUST}' and balance_due>0`);
  assert.equal(Number(dues.d),0,'تختفي من المستحقات');
  assert.equal(await custBal(),0);
});

/* ── ٦) تجاوز المتبقي ⇒ رفض ── */
test('٦: سداد 500 على متبقٍ 350 ⇒ OVERPAYMENT_NOT_ALLOWED', async ()=>{
  await resetSales();
  const s=await makeCreditSale(1000,400,CUST);
  await callPay(s.id,[{payment_method:'cash',amount:250,account_id:ACC_CASH}],'pay-t6-a');
  const r=await callPay(s.id,[{payment_method:'cash',amount:500,account_id:ACC_CASH}],'pay-t6-b');
  assert.ok(!r.ok&&/OVERPAYMENT_NOT_ALLOWED/.test(r.msg),r.msg);
  /* والمبلغ غير الموجب والطريقة غير الصحيحة */
  const a=await callPay(s.id,[{payment_method:'cash',amount:0,account_id:ACC_CASH}],'pay-t6-c');
  assert.ok(!a.ok&&/AMOUNT_MUST_BE_POSITIVE/.test(a.msg),a.msg);
  const b=await callPay(s.id,[{payment_method:'gold',amount:10,account_id:ACC_CASH}],'pay-t6-d');
  assert.ok(!b.ok&&/INVALID_PAYMENT_METHOD/.test(b.msg),b.msg);
});

/* ── ٧) idempotency: نفس الدفعة مرتين ⇒ تُسجَّل مرة ── */
test('٧: إرسال نفس الدفعة مرتين بنفس المفتاح ⇒ صف واحد', async ()=>{
  await resetSales();
  const s=await makeCreditSale(1000,400,CUST);
  const payload=[{payment_method:'cash',amount:200,account_id:ACC_CASH}];
  const r1=await callPay(s.id,payload,'dup-key-1');
  const r2=await callPay(s.id,payload,'dup-key-1');
  assert.ok(r1.ok&&r2.ok,r2.msg);
  assert.equal(r2.row.idempotent_replay,true,'الثانية replay');
  assert.equal(Number(r2.row.balance_due),400,'لم ينقص مرتين');
  const pays=await one(`select count(*)::int n from public.pos_sale_payments where sale_id=$1 and amount=200`,[s.id]);
  assert.equal(pays.n,1,'صف دفعة واحد فقط');
  const mvs=await one(`select count(*)::int n from public.pos_finance_movements where reference_id=$1 and amount=200`,[s.id]);
  assert.equal(mvs.n,1,'حركة واحدة فقط');
  assert.equal(await bal(ACC_CASH),400+200,'الخزينة زادت 200 مرة واحدة');
});

/* ── سجل التدقيق يُكتب داخل الدالة ── */
test('سجل التدقيق: قيد invoice_payment داخل المعاملة', async ()=>{
  await resetSales();
  const s=await makeCreditSale(500,100,CUST);
  const r=await callPay(s.id,[{payment_method:'cash',amount:100,account_id:ACC_CASH}],'audit-key-1');
  assert.ok(r.ok,r.msg);
  const a=await one(`select user_identifier,action,details from public.pos_audit_log where entity_id=$1 and action='invoice_payment' order by created_at desc limit 1`,[String(s.id)]);
  assert.ok(a,'قيد التدقيق موجود');
  assert.equal(a.user_identifier,'admin');
  assert.ok(a.details.includes('تحصيل 100'));
});

/* ── البيع الآجل بلا زبون مستحيل من الأصل (معيار ج-٣ على مستوى الخادم) ── */
test('فاتورة آجلة بلا زبون ⇒ post_sale_transaction يرفضها أصلاً', async ()=>{
  await resetSales();
  let err=null;
  try{ await makeCreditSale(300,0,null); }catch(e){ err=String(e.message||e); }
  assert.ok(err&&/CUSTOMER_REQUIRED_FOR_CREDIT_SALE/.test(err),'مرفوضة من مصدرها: '+err);
});

/* ── صلاحية الفرع: بائع لا يحصّل على فاتورة فرع آخر ── */
test('بائع لا يحصّل على فاتورة فرع آخر', async ()=>{
  const OTHER='dddddddd-9999-9999-9999-999999999999';
  await db.exec(`insert into public.pos_locations(id,name,is_sales_location,location_type) values ('${OTHER}','فرع آخر',true,'branch');
                 insert into public.pos_user_roles(identifier,role,active) values ('seller11','seller_11',true) on conflict do nothing;`);
  const s=await makeCreditSale(400,100,CUST);
  await db.exec(`create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{"email":"seller11@bag.com"}'::jsonb $$;`);
  const r=await callPay(s.id,[{payment_method:'cash',amount:100,account_id:ACC_CASH}],'perm-1');
  assert.ok(!r.ok&&/LOCATION_NOT_ALLOWED/.test(r.msg),r.msg);
  await db.exec(`create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{"email":"admin@bag.com"}'::jsonb $$;`);
});
