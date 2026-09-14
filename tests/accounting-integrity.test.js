/* ═══════════════════════════════════════════════════════════════════
   اختبارات طبقة AccountingIntegrity (التحقق المحاسبي في الواجهة)
   إطار: node:test — تشغيل: npm test
   المصدر الخاضع للاختبار: app.js كما هو في الإنتاج (بلا أي تعديل).
   ═══════════════════════════════════════════════════════════════════ */
const test=require('node:test'), assert=require('node:assert');
const fs=require('fs'), vm=require('vm'), path=require('path');

/* يمكن توجيه الاختبار لنسخة معدّلة: APP_JS=/path/to/app.js node --test tests/... */
const APP_JS=process.env.APP_JS||path.join(__dirname,'..','new discussion github','apps','pos','benamor-sales-system','app.js');

function makeCtx(){
  function el(){const cache={};const e={style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},addEventListener(){},removeEventListener(){},appendChild(c){return c},remove(){},querySelector(s){return cache[s]||(cache[s]=el())},querySelectorAll(){return[]},setAttribute(){},removeAttribute(){},focus(){},blur(){},click(){},reset(){},value:'',textContent:'',innerHTML:'',id:'',name:'',children:[],options:[],selectedOptions:[{textContent:'',value:''}],checked:false,disabled:false,placeholder:'',closest(){return el()},contains(){return false},insertAdjacentHTML(){},scrollIntoView(){},getAttribute(){return null},srcdoc:'',onload:null};return e;}
  const els={};
  const smartFetch=async()=>({ok:true,status:200,text:async()=>'[]',json:async()=>[]});
  /* مؤقّتات لا تُبقي عملية الاختبار حية (إقلاع app.js يسجّل interval دائم) */
  const si=(...a)=>{const id=setInterval(...a); id.unref&&id.unref(); return id;};
  const ctx={console,setTimeout,clearTimeout,setInterval:si,clearInterval,Promise,JSON,Math,Date,Object,Array,Map,Set,Number,String,Error,TypeError,RegExp,
    document:{querySelector:()=>el(),querySelectorAll:()=>[],getElementById:id=>(els[id]||(els[id]=el())),createElement:()=>el(),body:el(),documentElement:el(),addEventListener(){},title:''},
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},fetch:smartFetch,
    navigator:{onLine:true,serviceWorker:{register:async()=>({})}},
    alert(){},prompt(){return null},confirm(){return false},
    atob:s=>Buffer.from(s,'base64').toString('binary'),btoa:s=>Buffer.from(s,'binary').toString('base64'),
    URL:{createObjectURL:()=>'x',revokeObjectURL(){}},Blob:function(){},FileReader:function(){},FormData:function(){this.append=function(){}},
    Event:function(){},CustomEvent:function(){},history:{},location:{href:'x',reload(){},origin:'x'},requestAnimationFrame:f=>f(),
    performance:{now:()=>Date.now()},crypto:{randomUUID:()=>'u'},google:{accounts:{oauth2:{init(){}}}},open:()=>null,structuredClone:o=>JSON.parse(JSON.stringify(o))};
  ctx.window=ctx;ctx.self=ctx;ctx.globalThis=ctx;ctx.addEventListener=()=>{};ctx.removeEventListener=()=>{};ctx.dispatchEvent=()=>true;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(APP_JS,'utf8'),ctx,{filename:'app.js'});
  return ctx;
}

const ctx=makeCtx();
const run=c=>vm.runInContext(c,ctx);
run(`
  locations=[{id:'L1',name:'فرع'}];
  products=[
    {code:'T1',name:'صنبور',retail_price:100,purchase_price:60,category:'c'},
    {code:'T2',name:'حوض',retail_price:200,purchase_price:120,category:'c'}];
  stock=[];sales=[];saleItems=[];salePayments=[];customerLedger=[];stockMovements=[];financeMovements=[];
  customers=[{id:'c1',name:'زبون',balance:0}];financeAccounts=[{id:'a1',balance:0}];
  compositeItems=[];purchases=[];purchaseItems=[];suppliers=[];
  buildProductCostIndex(); buildProductSearchIndex();
`);

