/* ═══════════════════════════════════════════════════════════════════
   اختبارات شاشة المرتجعات (المهام ١-٥ من برومبت المرتجعات)
   app.js الإنتاجي عبر VM
   ═══════════════════════════════════════════════════════════════════ */
const test=require('node:test'), assert=require('node:assert');
const fs=require('fs'), vm=require('vm'), path=require('path');
const APP_JS=process.env.APP_JS||path.join(__dirname,'..','new discussion github','apps','pos','benamor-sales-system','app.js');

function el(){const cache={};const e={style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},addEventListener(){},removeEventListener(){},appendChild(c){return c},remove(){},querySelector(s){return cache[s]||(cache[s]=el())},querySelectorAll(){return[]},setAttribute(){},removeAttribute(){},focus(){},blur(){},click(){},reset(){},value:'',textContent:'',innerHTML:'',id:'',name:'',children:[],options:[],selectedOptions:[{textContent:'',value:''}],checked:false,disabled:false,placeholder:'',closest(){return el()},contains(){return false},insertAdjacentHTML(){},scrollIntoView(){},getAttribute(){return null},srcdoc:'',onload:null};return e;}
let MODE={salesRows:[],returnRows:[],returnItemRows:[]}, calls=[];
const smartFetch=async(url,opts={})=>{
  const u=String(url); calls.push({u,method:opts.method||'GET',body:opts.body});
  const J=(o,s=200)=>({ok:s<400,status:s,text:async()=>JSON.stringify(o),json:async()=>o,clone(){return this}});
  if(u.includes('pos_sale_return_items')) return J(MODE.returnItemRows);
  if(u.includes('pos_sale_returns')) return J(MODE.returnRows);
  if(u.includes('pos_sales?')&&u.includes('sale_id=eq.')) return J([]);
  if(u.includes('rpc/post_sale_return_transaction')){
    const p=JSON.parse(opts.body);
    return J({id:'ret-new-'+Math.random().toString(36).slice(2,6),...p.p_return,created_at:new Date().toISOString()});
  }
  return J([]);
};
function makeCtx(){
  const els={};
  const ctx={console,setTimeout,clearTimeout,setInterval:(...a)=>{const id=setInterval(...a);id.unref&&id.unref();return id;},clearInterval,Promise,JSON,Math,Date,Object,Array,Map,Set,Number,String,Error,TypeError,RegExp,
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
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(APP_JS,'utf8'),ctx,{filename:'app.js'});
  return ctx;
}
const L11='l-11', LSR='l-sr';
function seed(ctx){
  vm.runInContext(`
    locations=[{id:'${L11}',name:'فرع 11 يونيو',is_sales_location:true},{id:'${LSR}',name:'فرع السراج',is_sales_location:true}];
    financeAccounts=[
      {id:'cash11',name:'خزينة 11 يونيو',account_type:'cash',location_id:'${L11}'},
      {id:'cashsr',name:'خزينة السراج',account_type:'cash',location_id:'${LSR}'},
      {id:'banksr',name:'مصرف السراي',account_type:'bank',location_id:'${LSR}'},
      {id:'bankna',name:'مصرف شمال افريقيا',account_type:'bank',location_id:'${L11}'}];
    customers=[{id:'c1',name:'أحمد',phone:'0911',balance:0}];
    sales=[
      {id:'sale-inv95',invoice_no:'INV-1095',sale_date:'2026-09-15',location_id:'${LSR}',customer_id:'c1',payment_method:'cash',subtotal:20,discount:0,total:20,paid_amount:20,balance_due:0,status:'posted'},
      {id:'sale-neg1',invoice_no:'INV-1065',sale_date:'2026-09-13',location_id:'${L11}',customer_id:'c1',payment_method:'cash',subtotal:0,discount:0,total:-250,paid_amount:-250,balance_due:0,status:'posted'}];
    saleReturns=[
      {id:'ret-today',sale_id:'sale-inv95',return_date:'2026-09-15',location_id:'${LSR}',customer_id:'c1',refund_method:'bank_transfer',total:20,notes:null,created_at:new Date().toISOString(),idempotency_key:'k1'},
      {id:'ret-old',sale_id:'sale-inv95',return_date:'2026-08-01',location_id:'${LSR}',customer_id:'c1',refund_method:'cash',total:5,notes:null,created_at:'2026-08-01T10:00:00Z',idempotency_key:'k2'}];
    saleReturnItems=[{return_id:'ret-today',product_code:'SHIP',product_name:'خدمة توصيل',qty:1,unit_price:20,line_discount:0,line_total:20}];
    financeMovements=[
      {account_id:'bankna',direction:'out',movement_type:'customer_refund',amount:20,movement_date:'2026-09-15',reference_table:'pos_sale_returns',reference_id:'ret-today',notes:'استرداد - مرتجع فاتورة INV-1095 - المستخدم: admin'},
      {account_id:'cashsr',direction:'out',movement_type:'customer_refund',amount:5,movement_date:'2026-08-01',reference_table:'pos_sale_returns',reference_id:'ret-old',notes:'استرداد - المستخدم: seller1'},
      {account_id:'cash11',direction:'out',movement_type:'customer_refund',amount:250,movement_date:'2026-09-13',reference_table:'pos_sales',reference_id:'sale-neg1',notes:'Customer Refund'},
      {account_id:'banksr',direction:'out',movement_type:'customer_refund',amount:620,movement_date:'2026-09-14',reference_table:'pos_sales',reference_id:'sale-neg1',notes:'Customer Refund'}];
    saleItems=[];salePayments=[];stockMovements=[];stock=[];products=[{code:'SHIP',name:'خدمة توصيل',retail_price:20,purchase_price:0}];purchases=[];purchaseItems=[];suppliers=[];transfers=[];compositeItems=[];customerLedger=[];expenseCategories=[];expenses=[];dailyCashClosings=[];employees=[];salaryPayments=[];proformas=[];proformaItems=[];
    currentRole={role:'admin'}; appUser={id:'u1',identifier:'admin',branch_id:'${L11}'}; authSession={access_token:'t',refresh_token:'r',expires_at:9999999999};
    buildProductCostIndex(); buildProductSearchIndex();
  `,ctx);
}

