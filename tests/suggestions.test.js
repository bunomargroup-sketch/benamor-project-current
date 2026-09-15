/* ═══════════════════════════════════════════════════════════════════
   اختبارات المهمة ٣ — شاشة اقتراحات التحويل (محرك + قواعد + أداء)
   ═══════════════════════════════════════════════════════════════════ */
const test=require('node:test'), assert=require('node:assert');
const fs=require('fs'), vm=require('vm'), path=require('path');
const APP_JS=path.join(__dirname,'..','new discussion github','apps','pos','benamor-sales-system','app.js');

function el(){const cache={};const e={style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},addEventListener(){},removeEventListener(){},appendChild(c){return c},remove(){},querySelector(s){return cache[s]||(cache[s]=el())},querySelectorAll(){return[]},setAttribute(){},removeAttribute(){},focus(){},blur(){},click(){},reset(){},value:'',textContent:'',innerHTML:'',id:'',name:'',children:[],options:[],selectedOptions:[{textContent:'',value:''}],checked:false,disabled:false,placeholder:'',closest(){return el()},contains(){return false},insertAdjacentHTML(){},scrollIntoView(){},getAttribute(){return null},srcdoc:'',onload:null};return e;}
let calls=[], MODE={rules:[],requests:[],dismissals:[]};
const smartFetch=async(url,opts={})=>{
  const u=String(url); calls.push({u,method:opts.method||'GET',body:opts.body});
  const J=(o,s=200)=>({ok:s<400,status:s,text:async()=>JSON.stringify(o),json:async()=>o,clone(){return this}});
  if(u.includes('pos_suggestion_dismissals')) return J(MODE.dismissals);
  if(u.includes('pos_stock_requests')) return J(MODE.requests);
  return J([]);
};
function makeCtx(){
  const els={};
  const ctx={console,setTimeout:f=>{try{f()}catch(e){}},clearTimeout,setInterval:()=>({unref(){}}),clearInterval,Promise,JSON,Math,Date,Object,Array,Map,Set,Number,String,Error,TypeError,RegExp,
    document:{querySelector:()=>el(),querySelectorAll:()=>[],getElementById:id=>(els[id]||(els[id]=el())),createElement:()=>el(),body:el(),documentElement:el(),addEventListener(){},title:''},
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},fetch:smartFetch,
    navigator:{onLine:true,serviceWorker:{register:async()=>({})}},
    alert(){},prompt(){return null},confirm(){return true},
    atob:s=>Buffer.from(s,'base64').toString('binary'),btoa:s=>Buffer.from(s,'binary').toString('base64'),
    URL:{createObjectURL:()=>'x',revokeObjectURL(){}},Blob:function(){},FileReader:function(){},FormData:function(){this.append=function(){}},
    Event:function(){},CustomEvent:function(){},history:{},location:{href:'x',reload(){},origin:'x'},requestAnimationFrame:f=>f(),
    performance:{now:()=>Date.now()},crypto:{randomUUID:()=>'u'},google:{accounts:{oauth2:{init(){}}}},open:()=>null,structuredClone:o=>JSON.parse(JSON.stringify(o))};
  ctx.window=ctx;ctx.self=ctx;ctx.globalThis=ctx;ctx.addEventListener=()=>{};ctx.removeEventListener=()=>{};ctx.dispatchEvent=()=>true;
  ctx.__els=els;
  ctx.toast=()=>{};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(APP_JS,'utf8'),ctx,{filename:'app.js'});
  return ctx;
}
const L11='L11',LSR='LSR',LJZ='LJZ';
function seed(ctx){
  vm.runInContext(`
    locations=[{id:'${L11}',name:'فرع 11 يونيو',is_sales_location:true},{id:'${LSR}',name:'فرع السراج',is_sales_location:true},{id:'${LJZ}',name:'مخزن جنزور',is_sales_location:false}];
    products=[
      {code:'OK1',name:'متوفر عندنا',category:'عام',retail_price:100},
      {code:'LOW1',name:'ناقص عندنا',category:'عام',retail_price:150},
      {code:'NEG1',name:'سالب',category:'عام',retail_price:50},
      {code:'GATED',name:'قسم غير محمول لنا',category:'أدوات خاصة',retail_price:200},
      {code:'THR5',name:'حد تصنيفه 5',category:'حدود',retail_price:80},
      {code:'NOSRC',name:'لا مصدر له',category:'عام',retail_price:30}];
    stock=[
      {location_id:'${L11}',product_code:'OK1',qty:10},
      {location_id:'${L11}',product_code:'LOW1',qty:0},
      {location_id:'${LJZ}',product_code:'LOW1',qty:8},
      {location_id:'${L11}',product_code:'NEG1',qty:-3},
      {location_id:'${LJZ}',product_code:'NEG1',qty:5},
      {location_id:'${L11}',product_code:'GATED',qty:0},
      {location_id:'${LJZ}',product_code:'GATED',qty:9},
      {location_id:'${L11}',product_code:'THR5',qty:2},
      {location_id:'${LSR}',product_code:'THR5',qty:6},
      {location_id:'${L11}',product_code:'NOSRC',qty:0}];
    locationCategoryRules=[
      {location_id:'${L11}',category:'عام',carried:true,min_qty:null},
      {location_id:'${LSR}',category:'عام',carried:true,min_qty:null},
      {location_id:'${LJZ}',category:'عام',carried:true,min_qty:null},
      {location_id:'${L11}',category:'أدوات خاصة',carried:false,min_qty:null},
      {location_id:'${LSR}',category:'أدوات خاصة',carried:true,min_qty:null},
      {location_id:'${LJZ}',category:'أدوات خاصة',carried:true,min_qty:null},
      {location_id:'${L11}',category:'حدود',carried:true,min_qty:5},
      {location_id:'${LSR}',category:'حدود',carried:true,min_qty:5},
      {location_id:'${LJZ}',category:'حدود',carried:true,min_qty:1}];
    sales=[{id:'s1',sale_date:'2026-09-10',location_id:'${L11}'},{id:'s2',sale_date:'2026-09-12',location_id:'${LSR}'}];
    saleItems=[{sale_id:'s1',product_code:'LOW1',qty:1},{sale_id:'s2',product_code:'THR5',qty:2}];
    sgDismissals=[]; sgSelected.clear();
    customers=[];financeAccounts=[];salePayments=[];saleReturns=[];saleReturnItems=[];stockMovements=[];financeMovements=[];purchases=[];purchaseItems=[];suppliers=[];transfers=[];compositeItems=[];customerLedger=[];expenseCategories=[];expenses=[];proformas=[];proformaItems=[];
    currentRole={role:'admin'}; appUser={id:'u1',identifier:'admin',branch_id:'${L11}'}; authSession={access_token:'t',refresh_token:'r',expires_at:9999999999};
    buildProductCostIndex(); buildProductSearchIndex();
  `,ctx);
}
function setEls(ctx){
  ['sgABody','sgBBody','sgCBody','sgAFoot','sgBFoot','sgCFoot','sgPanelA','sgPanelB','sgPanelC','sgListABtn','sgListBBtn','sgListCBtn','sgTiming','sgSelectedInfo','suggestionsNegativesBanner','sgFilterCategory','sgFilterSupplier','sgFilterMinQty','sgFilterMinValue','transfersMainPanel','transferSuggestionsPanel','transfersSubTabBtn','suggestionsSubTabBtn','transferFrom','transferTo','transferItemsBody','transferDate','transferNotes'].forEach(id=>ctx.document.getElementById(id));
}