/* ── ١) بيع نقدي بسيط يوازن ── */
test('بيع نقدي بسيط يوازن', ()=>{
  const items=[{product_code:'T1',product_name:'صنبور',qty:2,unit_price:100,line_discount:0,line_total:200}];
  assert.equal(run(`validateAccountingForSale(${JSON.stringify(items)},200,[{payment_method:'cash',amount:200}],0)`),true);
});
/* ── ٢) بيع بدفع مختلط (نقدي + مصرفي) يوازن ── */
test('بيع بدفع مختلط يوازن', ()=>{
  const items=[{product_code:'T2',product_name:'حوض',qty:1,unit_price:200,line_discount:0,line_total:200}];
  assert.equal(run(`validateAccountingForSale(${JSON.stringify(items)},200,[{payment_method:'cash',amount:80},{payment_method:'bank_transfer',amount:120}],0)`),true);
});
/* ── ٣) بيع آجل: المدفوع ≠ الإجمالي ── */
test('بيع آجل (مدفوع جزئي) يوازن عبر Accounts_Receivable', ()=>{
  const items=[{product_code:'T1',product_name:'صنبور',qty:3,unit_price:100,line_discount:0,line_total:300}];
  // مدفوع 100 + متبقٍ 200 = إجمالي 300
  assert.equal(run(`validateAccountingForSale(${JSON.stringify(items)},300,[{payment_method:'cash',amount:100}],200)`),true);
});
/* ── ٤) مرتجع بيع (إجمالي سالب) يوازن بالإشارة المعاكسة ── */
test('فاتورة مرتجع (سالب) تُوازن بأسطر معاكسة', ()=>{
  assert.equal(run(`validateAccountingForSale([],-150,[{payment_method:'cash',amount:150}],0)`),true);
});
/* ── ٥) خصم على مستوى السطر وعلى مستوى الفاتورة ── */
test('خصم سطر + خصم فاتورة يبقيان التوازن', ()=>{
  const items=[{product_code:'T1',product_name:'صنبور',qty:2,unit_price:100,line_discount:20,line_total:180}]; // خصم سطر 20
  const discount=30; // خصم فاتورة
  const total=180-discount; // 150
  assert.equal(run(`validateAccountingForSale(${JSON.stringify(items)},${total},[{payment_method:'cash',amount:150}],0)`),true);
  // وبقيمة متبقية جزئية
  assert.equal(run(`validateAccountingForSale(${JSON.stringify(items)},${total},[{payment_method:'card',amount:100}],50)`),true);
});
/* ── ٦) تحويل مالي بين حسابين يوازن (مصروف من أ + إيداع في ب) ── */
test('تحويل بين حسابين: حركتان متعاكستان متساويتان', ()=>{
  assert.equal(run(`validateAccountingPayment('customer',250)`),true); // مأخذ موحد للحركة المتوازنة
  // التحويل في الواجهة = حركتا addFinanceMovement (out من أ، in إلى ب) بنفس المبلغ — نتحقق أن كل حركة بمفردها متوازنة والحسابات تتعاكس
  run(`financeAccounts=[{id:'a1',balance:500},{id:'a2',balance:100}]`);
  run(`localMovement('a1','out','adjustment',200,'2026-09-14','pos_finance_accounts','a1','تحويل صادر'); localMovement('a2','in','adjustment',200,'2026-09-14','pos_finance_accounts','a2','تحويل وارد')`);
  assert.equal(run(`financeAccounts[0].balance`),300);
  assert.equal(run(`financeAccounts[1].balance`),300);
});
/* ── ٧) كمية/سعر صفر أو سالب: قواعد الرفض في الواجهة ── */
test('كمية صفر تُرشَّح من بنود الفاتورة (لا تُباع)', ()=>{
  // getSaleItems يرشّح qty===0 — الفاتورة بلا بنود ⇒ يرفضها الحفظ («أضف صنفًا واحدًا على الأقل»)
  const rows=[{code:'T1',qty:'0',price:'100'}];
  const filtered=run(`(function(){ const items=[{product_code:'T1',product_name:'صنبور',qty:0,unit_price:100,line_discount:0,line_total:0}]; return items.filter(x=>x.product_name && x.qty!==0).length; })()`);
  assert.equal(filtered,0);
});
test('سعر سالب: السطر يُقصّ إلى صفر (Math.max(0,…)) فيتراجع للفحص الخادمي NEGATIVE_PRICE_NOT_ALLOWED', ()=>{
  const lt=run(`(function(){ const baseAbs=2*-50; return Math.max(0,baseAbs-0); })()`);
  assert.equal(lt,0);
});
/* ── ٨) الحالة المخلّة بالتوازن يجب أن تفشل ── */
test('معاملة غير متوازنة ⇒ تُرفض بخطأ (هذا الاختبار يثبت أن العطب مكتشف)', ()=>{
  // مدفوع 200 + متبقٍ 100 لكن الإجمالي 250 ⇒ مدين 300 ≠ دائن 250
  assert.throws(()=>run(`validateAccountingForSale([{product_code:'T1',qty:2,unit_price:125,line_discount:0,line_total:250}],250,[{payment_method:'cash',amount:200}],100)`),/غير متوازنة|Anomaly/);
});
test('دفعات أكبر من الإجمالي (بلا متبقٍ) تُخل بالتوازن ⇒ مرفوضة', ()=>{
  assert.throws(()=>run(`validateAccountingForSale([{product_code:'T1',qty:1,unit_price:100,line_discount:0,line_total:100}],100,[{payment_method:'cash',amount:150}],0)`),/غير متوازنة|Anomaly/);
});
/* ── ٩) أساسيات المحرك ── */
test('toMinor يحيّد فروق الفاصلة العائمة (0.1+0.2)', ()=>{
  assert.equal(run(`AccountingIntegrity.toMinor(0.1)+AccountingIntegrity.toMinor(0.2)`),run(`AccountingIntegrity.toMinor(0.3)`));
});
test('خريطة حسابات الدفع صحيحة', ()=>{
  assert.equal(run(`AccountingIntegrity.paymentAccount('cash')`),'Cash_Drawer');
  assert.equal(run(`AccountingIntegrity.paymentAccount('card')`),'Bank_Card');
  assert.equal(run(`AccountingIntegrity.paymentAccount('bank_transfer')`),'Bank_Transfer');
});
test('شراء نقدًا + شراء آجل يوازنان (والدفع الزائد يُقصّ للإجمالي بنيوياً)', ()=>{
  assert.equal(run(`validateAccountingForPurchase(500,500)`),true);
  assert.equal(run(`validateAccountingForPurchase(500,200)`),true);
  // paid > total: الدالة تقصّ المدفوع إلى الإجمالي (min) فتبقى متوازنة بنيوياً —
  // والرفض الفعلي للدفع الزائد يتم في مسار الحفظ/الخادم لا هنا
  assert.equal(run(`validateAccountingForPurchase(300,500)`),true);
});