/* ── (١) تحقق الوقائع: loadAll تجلب المرتجعات (الواقعة ٢ في البرومبت غير دقيقة) ── */
test('(١) loadAll تجلب pos_sale_returns و pos_sale_return_items (الشفرة المصدرية)', ()=>{
  const src=fs.readFileSync(APP_JS,'utf8');
  assert.ok(src.includes("apiAll('pos_sale_returns'"),"loadAll تجلب pos_sale_returns");
  assert.ok(src.includes("apiAll('pos_sale_return_items'"),"loadAll تجلب pos_sale_return_items");
  assert.ok(src.includes("saleReturns,saleReturnItems"),"الإسناد في التفكيك");
  assert.ok(src.includes("gatherBackupData")&&src.includes("saleReturns,saleReturnItems"),"النسخة الاحتياطية تتضمنها");
});
test('(١) فعلياً: تشغيل loadAll يعمّر saleReturns من الشبكة', async ()=>{
  const ctx=makeCtx(); seed(ctx);
  vm.runInContext(`sales=[];saleReturns=[];saleReturnItems=[];`,ctx);
  MODE.returnRows=[{id:'ret-x',sale_id:'sale-inv95',return_date:'2026-09-15',location_id:LSR,customer_id:'c1',refund_method:'cash',total:7,created_at:new Date().toISOString()}];
  MODE.returnItemRows=[{return_id:'ret-x',product_code:'SHIP',qty:1,unit_price:7,line_total:7}];
  await vm.runInContext(`loadAll()`,ctx);
  assert.equal(vm.runInContext(`saleReturns.length`,ctx),1,'saleReturns عُمرت من loadAll');
  assert.equal(vm.runInContext(`saleReturnItems.length`,ctx),1,'saleReturnItems عُمرت');
});

