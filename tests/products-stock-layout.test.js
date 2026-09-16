/* ═══════════════════════════════════════════════════════════════════
   اختبارات المهمتين ٢+٣ — قاعدة المنتجات والمخزون الحالي
   • النافذة: كل معرفات النموذج موجودة داخلها + الفتح والإغلاق
   • شريط الإجراءات: يظهر عند التحديد ويختفي بدونه
   • productBottomSearch محذوف من الـDOM ومن الكود
   • بطاقة «تحت الطلب» قابلة للنقر وتصفّي الجدول
   • الفلاتر: أزرار المسح + كل المعرفات
   • الرأس اللاصق + تخطيط ارتفاع النافذة
   ═══════════════════════════════════════════════════════════════════ */
const test=require('node:test'), assert=require('node:assert');
const fs=require('fs'), vm=require('vm'), path=require('path');
const HERE=path.join(__dirname,'..');
const POS=path.join(HERE,'new discussion github','apps','pos','benamor-sales-system');
const HTML=fs.readFileSync(path.join(POS,'index.html'),'utf8');
const CSS=fs.readFileSync(path.join(POS,'app.css'),'utf8');
const APP=fs.readFileSync(path.join(POS,'app.js'),'utf8');

test('(م٢-ملفات) النافذة: كل المعرفات + شريط الإجراءات + المحذوفات', ()=>{
  const modal=HTML.slice(HTML.indexOf('id="productModal"'),HTML.indexOf('</div>\n      </div>\n','id="productModal"'.length+HTML.indexOf('id="productModal"')));
  const modalHtml=HTML.slice(HTML.indexOf('id="productModal"'));
  for(const id of ['productCode','productName','productCategory','productSupplier','productBrand','productModel','productColor','productBarcode','productReorderPoint','productPurchasePrice','productRetailPrice','productWholesalePrice','productForm','productSubmitBtn','productComponentsSection','componentCodeInput','componentQtyInput','productComponentsBody'])
    assert.ok(modalHtml.includes(`id="${id}"`),id+' داخل النافذة');
  assert.ok(HTML.includes('id="productActionBar"'),'شريط الإجراءات');
  assert.ok(!HTML.includes('productBottomSearch'),'productBottomSearch محذوف من الـDOM');
  assert.ok(!APP.includes("q('productBottomSearch')"),'لا مرجع له في app.js');
  assert.ok(HTML.includes('class="row sticky-actions hidden" id="productActionBar"'),'الشريط مخفي افتراضياً');
  assert.ok(HTML.includes('onclick="openProductModal()"'),'زر + منتج جديد');
  assert.ok(HTML.includes('onclick="clearProductFilters()"'),'زر مسح فلاتر المنتجات');
});

test('(م٢-CSS) ارتفاع النافذة + الرأس اللاصق + تخطيط', ()=>{
  assert.ok(CSS.includes('#products.active > .panel{display:flex;flex-direction:column;height:calc(100dvh - 130px)'),'المنتجات: ارتفاع النافذة');
  assert.ok(CSS.includes('#products .product-table-scroll thead th{position:sticky;top:0'),'المنتجات: رأس لاصق');
  assert.ok(CSS.includes('#products .product-sidebar{max-height:calc(100dvh - 320px)'),'المنتجات: sidebar بحد ارتفاع');
  assert.ok(CSS.includes('@media(max-width:1100px){#products .product-workbench{grid-template-columns:1fr}'),'المنتجات: تابلت يلغي العمودين');
  /* الشريط السفلي القديم حُذف من الـDOM — قاعدة CSS العامة تبقى (لا تضر) */
});

test('(م٣-ملفات) المخزون: الفلاتر + البطاقات + النقر على «تحت الطلب»', ()=>{
  for(const id of ['stockLocationFilter','stockCategoryFilter','stockBrandFilter','stockSupplierFilter','stockStatusFilter','stockSearch','stockValueTotal','stockQtyTotal','stockItemsCount','stockLowCount','stockBody'])
    assert.ok(HTML.includes(`id="${id}"`),id);
  assert.ok(HTML.includes('id="stockLowCountCard" onclick="filterStockLow()"'),'بطاقة تحت الطلب قابلة للنقر');
  assert.ok(HTML.includes('onclick="clearStockFilters()"'),'زر مسح فلاتر المخزون');
  assert.ok(APP.includes('function filterStockLow(){const el=q("stockStatusFilter"); if(el){el.value="low"; renderStock();}}'),'filterStockLow يضبط low ويصفّي');
  assert.ok(APP.includes('function clearStockFilters()'),'clearStockFilters');
});

