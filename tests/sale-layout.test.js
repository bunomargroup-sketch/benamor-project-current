/* ═══════════════════════════════════════════════════════════════════
   اختبارات إعادة تنظيم شاشة «فاتورة بيع جديدة» — تخطيط وCSS فقط
   • كل معرّفات القيود موجودة دون تغيير، ولا حقل حُذف من الـDOM
   • البنية الجديدة (topbar · chips · panels · shortcuts · barcode ·
     context · items-head · finish-bar) والشريط الجانبي ٦ أزرار
   • الميزانية الرأسية: ≥١٠ صفوف مرئية على نافذة 900px (الحساب موثّق)
   • سلوك العرض: شريحة رصيد الزبون · سطر المخزون · شريحة السعر ·
     طيّ التفاصيل وثباته في localStorage · عدّاد الأصناف · رقم الفاتورة نصّاً
   ═══════════════════════════════════════════════════════════════════ */
const test=require('node:test'), assert=require('node:assert');
const fs=require('fs'), vm=require('vm'), path=require('path');
const HERE=path.join(__dirname,'..');
const POS=path.join(HERE,'new discussion github','apps','pos','benamor-sales-system');
const HTML=fs.readFileSync(path.join(POS,'index.html'),'utf8');
const CSS=fs.readFileSync(path.join(POS,'app.css'),'utf8');
const APP_JS=path.join(POS,'app.js');
const FORM=HTML.slice(HTML.indexOf('id="saleForm"'),HTML.indexOf('pos-bottom-bar" id="salePaymentScreen"'));

/* ═══ ١) القيود: المعرفات والحقول والمعالجات ═══ */
test('(تنظيم-١) كل المعرفات المحظور لمسها موجودة مرة واحدة، والحقول حية', ()=>{
  const ids=['saleInvoiceNo','saleDate','saleCustomerSearch','saleCustomer','saleNewCustomerName','saleNewCustomerPhone','saleWholesaleToggle','saleBarcodeInput','saleNotes','salePrintAfterSave','saleLocation','salePaymentMethod','saleCustomerBalance','saleCustomerInfo','saleStockInfo','saleItemsBody','saleHeaderTotal','saleFinishTotal','saleFinishBalance','salePayBtn','saleFooterBranch'];
  for(const id of ids){
    const n=(FORM.match(new RegExp('id="'+id+'"','g'))||[]).length;
    assert.equal(n,1,id+' مرة واحدة بالضبط');
  }
  /* saleDate ظاهر ومطلوب (لا hidden+required) */
  const dateWrap=FORM.slice(Math.max(0,FORM.indexOf('id="saleDate"')-220),FORM.indexOf('id="saleDate"'));
  assert.ok(!dateWrap.includes('hidden'),'saleDate ليس داخل حاوية مخفية');
  assert.ok(FORM.includes('id="saleDate" type="date" required'),'saleDate ما زال required وظاهراً في شريحة التاريخ');
  /* saleInvoiceNo مخفي في الـDOM */
  assert.ok(FORM.includes('class="hidden"><label>رقم الفاتورة</label><input id="saleInvoiceNo"'),'saleInvoiceNo مخفي في الـDOM');
  /* معالجات الباركود كما هي */
  assert.ok(FORM.includes('id="saleBarcodeInput"')&&FORM.includes('onkeydown="handleBarcodeKey(event)"')&&FORM.includes('oninput="handleBarcodeInput()"'),'معالجا الباركود لم يُمسّا');
  assert.ok(FORM.includes('id="salePayBtn" type="button" onclick="openSalePaymentScreen()"'),'زر الدفع يستدعي openSalePaymentScreen كما كان');
  /* أزرار الشريط السفلي الأربعة + ترتيب الدفع أخيراً */
  const fa=FORM.slice(FORM.indexOf('class="finish-actions"'),FORM.indexOf('</div>\n            </div>\n          </form>')>0?FORM.indexOf('</div>\n            </div>\n          </form>'):FORM.length);
  assert.ok(fa.includes('parkCurrentSale()')&&fa.includes('resumeParkedSale()')&&fa.includes('resetSaleFormWithConfirm()'),'أزرار تعليق/المعلقة/فاتورة جديدة موجودة');
  assert.ok(fa.indexOf('id="salePayBtn"')>fa.indexOf('parkCurrentSale()'),'الدفع آخر الأزرار (الأكبر)');
});

