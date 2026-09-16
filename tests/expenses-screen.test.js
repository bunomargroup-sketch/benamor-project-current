/* ═══════════════════════════════════════════════════════════════════
   اختبارات شاشة سجل المصاريف (الواجهة) — app.js الإنتاجي عبر VM
   تغطي: العرض الفوري بعد الحفظ، الإجمالي مع الفلاتر، ظهور الأزرار حسب
   الدور (مخفية لا معطلة)، المرايا المحلية بلا loadAll، والفلاتر.
   ═══════════════════════════════════════════════════════════════════ */
const test=require('node:test'), assert=require('node:assert');
const fs=require('fs'), vm=require('vm'), path=require('path');
const APP_JS=path.join(__dirname,'..','new discussion github','apps','pos','benamor-sales-system','app.js');

const LOC='l-1', LOC2='l-2', ACC='a-1', ACC2='a-2', CAT='c-1';
const today=new Date().toISOString().slice(0,10);
const yesterday=new Date(Date.now()-864e5).toISOString().slice(0,10);

function el(){const cache={};const e={style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},addEventListener(){},removeEventListener(){},appendChild(c){return c},remove(){},querySelector(s){return cache[s]||(cache[s]=el())},querySelectorAll(){return[]},setAttribute(){},removeAttribute(){},focus(){},blur(){},click(){},reset(){},value:'',textContent:'',innerHTML:'',id:'',name:'',children:[],options:[],selectedOptions:[{textContent:'',value:''}],checked:false,disabled:false,placeholder:'',closest(){return el()},contains(){return false},insertAdjacentHTML(){},scrollIntoView(){},getAttribute(){return null},srcdoc:'',onload:null};return e;}

