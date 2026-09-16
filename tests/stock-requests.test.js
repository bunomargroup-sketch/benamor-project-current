/* ═══════════════════════════════════════════════════════════════════
   اختبارات المهمة ٢ — «طُلب ولم يوجد» (0051 + الإشارة الصامتة)
   ═══════════════════════════════════════════════════════════════════ */
const test=require('node:test'), assert=require('node:assert');
const fs=require('fs'), vm=require('vm'), path=require('path');
const HERE=path.join(__dirname,'..');

/* ═══ الخادمي: الجدول في السلسلة + التفرّد اليومي + الصلاحيات ═══ */
let PGlite,pgcrypto;
try{
  PGlite=require('@electric-sql/pglite').PGlite;
  pgcrypto=require('@electric-sql/pglite/contrib/pgcrypto').pgcrypto;
}catch(e){ console.error('⚠ شغّل npm install'); process.exit(1); }
let db;
const L11=globalThis;

test.before(async ()=>{
  db=new PGlite({extensions:{pgcrypto}});
  await db.exec(fs.readFileSync(path.join(HERE,'supabase/local-shim.sql'),'utf8'));
  for(const f of fs.readdirSync(path.join(HERE,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())
    await db.exec(fs.readFileSync(path.join(HERE,'supabase/migrations',f),'utf8'));
});

test('(٢-خادمي) التفرّد اليومي + العدّاد: ثلاث نداءات ⇒ صف واحد hit_count=3، واليوم التالي صف جديد', async ()=>{
  const loc=(await db.query(`select id from public.pos_locations order by name limit 1`)).rows[0].id;
  const call=`select pos_record_stock_request('T-SR-1','${loc}',0,'[{"location_id":"x","name":"آخر","qty":3}]'::jsonb,'admin')`;
  await db.exec(call); await db.exec(call); await db.exec(call);
  let row=(await db.query(`select count(*)::int n, max(hit_count)::int h, max(last_requested_at) l from public.pos_stock_requests where product_code='T-SR-1'`)).rows[0];
  assert.equal(Number(row.n),1,'ثلاث نداءات ⇒ صف واحد');
  assert.equal(Number(row.h),3,'hit_count=3 (العدّاد محفوظ لا مبتلع)');
  /* يوم مختلف ⇒ صف ثانٍ */
  await db.exec(`insert into public.pos_stock_requests(product_code,location_id,request_date,qty_here)
                 values ('T-SR-1','${loc}','2026-01-01',0) on conflict do nothing`);
  n=(await db.query(`select count(*)::int n from public.pos_stock_requests where product_code='T-SR-1'`)).rows[0].n;
  assert.equal(n,2,'تاريخ مختلف ⇒ صف إضافي');
  /* resolved يُحدَّث، وطلب محلول ثم سُئل ثانيةً بنفس اليوم يبقى محلولاً والعدّاد يزيد */
  await db.exec(`update public.pos_stock_requests set resolved=true, resolved_at=now(), resolved_by='admin' where product_code='T-SR-1'`);
  await db.exec(call);
  row=(await db.query(`select count(*)::int n, max(hit_count)::int h, count(*) filter (where resolved)::int r from public.pos_stock_requests where product_code='T-SR-1'`)).rows[0];
  assert.equal(Number(row.n),2,'صفّان فقط (اليوم + 2026-01-01) — إعادة الطلب لم تنشئ صفاً');
  assert.equal(Number(row.h),4,'عدّاد اليوم زاد إلى 4');
  assert.equal(Number(row.r),2,'الصفّان resolved — طلب محلول لا يُفتح ثانيةً بنفس اليوم');
  const r=(await db.query(`select count(*) filter (where resolved)::int resolved, count(*)::int total from public.pos_stock_requests where product_code='T-SR-1'`)).rows[0];
  assert.equal(Number(r.resolved),2,'resolved=true للكل');
  await db.exec(`delete from public.pos_stock_requests where product_code='T-SR-1'`);
});

test('(٢-خادمي) anon مرفوض (جدولاً ودالةً) · authenticated يقرأ ويسجّل', async ()=>{
  await db.exec(`set role 'anon'`);
  let deniedTable=false, deniedFn=false;
  try{ await db.query(`select count(*) from public.pos_stock_requests`); }
  catch(e){ deniedTable=/permission denied/i.test(String(e.message)); }
  try{ await db.query(`select pos_record_stock_request('X', (select id from public.pos_locations limit 1), 0, null, 'anon')`); }
  catch(e){ deniedFn=/permission denied/i.test(String(e.message)); }
  assert.ok(deniedTable,'anon بلا صلاحية على الجدول');
  assert.ok(deniedFn,'anon بلا صلاحية على دالة التسجيل');
  await db.exec(`reset role`);
  await db.exec(`delete from public.pos_stock_requests`);
  await db.exec(`set role 'authenticated'`);
  const w=(await db.query(`select count(*)::int n from public.pos_stock_requests`)).rows[0].n;
  assert.equal(w,0,'authenticated يقرأ');
  await db.exec(`reset role`);
});

/* ═══ الواجهة: الإشارة الصامتة ═══ */
function el(){const cache={};const e={style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},addEventListener(){},removeEventListener(){},appendChild(c){return c},remove(){},querySelector(s){return cache[s]||(cache[s]=el())},querySelectorAll(){return[]},setAttribute(){},removeAttribute(){},focus(){},blur(){},click(){},reset(){},value:'',textContent:'',innerHTML:'',id:'',name:'',children:[],options:[],selectedOptions:[{textContent:'',value:''}],checked:false,disabled:false,placeholder:'',closest(){return el()},contains(){return false},insertAdjacentHTML(){},scrollIntoView(){},getAttribute(){return null},srcdoc:'',onload:null};return e;}
let calls=[], toasts=[], MODE={rules:[]};
const smartFetch=async(url,opts={})=>{
  const u=String(url); calls.push({u,method:opts.method||'GET',headers:opts.headers,body:opts.body});
  const J=(o,s=200)=>({ok:s<400,status:s,text:async()=>JSON.stringify(o),json:async()=>o,clone(){return this}});
  if(u.includes('rpc/pos_record_stock_request')) return J([]);
  if(u.includes('pos_location_category_rules')) return J(MODE.rules);
  return J([]);
};
function makeCtx(){
  const els={};
  const ctx={console,setTimeout:f=>{try{f()}catch(e){}},clearTimeout,setInterval:()=>({unref(){}}),clearInterval,Promise,JSON,Math,Date,Object,Array,Map,Set,Number,String,Error,TypeError,RegExp,
    document:{querySelector:()=>el(),querySelectorAll:()=>[],getElementById:id=>(els[id]||(els[id]=el())),createElement:()=>el(),body:el(),documentElement:el(),addEventListener(){},title:''},
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},fetch:smartFetch,
    navigator:{onLine:true,serviceWorker:{register:async()=>({})}},
    alert(){},prompt(){return null},confirm(){return false},
    atob:s=>Buffer.from(s,'base64').toString('binary'),btoa:s=>Buffer.from(s,'binary').toString('base64'),
    URL:{createObjectURL:()=>'x',revokeObjectURL(){}},Blob:function(){},FileReader:function(){},FormData:function(){this.append=function(){}},
    Event:function(){},CustomEvent:function(){},history:{},location:{href:'x',reload(){},origin:'x'},requestAnimationFrame:f=>f(),
    performance:{now:()=>Date.now()},crypto:{randomUUID:()=>'u'},google:{accounts:{oauth2:{init(){}}}},open:()=>null,structuredClone:o=>JSON.parse(JSON.stringify(o))};
  ctx.window=ctx;ctx.self=ctx;ctx.globalThis=ctx;ctx.addEventListener=()=>{};ctx.removeEventListener=()=>{};ctx.dispatchEvent=()=>true;
  ctx.__els=els;
  ctx.toast=(m,t)=>{toasts.push({m,t});};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(HERE,'new discussion github/apps/pos/benamor-sales-system/app.js'),'utf8'),ctx,{filename:'app.js'});
  return ctx;
}
function seed(ctx){
  vm.runInContext(`
    locations=[{id:'L11',name:'فرع 11 يونيو',is_sales_location:true},{id:'LSR',name:'فرع السراج',is_sales_location:true},{id:'LJZ',name:'مخزن جنزور'}];
    products=[{code:'P-ZERO',name:'نفد عندنا',category:'خلاطات',retail_price:10},{code:'P-OK',name:'متوفر',category:'خلاطات',retail_price:20},{code:'P-CAT5',name:'حد تصنيفه 5',category:'أدوات',retail_price:30}];
    stock=[{location_id:'L11',product_code:'P-OK',qty:9},
           {location_id:'LSR',product_code:'P-OK',qty:2},
           {location_id:'LSR',product_code:'P-ZERO',qty:4},
           {location_id:'LJZ',product_code:'P-ZERO',qty:7},
           {location_id:'L11',product_code:'P-CAT5',qty:3},
           {location_id:'LJZ',product_code:'P-CAT5',qty:6}];
    locationCategoryRules=[{location_id:'L11',category:'أدوات',carried:true,min_qty:5},{location_id:'L11',category:'خلاطات',carried:true,min_qty:null}];
    locationCategoryRulesLoaded=true;
    customers=[];financeAccounts=[];sales=[];saleItems=[];salePayments=[];saleReturns=[];saleReturnItems=[];stockMovements=[];financeMovements=[];purchases=[];purchaseItems=[];suppliers=[];transfers=[];compositeItems=[];customerLedger=[];expenseCategories=[];
    currentRole={role:'seller_11'}; appUser={id:'u1',identifier:'cash1',branch_id:'L11'}; authSession={access_token:'t',refresh_token:'r',expires_at:9999999999};
    editingSaleId=null; buildProductCostIndex(); buildProductSearchIndex();
  `,ctx);
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));

