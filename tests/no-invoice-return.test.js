/* ═══════════════════════════════════════════════════════════════════
   اختبارات المهمة ٣ — مرتجع بلا فاتورة (0055 + الواجهة)
   الخادمي: sale_id NULL · سبب إلزامي · المخزون +1 · الخزينة −100 بالضبط ·
            customer_refund مرجعها pos_sale_returns · حساب الاسترداد المختار ·
            price_edited · قيد القاعدة · idempotency · مسار الفاتورة كما كان
   الواجهة: النافذة والتحذير · السبب يمنع الحفظ · السعر تلقائي وقابل
            للتعديل · الوسم وعمود السبب · لوحة المدير · التدقيق
   ═══════════════════════════════════════════════════════════════════ */
const test=require('node:test'), assert=require('node:assert');
const fs=require('fs'), vm=require('vm'), path=require('path');
const HERE=path.join(__dirname,'..');
const DIR=path.join(HERE,'supabase/migrations');
const POS=path.join(HERE,'new discussion github','apps','pos','benamor-sales-system');
const APP=fs.readFileSync(path.join(POS,'app.js'),'utf8');
const HTML=fs.readFileSync(path.join(POS,'index.html'),'utf8');

let PGlite,pgcrypto;
try{
  PGlite=require('@electric-sql/pglite').PGlite;
  pgcrypto=require('@electric-sql/pglite/contrib/pgcrypto').pgcrypto;
}catch(e){ console.error('⚠ شغّل npm install'); process.exit(1); }

let LOC='11111111-1111-1111-1111-111111111111';
const ACC_CASH='22222222-2222-2222-2222-222222222222';
const ACC_BANK='33333333-3333-3333-3333-333333333333';
let db;
const one=async(sql,params)=>(await db.query(sql,params)).rows[0];
const q=async(sql)=>(await db.query(sql)).rows;
async function rpcNoInv(body,items,key){
  try{
    const r=await one(`select public.post_sale_return_transaction($1::jsonb,$2::jsonb,$3::text,$4::text) as row`,
      [JSON.stringify(body),JSON.stringify(items),key,'20262']);
    return {ok:true,row:r.row};
  }catch(e){ return {ok:false,msg:String(e.message||e)}; }
}

test.before(async ()=>{
  db=new PGlite({extensions:{pgcrypto}});
  await db.exec(fs.readFileSync(path.join(HERE,'supabase/local-shim.sql'),'utf8'));
  for(const f of fs.readdirSync(DIR).filter(f=>f.endsWith('.sql')).sort())
    await db.exec(fs.readFileSync(path.join(DIR,f),'utf8'));
  const locRow=(await db.query(`select id from public.pos_locations where name='فرع السراج'`)).rows[0];
  LOC=locRow.id; /* فرع السراج الذي أنشأته السلسلة نفسها */
  await db.exec(`
    insert into public.pos_user_roles(identifier,role,active) values ('admin','admin',true);
    insert into auth.users(id,email) values ('44444444-4444-4444-4444-444444444444','admin@bag.com');
    create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{"email":"admin@bag.com"}'::jsonb $$;
    insert into public.pos_products(code,name,retail_price,purchase_price,active) values ('R1','دش اختبار',100,60,true);
    insert into public.pos_stock(location_id,product_code,product_name,qty) values ('${LOC}','R1','دش اختبار',5);
    insert into public.pos_finance_accounts(id,name,account_type,opening_balance,location_id) values
      ('${ACC_CASH}','خزينة السراج','cash',1000,'${LOC}'),
      ('${ACC_BANK}','مصرف شمال افريقيا','bank',5000,null);
  `);
});

/* ═══ الخادمي ═══ */
test('(٣-خ١) مرتجع بلا فاتورة 100 نقداً: صف sale_id NULL + سبب + مخزون +1 + حركة خارجة مرجعها pos_sale_returns', async ()=>{
  const r=await rpcNoInv({sale_id:null,return_date:'2026-09-16',location_id:LOC,customer_id:null,refund_method:'cash',account_id:ACC_CASH,reason:'بضاعة قديمة قبل المنظومة'},
    [{product_code:'R1',product_name:'دش اختبار',qty:1,unit_price:100,price_edited:false}],'nir-1');
  assert.ok(r.ok,'فشل: '+r.msg);
  const row=await one(`select sale_id, reason, total, refund_method from public.pos_sale_returns where id='${r.row.id}'`);
  assert.equal(row.sale_id,null,'sale_id IS NULL');
  assert.equal(row.reason,'بضاعة قديمة قبل المنظومة');
  assert.equal(Number(row.total),100);
  assert.equal(Number((await one(`select qty from public.pos_stock where product_code='R1' and location_id='${LOC}'`)).qty),6,'المخزون 5→6');
  const mv=await one(`select direction,amount,movement_type,reference_table,reference_id from public.pos_finance_movements where reference_id='${r.row.id}'`);
  assert.equal(mv.direction,'out');
  assert.equal(Number(mv.amount),100);
  assert.equal(mv.movement_type,'customer_refund');
  assert.equal(mv.reference_table,'pos_sale_returns','المرجع pos_sale_returns لا pos_sales');
});

