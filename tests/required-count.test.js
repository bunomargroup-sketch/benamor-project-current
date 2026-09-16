/* ═══════════════════════════════════════════════════════════════════
   اختبارات المهمة ٤ — قائمة «جرد مطلوب» (الكميات السالبة)
   • الصفوف من stock بكمية < 0 فقط، مرتبة بالأكثر سلبيةً أولاً
   • الأعمدة: الصنف · الموقع · الكمية السالبة · آخر حركة (updated_at) · التصنيف
   • الملخّص: N صفاً يخصّ M صنفاً + تفصيل لكل موقع
   • تصدير CSV بـ BOM (عربي في Excel) بترتيب الجدول نفسه
   • البانر في شاشة الاقتراحات قابل للنقر ويفتح التبويب
   ═══════════════════════════════════════════════════════════════════ */
const test=require('node:test'), assert=require('node:assert');
const fs=require('fs'), vm=require('vm'), path=require('path');
const HERE=path.join(__dirname,'..');
const POS=path.join(HERE,'new discussion github','apps','pos','benamor-sales-system');
const APP=fs.readFileSync(path.join(POS,'app.js'),'utf8');
const HTML=fs.readFileSync(path.join(POS,'index.html'),'utf8');

function el(){const cache={};const cls=new Set();const cl={add:(...cs)=>cs.forEach(c=>cls.add(c)),remove:(...cs)=>cs.forEach(c=>cls.delete(c)),toggle:(c,f)=>{if(f===undefined)f=!cls.has(c);f?cls.add(c):cls.delete(c);return f},contains:c=>cls.has(c)};const e={style:{},dataset:{},classList:cl,addEventListener(){},removeEventListener(){},appendChild(c){return c},remove(){},querySelector(s){return cache[s]||(cache[s]=el())},querySelectorAll(){return[]},setAttribute(){},removeAttribute(){},focus(){},blur(){},click(){},reset(){},value:'',textContent:'',innerHTML:'',id:'',name:'',children:[],options:[],selectedOptions:[{textContent:'',value:''}],checked:false,disabled:false,placeholder:'',closest(){return el()},contains(){return false},insertAdjacentHTML(){},scrollIntoView(){},getAttribute(){return null},srcdoc:'',onload:null,onclick:null,download:'',href:''};return e;}
const storage={};
function makeCtx(){
  const els={};
  const blobs=[];
  class RecBlob{constructor(parts,opts){this.parts=parts;this.opts=opts;blobs.push(this);}}
  const ctx={console:{log(){},warn(){},error(){}},setTimeout:f=>{try{f()}catch(e){};return{unref(){}}},clearTimeout,setInterval:()=>({unref(){}}),clearInterval,Promise,JSON,Math,Date,Object,Array,Map,Set,Number,String,Boolean,Error,TypeError,RegExp,Intl,
    document:{querySelector:()=>el(),querySelectorAll:()=>[],getElementById:id=>(els[id]||(els[id]=el())),createElement:()=>el(),body:el(),documentElement:el(),addEventListener(){},title:''},
    localStorage:{getItem:k=>storage[k]??null,setItem:(k,v)=>{storage[k]=String(v)},removeItem:k=>{delete storage[k]}},
    fetch:async()=>({ok:true,status:200,text:async()=>'[]',json:async()=>[]}),
    navigator:{onLine:true,serviceWorker:{register:async()=>({})}},
    alert(){},prompt(){return null},confirm(){return true},
    atob:s=>Buffer.from(s,'base64').toString('binary'),btoa:s=>Buffer.from(s,'binary').toString('base64'),
    URL:{createObjectURL:()=>'blob:x',revokeObjectURL(){}},Blob:RecBlob,FileReader:function(){},FormData:function(){this.append=function(){}},
    Event:function(){},CustomEvent:function(){},history:{},location:{href:'x',reload(){},origin:'x'},requestAnimationFrame:f=>f(),
    performance:{now:()=>Date.now()},crypto:{randomUUID:()=>'u'},open:()=>null,structuredClone:o=>JSON.parse(JSON.stringify(o))};
  ctx.window=ctx;ctx.self=ctx;ctx.globalThis=ctx;ctx.addEventListener=()=>{};ctx.removeEventListener=()=>{};ctx.dispatchEvent=()=>true;
  ctx.__els=els;ctx.__blobs=blobs;
  vm.createContext(ctx);
  vm.runInContext(APP,ctx,{filename:'app.js'});
  return ctx;
}
const L1='11111111-1111-1111-1111-111111111111', L2='22222222-2222-2222-2222-222222222222';
function seed(ctx){
  vm.runInContext(`
    locations=[{id:'${L1}',name:'فرع السراج',location_type:'branch',is_sales_location:true},{id:'${L2}',name:'فرع 11 يونيو',location_type:'branch',is_sales_location:true}];
    products=[{code:'A1',name:'خلاط',category:'خلاطات',retail_price:100},{code:'B2',name:'حوض',category:'أحواض',retail_price:200},{code:'C3',name:'دش',category:'دشات',retail_price:300}];
    stock=[
      {location_id:'${L1}',product_code:'A1',product_name:'خلاط',qty:-5,updated_at:'2026-09-10T14:30:00Z'},
      {location_id:'${L2}',product_code:'A1',product_name:'خلاط',qty:-1,updated_at:'2026-09-12T09:00:00Z'},
      {location_id:'${L1}',product_code:'B2',product_name:'حوض',qty:-3,updated_at:'2026-09-01T08:00:00Z'},
      {location_id:'${L2}',product_code:'C3',product_name:'دش',qty:7,updated_at:'2026-09-14T10:00:00Z'},
      {location_id:'${L1}',product_code:'ZZ9',product_name:'غير معروف',qty:-2,updated_at:''}
    ];
    sales=[];saleItems=[];salePayments=[];saleReturns=[];saleReturnItems=[];purchases=[];purchaseItems=[];transfers=[];compositeItems=[];financeAccounts=[];customers=[];suppliers=[];
    currentRole={role:'admin'}; appUser={id:'u1',identifier:'admin',branch_id:'${L1}'};
    saleStockRequests=[]; suggestionDismissals=[]; locationCategoryRules=[];
  `,ctx);
}