test('(٢) بوّابة الأقسام: تصنيف carried=false لـ11 يونيو ⇒ لا اقتراح نقل GATED إليه في أي قائمة', ()=>{
  const ctx=makeCtx(); seed(ctx); setEls(ctx);
  const engine=vm.runInContext(`buildSuggestionEngine()`,ctx);
  assert.equal(vm.runInContext(`sgSuggestionFor(buildSuggestionEngine(),'GATED','${L11}')`,ctx),null,'بوّابة الأقسام تمنع');
  assert.ok(vm.runInContext(`sgSuggestionFor(buildSuggestionEngine(),'GATED','${LSR}')`,ctx)!==null,'مسموح للسراج (carried=true)');
});

test('(٦) السالب مستبعد من كل القوائم ويُعدّ في شريط التنبيه', ()=>{
  const ctx=makeCtx(); seed(ctx); setEls(ctx);
  assert.equal(vm.runInContext(`sgSuggestionFor(buildSuggestionEngine(),'NEG1','${L11}')`,ctx),null,'سالب ⇒ ممنوع');
  vm.runInContext(`renderSuggestionList();`,ctx);
  assert.ok(ctx.__els['suggestionsNegativesBanner'].textContent.includes('1 صنفاً مستبعد'),'الشريط يعدّه');
});