test('(٣-خ٢) الاختبار الحاسم: رصيد الخزينة نقص 100 بالضبط', async ()=>{
  const bal=await one(`select coalesce(sum(case direction when 'in' then amount else -amount end),0) s from public.pos_finance_movements where account_id='${ACC_CASH}'`);
  assert.equal(Number(bal.s),-100,'حركة خارجة واحدة بمقدار 100 حصراً — لا أكثر ولا أقل');
});

test('(٣-خ٣) مصرف شمال افريقيا ⇒ المال يخرج منه هو', async ()=>{
  const r=await rpcNoInv({sale_id:null,return_date:'2026-09-16',location_id:LOC,refund_method:'bank_transfer',account_id:ACC_BANK,reason:'استرداد مصرفي'},
    [{product_code:'R1',product_name:'دش اختبار',qty:1,unit_price:50,price_edited:true}],'nir-3');
  assert.ok(r.ok,r.msg);
  const mv=await one(`select account_id, amount from public.pos_finance_movements where reference_id='${r.row.id}'`);
  assert.equal(mv.account_id,ACC_BANK,'خرج من المصرف المختار');
  const it=await one(`select unit_price, price_edited from public.pos_sale_return_items where return_id='${r.row.id}'`);
  assert.equal(Number(it.unit_price),50,'السعر المعدَّل حُفظ');
  assert.equal(it.price_edited,true,'price_edited=true');
});

test('(٣-خ٤) بلا سبب ⇒ يُرفض، وبلا قيد قاعدة ⇒ يُرفض', async ()=>{
  const r=await rpcNoInv({sale_id:null,return_date:'2026-09-16',location_id:LOC,refund_method:'cash',account_id:ACC_CASH,reason:'   '},
    [{product_code:'R1',product_name:'دش',qty:1,unit_price:10}],'nir-4a');
  assert.ok(!r.ok&&/RETURN_REASON_REQUIRED/.test(r.msg),'السبب إلزامي حتى لو فراغات');
  let violated=false;
  try{ await db.exec(`insert into public.pos_sale_returns(sale_id,return_date,location_id,total,refund_method) values (null,'2026-09-16','${LOC}',10,'cash')`); }
  catch(e){ violated=/reason_required_check/i.test(String(e.message)); }
  assert.ok(violated,'قيد القاعدة يرفض بلا فاتورة بلا سبب');
});

test('(٣-خ٥) idempotency يعمل للمرتجعات بلا فاتورة، ومسار الفاتورة كما كان', async ()=>{
  const body={sale_id:null,return_date:'2026-09-16',location_id:LOC,refund_method:'none',reason:'بدون استرداد نقدي'};
  const items=[{product_code:'R1',product_name:'دش',qty:1,unit_price:30}];
  const a=await rpcNoInv(body,items,'nir-5'); assert.ok(a.ok,a.msg);
  const b=await rpcNoInv(body,items,'nir-5'); assert.ok(b.ok,b.msg);
  assert.equal(b.row.id,a.row.id,'إعادة نفس المفتاح ⇒ نفس المستند');
  assert.equal(b.row.idempotent_replay,true);
  assert.equal((await q(`select count(*) n from public.pos_sale_returns where reason='بدون استرداد نقدي'`))[0].n,1,'لا تكرار');
  /* مسار الفاتورة الأصلي: بيع ثم مرتجع جزئي كما كان */
  const sale=await one(`select public.post_sale_transaction($1::jsonb,$2::jsonb,$3::jsonb,$4::text,$5::text) as row`,
    [JSON.stringify({sale_date:'2026-09-16',location_id:LOC,customer_id:null,payment_method:'cash',subtotal:200,total:200,paid_amount:200,balance_due:0,status:'posted',notes:''}),
     JSON.stringify([{product_code:'R1',product_name:'دش اختبار',qty:2,unit_price:100,line_discount:0,line_total:200}]),
     JSON.stringify([{payment_method:'cash',amount:200,account_id:ACC_CASH}]),'nir-5-sale','admin']);
  const si=await q(`select id, qty from public.pos_sale_items where sale_id='${sale.row.id}'`);
  const ret=await rpcNoInv({sale_id:sale.row.id,return_date:'2026-09-16',location_id:LOC,refund_method:'cash',account_id:ACC_CASH},
    [{sale_item_id:si[0].id,qty:1}],'nir-5-ret');
  assert.ok(ret.ok,'مرتجع الفاتورة يعمل: '+ret.msg);
  assert.equal(ret.row.sale_id,sale.row.id,'مرتبط بالفاتورة');
  const over=await rpcNoInv({sale_id:sale.row.id,return_date:'2026-09-16',location_id:LOC,refund_method:'cash',account_id:ACC_CASH},
    [{sale_item_id:si[0].id,qty:99}],'nir-5-over');
  assert.ok(!over.ok&&/RETURN_QTY_EXCEEDS_SOLD_QTY/.test(over.msg),'سقف الكمية المباعة ما زال محرساً');
});

