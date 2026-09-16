/* ═══════════════════════════════════════════════════════════════════
   اختبار زر «فواتير البيع» من شاشة البيع (المهمة ٢)
   الشرط الحاسم: ٣ أصناف ⇒ زر ⇒ عودة للبيع ⇒ الأصناف الثلاثة موجودة
   ═══════════════════════════════════════════════════════════════════ */
const test=require('node:test'), assert=require('node:assert');
const fs=require('fs'), vm=require('vm'), path=require('path');
const APP_JS=path.join(__dirname,'..','new discussion github','apps','pos','benamor-sales-system','app.js');

function el(){const cache={};const e={style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},addEventListener(){},removeEventListener(){},appendChild(c){return c},remove(){},querySelector(s){return cache[s]||(cache[s]=el())},querySelectorAll(){return[]},setAttribute(){},removeAttribute(){},focus(){},blur(){},click(){},reset(){},value:'',textContent:'',innerHTML:'',id:'',name:'',children:[],options:[],selectedOptions:[{textContent:'',value:''}],checked:false,disabled:false,placeholder:'',closest(){return el()},contains(){return false},insertAdjacentHTML(){},scrollIntoView(){},getAttribute(){return null},srcdoc:'',onload:null};return e;}
const storage={};
function makeCtx(){
  const els={}; const navClicks=[];
  /* أزرار تنقل حقيقية: addEventListener يُخزَّن وclick يُنفّذ — كالمتصفح */
  const navBtns=[];
  const mkNavBtn=(tab)=>{ const b=el(); b.dataset={tab}; b.style={display:''}; const handlers={};
    b.addEventListener=(t,f)=>{handlers[t]=f;};
    b.click=()=>{ navClicks.push(tab); if(handlers.click) handlers.click(); };
    return b; };
  ['dashboard','sales','salesList','products'].forEach(t=>navBtns.push(mkNavBtn(t)));
  const ctx={console,setTimeout:(f)=>{try{f()}catch(e){};return {unref(){}};},clearTimeout,setInterval:()=>({unref(){}}),clearInterval,Promise,JSON,Math,Date,Object,Array,Map,Set,Number,String,Error,TypeError,RegExp,
    document:{querySelector:sel=>{ const m=String(sel).match(/nav button\[data-tab="([^"]+)"\]/); if(m){ const b=navBtns.find(x=>x.dataset.tab===m[1]); if(b) return b; } return el(); },querySelectorAll:sel=>String(sel).includes('nav button')?navBtns:[],getElementById:id=>(els[id]||(els[id]=el())),createElement:()=>el(),body:el(),documentElement:el(),addEventListener(){},title:''},
    localStorage:{getItem:k=>storage[k]??null,setItem:(k,v)=>{storage[k]=String(v)},removeItem:k=>{delete storage[k]}},
    fetch:async()=>({ok:true,status:200,text:async()=>'[]',json:async()=>[]}),
    navigator:{onLine:true,serviceWorker:{register:async()=>({})}},
    alert(){},prompt(){return null},confirm(){return true},
    atob:s=>Buffer.from(s,'base64').toString('binary'),btoa:s=>Buffer.from(s,'binary').toString('base64'),
    URL:{createObjectURL:()=>'x',revokeObjectURL(){}},Blob:function(){},FileReader:function(){},FormData:function(){this.append=function(){}},
    Event:function(){},CustomEvent:function(){},history:{},location:{href:'x',reload(){},origin:'x'},requestAnimationFrame:f=>f(),
    performance:{now:()=>Date.now()},crypto:{randomUUID:()=>'u'},google:{accounts:{oauth2:{init(){}}}},open:()=>null,structuredClone:o=>JSON.parse(JSON.stringify(o))};
  ctx.window=ctx;ctx.self=ctx;ctx.globalThis=ctx;ctx.addEventListener=()=>{};ctx.removeEventListener=()=>{};ctx.dispatchEvent=()=>true;
  ctx.__els=els; ctx.__navClicks=navClicks;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(APP_JS,'utf8'),ctx,{filename:'app.js'});
  return ctx;
}
function seed(ctx){
  vm.runInContext(`
    locations=[{id:'L1',name:'فرع 11 يونيو',is_sales_location:true}];
    products=[{code:'P1',name:'خلاط',retail_price:150,purchase_price:100},{code:'P2',name:'حوض',retail_price:300,purchase_price:200},{code:'P3',name:'مرآة',retail_price:80,purchase_price:50}];
    customers=[];financeAccounts=[];sales=[];saleItems=[];salePayments=[];saleReturns=[];saleReturnItems=[];stock=[];purchases=[];purchaseItems=[];suppliers=[];transfers=[];compositeItems=[];customerLedger=[];financeMovements=[];stockMovements=[];
    currentRole={role:'admin'}; appUser={id:'u1',identifier:'admin',branch_id:'L1'}; authSession={access_token:'t',refresh_token:'r',expires_at:9999999999};
    editingSaleId=null; buildProductCostIndex(); buildProductSearchIndex();
  `,ctx);
}
const mkRow=(code,qty,price)=>({querySelector:sel=>({'.si-code':{value:code},'.si-name':{value:code},'.si-qty':{value:String(qty)},'.si-price':{value:String(price)},'.si-kind':{value:'sale'},'.si-discount':{value:'0'}})[sel]||{value:''},classList:{add(){},remove(){},toggle(){},contains(){return false}}});

test('٣ أصناف ⇒ زر فواتير البيع ⇒ عودة للبيع ⇒ الأصناف الثلاثة موجودة', async ()=>{
  const ctx=makeCtx(); seed(ctx);
  /* املأ فاتورة بثلاثة أصناف */
  ctx.document.getElementById('saleItemsBody').querySelectorAll=()=>[mkRow('P1',2,150),mkRow('P2',1,300),mkRow('P3',3,80)];
  ['saleCashAmount','saleBankAmount','saleCardAmount','saleDiscount','saleCustomer','saleNewCustomerName','saleNewCustomerPhone','saleNotes','saleDate','saleLocation','salePrintAfterSave'].forEach(id=>ctx.document.getElementById(id));
  Object.assign(ctx.__els,{saleCashAmount:{...ctx.__els['saleCashAmount'],value:'0'}});
  assert.equal(vm.runInContext(`getSaleItems().length`,ctx),3,'٣ أصناف قبل');
  delete storage[vm.runInContext(`parkedSalesKey()`,ctx)];

  /* اضغط الزر */
  vm.runInContext(`openSalesListFromSale()`,ctx);
  assert.deepEqual(ctx.__navClicks,['salesList'],'انتقل إلى فواتير البيع');
  /* في المتصفح: resetSaleForm يفرغ saleItemsBody.innerHTML فتختفي الصفوف — نحاكيه */
  ctx.document.getElementById('saleItemsBody').querySelectorAll=()=>[];
  assert.equal(vm.runInContext(`getSaleItems().length`,ctx),0,'الفاتورة أُفرغت (عُلّقت)');
  const parked=JSON.parse(storage[vm.runInContext(`parkedSalesKey()`,ctx)]||'[]');
  assert.equal(parked.length,1,'عُلّقت في آلية التعليق نفسها');
  assert.equal(parked[0].items.length,3,'الأصناف الثلاثة في المعلّقة');
  assert.equal(vm.runInContext(`__autoResumeParkedOnSaleTab`,ctx),true,'علم الاسترجاع التلقائي مضبوط');

  /* العودة إلى تبويب البيع (نقر زر البيع في القائمة الجانبية) ⇒ استرجاع تلقائي
     (نعدّ استدعاءات addSaleRow — الدالة الفعلية التي تعيد بناء صفوف الفاتورة) */
  vm.runInContext(`window.__rowsRestored=0; const __origAddSaleRow=addSaleRow; addSaleRow=(...a)=>{window.__rowsRestored++; return __origAddSaleRow(...a);};`,ctx);
  vm.runInContext(`q('saleItemsBody').innerHTML='';`,ctx); /* الإفراغ الذي يفعله المعالج */
  vm.runInContext(`document.querySelector('nav button[data-tab="sales"]').click()`,ctx);
  assert.equal(vm.runInContext(`window.__rowsRestored`,ctx),3,'⭐ الأصناف الثلاثة استُرجعت تلقائياً (٣ صفوف أُعيد بناؤها)');
  const parked2=JSON.parse(storage[vm.runInContext(`parkedSalesKey()`,ctx)]||'[]');
  assert.equal(parked2.length,0,'أُزيلت من المعلّقة');
  assert.equal(vm.runInContext(`__autoResumeParkedOnSaleTab`,ctx),false,'العلم أُطفئ');
});

test('فاتورة فارغة ⇒ الزر ينتقل مباشرة بلا تعليق', ()=>{
  const ctx=makeCtx(); seed(ctx);
  ctx.document.getElementById('saleItemsBody').querySelectorAll=()=>[];
  delete storage[vm.runInContext(`parkedSalesKey()`,ctx)];
  vm.runInContext(`openSalesListFromSale()`,ctx);
  assert.deepEqual(ctx.__navClicks,['salesList']);
  const parked=JSON.parse(storage[vm.runInContext(`parkedSalesKey()`,ctx)]||'[]');
  assert.equal(parked.length,0,'لا تعليق لفاتورة فارغة');
});

test('أثناء تعديل فاتورة محفوظة ⇒ ينتقل بلا تعليق (المسودة محفوظة أصلاً بآلية التعديل)', ()=>{
  const ctx=makeCtx(); seed(ctx);
  vm.runInContext(`editingSaleId='sale-x';`,ctx);
  ctx.document.getElementById('saleItemsBody').querySelectorAll=()=>[mkRow('P1',1,150)];
  delete storage[vm.runInContext(`parkedSalesKey()`,ctx)];
  vm.runInContext(`openSalesListFromSale()`,ctx);
  assert.deepEqual(ctx.__navClicks,['salesList']);
  const parked=JSON.parse(storage[vm.runInContext(`parkedSalesKey()`,ctx)]||'[]');
  assert.equal(parked.length,0,'لا تعليق أثناء التعديل (المسودة سارية)');
});
