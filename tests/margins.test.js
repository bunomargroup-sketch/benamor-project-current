/* ═══════════════════════════════════════════════════════════════════
   اختبارات الهوامش والتكلفة (المتوسط المرجّح المتحرك + هامش سطر البيع)
   تجيب عن: هل يسقط اختبار لو أُفسد حساب الهامش عمداً؟ ⇒ نعم
   (جرّب: APP_JS=/tmp/broken-margin.js node --test tests/margins.test.js)
   ═══════════════════════════════════════════════════════════════════ */
const test=require('node:test'), assert=require('node:assert');
const fs=require('fs'), vm=require('vm'), path=require('path');
const APP_JS=process.env.APP_JS||path.join(__dirname,'..','new discussion github','apps','pos','benamor-sales-system','app.js');

function el(){const cache={};const e={style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},addEventListener(){},removeEventListener(){},appendChild(c){return c},remove(){},querySelector(s){return cache[s]||(cache[s]=el())},querySelectorAll(){return[]},setAttribute(){},removeAttribute(){},focus(){},blur(){},click(){},reset(){},value:'',textContent:'',innerHTML:'',id:'',name:'',children:[],options:[],selectedOptions:[{textContent:'',value:''}],checked:false,disabled:false,placeholder:'',closest(){return el()},contains(){return false},insertAdjacentHTML(){},scrollIntoView(){},getAttribute(){return null}};return e;}
function makeCtx(){
  const els={};
  const ctx={console,setTimeout,clearTimeout,setInterval:(...a)=>{const id=setInterval(...a);id.unref&&id.unref();return id;},clearInterval,Promise,JSON,Math,Date,Object,Array,Map,Set,Number,String,Error,TypeError,RegExp,
    document:{querySelector:()=>el(),querySelectorAll:()=>[],getElementById:id=>(els[id]||(els[id]=el())),createElement:()=>el(),body:el(),documentElement:el(),addEventListener(){},title:''},
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},fetch:async()=>({ok:true,status:200,text:async()=>'[]',json:async()=>[]}),
    navigator:{onLine:true,serviceWorker:{register:async()=>({})}},
    alert(){},prompt(){return null},confirm(){return false},
    atob:s=>Buffer.from(s,'base64').toString('binary'),btoa:s=>Buffer.from(s,'binary').toString('base64'),
    URL:{createObjectURL:()=>'x',revokeObjectURL(){}},Blob:function(){},FileReader:function(){},FormData:function(){this.append=function(){}},
    Event:function(){},CustomEvent:function(){},history:{},location:{href:'x',reload(){},origin:'x'},requestAnimationFrame:f=>f(),
    performance:{now:()=>Date.now()},crypto:{randomUUID:()=>'u'},google:{accounts:{oauth2:{init(){}}}},open:()=>null,structuredClone:o=>JSON.parse(JSON.stringify(o))};
  ctx.window=ctx;ctx.self=ctx;ctx.globalThis=ctx;ctx.addEventListener=()=>{};ctx.removeEventListener=()=>{};ctx.dispatchEvent=()=>true;
  ctx.__els=els;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(APP_JS,'utf8'),ctx,{filename:'app.js'});
  return ctx;
}
const seed=ctx=>vm.runInContext(`
  products=[{code:'T1',name:'صنبور',retail_price:150,purchase_price:100},{code:'T2',name:'حوض',retail_price:300,purchase_price:0}];
  purchases=[];purchaseItems=[];sales=[];saleItems=[];compositeItems=[];stock=[];customers=[];financeAccounts=[];financeMovements=[];salePayments=[];customerLedger=[];stockMovements=[];suppliers=[];transfers=[];
  currentRole={role:'admin'}; appUser={id:'u1',identifier:'admin',branch_id:'L1'};
  buildProductCostIndex();
`,ctx);

/* ── ١) المتوسط المرجّح المتحرك: سيناريو كامل بشراءين وبيع ومرتجع ── */
test('التكلفة: متوسط مرجّح متحرك صحيح (شراءان + بيع + مرتجع)', ()=>{
  const ctx=makeCtx(); seed(ctx);
  vm.runInContext(`
    purchases=[{id:'p1',purchase_date:'2026-01-01'},{id:'p2',purchase_date:'2026-02-01'},{id:'p3',purchase_date:'2026-03-01'}];
    purchaseItems=[
      {purchase_id:'p1',product_code:'T1',qty:10,line_total:1000},   /* 10 @ 100 */
      {purchase_id:'p2',product_code:'T1',qty:10,line_total:2000},   /* 10 @ 200 ⇒ المتوسط 150 */
    ];
    sales=[{id:'s1',sale_date:'2026-02-15'},{id:'s2',sale_date:'2026-03-05'}];
    saleItems=[
      {sale_id:'s1',product_code:'T1',qty:6},   /* بيع 6 بالمتوسط 150 ⇒ يتبقى 14 وحدة */
      {sale_id:'s2',product_code:'T1',qty:-2},  /* مرتجع 2 بالمتوسط الجاري ⇒ يتبقى 16 */
    ];
    buildProductCostIndex();
  `,ctx);
  /* المتوسط المرجّح المتحرك: الشراءان (10@100 + 10@200) ⇒ 150.
     بيع 6 يخصم بمتوسط 150 (يُبقيه 150) ومرتجع 2 يرجع به ⇒ يبقى 150 */
  const cost=vm.runInContext(`productCost('T1')`,ctx);
  assert.ok(Math.abs(cost-150)<0.0001,'المتوسط المرجّح = 150 (فعلي: '+cost+')');
  /* سيناريو مغاير: شراء وحيد ثم بيع جزئي ثم شراء أغلى ⇒ المتوسط يتأثر بالشراء فقط */
  vm.runInContext(`sales=[{id:'s1',sale_date:'2026-04-01'}];
    purchases=[{id:'p1',purchase_date:'2026-01-01'},{id:'p2',purchase_date:'2026-05-01'}];
    purchaseItems=[{purchase_id:'p1',product_code:'T1',qty:10,line_total:1000},{purchase_id:'p2',product_code:'T1',qty:10,line_total:3000}];
    saleItems=[{sale_id:'s1',product_code:'T1',qty:4}];
    buildProductCostIndex();`,ctx);
  const cost2=vm.runInContext(`productCost('T1')`,ctx);
  assert.ok(Math.abs(cost2-225)<0.0001,'شراء 10@100، بيع 4، شراء 10@300 ⇒ (600+3000)/16 = 225 (فعلي: '+cost2+')');
  /* منتج بلا تاريخ شراء ⇒ يسقط لسعر الشراء من بطاقة المنتج */
  assert.equal(vm.runInContext(`productCost('T2')`,ctx),0,'بلا تكلفة ولا سعر شراء ⇒ 0');
  vm.runInContext(`products[1].purchase_price=120; buildProductCostIndex();`,ctx);
  assert.equal(vm.runInContext(`productCost('T2')`,ctx),120,'يسقط لبطاقة المنتج 120');
});