test('(م٣-CSS) البطاقات النحيفة + الرأس اللاصق + ارتفاع النافذة', ()=>{
  assert.ok(CSS.includes('#stock.active > .panel{display:flex;flex-direction:column;height:calc(100dvh - 130px)'),'المخزون: ارتفاع النافذة');
  assert.ok(CSS.includes('#stock .stock-metric{display:flex;align-items:center;justify-content:space-between'),'البطاقات: سطر واحد (flex)');
  assert.ok(CSS.includes('#stock .stock-metric.clickable{cursor:pointer'),'قابلة للنقر');
  assert.ok(CSS.includes('#stock .stock-table-scroll thead th{position:sticky;top:0'),'المخزون: رأس لاصق');
});

test('(م١) إصلاح الجذر: قاعدة .row > input', ()=>{
  assert.ok(CSS.includes('.row > input,.row > select,.row > textarea{width:auto;flex:0 1 auto}'),'القاعدة موجودة');
});

/* ═══ السلوك في VM ═══ */
function el(){const cache={};const cls=new Set();const cl={add:(...cs)=>cs.forEach(c=>cls.add(c)),remove:(...cs)=>cs.forEach(c=>cls.delete(c)),toggle:(c,f)=>{if(f===undefined)f=!cls.has(c);f?cls.add(c):cls.delete(c);return f},contains:c=>cls.has(c)};const e={style:{},dataset:{},classList:cl,addEventListener(){},removeEventListener(){},appendChild(c){return c},remove(){},querySelector(s){return cache[s]||(cache[s]=el())},querySelectorAll(){return[]},setAttribute(){},removeAttribute(){},focus(){},blur(){},click(){},reset(){},value:'',textContent:'',innerHTML:'',id:'',name:'',children:[],options:[],selectedOptions:[{textContent:'',value:''}],checked:false,disabled:false,placeholder:'',closest(){return el()},contains(){return false},scrollIntoView(){},getAttribute(){return null},srcdoc:'',onload:null};return e;}
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

test('(م٢-سلوك) النافذة تفتح وتغلق + شريط الإجراءات يتبع التحديد', async ()=>{
  const ctx=makeCtx(); const E=ctx.__els;
  vm.runInContext(`products=[{code:'P1',name:'خلاط',category:'خلاطات',brand:'',color:'',supplier_name:'',retail_price:100,purchase_price:60,reorder_point:2,active:true,created_at:'2026-01-01'}]; selectedProductCode=null;`,ctx);
  /* لا تحديد ⇒ الشريط مخفي */
  vm.runInContext('renderProducts()',ctx);
  assert.ok(E.productActionBar.classList.contains('hidden'),'لا تحديد ⇒ مخفي');
  /* تحديد ⇒ يظهر */
  vm.runInContext(`selectedProductCode='P1'; renderProducts()`,ctx);
  assert.ok(!E.productActionBar.classList.contains('hidden'),'تحديد ⇒ ظاهر');
  assert.ok(E.selectedProductInfo.textContent.includes('P1'),'اسم المنتج في الشريط');
  /* إلغاء التحديد ⇒ يختفي */
  vm.runInContext(`selectedProductCode=null; renderProducts()`,ctx);
  assert.ok(E.productActionBar.classList.contains('hidden'),'إلغاء ⇒ مخفي');
  /* النافذة */
  vm.runInContext('openProductModal()',ctx);
  assert.ok(E.productModal.classList.contains('show'),'النافذة مفتوحة');
  vm.runInContext('closeProductModal()',ctx);
  assert.ok(!E.productModal.classList.contains('show'),'النافذة مغلقة');
});

test('(م٣-سلوك) النقر على «تحت الطلب» يصفّي الجدول فوراً', async ()=>{
  const ctx=makeCtx(); const E=ctx.__els;
  vm.runInContext(`stock=[{location_id:'L1',product_code:'A1',product_name:'صنف',qty:0,updated_at:'2026-01-01'}]; locations=[{id:'L1',name:'فرع',location_type:'branch'}]; products=[{code:'A1',name:'صنف',category:'',reorder_point:5}];`,ctx);
  const sf=ctx.document.getElementById('stockStatusFilter'); sf.value='';
  vm.runInContext('filterStockLow()',ctx);
  assert.equal(sf.value,'low','الفلتر صار low');
});