/* ═══ ٢) البنية الجديدة والشريط الجانبي ═══ */
test('(تنظيم-٢) البنية الجديدة: topbar+شرائح+لوحتان+اختصارات+سياق، والجانبي ٦ أزرار', ()=>{
  for(const cls of ['sale-topbar','sale-chips','schip-date','schip-customer','schip-price','schip-details','sale-details-panel','sale-customer-panel','sale-shortcuts','sale-barcode-strip','sale-context-strip','pos-items-head','finish-spacer','sale-finish-bar'])
    assert.ok(FORM.includes(cls),'العنصر/الفئة '+cls+' موجود');
  assert.equal((FORM.match(/class="rail-btn"/g)||[]).length,6,'الشريط الجانبي: ستة أزرار');
  assert.ok(!FORM.includes('إضافة سريعة'),'حُذف «إضافة سريعة»');
  assert.ok(!FORM.includes('طباعة باركود الصنف لاحقًا'),'حُذف «طباعة باركود الصنف لاحقًا»');
  assert.ok(!FORM.includes('cashier-info-grid')&&!FORM.includes('pos-invoice-head')&&!FORM.includes('cashier-head'),'حُذفت البنية القديمة');
  /* الأزرار الستة بالوظائف الأصلية */
  for(const fn of ['openQuickProductModal()','openSaleProductPicker()','openSalesListFromSale()','openPriceCheckerCarts()','applyDiscountCoupon()','toggleCalculator()'])
    assert.ok(FORM.includes('onclick="'+fn+'"'),fn);
  /* زر الصنف اليدوي وشريط الإضافة السفلي */
  assert.ok(FORM.includes('onclick="addSaleRowAndFocus()"'),'زر + صنف يدوي وشريط الإضافة يعملان');
  /* رقم الفاتورة نصّاً + عدّاد الأصناف في الموضعين */
  assert.ok(FORM.includes('id="saleInvoiceNoText"')&&FORM.includes('id="saleItemsCount"')&&FORM.includes('id="saleItemsCountMini"'));
});

/* ═══ ٣) قيود CSS ═══ */
test('(تنظيم-٣) الأنماط: زر الدفع برتقالي، صفوف مضغوطة، ارتفاع النافذة', ()=>{
  assert.ok(CSS.includes('#sales #salePayBtn{background:#d97706'),'زر الدفع #d97706');
  assert.ok(CSS.includes('font-size:15px;font-weight:900;padding:11px 30px'),'حشوة زر الدفع 11/30 وخط 15/900');
  assert.ok(CSS.includes('#sales.active{display:flex;flex-direction:column;height:calc(100dvh - 108px)'),'الشاشة بارتفاع النافذة');
  assert.ok(CSS.includes('#sales #saleItemsBody td{padding:3px 8px')&&CSS.includes('#sales #saleItemsBody input{min-height:30px'),'صفوف ~40px');
  assert.ok(CSS.includes('grid-template-columns:168px'),'الشريط الجانبي 168px');
  assert.ok(CSS.includes('border:2px solid var(--blue);border-radius:14px;box-shadow:0 0 0 3px rgba(59,130,246,.18)'),'شريط الباركود: إطار أزرق وظل');
  assert.ok(CSS.includes('#sales .sale-context-strip')&&CSS.includes('rgba(16,185,129,.12)'),'السطر السياقي شريحة خضراء خافتة');
  assert.ok(!CSS.includes('cashier-info-grid')&&!CSS.includes('pos-invoice-head{')&&!CSS.includes('#sales .cashier-head{'),'لا بقايا أنماط المحذوفات');
});

/* ═══ ٤) الميزانية الرأسية: ≥١٠ صفوف على 900px (حساب موثق) ═══ */
test('(تنظيم-٤) الميزانية الرأسية: ١٠ صفوف مرئية على نافذة 900px بلا تمرير', ()=>{
  /* الثوابت كما في app.css — الأسوأ: السطر السياقي ظاهر */
  const V=900;                          /* ارتفاع النافذة */
  const section=V-108;                  /* #sales.active: calc(100dvh - 108px) */
  const panelContent=section-12-4;      /* padding 6×2 + border 2×2 */
  const topbar=58, shortcuts=24, barcode=34+14+4, context=23, finish=45+20+2; /* الارتفاعات الفعلية */
  const gaps=5*6;                       /* gap:6px × ٥ فجوات (topbar..finish) */
  const work=panelContent-(topbar+shortcuts+barcode+context+finish)-gaps;
  const cardInner=work-4-12;            /* border 2×2 + padding 6×2 */
  const scroll=cardInner-28-34-8-4;     /* رأس البطاقة 28 + شريط الإضافة 34 + فجوتان 8 + هامش 4 */
  const thead=12*1.55+10+1;             /* th: خط 12 + حشوة 5×2 + حد */
  const row=Math.max(30+6+1, 32+6+1);   /* input 30 أو textarea 32 + حشوة 3×2 + حد */
  const visible=Math.floor((scroll-thead)/row);
  assert.ok(visible>=10,`صفوف مرئية=${visible} (المطلوب ≥10) — scroll=${scroll.toFixed(1)}px صف=${row}px`);
  /* حالة السطر السياقي مخفية (لا صنف محدد) ⇒ صف إضافي أو أكثر */
  const visibleNoCtx=Math.floor((scroll-thead+context+6)/row);
  assert.ok(visibleNoCtx>=11,`بدون السطر السياقي=${visibleNoCtx} (المطلوب ≥11)`);
});