/* ═══ الواجهة ═══ */
function el(){const cache={};const cls=new Set();const cl={add:(...cs)=>cs.forEach(c=>cls.add(c)),remove:(...cs)=>cs.forEach(c=>cls.delete(c)),toggle:(c,f)=>{if(f===undefined)f=!cls.has(c);f?cls.add(c):cls.delete(c);return f},contains:c=>cls.has(c)};const e={style:{},dataset:{},classList:cl,addEventListener(){},removeEventListener(){},appendChild(c){return c},remove(){},querySelector(s){return cache[s]||(cache[s]=el())},querySelectorAll(){return[]},setAttribute(){},removeAttribute(){},focus(){},blur(){},click(){},reset(){},value:'',textContent:'',innerHTML:'',id:'',name:'',children:[],options:[],selectedOptions:[{textContent:'',value:''}],checked:false,disabled:false,placeholder:'',closest(){return el()},contains(){return false},insertAdjacentHTML(){},scrollIntoView(){},getAttribute(){return null},srcdoc:'',onload:null,onclick:null};return e;}
const storage={};
function makeCtx(){
  const els={};
  const formHandlers={};
  const retForm=el(); retForm.addEventListener=(t,f)=>{formHandlers[t]=f;};
  els['saleReturnForm']=retForm;
  let calls=[];
  const J=(o,s=200)=>({ok:s<400,status:s,text:async()=>JSON.stringify(o),json:async()=>o,clone(){return this}});
  const smartFetch=async(url,opts={})=>{
    const u=String(url),h=opts.headers||{};
    calls.push({u,method:opts.method||'GET',body:opts.body,h});
    if(u.includes('/auth/v1/')) return J({access_token:'t',refresh_token:'r',expires_at:9999999999});
    if(u.includes('rpc/post_sale_return_transaction')) return J({id:'ret-ui-1',sale_id:null,total:100,idempotent_replay:false});
    return J([]);
  };
  const ctx={console:{log(){},warn(){},error(){}},setTimeout:f=>{try{f()}catch(e){};return{unref(){}}},clearTimeout,setInterval:()=>({unref(){}}),clearInterval,Promise,JSON,Math,Date,Object,Array,Map,Set,Number,String,Boolean,Error,TypeError,RegExp,Intl,
    document:{querySelector:()=>el(),querySelectorAll:()=>[],getElementById:id=>(els[id]||(els[id]=el())),createElement:()=>el(),body:el(),documentElement:el(),addEventListener(){},title:''},
    localStorage:{getItem:k=>storage[k]??null,setItem:(k,v)=>{storage[k]=String(v)},removeItem:k=>{delete storage[k]}},
    fetch:smartFetch,navigator:{onLine:true,serviceWorker:{register:async()=>({})}},
    alert(){},prompt(){return null},confirm(){return true},
    atob:s=>Buffer.from(s,'base64').toString('binary'),btoa:s=>Buffer.from(s,'binary').toString('base64'),
    URL:{createObjectURL:()=>'x',revokeObjectURL(){}},Blob:function(){},FileReader:function(){},FormData:function(){this.append=function(){}},
    Event:function(){},CustomEvent:function(){},history:{},location:{href:'x',reload(){},origin:'x'},requestAnimationFrame:f=>f(),
    performance:{now:()=>Date.now()},crypto:{randomUUID:()=>'u'},open:()=>null,structuredClone:o=>JSON.parse(JSON.stringify(o))};
  ctx.window=ctx;ctx.self=ctx;ctx.globalThis=ctx;ctx.addEventListener=()=>{};ctx.removeEventListener=()=>{};ctx.dispatchEvent=()=>true;
  ctx.__els=els;ctx.__calls=calls;ctx.__formHandlers=formHandlers;
  vm.createContext(ctx);
  vm.runInContext(APP,ctx,{filename:'app.js'});
  return ctx;
}
function seedUI(ctx){
  vm.runInContext(`
    locations=[{id:'L1',name:'فرع السراج',is_sales_location:true}];
    products=[{code:'R1',name:'دش اختبار',retail_price:100,purchase_price:60}];
    customers=[];sales=[];saleItems=[];salePayments=[];saleReturns=[];saleReturnItems=[];stock=[];financeAccounts=[{id:'AC1',name:'خزينة السراج',account_type:'cash',location_id:'L1'},{id:'AB1',name:'مصرف شمال افريقيا',account_type:'bank',location_id:null}];financeMovements=[];stockMovements=[];customerLedger=[];suppliers=[];transfers=[];compositeItems=[];purchases=[];purchaseItems=[];
    currentRole={role:'seller_sarraj'}; appUser={id:'u1',identifier:'20262',branch_id:'L1'}; authSession={access_token:'t',refresh_token:'r',expires_at:9999999999};
  `,ctx);
}
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setTimeout(r,0));};

