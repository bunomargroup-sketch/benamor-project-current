/* ═══════════════════════════════════════════════════════════════════
   اختبارات معاملات الخادم فوق سلسلة migrations (PostgreSQL حقيقي عبر PGlite)
   إطار: node:test — تشغيل: npm test
   تُبنى قاعدة كاملة من supabase/migrations ثم تُزرع بيانات أدنى وتُستدعى
   دوال RPC الحقيقية (post_sale_transaction وغيرها) للتحقق من:
     التوازن المالي بعد كل معاملة، رفض الكمية/السفر السالب والصفر،
     حارس المخزون لطابور دون اتصال، ومفتاح idempotency.
   ═══════════════════════════════════════════════════════════════════ */
const test=require('node:test'), assert=require('node:assert');
const fs=require('fs'), path=require('path');
let PGlite,pgcrypto;
try{
  PGlite=require('@electric-sql/pglite').PGlite;
  pgcrypto=require('@electric-sql/pglite/contrib/pgcrypto').pgcrypto;
}catch(e){ console.error('⚠ شغّل npm install أولاً'); process.exit(1); }

const HERE=path.join(__dirname,'..','supabase');
let db, LOC='11111111-1111-1111-1111-111111111111', CUST='33333333-3333-3333-3333-333333333333',
    ACC_CASH='44444444-4444-4444-4444-444444444444', ACC_BANK='55555555-5555-5555-5555-555555555555';

async function q(sql,params){ return (await db.query(sql,params||[])).rows; }
async function one(sql,params){ return (await q(sql,params))[0]; }
async function rpcErr(fn,payload){ /* يستدعي دالة ويعيد {ok,row} أو {ok:false,msg} */
  try{ const r=await one(`select public.${fn}($1::jsonb,$2::jsonb,$3::jsonb,$4::text,$5::text) as row`,
    [payload.p_sale||{},payload.p_items||[],payload.p_payments||[],payload.p_idempotency_key||null,payload.p_user_identifier||'admin']);
    return {ok:true,row:r.row};
  }catch(e){ return {ok:false,msg:String(e.message||e)}; }
}

test.before(async ()=>{
  db=new PGlite({extensions:{pgcrypto}});
  await db.exec(fs.readFileSync(path.join(HERE,'local-shim.sql'),'utf8'));
  const files=fs.readdirSync(path.join(HERE,'migrations')).filter(f=>f.endsWith('.sql')).sort();
  for(const f of files) await db.exec(fs.readFileSync(path.join(HERE,'migrations',f),'utf8'));
  /* بيانات أدنى */
  await db.exec(`
    insert into public.pos_locations(id,name,is_sales_location,location_type) values ('${LOC}','فرع الاختبار',true,'branch');
    insert into public.pos_user_roles(identifier,role,active) values ('admin','admin',true);
    insert into auth.users(id,email) values ('22222222-2222-2222-2222-222222222222','admin@bag.com');
    create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{"email":"admin@bag.com"}'::jsonb $$;
    insert into public.pos_products(code,name,retail_price,purchase_price,active) values ('T1','صنبور اختبار',100,60,true),('T2','حوض اختبار',200,120,true);
    insert into public.pos_stock(location_id,product_code,product_name,qty) values ('${LOC}','T1','صنبور اختبار',10),('${LOC}','T2','حوض اختبار',5);
    insert into public.pos_customers(id,name,phone,active) values ('${CUST}','زبون اختبار','0911',true);
    insert into public.pos_finance_accounts(id,name,account_type,opening_balance) values ('${ACC_CASH}','صندوق الاختبار','cash',1000),('${ACC_BANK}','بنك الاختبار','bank',5000);
  `);
});

const saleBody=(total,paid,balance)=>({sale_date:'2026-09-14',location_id:LOC,customer_id:null,subtotal:total,discount:0,total,paid_amount:paid,balance_due:balance,status:'posted',notes:''});
const item=(code,qty,price,lt)=>({product_code:code,product_name:code,qty,unit_price:price,line_discount:0,line_total:lt!==undefined?lt:qty*price});