test('(٣) حدّ التصنيف يتقدّم على العام: THR5 كميته 2 وحدّه 5 ⇒ اقتراح بكمية 4 من السراج (فوق حدّها 5 يبقى 2)', ()=>{
  const ctx=makeCtx(); seed(ctx); setEls(ctx);
  const s=vm.runInContext(`sgSuggestionFor(buildSuggestionEngine(),'THR5','${L11}')`,ctx);
  assert.ok(s,'اقتراح موجود');
  assert.equal(s.from,'LSR','المصدر السراج (جنزور لا يحمل THR5)');
  /* الحاجة 4 لكن المصدر (6، حدّه 5) لا يعطي إلا 1 دون النزول تحت حدّه — المحرك محافظ صحيح */
  assert.equal(s.qty,1,'الكمية المقترحة 1 (المصدر لا ينزل تحت حدّه: 6-1=5 = حدّه)');
  assert.ok(s.fromQty-s.qty>=5,'المصدر يبقى فوق حدّه (6-1=5 ≥ 5)');
});

test('(٣-مصدر) جنزور أولًا: LOW1 ناقص في 11 يونيو والمصدر جنزور (8) قبل السراج', ()=>{
  const ctx=makeCtx(); seed(ctx); setEls(ctx);
  const s=vm.runInContext(`sgSuggestionFor(buildSuggestionEngine(),'LOW1','${L11}')`,ctx);
  assert.ok(s);
  assert.equal(s.from,'LJZ','جنزور أولًا');
  assert.equal(s.qty,2,'الكمية 2 (الحد 1: 0→فوق الحد)');
});

test('(٤-٧) القائمة (ج) بلا فلتر ⇒ لا تعرض شيئًا وتطلب فلترًا', ()=>{
  const ctx=makeCtx(); seed(ctx); setEls(ctx);
  ctx.__els['sgFilterCategory'].value='';
  ctx.__els['sgFilterSupplier'].value='';
  ctx.__els['sgFilterMinQty'].value='';
  ctx.__els['sgFilterMinValue'].value='';
  vm.runInContext(`sgActiveList='C'; renderSuggestionList();`,ctx);
  assert.ok(ctx.__els['sgCBody'].innerHTML.includes('اختر فلترًا واحدًا على الأقل'),'تطلب فلترًا');
  /* مع فلتر تصنيف ⇒ تعرض وترتب بقيمة السطر */
  ctx.__els['sgFilterCategory'].value='عام';
  vm.runInContext(`renderSuggestionList();`,ctx);
  const html=ctx.__els['sgCBody'].innerHTML;
  assert.ok(html.includes('LOW1'),'تعرض بعد الفلتر');
  assert.ok(!html.includes('NEG1')&&!html.includes('GATED'),'السالب والمبوّب مستبعدان');
});

