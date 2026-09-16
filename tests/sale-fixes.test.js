/* ═══════════════════════════════════════════════════════════════════
   اختبارات إصلاحات شاشة البيع المبلَّغة من الجهاز:
   ١) بحث الزبائن: الشريحة كلها تفتح اللوحة، والفتح يعيد بناء القائمة،
      وEnter في البحث محروس (لا يرسل الفاتورة ولا يُفسَّر ماسحاً)
   ٢) زر الدفع: الشريط السفلي position:fixed — دائم الظهور مهما طال
      المحتوى أو ظهر تنبيه التعديل
   ٣) وضع التعديل: لا شيء يخفي salePayBtn — الثبات يغطيه
   ═══════════════════════════════════════════════════════════════════ */
const test=require('node:test'), assert=require('node:assert');
const fs=require('fs'), vm=require('vm'), path=require('path');
const HERE=path.join(__dirname,'..');
const POS=path.join(HERE,'new discussion github','apps','pos','benamor-sales-system');
const APP=fs.readFileSync(path.join(POS,'app.js'),'utf8');
const HTML=fs.readFileSync(path.join(POS,'index.html'),'utf8');
const CSS=fs.readFileSync(path.join(POS,'app.css'),'utf8');

/* ═══ الملفات ═══ */
test('(إصلاح-ملفات) الشريحة تفتح اللوحة + حارس Enter + الشريط مثبَّت', ()=>{
  /* الشريحة كلها قابلة للنقر وتفتح بقوة */
  const chip=HTML.slice(HTML.indexOf('schip-customer'),HTML.indexOf('schip-price'));
  assert.ok(chip.includes('onclick="toggleSaleCustomerPanel(true)"'),'الشريحة تفتح اللوحة');
  assert.ok(chip.includes('event.stopPropagation();toggleSaleCustomerPanel(true)'),'زر «تغيير» يفتح دون ازدواج');
  /* حارس Enter على البحث */
  assert.ok(HTML.includes('id="saleCustomerSearch" placeholder="اكتب للتصفية…" oninput="filterSaleCustomerOptions()" onkeydown="if(event.key===\x27Enter\x27){event.preventDefault();event.stopPropagation();}"'),'Enter في البحث محروس');
  assert.ok(HTML.includes('toggleSaleCustomerPanel(false)">✖ إخفاء اللوحة'),'زر إخفاء اللوحة');
  /* الشريط السفلي مثبَّت */
  assert.ok(CSS.includes('#sales .sale-finish-bar{position:fixed;left:14px;right:14px;bottom:10px;z-index:30'),'position:fixed دائم الظهور');
  assert.ok(CSS.includes('@media(min-width:901px){body:not(.nav-collapsed) #sales .sale-finish-bar{right:292px}}'),'إزاحة عند فتح القائمة الجانبية');
  assert.ok(CSS.includes('height:calc(100dvh - 175px)'),'ارتفاع العمود يحتسب الشريط المثبَّت');
  assert.ok(/@media\(max-width:1100px\)\{[^}]*#sales #saleForm\{padding-bottom:96px\}/s.test(CSS.replace(/\n/g,''))||CSS.includes('#sales #saleForm{padding-bottom:96px}'),'هامش التمرير في وضع التابلت يحمي المحتوى من الشريط');
  /* لا قاعدة تخفي زر الدفع */
  assert.ok(!/salePayBtn[^}]*display\s*:\s*none/.test(CSS)&&!/display\s*:\s*none[^}]*salePayBtn/.test(CSS),'لا شيء يخفي زر الدفع');
  /* الدالة الجديدة */
  assert.ok(APP.includes('function toggleSaleCustomerPanel(force)'),'الدالة تقبل فتحاً/إغلاقاً صريحاً');
});