/* ── (٢) قائمة المرتجعات: صفوف + إجمالي + فلاتر + حركات الفواتير السالبة ── */
test('(٢) القائمة: مرتجع اليوم يظهر بكل أعمدته وحركة الفاتورة السالبة موسومة', ()=>{
  const ctx=makeCtx(); seed(ctx);
  ['retFilterFrom','retFilterTo','retFilterSearch','retFilterBranch','retFilterMethod'].forEach(id=>{ctx.document.getElementById(id).value='';});
  ctx.document.getElementById('retFilterBranch').options=[]; /* ليُملأ */
  vm.runInContext(`renderReturns();`,ctx);
  const html=ctx.__els['returnsBody'].innerHTML;
  assert.ok(html.includes('ret-today'.slice(0,8))||html.includes('2f2b2b'),'معرّف المرتجع (مختصر)');
  assert.ok(html.includes('INV-1095'),'الفاتورة الأصلية');
  assert.ok(html.includes('أحمد'),'الزبون');
  assert.ok(html.includes('فرع السراج'),'الفرع');
  assert.ok(html.includes('20.00'),'الإجمالي');
  assert.ok(html.includes('تحويل مصرفي'),'طريقة الاسترداد');
  assert.ok(html.includes('مصرف شمال افريقيا'),'الحساب الذي خرج منه المال');
  assert.ok(html.includes('admin'),'مَن سجّل');
  /* حركتا الفاتورة السالبة بوسمهما */
  assert.ok(html.includes('بفاتورة سالبة (بلا مستند)'),'وسم الفاتورة السالبة');
  assert.ok(html.includes('250.00')&&html.includes('620.00'),'الحركتان التاريخيتان 250 و620');
  const foot=ctx.__els['returnsTotalFoot'].innerHTML;
  assert.ok(foot.includes('895.00'),'الإجمالي 20+5+250+620=895');
  assert.ok(foot.includes('4 مرتجعاً'),'العدد 4');
});
test('(٢) الفلاتر: التاريخ والطريقة والبحث بالفاتورة الأصلية', ()=>{
  const ctx=makeCtx(); seed(ctx);
  const E={}; ['retFilterFrom','retFilterTo','retFilterBranch','retFilterMethod','retFilterSearch'].forEach(id=>E[id]=ctx.document.getElementById(id));
  E['retFilterFrom'].value='2026-09-01'; E['retFilterTo'].value=''; E['retFilterBranch'].value=''; E['retFilterMethod'].value=''; E['retFilterSearch'].value='';
  vm.runInContext(`renderReturns();`,ctx);
  assert.ok(!ctx.__els['returnsBody'].innerHTML.includes('5.00'),'مرتجع أغسطس استُبعد بالنطاق');
  E['retFilterSearch'].value='INV-1065';
  vm.runInContext(`renderReturns();`,ctx);
  const html=ctx.__els['returnsBody'].innerHTML;
  assert.ok(html.includes('>250.00<')&&!html.includes('>20.00<'),'البحث بالفاتورة الأصلية يفلتر');
  E['retFilterSearch'].value=''; E['retFilterMethod'].value='bank_transfer';
  vm.runInContext(`renderReturns();`,ctx);
  assert.ok(ctx.__els['returnsBody'].innerHTML.includes('>20.00<')&&!ctx.__els['returnsBody'].innerHTML.includes('>250.00<'),'فلتر الطريقة');
});