test('(٣-و١) النافذة: التحذير والسبب ظاهران، جدول الفاتورة مخفي، والحفظ بلا سبب يُرفض', async ()=>{
  const ctx=makeCtx(); seedUI(ctx); const E=ctx.__els;
  vm.runInContext('openNoInvoiceReturn()',ctx);
  assert.ok(E.saleReturnModal.classList.contains('show'),'النافذة مفتوحة');
  assert.ok(!E.noInvoiceReturnWarn.classList.contains('hidden'),'التحذير ظاهر');
  assert.ok(!E.noInvoiceReasonWrap.classList.contains('hidden'),'حقل السبب ظاهر');
  assert.ok(!E.noInvoiceItemsWrap.classList.contains('hidden'),'جدول بنود بلا فاتورة ظاهر');
  assert.ok(E.saleReturnItemsTable.classList.contains('hidden'),'جدول الفاتورة مخفي');
  assert.equal(E.saleReturnSubmitBtn.textContent,'حفظ مرتجع بلا فاتورة');
  /* بلا سبب ⇒ رفض بلا أي نداء */
  vm.runInContext(`addNoInvoiceReturnProduct(products[0],1)`,ctx);
  E.saleReturnReason.value='';
  const rpcBefore=ctx.__calls.filter(c=>c.u.includes('post_sale_return_transaction')).length;
  await ctx.__formHandlers.submit({preventDefault(){}});
  await flush();
  assert.equal(ctx.__calls.filter(c=>c.u.includes('post_sale_return_transaction')).length,rpcBefore,'لا نداء حفظ بلا سبب');
  /* بلا أصناف + سبب ⇒ رفض */
  E.saleReturnReason.value='سبب تجريبي';
  vm.runInContext('noInvoiceReturnItems=[]; renderNoInvoiceReturnItems()',ctx);
  await ctx.__formHandlers.submit({preventDefault(){}});
  assert.equal(ctx.__calls.filter(c=>c.u.includes('post_sale_return_transaction')).length,rpcBefore,'لا نداء حفظ بلا أصناف');
});

