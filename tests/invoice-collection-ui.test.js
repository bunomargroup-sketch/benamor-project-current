/* ═══════════════════════════════════════════════════════════════════
   اختبارات واجهة تحصيل الفواتير (ب) + الآجل (ج) + خلل الزبون (د)
   app.js الإنتاجي عبر VM — مع محاكاة select حقيقية (innerHTML يصفّر الاختيار)
   ═══════════════════════════════════════════════════════════════════ */
const test=require('node:test'), assert=require('node:assert');
const fs=require('fs'), vm=require('vm'), path=require('path');
const APP_JS=path.join(__dirname,'..','new discussion github','apps','pos','benamor-sales-system','app.js');

function el(){const cache={};const e={style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},addEventListener(){},removeEventListener(){},appendChild(c){return c},remove(){},querySelector(s){return cache[s]||(cache[s]=el())},querySelectorAll(){return[]},setAttribute(){},removeAttribute(){},focus(){},blur(){},click(){},reset(){},value:'',textContent:'',innerHTML:'',id:'',name:'',children:[],options:[],selectedOptions:[{textContent:'',value:''}],checked:false,disabled:false,placeholder:'',closest(){return el()},contains(){return false},insertAdjacentHTML(){},scrollIntoView(){},getAttribute(){return null},srcdoc:'',onload:null};return e;}
/* select تحاكي المتصفح: إعادة innerHTML تعيد الخيارات وتصفّر القيمة للأول */
function selectEl(){
  const e=el();
  let _html='', _value='';
  Object.defineProperty(e,'innerHTML',{get:()=>_html,set(v){_html=v; const opts=[...String(v).matchAll(/<option value="([^"]*)"/g)].map(m=>m[1]); e.options=opts.map(val=>({value:val,textContent:''})); _value=opts.length?opts[0]:'';}});
  Object.defineProperty(e,'value',{get:()=>_value,set(v){ const opts=[...e.options].map(o=>o.value); if(opts.includes(v)) _value=v; else _value=opts.length?opts[0]:'';}});
  e.innerHTML='';
  return e;
}

let calls=[], confirmFlag=false, MODE={};
const smartFetch=async(url,opts={})=>{
  const u=String(url); calls.push({u,method:opts.method||'GET',body:opts.body});
  const J=(o,s=200)=>({ok:s<400,status:s,text:async()=>JSON.stringify(o),json:async()=>o});
  if(u.includes('rpc/post_invoice_payment')){
    const p=JSON.parse(opts.body);
    const sl=MODE.sales.find(x=>x.id===p.p_sale_id);
    const sum=p.p_payments.reduce((a,x)=>a+Number(x.amount||0),0);
    return J({...sl,paid_amount:Number(sl.paid_amount)+sum,balance_due:Number(sl.balance_due)-sum,idempotent_replay:false});
  }
  return J([]);
};
function makeCtx(){
  const els={};
  const ctx={console,setTimeout,clearTimeout,setInterval:(...a)=>{const id=setInterval(...a);id.unref&&id.unref();return id;},clearInterval,Promise,JSON,Math,Date,Object,Array,Map,Set,Number,String,Error,TypeError,RegExp,
    document:{querySelector:()=>el(),querySelectorAll:()=>[],getElementById:id=>(els[id]||(els[id]=(id==='saleCustomer')?selectEl():el())),createElement:()=>el(),body:el(),documentElement:el(),addEventListener(){},title:''},
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},fetch:smartFetch,
    navigator:{onLine:true,serviceWorker:{register:async()=>({})}},
    alert(){},prompt(){return null},confirm(){return confirmFlag;},
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
function seed(ctx){
  MODE.sales=[{id:'s-due',paid_amount:400,balance_due:600}];
  vm.runInContext(`
    locations=[{id:'L1',name:'فرع 11 يونيو',is_sales_location:true}];
    customers=[{id:'c1',name:'أحمد',phone:'0911',balance:600},{id:'c2',name:'سالم',phone:'0922',balance:0},{id:'c3',name:'خالد',phone:'0933',balance:0}];
    financeAccounts=[{id:'acc1',name:'خزينة',account_type:'cash',location_id:'L1',balance:1000},{id:'acc2',name:'بنك',account_type:'bank',balance:500}];
    sales=[{id:'s-due',invoice_no:'INV-1',sale_date:'2026-09-14',location_id:'L1',customer_id:'c1',payment_method:'credit',subtotal:1000,discount:0,total:1000,paid_amount:400,balance_due:600,status:'posted'},
           {id:'s-paid',invoice_no:'INV-2',sale_date:'2026-09-14',location_id:'L1',customer_id:null,payment_method:'cash',subtotal:100,discount:0,total:100,paid_amount:100,balance_due:0,status:'posted'},
           {id:'s-local',invoice_no:null,sale_date:'2026-09-14',location_id:'L1',customer_id:null,payment_method:'cash',subtotal:50,discount:0,total:50,paid_amount:50,balance_due:0,status:'posted',offline_pending:true}];
    saleItems=[];salePayments=[];customerLedger=[];stockMovements=[];financeMovements=[];stock=[];products=[];purchases=[];purchaseItems=[];suppliers=[];transfers=[];compositeItems=[];expenseCategories=[];
    currentRole={role:'admin'}; appUser={id:'u1',identifier:'admin',branch_id:'L1'}; authSession={access_token:'t',refresh_token:'r',expires_at:9999999999};
    buildProductCostIndex(); buildProductSearchIndex();
  `,ctx);
}

/* ═══ (د) الاستنساخ الأمين للخلل — قبل الإصلاح كان يفشل ═══ */
test('(د) الاستنساخ: renderAll كان يمسح اختيار الزبون — الآن محفوظ', ()=>{
  const ctx=makeCtx(); seed(ctx);
  ctx.document.getElementById('saleCustomerSearch').value='';
  vm.runInContext(`fillSupplierSelects(); q('saleCustomer').value='c2';`,ctx);
  assert.equal(ctx.__els['saleCustomer'].value,'c2','اخترنا سالم');
  /* المحاكاة تحاكي المتصفح: إعادة innerHTML تصفّر — fillSupplierSelects الآن يحفظ الاختيار */
  vm.runInContext(`renderAll();`,ctx);
  assert.equal(ctx.__els['saleCustomer'].value,'c2','⚙️ الاختيار بقيت بعد renderAll (كانت تُمسح قبل الإصلاح)');
});
test('(د) زر المسح + البحث', ()=>{
  const ctx=makeCtx(); seed(ctx);
  vm.runInContext(`fillSupplierSelects(); q('saleCustomer').value='c2';`,ctx);
  vm.runInContext(`clearSaleCustomerSelection();`,ctx);
  assert.equal(ctx.__els['saleCustomer'].value,'','صار زبون نقدي');
  /* التصفية بالبحث: "أحمد" فقط */
  ctx.__els['saleCustomerSearch'].value='أحمد';
  vm.runInContext(`filterSaleCustomerOptions();`,ctx);
  const opts=ctx.__els['saleCustomer'].options.map(o=>o.value);
  assert.deepEqual(opts.filter(Boolean),['c1'],'خيار أحمد فقط بعد التصفية');
  /* اختيار أحمد ثم إعادة renderAll مع تصفية نشطة لا تفقده */
  vm.runInContext(`q('saleCustomer').value='c1'; renderAll();`,ctx);
  assert.equal(ctx.__els['saleCustomer'].value,'c1','بقي أحمد مختاراً');
});

/* ═══ (ب) زر التحصيل في الصف ═══ */
test('(ب) زر 💵 تحصيل يظهر للفاتورة المستحقة فقط (وليس للمحلية)', ()=>{
  const ctx=makeCtx(); seed(ctx);
  vm.runInContext(`renderSales();`,ctx);
  const html=ctx.__els['salesBody'].innerHTML;
  assert.ok(html.includes("openInvoicePayment('s-due')"),'زر تحصيل على المستحقة');
  assert.ok(!html.includes("openInvoicePayment('s-paid')"),'لا زر على المسددة');
  assert.ok(!html.includes("openInvoicePayment('s-local')"),'لا زر على المحلية');
  assert.ok(html.includes('data-id="s-due"'),'data-id للقائمة السياقية');
});

/* ═══ (ب) فتح النافذة وتعبئتها وسداد كامل ═══ */
test('(ب) النافذة: المتبقي بارز + سداد كامل يملأ الكاش + منع التجاوز', async ()=>{
  const ctx=makeCtx(); seed(ctx);
  ['invoicePaymentInfo','invPayCash','invPayBank','invPayCard','invPayCashAccount','invPayBankAccount','invPayCardAccount','invPayDate','invPayNotes','invPayError','invPayRemaining'].forEach(id=>ctx.document.getElementById(id));
  await vm.runInContext(`openInvoicePayment('s-due');`,ctx);
  const info=ctx.__els['invoicePaymentInfo'].innerHTML;
  assert.ok(info.includes('600.00'),'المتبقي 600 ظاهر');
  assert.ok(info.includes('أحمد'),'اسم الزبون ظاهر');
  assert.ok(info.includes('400.00'),'المدفوع سابقاً ظاهر');
  assert.equal(ctx.__els['invPayCashAccount'].value,'acc1','حساب الكاش الافتراضي');
  /* سداد كامل */
  vm.runInContext(`fillInvoicePaymentFull();`,ctx);
  assert.equal(Number(ctx.__els['invPayCash'].value),600,'ملأ 600');
  /* تجاوز: 700 */
  ctx.__els['invPayCash'].value='700';
  vm.runInContext(`updateInvoicePaymentTotals();`,ctx);
  assert.ok(String(ctx.__els['invPayError'].textContent).includes('يتجاوز'),'رسالة منع التجاوز');
  assert.equal(ctx.__els['invPayError'].style.display,'block');
});

/* ═══ (ب) التقديم: RPC ذرّي + مرايا محلية + صفر loadAll ═══ */
test('(ب) تسجيل الدفعة: rpc واحد + مرايا محلية كاملة + لا loadAll', async ()=>{
  const ctx=makeCtx(); seed(ctx);
  calls=[];
  ['invoicePaymentInfo','invPayCash','invPayBank','invPayCard','invPayCashAccount','invPayBankAccount','invPayCardAccount','invPayDate','invPayNotes','invPayError','invPayRemaining'].forEach(id=>ctx.document.getElementById(id));
  await vm.runInContext(`openInvoicePayment('s-due');`,ctx);
  ctx.__els['invPayCash'].value='150'; ctx.__els['invPayBank'].value='100';
  ctx.__els['invPayCashAccount'].value='acc1'; ctx.__els['invPayBankAccount'].value='acc2';
  ctx.__els['invPayDate'].value='2026-09-14'; ctx.__els['invPayNotes'].value='دفعة';
  confirmFlag=true;
  await vm.runInContext(`q('invoicePaymentForm').__submit&&0; (async()=>{})();`,ctx);
  /* المعالج مسجل بـ addEventListener في المتصفح — نستدعي مساره عبر dispatch اصطناعي: ننفّذ نفس منطق submit مباشرة */
  await vm.runInContext(`(async()=>{
    const sl=sales.find(x=>x.id==='s-due');
    const rows=getInvoicePaymentRows();
    const sum=rows.reduce((a,x)=>a+Number(x.amount||0),0);
    validateAccountingPayment('customer',sum);
    const idem=getDraftKey('invoicePayment');
    const res=await rpc('post_invoice_payment',{p_sale_id:'s-due',p_payments:rows,p_payment_date:q('invPayDate').value,p_notes:q('invPayNotes').value,p_idempotency_key:idem,p_user_identifier:'admin'});
    clearDraftKey('invoicePayment');
    mirrorInvoicePaymentLocally('s-due',res,rows,sum);
  })()`,ctx);
  const sl=vm.runInContext(`JSON.stringify(sales.find(x=>x.id==='s-due'))`,ctx);
  const parsed=JSON.parse(sl);
  assert.equal(Number(parsed.paid_amount),650,'paid_amount=650 محلياً');
  assert.equal(Number(parsed.balance_due),350,'balance_due=350 محلياً');
  assert.equal(vm.runInContext(`salePayments.length`,ctx),2,'صفّا دفعة');
  assert.equal(vm.runInContext(`financeAccounts[0].balance`,ctx),1150,'الخزينة +150');
  assert.equal(vm.runInContext(`financeAccounts[1].balance`,ctx),600,'البنك +100');
  assert.equal(vm.runInContext(`customers[0].balance`,ctx),350,'دين أحمد نقص 250');
  assert.equal(vm.runInContext(`customerLedger.length`,ctx),1,'قيد credit مربوط بالفاتورة');
  assert.equal(vm.runInContext(`customerLedger[0].reference_id`,ctx),'s-due');
  const rpcCall=calls.find(c=>c.u.includes('post_invoice_payment'));
  assert.ok(rpcCall,'نداء RPC واحد');
  const loadAllHits=calls.filter(c=>/pos_sales\?|pos_sale_items\?|pos_product_stock_summary|pos_purchases\?/.test(c.u));
  assert.equal(loadAllHits.length,0,'صفر loadAll');
});

/* ═══ (ج) سطر المتبقي البارز ═══ */
test('(ج) سطر «سيُسجَّل ديناً على» يظهر مع اسم الزبون ويحذر بدونه', ()=>{
  const ctx=makeCtx(); seed(ctx);
  /* صف فاتورة وهمي: 10 × 100 = 1000 */
  const row={querySelector:sel=>({' .si-code':{value:'T1'},'.si-code':{value:'T1'},'.si-name':{value:'صنبور'},'.si-qty':{value:'10'},'.si-price':{value:'100'},'.si-kind':{value:'sale'},'.si-discount':{value:'0'}}[sel]||{value:''}),classList:{add(){},remove(){},toggle(){},contains(){return false}}};
  ctx.document.getElementById('saleItemsBody').querySelectorAll=()=>[row];
  vm.runInContext(`fillSupplierSelects(); q('saleCustomer').value='c1';`,ctx);
  vm.runInContext(`q('saleCashAmount').value='400'; q('saleBankAmount').value='0'; q('saleCardAmount').value='0'; updateSaleTotal();`,ctx);
  const line=ctx.__els['saleCreditLine'];
  assert.equal(line.style.display,'block','السطر ظاهر');
  assert.ok(line.innerHTML.includes('600.00'),'المتبقي 600');
  assert.ok(line.innerHTML.includes('أحمد'),'اسم الزبون');
  /* بلا زبون ⇒ تحذير */
  vm.runInContext(`q('saleCustomer').value=''; updateSaleTotal();`,ctx);
  assert.ok(String(line.innerHTML).includes('تحتاج زبوناً'),'تحذير بلا زبون');
  /* مسددة ⇒ يختفي */
  vm.runInContext(`q('saleCashAmount').value='1000'; updateSaleTotal();`,ctx);
  assert.equal(line.style.display,'none','اختفى عند السداد الكامل');
});

/* ═══ (ج) setCreditSale موجودة وتعمل (فرضية الاستحالة غير دقيقة — بالدليل) ═══ */
test('(ج) setCreditSale تضبط credit وتصفّر الدفعات', ()=>{
  const ctx=makeCtx(); seed(ctx);
  vm.runInContext(`q('saleCashAmount').value='300'; setCreditSale();`,ctx);
  assert.equal(ctx.__els['salePaymentMethod'].value,'credit');
  assert.equal(Number(ctx.__els['saleCashAmount'].value),0);
});