/* ═══ السلوك في VM ═══ */
function el(){const cache={};const cls=new Set();const cl={add:(...cs)=>cs.forEach(c=>cls.add(c)),remove:(...cs)=>cs.forEach(c=>cls.delete(c)),toggle:(c,f)=>{if(f===undefined)f=!cls.has(c);f?cls.add(c):cls.delete(c);return f},contains:c=>cls.has(c)};const e={style:{},dataset:{},classList:cl,addEventListener(){},removeEventListener(){},appendChild(c){return c},remove(){},querySelector(s){return cache[s]||(cache[s]=el())},querySelectorAll(){return[]},setAttribute(){},removeAttribute(){},focus(){},blur(){},click(){},reset(){},value:'',textContent:'',innerHTML:'',id:'',name:'',children:[],options:[],selectedOptions:[{textContent:'',value:''}],checked:false,disabled:false,placeholder:'',closest(){return el()},contains(){return false},insertAdjacentHTML(){},scrollIntoView(){},getAttribute(){return null},onclick:null};return e;}
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

test('(إصلاح-١) بحث الزبائن: اللوحة تفتح صريحةً وتغلق، والقائمة تُبنى والتصفية تعمل', async ()=>{
  const ctx=makeCtx(); const E=ctx.__els;
  vm.runInContext(`customers=[{id:'c1',name:'علي حسن',phone:'0911111111',balance:0},{id:'c2',name:'منصور',phone:'0922222222',balance:30},{id:'c3',name:'علي المبروك',phone:'0933333333',balance:0}]; locations=[]; products=[]; sales=[]; saleItems=[]; currentRole={role:'admin'}; appUser={id:'u1',identifier:'admin',branch_id:'L1'};`,ctx);
  /* فتح صريح */
  vm.runInContext('toggleSaleCustomerPanel(true)',ctx);
  assert.ok(!E.saleCustomerPanel.classList.contains('hidden'),'فتح صريح');
  /* الفتح يبني القائمة (لا تُترك فارغة) */
  assert.ok(E.saleCustomer.innerHTML.includes('علي حسن')&&E.saleCustomer.innerHTML.includes('منصور'),'القائمة مبنية عند الفتح');
  /* التصفية بالاسم */
  E.saleCustomerSearch.value='علي';
  vm.runInContext('filterSaleCustomerOptions()',ctx);
  assert.ok(E.saleCustomer.innerHTML.includes('c1')&&E.saleCustomer.innerHTML.includes('c3')&&!E.saleCustomer.innerHTML.includes('c2'),'تصفية بالاسم');
  /* التصفية بالهاتف */
  E.saleCustomerSearch.value='0922222222';
  vm.runInContext('filterSaleCustomerOptions()',ctx);
  assert.ok(E.saleCustomer.innerHTML.includes('c2')&&!E.saleCustomer.innerHTML.includes('c1'),'تصفية بالهاتف');
  /* إغلاق صريح */
  vm.runInContext('toggleSaleCustomerPanel(false)',ctx);
  assert.ok(E.saleCustomerPanel.classList.contains('hidden'),'إغلاق صريح');
});

test('(إصلاح-٢) زر الدفع لا يختفي: ثابت بغضّ النظر عن المحتوى أو وضع التعديل', async ()=>{
  const ctx=makeCtx(); const E=ctx.__els;
  /* وضع التعديل: تنبيه التعديل ظاهر + شريط الدفع ثابت (CSS-level) —
     لا يوجد أي مسار يخفي salePayBtn أو sale-finish-bar */
  vm.runInContext(`editingSaleId='x'; q('saleEditAlert').classList.remove('hidden');`,ctx);
  assert.ok(!E.saleEditAlert.classList.contains('hidden'),'تنبيه التعديل ظاهر (وضع التعديل)');
  const src=APP;
  assert.ok(!/salePayBtn[^;]{0,120}classList\.add\(\s*'hidden'/.test(src)&&!/classList\.add\('hidden'[^;]{0,120}salePayBtn/.test(src),'لا كود يخفي زر الدفع');
  assert.ok(!/sale-finish-bar[^"]*hidden/.test(HTML),'لا صنف مخفي على الشريط');
  /* شاشة الدفع تعلو الشريط المثبَّت (bottom:78px) */
  assert.ok(CSS.includes('inset:auto 16px 78px auto'),'شاشة الدفع تعلو الشريط');
});