test('(٤) صنف كميته 0 عند الفرع ومتوفّر في مواقع أخرى ⇒ صف يُسجَّل صامتاً بلا أي رسالة', async ()=>{
  const ctx=makeCtx(); seed(ctx); toasts=[]; calls=[];
  vm.runInContext(`renderSaleStockInfo('P-ZERO');`,ctx); /* الرسم متزامن */
  const rendered=ctx.__els['saleStockInfo'].innerHTML;
  assert.ok(rendered.includes('نفد عندنا'),'الرسم تم');
  assert.equal(calls.length,0,'⭐ لا نداء شبكة قبل/أثناء الرسم — الإشارة غير محجوبة');
  await wait(30); /* الإشارة غير محجوبة تعمل بعد الرسم */
  const posts=calls.filter(c=>c.method==='POST'&&c.u.includes('rpc/pos_record_stock_request'));
  assert.equal(posts.length,1,'نداء RPC واحد');
  const body=JSON.parse(posts[0].body);
  assert.equal(body.p_product_code,'P-ZERO');
  assert.equal(body.p_location_id,'L11');
  assert.equal(Number(body.p_qty_here),0);
  assert.equal(body.p_available_elsewhere.length,2,'موقعان متوفران (السراج وجنزور)');
  assert.equal(toasts.filter(t=>!/نسخة|تحديث/.test(t.m)).length,0,'⭐ صمت تام: لا رسالة للكاشير');
});