test('(٤-١) القائمة: سالبة فقط، الأكثر سلبيةً أولاً، وكل الأعمدة صحيحة', async ()=>{
  const ctx=makeCtx(); seed(ctx); const E=ctx.__els;
  vm.runInContext('renderRequiredCount()',ctx);
  const html=E.requiredCountBody.innerHTML;
  /* الترتيب: A1@سراج −5 ثم B2@سراج −3 ثم ZZ9 −2 ثم A1@11يونيو −1 — وC3 الموجب مستبعد */
  const order=[...html.matchAll(/<tr><td>(\d+)<\/td><td class="ltr"><b>([A-Z0-9]+)<\/b>/g)].map(m=>m[2]);
  assert.deepEqual(order,['A1','B2','ZZ9','A1'],'الأكثر سلبيةً أولاً');
  assert.ok(!html.includes('C3'),'الموجب مستبعد');
  assert.ok(html.includes('فرع السراج')&&html.includes('فرع 11 يونيو'),'أسماء المواقع');
  assert.ok(html.includes('-5.00')&&html.includes('-3.00'),'الكميات السالبة منسقة');
  assert.ok(html.includes('2026-09-10 14:30'),'آخر حركة من updated_at');
  assert.ok(html.includes('خلاطات')&&html.includes('أحواض'),'التصنيف من بطاقة المنتج');
  /* الملخّص: 4 صفوف تخصّ 3 أصناف + تفصيل المواقع */
  assert.ok(E.requiredCountSummary.textContent.includes('4 صفاً')&&E.requiredCountSummary.textContent.includes('3 صنفاً'),'الملخّص');
  assert.ok(E.requiredCountSummary.textContent.includes('فرع السراج: 3')&&E.requiredCountSummary.textContent.includes('فرع 11 يونيو: 1'),'تفصيل المواقع');
  /* مجموع العجز في التذييل */
  assert.ok(E.requiredCountFoot.innerHTML.includes('-11.00'),'مجموع العجز −11');
  /* نظيفة بلا سالب */
  vm.runInContext('stock=stock.filter(s=>Number(s.qty||0)>=0); renderRequiredCount()',ctx);
  assert.ok(E.requiredCountBody.innerHTML.includes('لا توجد كميات سالبة'),'حالة نظيفة');
});