test('(٣-و٢) السعر تلقائي من الكتالوج، وتعديله يعلّم price_edited، والحفظ يرسل الحزمة الصحيحة ويسجّل التدقيق', async ()=>{
  const ctx=makeCtx(); seedUI(ctx); const E=ctx.__els;
  vm.runInContext('openNoInvoiceReturn()',ctx);
  vm.runInContext(`addNoInvoiceReturnProduct(products[0],1)`,ctx);
  let items=vm.runInContext('getNoInvoiceReturnItems()',ctx);
  assert.equal(items[0].unit_price,100,'السعر مُلئ من سعر البيع الحالي');
  assert.equal(items[0].price_edited,false);
  /* عدّل السعر ⇒ price_edited=true */
  E.noInvoiceReturnItemsBody.innerHTML='';
  vm.runInContext(`noInvoicePrice({dataset:{i:0},value:'80'})`,ctx);
  items=vm.runInContext('getNoInvoiceReturnItems()',ctx);
  assert.equal(items[0].unit_price,80);
  assert.equal(items[0].price_edited,true,'تعديل السعر مُعلَّم');
  /* الحفظ الكامل */
  E.saleReturnReason.value='بضاعة قبل المنظومة';
  E.saleReturnDate.value='2026-09-16';
  E.saleReturnRefundMethod.value='cash';
  E.saleReturnAccount.value='AC1';
  E.saleReturnNotes.value='';
  await ctx.__formHandlers.submit({preventDefault(){}});
  await flush();
  const rpcCall=ctx.__calls.find(c=>c.u.includes('rpc/post_sale_return_transaction'));
  assert.ok(rpcCall,'نداء الحفظ');
  const payload=JSON.parse(rpcCall.body);
  assert.equal(payload.p_return.sale_id,null);
  assert.equal(payload.p_return.reason,'بضاعة قبل المنظومة');
  assert.equal(payload.p_return.account_id,'AC1','الحساب من حقل الاختيار');
  assert.equal(payload.p_items[0].price_edited,true);
  assert.equal(payload.p_user_identifier,'20262');
  const audit=ctx.__calls.find(c=>c.u.includes('pos_audit_log'));
  assert.ok(audit,'سجل التدقيق');
  const auditBody=JSON.parse(audit.body);
  assert.equal(auditBody.entity_type,'pos_sale_returns');
  assert.equal(auditBody.entity_id,'ret-ui-1','الإسناد لمعرّف المرتجع');
  assert.ok(auditBody.details.includes('بضاعة قبل المنظومة')&&auditBody.details.includes('سعر معدَّل: نعم'),'السبب وتعديل السعر في التدقيق');
  /* محلياً: القائمة والوسم ولوحة المدير */
  const noInv=vm.runInContext('saleReturns.find(r=>!r.sale_id)',ctx);
  assert.ok(noInv,'أُدرج محلياً في saleReturns');
  vm.runInContext('renderReturns()',ctx);
  assert.ok(E.returnsBody.innerHTML.includes('بلا فاتورة'),'وسم «بلا فاتورة» في القائمة');
  assert.ok(E.returnsBody.innerHTML.includes('بضاعة قبل المنظومة'),'السبب في عموده');
  vm.runInContext('renderDashboard()',ctx);
  assert.ok(!E.dashNoInvoiceReturns.classList.contains('hidden'),'سطر لوحة المدير ظاهر');
  assert.ok(E.dashNoInvoiceReturns.innerHTML.includes('بقيمة'),'قيمة اليوم معروضة');
});

test('(٣-و٣) لوحة المدير: مخفية حين لا مرتجعات بلا فاتورة اليوم', async ()=>{
  const ctx=makeCtx(); seedUI(ctx); const E=ctx.__els;
  const today=new Date().toISOString().slice(0,10);
  vm.runInContext(`saleReturns=[{id:'x1',sale_id:'s1',return_date:'${today}',total:50}]`,ctx);
  vm.runInContext('renderDashboard()',ctx);
  assert.ok(E.dashNoInvoiceReturns.classList.contains('hidden'),'لا بلا-فاتورة ⇒ مخفي');
});

test('(٣-و٤) الملفات: الأزرار والحقول والوسم موجودة، والدالة الجديدة في السلسلة', ()=>{
  assert.ok(HTML.includes('onclick="openNoInvoiceReturn()"'),'زر «مرتجع بدون فاتورة»');
  assert.ok(HTML.includes('id="saleReturnReason"')&&HTML.includes('id="noInvoiceReturnWarn"')&&HTML.includes('id="noInvoiceReturnItemsBody"'),'حقول النافذة');
  assert.ok(HTML.includes('مرتجع بلا فاتورة — يُسجَّل باسمك ويظهر في تقرير المدير'),'التحذير الظاهر');
  assert.ok(HTML.includes('<th>السبب</th>'),'عمود السبب');
  assert.ok(HTML.includes('id="dashNoInvoiceReturns"'),'بطاقة لوحة المدير');
  const m=fs.readFileSync(path.join(DIR,'0055_return_without_invoice.sql'),'utf8');
  assert.ok(m.includes('alter column sale_id drop not null'),'sale_id nullable');
  assert.ok(m.includes('price_edited'),'عمود price_edited');
  assert.ok(m.includes('pos_sale_returns_reason_required_check'),'قيد السبب');
  assert.ok(m.includes('RETURN_REASON_REQUIRED'),'رفض بلا سبب في الدالة');
  assert.ok(m.includes('from anon, public'),'منح الدالة محرسة (سحب من anon وpublic)');
});