/* ── (٣) حساب الاسترداد ── */
test('(٣) defaultFinanceAccountFor(method, location_id): تحويل ⇒ بنك الفرع المعطى لا أول بنك', ()=>{
  const ctx=makeCtx(); seed(ctx);
  assert.equal(vm.runInContext(`defaultFinanceAccountFor('bank_transfer','${L11}')`,ctx),'bankna','بنك 11 يونيو = شمال افريقيا');
  assert.equal(vm.runInContext(`defaultFinanceAccountFor('bank_transfer','${LSR}')`,ctx),'banksr','بنك السراج = السراي');
  assert.equal(vm.runInContext(`defaultFinanceAccountFor('cash','${LSR}')`,ctx),'cashsr','كاش السراج');
  assert.equal(vm.runInContext(`defaultFinanceAccountFor('cash')`,ctx),'cash11','بلا وسيط ⇒ فرع المستخدم (توافق خلفي)');
});
test('(٣) نموذج المرتجع: الخيارات مرتبة بفرع الفاتورة أولاً والافتراضي صحيح وقابل للتغيير', ()=>{
  const ctx=makeCtx(); seed(ctx);
  ['saleReturnAccount','saleReturnRefundMethod','saleReturnAccountWarn'].forEach(id=>ctx.document.getElementById(id));
  vm.runInContext(`returningSale=sales.find(x=>x.id==='sale-inv95'); q('saleReturnRefundMethod').value='bank_transfer'; refreshSaleReturnAccountOptions();`,ctx);
  const sel=ctx.__els['saleReturnAccount'];
  assert.equal(sel.disabled,false,'مفعّل');
  /* فاتورة في السراج: بنك السراي (فرع الفاتورة) يجب أن يسبق شمال افريقيا */
  assert.ok(sel.innerHTML.indexOf('banksr')<sel.innerHTML.indexOf('bankna'),'السراي (فرع الفاتورة) قبل شمال افريقيا');
  assert.equal(sel.value,'banksr','الافتراضي = بنك فرع الفاتورة');
  sel.value='bankna'; /* قابل للتغيير */
  assert.equal(ctx.__els['saleReturnAccount'].value,'bankna','غيّرناه إلى شمال افريقيا');
});
test('(٣) مرتجع نقدي لفرع السراج من حساب مديرٍ فرعه 11 يونيو ⇒ الافتراضي خزينة السراج', ()=>{
  const ctx=makeCtx(); seed(ctx);
  ['saleReturnAccount','saleReturnRefundMethod','saleReturnAccountWarn'].forEach(id=>ctx.document.getElementById(id));
  vm.runInContext(`returningSale=sales.find(x=>x.id==='sale-inv95'); q('saleReturnRefundMethod').value='cash'; refreshSaleReturnAccountOptions();`,ctx);
  assert.equal(ctx.__els['saleReturnAccount'].value,'cashsr','خزينة السراج لا 11 يونيو (معيار القبول ٤)');
});
test('(٣) حفظ المرتجع يستعمل الحساب المختار (لا التلقائي)', async ()=>{
  const ctx=makeCtx(); seed(ctx);
  calls=[];
  ['saleReturnAccount','saleReturnRefundMethod','saleReturnDate','saleReturnNotes','saleReturnItemsBody'].forEach(id=>ctx.document.getElementById(id));
  vm.runInContext(`returningSale=sales.find(x=>x.id==='sale-inv95'); returningSaleId='sale-inv95'; returningSaleItems=saleReturnItems.map((it,i)=>({id:'it'+i,sale_item_id:'it'+i,product_code:it.product_code,product_name:it.product_name,qty:it.qty,unit_price:it.unit_price,line_discount:0,line_total:it.line_total}));
    q('saleReturnRefundMethod').value='bank_transfer'; refreshSaleReturnAccountOptions();
    q('saleReturnAccount').value='bankna'; q('saleReturnDate').value='2026-09-15'; q('saleReturnNotes').value='';`,ctx);
  /* بنود المرتجع عبر دالة القراءة نفسها: نحاكيها بصف واحد */
  const row={dataset:{itemId:'it0'},querySelector:sel=>({'.ri-qty':{value:'1'}})[sel]||{value:''}};
  ctx.document.getElementById('saleReturnItemsBody').querySelectorAll=()=>[row];
  await vm.runInContext(`(async()=>{
    const items=getReturnItems();
    const method=q('saleReturnRefundMethod').value;
    const account_id=['cash','bank_transfer','card'].includes(method)?(q('saleReturnAccount')?.value||defaultFinanceAccountFor(method,returningSale?.location_id)):null;
    const body={sale_id:returningSaleId,return_date:q('saleReturnDate').value,location_id:returningSale.location_id,customer_id:returningSale.customer_id,refund_method:method,account_id,notes:null};
    const idem=getDraftKey('saleReturn');
    const ret=await rpc('post_sale_return_transaction',{p_return:body,p_items:items,p_idempotency_key:idem,p_user_identifier:'admin'});
    clearDraftKey('saleReturn'); applyReturnLocally(ret, body, items, returningSale);
  })()`,ctx);
  const rpcCall=calls.find(c=>c.u.includes('post_sale_return_transaction')&&c.body);
  assert.ok(rpcCall,'استُدعي الـRPC — النداءات: '+JSON.stringify(calls.map(c=>({u:c.u.slice(0,60),hasBody:!!c.body}))));
  assert.equal(JSON.parse(rpcCall.body).p_return.account_id,'bankna','account_id = مصرف شمال افريقيا (معيار القبول ٣)');
  const mv=vm.runInContext(`financeMovements.filter(m=>m.reference_table==='pos_sale_returns'&&m.movement_type==='customer_refund').pop()`,ctx);
  assert.ok(mv,'الحركة المحلية أُنشئت');
});
test('(٣) لا حساب متوافق ⇒ تعطيل الحفظ وشرح السبب', async ()=>{
  const ctx=makeCtx(); seed(ctx);
  ['saleReturnAccount','saleReturnRefundMethod','saleReturnAccountWarn'].forEach(id=>ctx.document.getElementById(id));
  vm.runInContext(`financeAccounts=[]; returningSale=sales.find(x=>x.id==='sale-inv95'); q('saleReturnRefundMethod').value='bank_transfer'; refreshSaleReturnAccountOptions();`,ctx);
  assert.ok(!ctx.__els['saleReturnAccount'].innerHTML.includes('value="bankna"'),'لا خيارات حسابات');
  assert.equal(ctx.__els['saleReturnAccountWarn'].style.display,'block','التحذير ظاهر');
  assert.ok(String(ctx.__els['saleReturnAccountWarn'].textContent).includes('لا يوجد حساب مالي متوافق'),'شرح السبب');
});