test('(٤-٢) التبويب الفرعي والبانر القابل للنقر', async ()=>{
  const ctx=makeCtx(); seed(ctx); const E=ctx.__els;
  vm.runInContext(`stock.push({location_id:'${L2}',product_code:'B2',product_name:'حوض',qty:-9,updated_at:'2026-09-15T10:00:00Z'}); showTransfersSub('requiredCount')`,ctx);
  assert.equal(E.requiredCountPanel.style.display,'','اللوحة ظاهرة');
  assert.ok(E.requiredCountSubTabBtn.classList.contains('active'),'الزر نشط');
  assert.equal(E.transfersMainPanel.style.display,'none','التحويلات مخفية');
  assert.ok(E.requiredCountBody.innerHTML.includes('B2'),'رُسمت');
  /* بانر الاقتراحات: يظهر بالعدد ويفتح القائمة عند النقر */
  vm.runInContext(`stock.push({location_id:'${L1}',product_code:'C3',product_name:'دش',qty:-4,updated_at:'2026-09-15T11:00:00Z'}); sgNegativesCount=stock.filter(s=>Number(s.qty||0)<0).length; renderSuggestionList()`,ctx);
  assert.ok(E.suggestionsNegativesBanner.style.display==='block','البانر ظاهر');
  assert.ok(E.suggestionsNegativesBanner.textContent.includes('صنفاً مستبعد'),'نص البانر');
  assert.equal(typeof E.suggestionsNegativesBanner.onclick,'function','البانر قابل للنقر');
  vm.runInContext('showTransfersSub("suggestions")',ctx);
  E.suggestionsNegativesBanner.onclick();
  assert.equal(E.requiredCountPanel.style.display,'','النقر على البانر يفتح جرد مطلوب');
});

test('(٤-٣) التصدير: CSV بـ BOM وبترتيب الجدول، والطباعة ترفض بلا سالب', async ()=>{
  const ctx=makeCtx(); seed(ctx); const E=ctx.__els;
  /* نظيفة ⇒ الرفض بلا ملف */
  vm.runInContext('stock=[]; exportRequiredCountCsv(); printRequiredCount()',ctx);
  assert.equal(ctx.__blobs.length,0,'لا ملف بلا سالب');
  /* مع سالب ⇒ CSV */
  vm.runInContext(`stock=[
    {location_id:'${L1}',product_code:'A1',product_name:'خلاط',qty:-5,updated_at:'2026-09-10T14:30:00Z'},
    {location_id:'${L2}',product_code:'B2',product_name:'حوض',qty:-2,updated_at:'2026-09-12T09:00:00Z'}
  ]; exportRequiredCountCsv()`,ctx);
  assert.equal(ctx.__blobs.length,1,'ملف واحد');
  const csv=String(ctx.__blobs[0].parts[0]);
  assert.ok(csv.startsWith('\ufeff'),'BOM للعربية في Excel');
  assert.ok(csv.includes('"كود الصنف"')&&csv.includes('"آخر حركة"'),'الرؤوس');
  const a1row=csv.split('\r\n').find(l=>l.includes('"A1"'));
  const b2row=csv.split('\r\n').find(l=>l.includes('"B2"'));
  assert.ok(a1row&&b2row,'الصفوف موجودة');
  assert.ok(csv.indexOf('"A1"')<csv.indexOf('"B2"'),'الأكثر سلبيةً أولاً في الملف');
  assert.ok(a1row.includes('-5')&&a1row.includes('2026-09-10 14:30'),'بيانات الصف');
  assert.ok(ctx.__blobs[0].opts.type.includes('text/csv'),'نوع الملف CSV');
});

test('(٤-٤) الملفات: الزر واللوحة والأعمدة والدوال', ()=>{
  assert.ok(HTML.includes('requiredCountSubTabBtn')&&HTML.includes('جرد مطلوب</button>'),'زر التبويب الفرعي');
  assert.ok(HTML.includes('requiredCountPanel')&&HTML.includes('requiredCountBody'),'اللوحة والجدول');
  assert.ok(HTML.includes('الكمية السالبة</th>')&&HTML.includes('آخر حركة له</th>')&&HTML.includes('التصنيف</th>'),'الأعمدة الخمسة');
  assert.ok(HTML.includes('exportRequiredCountCsv()')&&HTML.includes('printRequiredCount()'),'زرا التصدير والطباعة');
  for(const fn of ['function requiredCountRows','function renderRequiredCount','function exportRequiredCountCsv','function printRequiredCount'])
    assert.ok(APP.includes(fn),fn);
  assert.ok(APP.includes("b.onclick=()=>showTransfersSub('requiredCount')"),'البانر يفتح القائمة');
  /* لا نداء شبكة ولا loadAll في المسار الجديد */
  const block=APP.slice(APP.indexOf('function requiredCountRows'),APP.indexOf('function showTransfersSub(which)'));
  assert.ok(!block.includes('await api')&&!block.includes('apiAll')&&!block.includes('loadAll'),'محلي بالكامل');
});