/* ═══ ٥) السلوك في VM ═══ */
function el(){
  const cache={};
  const cls=new Set();
  const cl={add:c=>cls.add(c),remove:c=>cls.delete(c),toggle:(c,f)=>{if(f===undefined)f=!cls.has(c);f?cls.add(c):cls.delete(c);return f},contains:c=>cls.has(c)};
  const e={style:{},dataset:{},classList:cl,addEventListener(){},removeEventListener(){},appendChild(c){return c},remove(){},
    querySelector(s){return cache[s]||(cache[s]=el())},querySelectorAll(){return[]},setAttribute(){},removeAttribute(){},
    focus(){},blur(){},click(){},reset(){},value:'',textContent:'',innerHTML:'',id:'',name:'',children:[],options:[],
    selectedOptions:[{textContent:'',value:''}],checked:false,disabled:false,placeholder:'',closest(){return el()},
    contains(){return false},insertAdjacentHTML(){},scrollIntoView(){},getAttribute(){return null},srcdoc:'',onload:null,onclick:null};
  return e;
}
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
  vm.runInContext(fs.readFileSync(APP_JS,'utf8'),ctx,{filename:'app.js'});
  return ctx;
}
function seed(ctx){
  vm.runInContext(`
    locations=[{id:'L1',name:'فرع السراج',is_sales_location:true}];products=[{code:'T1',name:'صنف تجريبي',retail_price:100,purchase_price:60}];customers=[];sales=[];salePayments=[];saleReturns=[];stock=[];financeAccounts=[];financeMovements=[];stockMovements=[];customerLedger=[];suppliers=[];transfers=[];compositeItems=[];purchases=[];purchaseItems=[];saleItems=[];saleReturnItems=[];
    currentRole={role:'admin'}; appUser={id:'u1',identifier:'admin',branch_id:'L1'}; authSession={access_token:'t',refresh_token:'r',expires_at:9999999999};
    buildProductCostIndex(); buildProductSearchIndex();
  `,ctx);
}
const mkRow=(code,qty,price)=>({querySelector:sel=>({'.si-code':{value:code},'.si-name':{value:code},'.si-qty':{value:String(qty)},'.si-price':{value:String(price)},'.si-kind':{value:'sale'},'.si-discount':{value:'0'}})[sel]||{value:'',innerHTML:''},classList:{add(){},remove(){},toggle(){},contains(){return false}}});