test('(٢-٥) عشر مرات في نفس اليوم ⇒ النداء يذهب والتفرّد يمنعه خادمياً (عميل لا يحتسب)', async ()=>{
  const ctx=makeCtx(); seed(ctx); calls=[];
  for(let i=0;i<10;i++){ vm.runInContext(`renderSaleStockInfo('P-ZERO');`,ctx); }
  await wait(40);
  const posts=calls.filter(c=>c.method==='POST'&&c.u.includes('rpc/pos_record_stock_request'));
  assert.equal(posts.length,10,'عشر نداءات صامتة — والفهرس الفريد + العدّاد يمنعان الازدواج خادمياً (مُختبر خادمياً أعلاه)');
});

test('الكمية فوق الحدّ العام ⇒ لا تسجيل', async ()=>{
  const ctx=makeCtx(); seed(ctx); calls=[];
  vm.runInContext(`renderSaleStockInfo('P-OK');`,ctx); /* 9 عند الفرع > الحد 1 */
  await wait(30);
  assert.equal(calls.filter(c=>c.u.includes('pos_stock_requests')).length,0,'لا إشارة');
});

test('(٣) حدّ التصنيف يتقدّم على الحدّ العام: كميته 3 وحدّ تصنيفه 5 ⇒ يُسجَّل', async ()=>{
  const ctx=makeCtx(); seed(ctx); calls=[];
  vm.runInContext(`renderSaleStockInfo('P-CAT5');`,ctx); /* 3 ≤ 5 (حد الأدوات في 11 يونيو) */
  await wait(30);
  const posts=calls.filter(c=>c.method==='POST'&&c.u.includes('rpc/pos_record_stock_request'));
  assert.equal(posts.length,1,'حد التصنيف 5 طبّق لا العام 1');
  const body=JSON.parse(posts[0].body);
  assert.equal(Number(body.p_qty_here),3);
});

test('لا كمية في أي موقع آخر ⇒ ليست إشارة تحويل ولا تسجيل', async ()=>{
  const ctx=makeCtx(); seed(ctx); calls=[];
  vm.runInContext(`
    stock.push({location_id:'L11',product_code:'P-ONLY-HERE',qty:0});
    products.push({code:'P-ONLY-HERE',name:'موجود هنا فقط',category:'خلاطات',retail_price:5});
    buildProductSearchIndex();
    renderSaleStockInfo('P-ONLY-HERE');
  `,ctx);
  await wait(30);
  assert.equal(calls.filter(c=>c.u.includes('stock_requests')).length,0,'لا مواقع أخرى فيها كمية ⇒ لا تسجيل');
});