/* ── ٢) هامش سطر البيع: القيمة والنسبة كما تعرضهما الواجهة ── */
test('هامش السطر: (السعر−التكلفة)×الكمية والنسبة المئوية — كما في updateSaleTotal', ()=>{
  const ctx=makeCtx(); seed(ctx);
  vm.runInContext(`purchases=[{id:'p1',purchase_date:'2026-01-01'}];
    purchaseItems=[{purchase_id:'p1',product_code:'T1',qty:10,line_total:1000}]; /* تكلفة 100 */
    buildProductCostIndex();`,ctx);
  /* صف فاتورة: 3 × 150 (تكلفة 100) ⇒ هامش 150 ونسبة 50% */
  const cells={};
  const map={'.si-code':{value:'T1'},'.si-name':{value:'صنبور'},'.si-qty':{value:'3'},'.si-price':{value:'150'},'.si-kind':{value:'sale'},'.si-discount':{value:'0'}};
  const row={querySelector:sel=>{
    if(!map[sel]){ if(!cells[sel]) cells[sel]={innerHTML:'',textContent:''}; return cells[sel]; }
    return map[sel];
  },classList:{add(){},remove(){},toggle(){},contains(){return false}}};
  ctx.document.getElementById('saleItemsBody').querySelectorAll=()=>[row];
  vm.runInContext(`q('saleCashAmount').value='450'; q('saleBankAmount').value='0'; q('saleCardAmount').value='0'; q('saleDiscount').value='0'; updateSaleTotal();`,ctx);
  assert.ok(cells['.si-margin'].innerHTML.includes('150.00'),'قيمة الهامش 150 (فعلي: '+cells['.si-margin'].innerHTML+')');
  assert.ok(cells['.si-margin-pct'].innerHTML.includes('50'),'النسبة 50% (فعلي: '+cells['.si-margin-pct'].innerHTML+')');
  assert.ok(cells['.si-margin'].innerHTML.includes('stock-positive'),'لون موجب');
  /* هامش سالب: بيع تحت التكلفة 3 × 80 (تكلفة 100) ⇒ −60 ونسبة −25% */
  row.querySelector('.si-price').value='80';
  vm.runInContext(`q('saleCashAmount').value='240'; updateSaleTotal();`,ctx);
  assert.ok(cells['.si-margin'].innerHTML.includes('-60.00'),'هامش سالب −60');
  assert.ok(cells['.si-margin'].innerHTML.includes('stock-negative'),'لون سالب');
  assert.ok(cells['.si-margin-pct'].innerHTML.includes('-20'),'النسبة −20% (هامش على التكلفة) — فعلي: '+cells['.si-margin-pct'].innerHTML);
});

/* ── ٣) هامش المنتج المركّب: تكلفة مكوّناته ── */
test('المركّب: تكلفته من مكوّناته (وليس من سعر شرائه)', ()=>{
  const ctx=makeCtx(); seed(ctx);
  vm.runInContext(`
    purchases=[{id:'p1',purchase_date:'2026-01-01'}];
    purchaseItems=[{purchase_id:'p1',product_code:'P1',qty:10,line_total:1000},{purchase_id:'p1',product_code:'P2',qty:10,line_total:3000}];
    compositeItems=[{composite_code:'KIT',component_code:'P1',qty:1},{composite_code:'KIT',component_code:'P2',qty:2}];
    products.push({code:'KIT',name:'طقم',retail_price:800,purchase_price:0});
    buildProductCostIndex();`,ctx);
  /* تكلفة KIT = 100 + 2×300 = 700 — بيع KIT يخصم مكوّناته */
  vm.runInContext(`sales=[{id:'s1',sale_date:'2026-02-01'}]; saleItems=[{sale_id:'s1',product_code:'KIT',qty:1}]; buildProductCostIndex();`,ctx);
  assert.equal(vm.runInContext(`productCost('P1')`,ctx),100,'خصم مكوّن واحد');
  assert.equal(vm.runInContext(`productCost('P2')`,ctx),300,'خصم 2×P2: (10×300−600)/8=300');
});