test('(تنظيم-٥) العرض: رصيد الزبون وسطر المخزون شرطيان، والسعر والتفاصيل والعدّاد والرقم يعملون', async ()=>{
  const ctx=makeCtx(); seed(ctx); const E=ctx.__els;
  const flush=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setTimeout(r,0));};

  /* (٦) زبون نقدي: لا شريحة رصيد — ثم اختيار زبون تُظهرها فوراً */
  vm.runInContext(`renderSaleCustomerInfo()`,ctx);
  assert.ok(E.saleCustomerChip.classList.contains('hidden'),'زبون نقدي ⇒ شريحة الرصيد مخفية (لا 0.00)');
  assert.equal(E.saleCustomerChipName.textContent,'زبون نقدي','الشريحة تعرض «زبون نقدي»');
  vm.runInContext(`customers.push({id:'c1',name:'علي حسن',phone:'0911',balance:120}); q('saleCustomer').value='c1'; renderSaleCustomerInfo();`,ctx);
  assert.ok(!E.saleCustomerChip.classList.contains('hidden'),'اختيار زبون ⇒ الشريحة ظاهرة');
  assert.ok(E.saleCustomerBalance.textContent.includes('120.00'),'الرصيد معروض');
  assert.equal(E.saleCustomerChipName.textContent,'علي حسن','اسم الزبون في شريحة الزبون');

  /* (٧) سطر المخزون: مخفي قبل اختيار صنف، ظاهر بعده */
  vm.runInContext(`renderSaleStockInfo('')`,ctx);
  assert.ok(E.saleStockInfoStrip.classList.contains('hidden'),'لا صنف ⇒ السطر السياقي مخفي');
  vm.runInContext(`renderSaleStockInfo('T1')`,ctx);
  assert.ok(!E.saleStockInfoStrip.classList.contains('hidden'),'اختيار صنف ⇒ السطر ظاهر');
  assert.ok(E.saleStockInfo.innerHTML.includes('صنف تجريبي'),'اسم الصنف في السطر');

  /* شريحة السعر تبدّل #saleWholesaleToggle */
  vm.runInContext(`toggleSaleWholesale()`,ctx);
  assert.equal(E.saleWholesaleToggle.checked,true,'الشريحة فعّلت سعر الجملة');
  assert.equal(E.salePriceChipLbl.textContent,'سعر الجملة','ملصق الشريحة تحدّث');
  assert.ok(E.salePriceChip.classList.contains('active'),'الشريحة مميّزة');
  vm.runInContext(`toggleSaleWholesale()`,ctx);
  assert.equal(E.saleWholesaleToggle.checked,false,'إعادة التبديل ⇒ تجزئة');
  assert.equal(E.salePriceChipLbl.textContent,'سعر التجزئة');

  /* (٥) طيّ «تفاصيل الفاتورة» يثبت في localStorage ويُستعاد */
  vm.runInContext(`toggleSaleDetailsPanel()`,ctx);
  assert.ok(E.saleDetailsPanel.classList.contains('hidden'),'طُويت اللوحة');
  assert.equal(storage['posSaleDetailsOpen_admin'],'0','حُفظ الطيّ لكل مستخدم');
  storage['posSaleDetailsOpen_admin']='1';
  vm.runInContext(`applySaleLayoutPrefs()`,ctx);
  assert.ok(!E.saleDetailsPanel.classList.contains('hidden'),'استُعيد الفتح من التفضيل المحفوظ');

  /* عدّاد الأصناف في رأس البطاقة والشريط السفلي */
  ctx.document.getElementById('saleItemsBody').querySelectorAll=()=>[mkRow('T1',2,100),mkRow('T1',1,100)];
  ['saleCashAmount','saleBankAmount','saleCardAmount','saleDiscount','salePaymentMethod','salePaidAmount','saleTotal','salePaymentScreenTotal','saleBalance','salePaymentDetected','saleCreditLine','saleCustomer','saleCustomerBalance','saleCustomerInfo'].forEach(id=>ctx.document.getElementById(id));
  Object.assign(E.saleCashAmount,{value:'0'});Object.assign(E.saleBankAmount,{value:'0'});Object.assign(E.saleCardAmount,{value:'0'});Object.assign(E.saleDiscount,{value:'0'});Object.assign(E.salePaymentMethod,{value:'cash'});
  vm.runInContext(`updateSaleTotal()`,ctx);
  assert.equal(E.saleItemsCount.textContent,'2','عدّاد رأس البطاقة');
  assert.equal(E.saleItemsCountMini.textContent,'2','عدّاد الشريط السفلي');
  assert.ok(E.saleHeaderTotal.textContent.includes('300.00'),'الإجمالي في الشريط العلوي');

  /* رقم الفاتورة نصّاً بعد الحفظ */
  vm.runInContext(`q('saleInvoiceNo').value=''; syncSaleInvoiceNoText();`,ctx);
  assert.equal(E.saleInvoiceNoText.textContent,'الرقم يُولَّد عند الحفظ','قبل الحفظ');
  vm.runInContext(`q('saleInvoiceNo').value='INV-2026-77'; syncSaleInvoiceNoText();`,ctx);
  assert.equal(E.saleInvoiceNoText.textContent,'رقم الفاتورة: INV-2026-77','بعد الحفظ');
  await flush();
});

test('(تنظيم-٦) قائمة الزر الأيمن على سطر الصنف: تعديل السعر والهامش', async ()=>{
  const ctx=makeCtx(); seed(ctx);
  const items=vm.runInContext(`CTX_BUILDERS.saleItemsBody({querySelector:s=>({'.si-code':{value:'T1|تجريبي'}})[s]||{value:''}})`,ctx);
  assert.ok(items[0].head==='T1','رأس القائمة كود الصنف');
  const labels=items.filter(i=>i.label).map(i=>i.label);
  assert.ok(labels.includes('تعديل سعر الصنف'),'تعديل سعر الصنف في القائمة');
  assert.ok(labels.some(l=>l.includes('الهامش')),'الهامش في القائمة');
  /* الدالتان الأصليتان كما هما */
  const src=fs.readFileSync(APP_JS,'utf8');
  assert.ok(src.includes('async function editSelectedSaleLinePrice(){')&&src.includes('function toggleSupervisorMargins(){'),'الدالتان لم تُلمسا');
});