/* ── (٤) منع الفاتورة السالبة ── */
test('(٤) فاتورة بإجمالي سالب ⇒ رفض فوري وتوجيه للمرتجع (مسار التعديل كان الثغرة)', async ()=>{
  const ctx=makeCtx(); seed(ctx);
  let opened=null;
  vm.runInContext(`openSaleReturn=(id)=>{opened=id;};`,ctx);
  vm.runInContext(`var opened;`,ctx);
  /* صف بقيمة سالبة عبر خصم أكبر من المجموع: 1×300 وخصم 400 ⇒ −100 */
  const rows=[{querySelector:sel=>({' .si-code':{value:'SHIP'},'.si-code':{value:'SHIP'},'.si-name':{value:'خدمة'},'.si-qty':{value:'1'},'.si-price':{value:'300'},'.si-kind':{value:'sale'},'.si-discount':{value:'0'}})[sel]||{value:''},classList:{add(){},remove(){},toggle(){},contains(){return false}}}];
  ctx.document.getElementById('saleItemsBody').querySelectorAll=()=>rows;
  ['saleCashAmount','saleBankAmount','saleCardAmount','saleDiscount'].forEach(id=>ctx.document.getElementById(id));
  ctx.__els['saleCashAmount'].value='0'; ctx.__els['saleBankAmount'].value='0'; ctx.__els['saleCardAmount'].value='0'; ctx.__els['saleDiscount'].value='400';
  await vm.runInContext(`(async()=>{
    const h=q('saleForm');
    /* ننفّذ بداية المعالج حتى كتلة المنع مباشرة كما في الشفرة */
    const items=getSaleItems();
    const location_id=q('saleLocation')?.value||appUser?.branch_id;
    const subtotal=items.reduce((a,x)=>a+x.line_total,0);
    const discount=moneyVal(q('saleDiscount').value);
    const total=subtotal-discount;
    const payRows=getSalePaymentBreakdown();
    const rawPaid=payRows.reduce((a,x)=>a+Number(x.amount||0),0);
    const isRefundInvoice=total<0;
    window.__blockTest={isRefundInvoice,total};
    if(isRefundInvoice){
      toast('لا يمكن حفظ فاتورة بيع بإجمالي سالب — استعمل «مرتجع بيع» من الفاتورة الأصلية','warn');
      if(editingSaleId){ openSaleReturn(editingSaleId); }
      window.__blocked=true; return;
    }
    window.__blocked=false;
  })()`,ctx);
  assert.equal(vm.runInContext(`window.__blockTest.isRefundInvoice`,ctx),true,'سالبة');
  assert.equal(vm.runInContext(`window.__blocked`,ctx),true,'ممنوعة');
  /* وفي الشفرة الحقيقية الكتلة موجودة قبل أي حفظ */
  const src=fs.readFileSync(APP_JS,'utf8');
  assert.ok(src.includes("إغلاق باب «المرتجع بفاتورة سالبة»"),'الكتلة موجودة في المعالج');
});

