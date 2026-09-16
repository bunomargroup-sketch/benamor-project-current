/* ═══════════════════════════════════════════════════════════════════
   اختبارات المهمة ١ — تلوين أسطر البيع حسب الهامش
   • اللون على السعر الفعلي للسطر (بعد الخصم) لا سعر الكتالوج
   • سالب أو <5% ⇒ أحمر · 5–15% ⇒ برتقالي · 15–30% ⇒ أصفر · ≥30% ⇒ بلا لون
   • تكلفة صفر ⇒ بلا لون (لا خسارة)
   • العتبات من APP_CONFIG وتتبعها الألوان فوراً بلا إعادة تحميل
   • 10 أصناف عادية (35%) ⇒ بلا ألوان تقريباً
   ═══════════════════════════════════════════════════════════════════ */
const test=require('node:test'), assert=require('node:assert');
const fs=require('fs'), vm=require('vm'), path=require('path');
const HERE=path.join(__dirname,'..');
const POS=path.join(HERE,'new discussion github','apps','pos','benamor-sales-system');
const APP_JS=path.join(POS,'app.js');
const HTML=fs.readFileSync(path.join(POS,'index.html'),'utf8');
const CSS=fs.readFileSync(path.join(POS,'app.css'),'utf8');
const APP=fs.readFileSync(APP_JS,'utf8');

function el(){const cache={};const cls=new Set();const cl={add:(...cs)=>cs.forEach(c=>cls.add(c)),remove:(...cs)=>cs.forEach(c=>cls.delete(c)),toggle:(c,f)=>{if(f===undefined)f=!cls.has(c);f?cls.add(c):cls.delete(c);return f},contains:c=>cls.has(c)};const e={style:{},dataset:{},classList:cl,addEventListener(){},removeEventListener(){},appendChild(c){return c},remove(){},querySelector(s){return cache[s]||(cache[s]=el())},querySelectorAll(){return[]},setAttribute(){},removeAttribute(){},focus(){},blur(){},click(){},reset(){},value:'',textContent:'',innerHTML:'',id:'',name:'',children:[],options:[],selectedOptions:[{textContent:'',value:''}],checked:false,disabled:false,placeholder:'',closest(){return el()},contains(){return false},insertAdjacentHTML(){},scrollIntoView(){},getAttribute(){return null}};return e;}
const storage={};
function makeCtx(){
  const els={};
  const ctx={console:{log(){},warn(){},error(){}},setTimeout:f=>{try{f()}catch(e){};return{unref(){}}},clearTimeout,setInterval:()=>({unref(){}}),clearInterval,Promise,JSON,Math,Date,Object,Array,Map,Set,Number,String,Boolean,Error,TypeError,RegExp,Intl,
    document:{querySelector:()=>el(),querySelectorAll:()=>[],getElementById:id=>(els[id]||(els[id]=el())),createElement:()=>el(),body:el(),documentElement:el(),addEventListener(){},title:''},
    localStorage:{getItem:k=>storage[k]??null,setItem:(k,v)=>{storage[k]=String(v)},removeItem:k=>{delete storage[k]}},
    fetch:async()=>({ok:true,status:200,text:async()=>'[]',json:async()=>[]}),
    navigator:{onLine:true,serviceWorker:{register:async()=>({})}},
    alert(){},prompt(){return null},confirm(){return true},
    atob:s=>Buffer.from(s,'base64').toString('binary'),btoa:s=>Buffer.from(s,'binary').toString('base64'),
    URL:{createObjectURL:()=>'x',revokeObjectURL(){}},Blob:function(){},FileReader:function(){},FormData:function(){this.append=function(){}},
    Event:function(){},CustomEvent:function(){},history:{},location:{href:'x',reload(){},origin:'x'},requestAnimationFrame:f=>f(),
    performance:{now:()=>Date.now()},crypto:{randomUUID:()=>'u'},open:()=>null,structuredClone:o=>JSON.parse(JSON.stringify(o))};
  ctx.window=ctx;ctx.self=ctx;ctx.globalThis=ctx;ctx.addEventListener=()=>{};ctx.removeEventListener=()=>{};ctx.dispatchEvent=()=>true;
  ctx.__els=els;
  vm.createContext(ctx);
  vm.runInContext(APP,ctx,{filename:'app.js'});
  return ctx;
}
/* صف وهمي: كمية · سعر · خصم نصّي — بقية الحقول كسلووب باقي المنظومة */
function mkRow(code,qty,price,discount='0'){
  const cls=new Set();
  return {querySelector:s=>({'.si-code':{value:code},'.si-name':{value:code},'.si-qty':{value:String(qty)},'.si-price':{value:String(price)},'.si-kind':{value:'sale'},'.si-discount':{value:String(discount)},'.si-margin':null,'.si-margin-pct':null,'.si-line':{innerHTML:''}})[s]||{value:''},
          classList:{add:(...cs)=>cs.forEach(c=>cls.add(c)),remove:(...cs)=>cs.forEach(c=>cls.delete(c)),toggle:(c,f)=>{if(f===undefined)f=!cls.has(c);f?cls.add(c):cls.delete(c);return f},contains:c=>cls.has(c),__set:cls}};
}
function seed(ctx){
  vm.runInContext(`
    locations=[{id:'L1',name:'فرع السراج',is_sales_location:true}];products=[{code:'A45',name:'خلاط هامش 45',retail_price:145,purchase_price:100},{code:'ZERO',name:'بلا تكلفة',retail_price:80,purchase_price:0},{code:'NORM',name:'عادي 35',retail_price:135,purchase_price:100},{code:'M8',name:'هامش 8',retail_price:108,purchase_price:100}];
    customers=[];sales=[];saleItems=[];salePayments=[];saleReturns=[];saleReturnItems=[];stock=[];financeAccounts=[];financeMovements=[];stockMovements=[];customerLedger=[];suppliers=[];transfers=[];compositeItems=[];purchases=[];purchaseItems=[];
    currentRole={role:'admin'}; appUser={id:'u1',identifier:'admin',branch_id:'L1'}; authSession={access_token:'t',refresh_token:'r',expires_at:9999999999};
    buildProductCostIndex(); buildProductSearchIndex();
  `,ctx);
}
function primeForm(ctx){ /* العناصر التي تلمسها updateSaleTotal */
  const E=ctx.__els;
  ['saleCashAmount','saleBankAmount','saleCardAmount','saleDiscount','salePaymentMethod','salePaidAmount','saleTotal','salePaymentScreenTotal','saleBalance','salePaymentDetected','saleCreditLine','saleCustomer','saleCustomerBalance','saleCustomerInfo','saleItemsCount','saleItemsCountMini','saleWholesaleToggle'].forEach(id=>ctx.document.getElementById(id));
  Object.assign(E.saleCashAmount,{value:'0'});Object.assign(E.saleBankAmount,{value:'0'});Object.assign(E.saleCardAmount,{value:'0'});Object.assign(E.saleDiscount,{value:'0'});Object.assign(E.salePaymentMethod,{value:'cash'});
  return E;
}
const colorOf=r=>['margin-red','margin-orange','margin-yellow'].find(c=>r.classList.contains(c))||'بلا لون';