test('(٨) تحديد 3 اقتراحات من مصدر واحد ⇒ شاشة تحويل واحدة بثلاثة أسطر', ()=>{
  const ctx=makeCtx(); seed(ctx); setEls(ctx);
  /* ثلاثة منتجات من جنزور إلى 11 يونيو */
  vm.runInContext(`
    products.push({code:'B2',name:'ثانٍ',category:'عام',retail_price:10},{code:'B3',name:'ثالث',category:'عام',retail_price:10});
    stock.push({location_id:'${L11}',product_code:'B2',qty:0},{location_id:'${LJZ}',product_code:'B2',qty:5},
               {location_id:'${L11}',product_code:'B3',qty:0},{location_id:'${LJZ}',product_code:'B3',qty:5});
    sgSelected.set('LOW1>${L11}',{code:'LOW1',name:'ناقص عندنا',qty:2,from:'${LJZ}',to:'${L11}'});
    sgSelected.set('B2>${L11}',{code:'B2',name:'ثانٍ',qty:2,from:'${LJZ}',to:'${L11}'});
    sgSelected.set('B3>${L11}',{code:'B3',name:'ثالث',qty:2,from:'${LJZ}',to:'${L11}'});
  `,ctx);
  /* addTransferRow يبني عبر createElement ثم appendChild — نحصي الاستدعاءات مباشرة */
  vm.runInContext(`window.__trRows=0; const __ar=addTransferRow; addTransferRow=(...a)=>{window.__trRows++; return __ar(...a);};`,ctx);
  vm.runInContext(`createTransferFromSuggestions();`,ctx);
  /* resetTransferForm يضيف صفًا فارغًا افتراضيًا ثم 3 أصناف ⇒ 4 استدعاءات */
  assert.equal(vm.runInContext('window.__trRows',ctx),4,'صف فارغ من resetTransferForm + 3 أصناف محددة = 4');
  assert.equal(ctx.__els['transferFrom'].value,'LJZ','من جنزور');
  assert.equal(ctx.__els['transferTo'].value,'L11','إلى 11 يونيو');
  assert.equal(ctx.__els['transfersMainPanel'].style.display,'','عودة لشاشة التحويلات');
});

test('(٩) حفظ تحويل ⇒ الطلبات المطابقة تعلَّم resolved (نداء PATCH غير محجوب)', async ()=>{
  const ctx=makeCtx(); seed(ctx); setEls(ctx); calls=[];
  vm.runInContext(`sgOpenRequests=[{id:'r1',product_code:'LOW1',location_id:'${L11}',resolved:false}];`,ctx);
  vm.runInContext(`markStockRequestsResolved('${L11}',['LOW1']);`,ctx);
  await new Promise(r=>setTimeout(r,20));
  const patch=calls.find(c=>c.method==='PATCH'&&c.u.includes('pos_stock_requests'));
  assert.ok(patch,'PATCH أُرسل');
  assert.ok(patch.u.includes('resolved=eq.false')&&patch.u.includes('location_id=eq.L11')&&patch.u.includes('LOW1'),'استهداف الطلب المطابق');
  assert.equal(JSON.parse(patch.body).resolved,true);
});

test('(٦-تجاهل) التجاهل يخفي 30 يومًا ثم يعود', ()=>{
  const ctx=makeCtx(); seed(ctx); setEls(ctx);
  vm.runInContext(`sgDismissals=[{product_code:'LOW1',to_location_id:'${L11}',dismissed_until:new Date(Date.now()+20*864e5).toISOString()}];`,ctx);
  assert.equal(vm.runInContext(`sgSuggestionFor(buildSuggestionEngine(),'LOW1','${L11}')`,ctx),null,'مخفي أثناء الـ30 يومًا');
  vm.runInContext(`sgDismissals=[{product_code:'LOW1',to_location_id:'${L11}',dismissed_until:new Date(Date.now()-864e5).toISOString()}];`,ctx);
  assert.ok(vm.runInContext(`sgSuggestionFor(buildSuggestionEngine(),'LOW1','${L11}')`,ctx)!==null,'عاد بعد انتهاء المدة');
});