/* ── ١) بيع نقدي: كل الآثار متوازنة ── */
test('بيع نقدي: مخزون + دفعة + حركة مالية داخلة متساوية', async ()=>{
  const r=await rpcErr('post_sale_transaction',{p_sale:saleBody(200,200,0),p_items:[item('T1',2,100)],p_payments:[{payment_method:'cash',amount:200,account_id:ACC_CASH}],p_idempotency_key:'srv-t1'});
  assert.ok(r.ok,'فشل الحفظ: '+r.msg);
  assert.equal((await one(`select qty from public.pos_stock where product_code='T1' and location_id='${LOC}'`)).qty,8,'المخزون 10→8');
  const pay=await one(`select amount from public.pos_sale_payments where sale_id='${r.row.id}'`);
  assert.equal(Number(pay.amount),200);
  const mv=await one(`select direction,amount from public.pos_finance_movements where reference_id='${r.row.id}'`);
  assert.equal(mv.direction,'in'); assert.equal(Number(mv.amount),200);
  assert.ok(r.row.invoice_no,'رقم الفاتورة وُلّد من الخادم');
});
/* ── ٢) دفع مختلط: حركتان (نقدي + مصرفي) ── */
test('بيع بدفع مختلط: حركتا قبض بمبلغين', async ()=>{
  const r=await rpcErr('post_sale_transaction',{p_sale:saleBody(300,300,0),p_items:[item('T2',1,200),item('T1',1,100)],p_payments:[{payment_method:'cash',amount:100,account_id:ACC_CASH},{payment_method:'bank_transfer',amount:200,account_id:ACC_BANK}],p_idempotency_key:'srv-t2'});
  assert.ok(r.ok,r.msg);
  const mvs=await q(`select direction,sum(amount) s, count(*) n from public.pos_finance_movements where reference_id='${r.row.id}' group by direction`);
  assert.equal(mvs.length,1); assert.equal(Number(mvs[0].s),300); assert.equal(mvs[0].n,2);
});
/* ── ٣) بيع آجل: قيد دين الزبون ── */
test('بيع آجل: balance_due يولّد قيد دين بالمبلغ الصحيح', async ()=>{
  const r=await rpcErr('post_sale_transaction',{p_sale:{...saleBody(150,50,100),customer_id:CUST},p_items:[item('T1',1,150)],p_payments:[{payment_method:'cash',amount:50,account_id:ACC_CASH}],p_idempotency_key:'srv-t3'});
  assert.ok(r.ok,r.msg);
  const led=await one(`select debit,credit from public.pos_customer_ledger where reference_id='${r.row.id}'`);
  assert.equal(Number(led.debit),100); assert.equal(Number(led.credit),0);
});
/* ── ٤) مرتجع بيع: إرجاع المخزون وحركة خارجة ── */
test('مرتجع بيع كامل: مخزون راجع واسترداد خارج', async ()=>{
  const orig=await rpcErr('post_sale_transaction',{p_sale:saleBody(100,100,0),p_items:[item('T1',1,100)],p_payments:[{payment_method:'cash',amount:100,account_id:ACC_CASH}],p_idempotency_key:'srv-t4-orig'});
  assert.ok(orig.ok,orig.msg);
  const before=(await one(`select qty from public.pos_stock where product_code='T1' and location_id='${LOC}'`)).qty;
  const items=await q(`select id,product_code,product_name,qty,unit_price,line_discount,line_total from public.pos_sale_items where sale_id='${orig.row.id}'`);
  const ret=await (async()=>{
    try{ const r=await one(`select public.post_sale_return_transaction($1::jsonb,$2::jsonb,$3::text,$4::text) as row`,
      [{sale_id:orig.row.id,return_date:'2026-09-14',location_id:LOC,customer_id:null,refund_method:'cash',account_id:ACC_CASH},
       items.map(i=>({sale_item_id:i.id,qty:Number(i.qty)})),'srv-t4-ret','admin']);
      return {ok:true,row:r.row};
    }catch(e){ return {ok:false,msg:String(e.message||e)}; }
  })();
  assert.ok(ret.ok,'فشل المرتجع: '+ret.msg);
  const after=(await one(`select qty from public.pos_stock where product_code='T1' and location_id='${LOC}'`)).qty;
  assert.equal(Number(after),Number(before)+1,'المخزون رُجّع +1');
  const mv=await one(`select direction,amount,movement_type from public.pos_finance_movements where reference_id='${ret.row.id}'`);
  assert.equal(mv.direction,'out'); assert.equal(Number(mv.amount),100);
});
/* ── ٥) خصم سطر + خصم فاتورة: الأرقام كما أُدخلت ── */
test('خصم سطر وخصم فاتورة: الإجمالي = المجموع - الخصم', async ()=>{
  const r=await rpcErr('post_sale_transaction',{p_sale:{...saleBody(150,150,0),discount:30,subtotal:180},p_items:[{product_code:'T1',product_name:'x',qty:2,unit_price:100,line_discount:20,line_total:180}],p_payments:[{payment_method:'cash',amount:150,account_id:ACC_CASH}],p_idempotency_key:'srv-t5'});
  assert.ok(r.ok,r.msg);
  assert.equal(Number(r.row.subtotal),180); assert.equal(Number(r.row.discount),30); assert.equal(Number(r.row.total),150);
});
/* ── ٦) كمية صفر/سالبة وسعر سالب ⇒ مرفوضة من الخادم ── */
test('كمية صفر ⇒ ITEM مرفوض', async ()=>{
  const r=await rpcErr('post_sale_transaction',{p_sale:saleBody(100,100,0),p_items:[item('T1',0,100,0)],p_payments:[{payment_method:'cash',amount:100,account_id:ACC_CASH}],p_idempotency_key:'srv-t6a'});
  assert.ok(!r.ok&&/NEGATIVE_OR_ZERO|QTY/i.test(r.msg),r.msg);
});
test('كمية سالبة ⇒ مرفوضة (المسار الصحيح: مرتجع)', async ()=>{
  const r=await rpcErr('post_sale_transaction',{p_sale:saleBody(-100,-100,0),p_items:[item('T1',-1,100,-100)],p_payments:[{payment_method:'cash',amount:100,account_id:ACC_CASH}],p_idempotency_key:'srv-t6b'});
  assert.ok(!r.ok&&/NEGATIVE_OR_ZERO/i.test(r.msg),r.msg);
});
test('سعر سالب ⇒ مرفوض', async ()=>{
  const r=await rpcErr('post_sale_transaction',{p_sale:saleBody(-100,-100,0),p_items:[item('T1',1,-100,-100)],p_payments:[{payment_method:'cash',amount:100,account_id:ACC_CASH}],p_idempotency_key:'srv-t6c'});
  assert.ok(!r.ok&&/NEGATIVE_PRICE/i.test(r.msg),r.msg);
});
/* ── ٧) حارس الطابور دون اتصال: نفاد الكمية يُرفض للفواتير المؤجلة فقط ── */
test('offline_queued مع كمية غير كافية ⇒ INSUFFICIENT_STOCK_QUEUED', async ()=>{
  const p_items=[item('T2',99,200)]; /* المتاح 5 */
  const r=await rpcErr('post_sale_transaction',{p_sale:{...saleBody(19800,19800,0),offline_queued:true},p_items,p_payments:[{payment_method:'cash',amount:19800,account_id:ACC_CASH}],p_idempotency_key:'srv-t7'});
  assert.ok(!r.ok&&/INSUFFICIENT_STOCK_QUEUED/.test(r.msg),r.msg);
  /* نفس الطلب بدون علامة الطابور ⇒ يُقبل (سماح السالب القائم) */
  const r2=await rpcErr('post_sale_transaction',{p_sale:saleBody(19800,19800,0),p_items,p_payments:[{payment_method:'cash',amount:19800,account_id:ACC_CASH}],p_idempotency_key:'srv-t7b'});
  assert.ok(r2.ok,r2.msg);
});
/* ── ٨) idempotency: نفس المفتاح مرتين ⇒ صف واحد ── */
test('إعادة الإرسال بنفس المفتاح ⇒ نفس الفاتورة (replay)', async ()=>{
  const payload={p_sale:saleBody(100,100,0),p_items:[item('T1',1,100)],p_payments:[{payment_method:'cash',amount:100,account_id:ACC_CASH}],p_idempotency_key:'srv-t8-dup'};
  const r1=await rpcErr('post_sale_transaction',payload);
  const r2=await rpcErr('post_sale_transaction',payload);
  assert.ok(r1.ok&&r2.ok);
  assert.equal(r1.row.id,r2.row.id,'نفس المعرف');
  const n=await one(`select count(*)::int n from public.pos_sales where idempotency_key='srv-t8-dup'`);
  assert.equal(n.n,1,'صف واحد فقط');
});
/* ── ٩) فحص الدور داخل RPC: بائع خارج فرعه مرفوض ── */
test('بائع لا يبيع في فرع غير مسموح (pos_assert_location_allowed)', async ()=>{
  await db.exec(`create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{"email":"seller11@bag.com"}'::jsonb $$;
                 insert into public.pos_user_roles(identifier,role,active) values ('seller11','seller_11',true);`);
  const OTHER='99999999-9999-9999-9999-999999999999';
  await db.exec(`insert into public.pos_locations(id,name,is_sales_location,location_type) values ('${OTHER}','فرع آخر',true,'branch');`);
  const r=await rpcErr('post_sale_transaction',{p_sale:{...saleBody(100,100,0),location_id:OTHER},p_items:[item('T1',1,100)],p_payments:[{payment_method:'cash',amount:100,account_id:ACC_CASH}],p_idempotency_key:'srv-t9',p_user_identifier:'seller11'});
  assert.ok(!r.ok&&/location|LOCATION/i.test(r.msg),r.msg);
  await db.exec(`create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{"email":"admin@bag.com"}'::jsonb $$;`);
});
/* ── ١٠) تحويل مالي بين حسابين: رصيدان متعاكسان ── */
test('تحويل بين حسابين: المصدر ينقص والهدف يزيد بنفس المبلغ', async ()=>{
  const b1=Number((await one(`select balance from public.pos_finance_account_balances where id='${ACC_CASH}'`)).balance);
  const b2=Number((await one(`select balance from public.pos_finance_account_balances where id='${ACC_BANK}'`)).balance);
  await db.exec(`insert into public.pos_finance_movements(account_id,direction,movement_type,amount,movement_date,reference_table,reference_id,notes)
                 values ('${ACC_CASH}','out','adjustment',250,'2026-09-14','manual',null,'تحويل إلى البنك'),
                            ('${ACC_BANK}','in','adjustment',250,'2026-09-14','manual',null,'تحويل من الصندوق');`);
  const a1=Number((await one(`select balance from public.pos_finance_account_balances where id='${ACC_CASH}'`)).balance);
  const a2=Number((await one(`select balance from public.pos_finance_account_balances where id='${ACC_BANK}'`)).balance);
  assert.equal(a1,b1-250); assert.equal(a2,b2+250);
});