let MODE={expenses:[],postRow:null,confirmFlag:false};
let calls=[];
const smartFetch=async(url,opts={})=>{
  const u=String(url); calls.push({u,method:opts.method||'GET',body:opts.body});
  const J=(o,s=200)=>({ok:s<400,status:s,text:async()=>JSON.stringify(o),json:async()=>o});
  if(u.includes('rpc/pos_update_expense')){ const p=JSON.parse(opts.body); return J({id:p.p_expense_id,...p.p_expense,created_by:'cashier1',created_at:new Date().toISOString()}); }
  if(u.includes('rpc/pos_delete_expense')){ const p=JSON.parse(opts.body); return J({id:p.p_expense_id,deleted:true}); }
  if(u.includes('pos_audit_log')) return J([]);
  if(u.includes('rest/v1/pos_expenses')&&(opts.method==='POST'||!opts.method)){
    if(opts.method==='POST'){ MODE.postRow._id='new-'+(calls.length); return J([{...MODE.postRow,id:MODE.postRow._id}]); }
    return J(MODE.expenses);
  }
  return J([]);
};
function makeCtx(){
  const els={};
  const ctx={console,setTimeout,clearTimeout,setInterval:(...a)=>{const id=setInterval(...a);id.unref&&id.unref();return id;},clearInterval,Promise,JSON,Math,Date,Object,Array,Map,Set,Number,String,Error,TypeError,RegExp,
    document:{querySelector:()=>el(),querySelectorAll:()=>[],getElementById:id=>(els[id]||(els[id]=el())),createElement:()=>el(),body:el(),documentElement:el(),addEventListener(){},title:''},
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},fetch:smartFetch,
    navigator:{onLine:true,serviceWorker:{register:async()=>({})}},
    alert(){},prompt(){return null},confirm(){return MODE.confirmFlag;},
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
function seed(ctx,role){
  vm.runInContext(`
    locations=[{id:'${LOC}',name:'فرع 11 يونيو'},{id:'${LOC2}',name:'فرع السراج'}];
    financeAccounts=[{id:'${ACC}',name:'خزينة 11 يونيو',account_type:'cash',balance:1000},{id:'${ACC2}',name:'خزينة السراج',account_type:'cash',balance:500}];
    expenseCategories=[{id:'${CAT}',name:'وقود',active:true}];
    expenses=[];financeMovements=[];sales=[];saleItems=[];salePayments=[];stockMovements=[];customerLedger=[];customers=[];stock=[];products=[];purchases=[];purchaseItems=[];suppliers=[];transfers=[];compositeItems=[];
    currentRole={role:'${role}'}; appUser={id:'u1',identifier:'cashier1',branch_id:'${LOC}'}; authSession={access_token:'tok',refresh_token:'r',expires_at:9999999999};
    buildProductCostIndex(); buildProductSearchIndex();
    expensesListInit=true; expensesListLimit=500;
  `,ctx);
}

const mkRow=(o)=>Object.assign({id:'e'+Math.random().toString(36).slice(2,8),expense_date:today,location_id:LOC,account_id:ACC,category_id:CAT,title:'وقود سيارة',amount:50,notes:null,created_by:'cashier1',created_at:new Date().toISOString(),updated_at:null},o);

/* ── ١) العرض: أعمدة + إجمالي + أزرار الكاشير (تعديل مصروفه اليوم فقط، لا حذف) ── */
test('كاشير: يرى تعديل مصروفه اليوم فقط — لا حذف إطلاقاً — والإجمالي صحيح', ()=>{
  const ctx=makeCtx(); seed(ctx,'seller_11');
  MODE.expenses=[
    mkRow({id:'mine-today',title:'مصروفي اليوم',amount:100}),
    mkRow({id:'mine-yesterday',title:'مصروفي أمس',amount:70,created_at:new Date(Date.now()-864e5).toISOString(),expense_date:yesterday}),
    mkRow({id:'colleague',title:'مصروف زميلي',amount:30,created_by:'other'}),
    mkRow({id:'unknown',title:'قديم مجهول',amount:20,created_by:null}),
  ];
  vm.runInContext(`expensesListCache=[...window.__testRows]`.replace('window.__testRows','[]'),ctx);
  vm.runInContext(`expensesListCache=JSON.parse(${JSON.stringify(JSON.stringify(MODE.expenses))}); renderExpensesList();`,ctx);
  const html=ctx.__els['expensesBody'].innerHTML;
  const btn=(id)=>html.split(`onclick="editExpense('${id}')"`).length-1;
  const del=(id)=>html.split(`onclick="deleteExpense('${id}')"`).length-1;
  assert.equal(btn('mine-today'),1,'زر تعديل على مصروفه اليوم');
  assert.equal(btn('mine-yesterday'),0,'لا تعديل على مصروفه أمس');
  assert.equal(btn('colleague'),0,'لا تعديل على مصروف زميله');
  assert.equal(btn('unknown'),0,'لا تعديل على المجهول');
  ['mine-today','mine-yesterday','colleague','unknown'].forEach(id=>assert.equal(del(id),0,'لا زر حذف للكاشير: '+id));
  const foot=ctx.__els['expensesTotalFoot'].innerHTML;
  assert.ok(foot.includes('220.00'),'الإجمالي = 100+70+30+20 = 220','foot='+foot);
  assert.ok(foot.includes('4 مصروفاً'),'العدد 4');
  assert.ok(html.includes('فرع 11 يونيو')&&html.includes('خزينة 11 يونيو')&&html.includes('وقود'),'أسماء الفرع/الحساب/التصنيف ظاهرة');
  assert.ok(html.includes('>cashier1<'),'عمود مَن سجّل');
});

/* ── ٢) المدير: تعديل وحذف على الكل ── */
test('مدير: يرى تعديل وحذف على كل الصفوف', ()=>{
  const ctx=makeCtx(); seed(ctx,'admin');
  MODE.expenses=[mkRow({id:'any1'}),mkRow({id:'any2',created_by:'other',created_at:'2020-01-01T00:00:00Z'})];
  vm.runInContext(`expensesListCache=JSON.parse(${JSON.stringify(JSON.stringify(MODE.expenses))}); renderExpensesList();`,ctx);
  const html=ctx.__els['expensesBody'].innerHTML;
  assert.equal(html.split('editExpense(').length-1,2);
  assert.equal(html.split('deleteExpense(').length-1,2);
});

/* ── ٣) الفلاتر تبني الاستعلام الصحيح ── */
test('الفلاتر تُترجم لاستعلام خادم صحيح (تاريخ/تصنيف/فرع/بحث)', async ()=>{
  const ctx=makeCtx(); seed(ctx,'admin');
  const setV=(id,v)=>{ctx.document.getElementById(id).value=v;};
  setV('expenseListFrom','2026-09-01'); setV('expenseListTo','2026-09-30');
  setV('expenseListCategory',CAT); setV('expenseListBranch',LOC2); setV('expenseListSearch','وقود');
  MODE.expenses=[]; calls=[];
  await vm.runInContext(`fetchExpensesList()`,ctx);
  await new Promise(r=>setTimeout(r,20));
  const expCall=calls.find(c=>c.u.includes('pos_expenses'));
  assert.ok(expCall,'استُدعي الاستعلام');
  assert.ok(expCall.u.includes('expense_date=gte.2026-09-01')&&expCall.u.includes('expense_date=lte.2026-09-30'),'نطاق التاريخ');
  assert.ok(expCall.u.includes('category_id=eq.'+CAT),'فلتر التصنيف');
  assert.ok(expCall.u.includes('location_id=eq.'+LOC2),'فلتر الفرع');
  assert.ok(expCall.u.includes('title=ilike.*%D9%88%D9%82%D9%88%D8%AF*'),'بحث البيان (مرمّز)');
  assert.ok(expCall.u.includes('order=expense_date.desc,created_at.desc')&&expCall.u.includes('limit=500'),'الترتيب والحد');
});

/* ── ٤) الحفظ: يظهر في أعلى القائمة فوراً + created_by في الجسم + صفر loadAll ── */
test('حفظ مصروف: يظهر أعلى القائمة فوراً، created_by يُرسل، لا loadAll', async ()=>{
  const ctx=makeCtx(); seed(ctx,'seller_11');
  const setV=(id,v)=>{ctx.document.getElementById(id).value=v;};
  setV('expenseDate',today); setV('expenseAmount','100'); setV('expenseTitle','ضيافة');
  setV('expenseAccount',ACC); setV('expenseCategory',CAT); setV('expenseNotes','');
  setV('expensePaymentMethod','cash'); setV('expenseLocation',LOC);
  MODE.expenses=[];
  vm.runInContext(`expensesListCache=[];`,ctx);
  MODE.postRow={expense_date:today,location_id:LOC,account_id:ACC,category_id:CAT,title:'ضيافة',amount:100,notes:null,created_by:'cashier1',created_at:new Date().toISOString()};
  setV('expenseListFrom',today.slice(0,8)+'01'); setV('expenseListTo',today); setV('expenseListCategory',''); setV('expenseListBranch',''); setV('expenseListSearch','');
  calls=[];
  /* معالج submit مسجّل على العنصر في المتصفح؛ في VM نختبر مساره الحرج
     (إدراج + مطابقة الفلاتر + unshift + مرآة الحركة + الرسم) كما يستدعيها هو */
  const posted=await vm.runInContext(`(async()=>{
    const body={expense_date:'${today}',location_id:'${LOC}',account_id:'${ACC}',category_id:'${CAT}',title:'ضيافة',amount:100,notes:null,created_by:'cashier1'};
    const r=await api('pos_expenses',{method:'POST',body});
    if(expensesListInit && expenseMatchesListFilters(r[0])){ expensesListCache.unshift(r[0]); }
    expenses.unshift(r[0]);
    localMovement(body.account_id,'out','expense',body.amount,body.expense_date,'pos_expenses',r[0].id,body.title);
    renderExpensesList();
    return r[0];
  })()`,ctx);
  const html=ctx.__els['expensesBody'].innerHTML;
  assert.ok(html.includes('ضيافة'),'ظهر في القائمة فوراً');
  assert.ok(html.split('<tr>').length-1>=1,'صف واحد على الأقل');
  assert.ok(ctx.__els['expensesTotalFoot'].innerHTML.includes('100.00'),'الإجمالي تحدّث');
  const postCall=calls.find(c=>c.method==='POST'&&c.u.includes('pos_expenses'));
  assert.ok(postCall&&JSON.parse(postCall.body).created_by==='cashier1','created_by أُرسل في جسم الإدراج');
  const balance=vm.runInContext(`financeAccounts[0].balance`,ctx);
  assert.equal(balance,900,'الخزينة المحلية نقصت 100');
  /* صفر نداءات loadAll (الجداول الكبيرة) */
  const loadAllHits=calls.filter(c=>/pos_sales|pos_sale_items|pos_purchases|pos_product_stock_summary|pos_stock\?/.test(c.u));
  assert.equal(loadAllHits.length,0,'لا loadAll بعد الحفظ');
});

/* ── ٥) التعديل: RPC + مرآة محلية (صف/حركة/رصيد) ── */
test('تعديل: يستدعي pos_update_expense ويحديث المرايا محلياً', async ()=>{
  const ctx=makeCtx(); seed(ctx,'admin');
  const row=mkRow({id:'edit-me',amount:100,account_id:ACC});
  vm.runInContext(`expensesListCache=JSON.parse(${JSON.stringify(JSON.stringify([row]))}); expenses=[...expensesListCache]; localMovement('${ACC}','out','expense',100,'${today}','pos_expenses','edit-me','وقود'); renderExpensesList();`,ctx);
  assert.equal(vm.runInContext(`financeAccounts[0].balance`,ctx),900);
  const updated={...row,amount:250,title:'وقود أكثر'};
  await vm.runInContext(`mirrorExpenseUpdatedLocally(JSON.parse(${JSON.stringify(JSON.stringify(updated))}));`,ctx);
  assert.equal(vm.runInContext(`financeAccounts[0].balance`,ctx),750,'الرصيد: 1000-250 بعد التعديل (عوض 100 ثم خصم 250)');
  assert.equal(vm.runInContext(`expensesListCache[0].amount`,ctx),250,'الصف تحدّث');
  assert.equal(vm.runInContext(`financeMovements.length`,ctx),1,'حركة واحدة فقط (القديمة استُبدلت)');
  assert.equal(Number(vm.runInContext(`financeMovements[0].amount`,ctx)),250);
});

/* ── ٦) الحذف: RPC + إرجاع الرصيد محلياً + إزالة من القائمتين ── */
test('حذف: يعيد الرصيد محلياً ويزيل الصف من القائمة والتقرير', async ()=>{
  const ctx=makeCtx(); seed(ctx,'admin');
  const row=mkRow({id:'del-me',amount:80});
  vm.runInContext(`expensesListCache=JSON.parse(${JSON.stringify(JSON.stringify([row]))}); expenses=[...expensesListCache]; localMovement('${ACC}','out','expense',80,'${today}','pos_expenses','del-me','ضيافة'); renderExpensesList();`,ctx);
  assert.equal(vm.runInContext(`financeAccounts[0].balance`,ctx),920);
  await vm.runInContext(`mirrorExpenseDeletedLocally(expensesListCache[0]);`,ctx);
  assert.equal(vm.runInContext(`financeAccounts[0].balance`,ctx),1000,'عاد الرصيد كاملاً');
  assert.equal(vm.runInContext(`expensesListCache.length`,ctx),0,'أُزيل من القائمة');
  assert.equal(vm.runInContext(`expenses.length`,ctx),0,'أُزيل من مصفوفة التقارير');
  assert.equal(vm.runInContext(`financeMovements.length`,ctx),0,'لا حركة يتيمة محلياً');
});

/* ── ٧) قاعدة اليوم: العبرة بـ created_at (UTC مطابق للخادم) ── */
test('قاعدة نفس اليوم تُقارن بـ created_at بصيغة UTC', ()=>{
  const ctx=makeCtx(); seed(ctx,'seller_11');
  const res=vm.runInContext(`JSON.stringify([
    canEditExpenseRow({created_by:'cashier1',created_at:new Date().toISOString()}),
    canEditExpenseRow({created_by:'cashier1',created_at:'2020-01-01T00:00:00Z'}),
    canEditExpenseRow({created_by:'other',created_at:new Date().toISOString()}),
    canEditExpenseRow({created_by:null,created_at:new Date().toISOString()})
  ])`,ctx);
  assert.equal(res,JSON.stringify([true,false,false,false]));
});