test('(١-١) القبول: هامش 45% ⇒ بلا لون، وخصم سطر 40% ⇒ يحمرّ فوراً', async ()=>{
  const ctx=makeCtx(); seed(ctx); const E=primeForm(ctx);
  const row=mkRow('A45',1,145,'0');
  ctx.document.getElementById('saleItemsBody').querySelectorAll=()=>[row];
  vm.runInContext(`updateSaleTotal()`,ctx);
  assert.equal(colorOf(row),'بلا لون','هامش 45% ⇒ بلا لون');
  /* خصم 40% من الأساس: 145×0.6=87 < 100 ⇒ خسارة ⇒ أحمر فوراً بنفس النداء */
  const row2=mkRow('A45',1,145,'40%');
  ctx.document.getElementById('saleItemsBody').querySelectorAll=()=>[row2];
  vm.runInContext(`updateSaleTotal()`,ctx);
  assert.equal(colorOf(row2),'margin-red','خصم 40% ⇒ السطر أحمر (خسارة فعلية)');
  /* الكمية تغيّرت والسعر ثابت والخصم صفري لكن السعر حرّ: 103/تكلفة100 = 3% ⇒ أحمر */
  const row3=mkRow('A45',2,103,'0');
  ctx.document.getElementById('saleItemsBody').querySelectorAll=()=>[row3];
  vm.runInContext(`updateSaleTotal()`,ctx);
  assert.equal(colorOf(row3),'margin-red','سعر محرَّر 103 ⇒ هامش 3% ⇒ أحمر');
});

test('(١-٢) تكلفة صفر ⇒ بلا لون إطلاقاً حتى لو السعر أدنى من «التكلفة»', async ()=>{
  const ctx=makeCtx(); seed(ctx); primeForm(ctx);
  const row=mkRow('ZERO',1,10,'0');
  ctx.document.getElementById('saleItemsBody').querySelectorAll=()=>[row];
  vm.runInContext(`updateSaleTotal()`,ctx);
  assert.equal(colorOf(row),'بلا لون','تكلفة مجهولة ⇒ لا لون ولا اعتبار خسارة');
});