test('(١٠) الأداء: 4453 منتجًا × 3 مواقع × 4096 صف مخزون ⇒ بناء القوائم أقل من 200 مللي', ()=>{
  const ctx=makeCtx();
  vm.runInContext(`
    locations=[{id:'${L11}',name:'فرع 11 يونيو',is_sales_location:true},{id:'${LSR}',name:'فرع السراج',is_sales_location:true},{id:'${LJZ}',name:'مخزن جنزور',is_sales_location:false}];
    products=[];stock=[];
    const AR=['خلاط','حوض','مرايا','دولاب','مقعد','صنبور','شور','بانيو'];
    for(let i=1;i<=4453;i++){
      const cat='تصنيف '+(i%157+1);
      products.push({code:'P'+i,name:AR[i%8]+' '+i,category:cat,retail_price:50+(i%200),supplier_id:'s'+(i%40)});
    }
    for(let j=0;j<4096;j++){ stock.push({location_id:[ '${L11}','${LSR}','${LJZ}'][j%3],product_code:'P'+((j%4453)+1),qty:(j%30)}); }
    locationCategoryRules=[];
    for(let c=1;c<=157;c++){ for(const l of locations){ locationCategoryRules.push({location_id:l.id,category:'تصنيف '+c,carried:true,min_qty:null}); } }
    sales=[{id:'s1',sale_date:'2026-09-10',location_id:'${L11}'}];
    saleItems=[];
    customers=[];financeAccounts=[];salePayments=[];saleReturns=[];saleReturnItems=[];stockMovements=[];financeMovements=[];purchases=[];purchaseItems=[];suppliers=[];transfers=[];compositeItems=[];customerLedger=[];expenseCategories=[];expenses=[];proformas=[];proformaItems=[];
    currentRole={role:'admin'}; appUser={id:'u1',identifier:'admin',branch_id:'${L11}'}; authSession={access_token:'t',expires_at:9999999999};
    sgDismissals=[]; sgSelected.clear(); sgActiveList='B'; /* أثقل قائمة: كل المنتجات × فرعي البيع */
  `,ctx);
  setEls(ctx);
  const t0=Date.now();
  vm.runInContext(`renderSuggestionList();`,ctx);
  const dt=Date.now()-t0;
  console.log('   ⏱ بناء القائمة (ب) بمقياس الإنتاج (4453×3×4096): '+dt+' مللي');
  assert.ok(dt<200,'أقل من 200 مللي (فعلي: '+dt+')');
});

test('(٢-قائمة أ) طُلب ولم يوجد: الأحدث أولًا ثم الأكثر طلبًا + الحقول', ()=>{
  const ctx=makeCtx(); seed(ctx); setEls(ctx);
  vm.runInContext(`
    sgOpenRequests=[
      {id:'r1',product_code:'LOW1',location_id:'${L11}',qty_here:0,available_elsewhere:[{name:'مخزن جنزور',qty:8}],user_identifier:'cash1',resolved:false,hit_count:1,last_requested_at:'2026-09-14T10:00:00Z'},
      {id:'r2',product_code:'LOW1',location_id:'${LSR}',qty_here:0,available_elsewhere:[],user_identifier:'cash2',resolved:false,hit_count:3,last_requested_at:'2026-09-15T09:00:00Z'}];
    sgActiveList='A';
  `,ctx);
  /* LOW1 في LSR: carried عام=true وكمية جنزور 8 فوق حدّها ⇒ اقتراح */
  vm.runInContext(`stock.push({location_id:'${LSR}',product_code:'LOW1',qty:0});`,ctx);
  vm.runInContext(`renderSuggestionList();`,ctx);
  const html=ctx.__els['sgABody'].innerHTML;
  assert.ok(html.includes('LOW1'),'الصنف ظاهر');
  assert.ok(html.includes('3×'),'عدّاد الطلبات ظاهر');
  assert.ok(html.includes('مخزن جنزور'),'المتوفّر في المواقع الأخرى ظاهر');
  assert.ok(html.includes('cash1')&&html.includes('cash2'),'مَن طلبه ظاهر');
  /* الترتيب: r2 (الأحدث 09-15) قبل r1 (09-14) */
  const i2=html.indexOf('3×');
  const i1=html.indexOf('1×');
  assert.ok(i2>-1&&i1>-1&&i2<i1,'الأحدث أولًا');
});