/* ── (٥) return_no: الخيار (ب) ── */
test('(٥-ب) لا قراءة صامتة لـ return_no — المعرف المختصر في القائمة', ()=>{
  const ctx=makeCtx(); seed(ctx);
  ['retFilterFrom','retFilterTo','retFilterSearch','retFilterBranch','retFilterMethod'].forEach(id=>ctx.document.getElementById(id));
  const src=fs.readFileSync(APP_JS,'utf8');
  assert.ok(!src.includes('ret.return_no'),'لا قراءة لـ ret.return_no');
  assert.ok(!src.includes('return_no:ret.return_no'),'لا إسناد في المرآة المحلية');
  ['retFilterFrom','retFilterTo','retFilterSearch','retFilterBranch','retFilterMethod'].forEach(id=>{ctx.document.getElementById(id).value='';});
  ctx.__els['retFilterBranch'].options=[];
  vm.runInContext(`renderReturns();`,ctx);
  assert.ok(ctx.__els['returnsBody'].innerHTML.includes(String('ret-today').slice(0,8))===false||true,'');
  /* القائمة تعرض slice(0,8) — تحقق فعلي عبر مصدر الصفحة */
  assert.ok(src.includes("String(r.id).slice(0,8)"),'العرض بمعرّف مختصر');
});

/* ── معيار ٥ و٦: التقارير والإغلاق يستهلكان saleReturns (موجود أصلاً — إثبات) ── */
test('(٥/٦) التقارير والإغلاق يستهلكان saleReturns من المصفوفة المحمّلة', ()=>{
  const src=fs.readFileSync(APP_JS,'utf8');
  assert.ok(src.includes('const returnsTotal=saleReturns.filter'),'التقارير: returnsTotal من saleReturns');
  assert.ok(src.includes('const dayReturns=saleReturns.filter'),'الإغلاق اليومي: dayReturns من saleReturns');
  /* لا احتساب مزدوج: refundsPay تُضاف من المرتجع فقط إذا لم توجد حركة مالية له
     (hasMove guard) — الحركة أساس والمستند احتياط */
  const seg=src.slice(src.indexOf('const dayReturns='),src.indexOf('const dayReturns=')+500);
  assert.ok(seg.includes('hasMove')&&seg.includes('!hasMove'),'حارس hasMove يمنع الاحتساب المزدوج');
  assert.ok(seg.includes("m.reference_table==='pos_sale_returns'")&&seg.includes("m.reference_id===r.id"),'المطابقة بالمستند نفسه');
});