test('(١-٣) العتبات: برتقالي عند 8%، أصفر عند 20%، وتتبع التعديل فوراً', async ()=>{
  const ctx=makeCtx(); seed(ctx); primeForm(ctx);
  const r8=mkRow('M8',1,108,'0'), r20=mkRow('NORM',1,120,'0');
  ctx.document.getElementById('saleItemsBody').querySelectorAll=()=>[r8,r20];
  vm.runInContext(`updateSaleTotal()`,ctx);
  assert.equal(colorOf(r8),'margin-orange','8% ⇒ برتقالي');
  assert.equal(colorOf(r20),'margin-yellow','20% ⇒ أصفر');
  /* عدّل المدير العتبة الصفراء إلى 40% ⇒ صف 35% يصير أصفراً فوراً بلا إعادة تحميل */
  vm.runInContext(`APP_CONFIG.marginYellowBelow=40; updateSaleTotal()`,ctx);
  assert.equal(colorOf(r20),'margin-yellow','20% بقيت أصفر');
  const r35=mkRow('NORM',1,135,'0');
  ctx.document.getElementById('saleItemsBody').querySelectorAll=()=>[r35];
  vm.runInContext(`updateSaleTotal()`,ctx);
  assert.equal(colorOf(r35),'margin-yellow','35% صار أصفر بعد رفع العتبة إلى 40');
  vm.runInContext(`APP_CONFIG.marginRedBelow=10; APP_CONFIG.marginOrangeBelow=20; APP_CONFIG.marginYellowBelow=30; updateSaleTotal()`,ctx);
  assert.equal(colorOf(r35),'بلا لون','35% فوق العتبة الصفراء المُعادة ⇒ بلا لون');
  const r8b=mkRow('M8',1,108,'0');
  ctx.document.getElementById('saleItemsBody').querySelectorAll=()=>[r8b];
  vm.runInContext(`updateSaleTotal()`,ctx);
  assert.equal(colorOf(r8b),'margin-red','8% تحت العتبة الحمراء الجديدة 10 ⇒ أحمر');
});

test('(١-٤) فاتورة من 10 أصناف عادية (35%) ⇒ صفر ألوان', async ()=>{
  const ctx=makeCtx(); seed(ctx); primeForm(ctx);
  const rows=Array.from({length:10},(_,i)=>mkRow('NORM',1+i,135,'0'));
  ctx.document.getElementById('saleItemsBody').querySelectorAll=()=>rows;
  vm.runInContext(`updateSaleTotal()`,ctx);
  const colored=rows.filter(r=>r.classList.contains('margin-red')||r.classList.contains('margin-orange')||r.classList.contains('margin-yellow')).length;
  assert.equal(colored,0,'لا ألوان على الأصناف العادية — اللون للاستثناء فقط');
});

test('(١-٥) الملفات: العتبات في APP_CONFIG والإعدادات والأنماط والملحوظة', ()=>{
  assert.ok(APP.includes('marginRedBelow:5,marginOrangeBelow:15,marginYellowBelow:30'),'العتبات في APP_CONFIG بقيم 5/15/30');
  for(const id of ['settingsMarginRedBelow','settingsMarginOrangeBelow','settingsMarginYellowBelow'])
    assert.ok(HTML.includes(`id="${id}"`),'حقل '+id);
  assert.ok(HTML.includes('النسبة محسوبة على التكلفة: (البيع − الشراء) ÷ الشراء'),'الملحوظة تحت الإعدادات');
  assert.ok(APP.includes("if(q('saleItemsBody')) updateSaleTotal(); /* الألوان تتبع العتبات فوراً"),'الحفظ يعيد الحساب فوراً');
  for(const c of ['margin-red','margin-orange','margin-yellow'])
    assert.ok(CSS.includes(`tr.${c} td{background:color-mix`),'نمط '+c);
  assert.ok(CSS.includes('td:first-child{border-inline-start:4px solid'),'شريط 4px في بداية السطر');
  /* لا نداء إضافي: التلوين داخل حلقة updateSaleTotal التي تستدعي productCost أصلاً */
  const loopSrc=APP.slice(APP.indexOf('function updateSaleTotal()'),APP.indexOf('function normalizePhoneLY'));
  assert.ok(loopSrc.includes('applyMarginRowColor(tr')),'التلوين داخل حلقة updateSaleTotal نفسها';
  assert.equal((loopSrc.match(/productCost\(/g)||[]).length,1,'لا نداء productCost إضافي');
});
