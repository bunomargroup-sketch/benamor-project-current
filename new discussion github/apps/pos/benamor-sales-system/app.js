(function(){try{var t=localStorage.getItem('posTheme'); if(t){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(console.warn));}

function applyThemeIcon(){try{var t=document.documentElement.getAttribute('data-theme')||localStorage.getItem('posTheme')||'auto';var btn=document.getElementById('themeToggle');if(btn){btn.innerHTML=t==='dark'?'<i class="ti ti-sun"></i>':'<i class="ti ti-moon"></i>';}}catch(e){}}
function toggleTheme(){try{var cur=document.documentElement.getAttribute('data-theme');var next=cur==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',next);localStorage.setItem('posTheme',next);applyThemeIcon();}catch(e){}}
document.addEventListener('DOMContentLoaded',applyThemeIcon);


const APP_CONFIG={businessName:'مجموعة بن عمر',tagline:'نظام بيع ومخزون',currency:'د.ل',lowStockThreshold:2,supabaseUrl:'https://kkqbkumobeimwuscxztu.supabase.co',supabaseKey:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrcWJrdW1vYmVpbXd1c2N4enR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3Nzc0NDAsImV4cCI6MjA5NzM1MzQ0MH0.5hUmVo-RSW_XVrW8XvJZP7_RoRHoxR0Sl0AxplOMwH0'};
function loadLocalConfig(){try{Object.assign(APP_CONFIG,JSON.parse(localStorage.getItem('posAppConfig')||'{}'));}catch(e){}}
loadLocalConfig();
const SUPABASE_URL=APP_CONFIG.supabaseUrl;
const SUPABASE_KEY=APP_CONFIG.supabaseKey;
function authBearer(){return (authSession&&authSession.access_token)||SUPABASE_KEY} const H = { apikey: SUPABASE_KEY, get Authorization(){return `Bearer ${authBearer()}`}, 'Content-Type':'application/json', Prefer:'return=representation' };
let locations=[], suppliers=[], ledger=[], payments=[], stock=[], purchases=[], purchaseItems=[], products=[], transfers=[], sales=[], saleItems=[], salePayments=[], proformas=[], proformaItems=[], saleReturns=[], saleReturnItems=[], stockMovements=[], customers=[], customerLedger=[], userRoles=[], financeAccounts=[], financeMovements=[], dailyCashClosings=[], expenseCategories=[], expenses=[], employees=[], salaryPayments=[], compositeItems=[];
let appUser=JSON.parse(localStorage.getItem('posUser')||'null'), authSession=JSON.parse(localStorage.getItem('posAuthSession')||'null'), currentRole=null;
let editingPurchaseId=null, originalPurchase=null, originalPurchaseItems=[];
let editingTransferId=null, originalTransfer=null, originalTransferItems=[];
let editingSaleId=null, originalSale=null, originalSaleItems=[];
let selectedProductCode=null;
let productFormMode='create', editingProductCode=null;
let selectedSaleId=null;
let priceCheckerCarts=[], sourcePriceCheckerCartId=null;
let activePayInputId="saleCashAmount";
let saleSaveMode="new";
let lastFocusedSaleRow=null;
let calcExpr="";
let currentReport="overview";
let productSortIndex=16, productSortDir='desc';
let stockSortIndex=3, stockSortDir='desc';
let pickerSelectedIndex=0;
let pickerSortIndex=5, pickerSortDir='desc';
let productPickerTarget='sale';
let editingProformaId=null;
let editingFinanceAccountId=null;
let returningSaleId=null, returningSale=null, returningSaleItems=[];

function q(id){return document.getElementById(id)}
function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
function cfgText(v){return esc(v)}
function initBranding(){document.title=APP_CONFIG.businessName+' - '+APP_CONFIG.tagline; if(q('brandTitle'))q('brandTitle').textContent=APP_CONFIG.businessName; if(q('brandTagline'))q('brandTagline').textContent=APP_CONFIG.tagline; if(q('loginTitle'))q('loginTitle').textContent='دخول '+APP_CONFIG.businessName;}
function money(n){return Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
function normalizeDigits(v){return String(v??'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d))}
function parseDecimal(v){
  let s=normalizeDigits(v).trim().replace(/\s/g,'');
  if(!s) return 0;
  const hasComma=s.includes(','), hasDot=s.includes('.');
  if(hasComma && hasDot){
    // If both exist, treat the last separator as decimal and the other as thousands.
    if(s.lastIndexOf(',')>s.lastIndexOf('.')) s=s.replace(/\./g,'').replace(',','.');
    else s=s.replace(/,/g,'');
  }else if(hasComma) s=s.replace(',','.');
  s=s.replace(/[^0-9.\-]/g,'');
  const n=Number(s);
  return Number.isFinite(n)?n:0;
}
function moneyVal(v){return parseDecimal(v)}

/* ===== Accounting integrity guard: double-entry validation before writes ===== */
const AccountingIntegrity=(()=>{
  const toMinor=v=>Math.round(moneyVal(v)*1000);
  const line=(account,debit=0,credit=0)=>({account,debit:toMinor(debit),credit:toMinor(credit)});
  const validate=(tx)=>{
    const debit=tx.lines.reduce((a,l)=>a+Number(l.debit||0),0);
    const credit=tx.lines.reduce((a,l)=>a+Number(l.credit||0),0);
    if(debit!==credit){
      console.error('Accounting validation failed',tx,{debit,credit});
      throw new Error(`Accounting Anomaly Detected: ${tx.type} غير متوازنة (${money(debit/1000)} ≠ ${money(credit/1000)})`);
    }
    return true;
  };
  const paymentAccount=(method)=>method==='cash'?'Cash_Drawer':(method==='card'?'Bank_Card':'Bank_Transfer');
  return {toMinor,line,validate,paymentAccount};
})();
function validateAccountingForSale(items,total,payRows,balanceDue){
  const lines=[]; const absTotal=Math.abs(Number(total||0));
  if(Number(total||0)>=0){
    payRows.forEach(r=>lines.push(AccountingIntegrity.line(AccountingIntegrity.paymentAccount(r.payment_method),r.amount,0)));
    if(Number(balanceDue||0)>0) lines.push(AccountingIntegrity.line('Accounts_Receivable',balanceDue,0));
    lines.push(AccountingIntegrity.line('Revenue_Sales',0,total));
  }else{
    lines.push(AccountingIntegrity.line('Sales_Returns',absTotal,0));
    payRows.forEach(r=>lines.push(AccountingIntegrity.line(AccountingIntegrity.paymentAccount(r.payment_method),0,r.amount)));
  }
  const cogs=items.reduce((a,it)=>a+(productCost(it.product_code)*Number(it.qty||0)),0);
  if(cogs>0){lines.push(AccountingIntegrity.line('COGS_Expense',cogs,0)); lines.push(AccountingIntegrity.line('Inventory_Asset',0,cogs));}
  if(cogs<0){lines.push(AccountingIntegrity.line('Inventory_Asset',Math.abs(cogs),0)); lines.push(AccountingIntegrity.line('COGS_Expense',0,Math.abs(cogs)));}
  return AccountingIntegrity.validate({type:'SALE',lines});
}
function validateAccountingForPurchase(total,paid){
  const credit=Math.max(0,Number(total||0)-Math.min(Number(paid||0),Number(total||0)));
  const lines=[AccountingIntegrity.line('Inventory_Asset',total,0)];
  if(Number(paid||0)>0) lines.push(AccountingIntegrity.line('Payment_Account',0,Math.min(Number(paid||0),Number(total||0))));
  if(credit>0) lines.push(AccountingIntegrity.line('Accounts_Payable',0,credit));
  return AccountingIntegrity.validate({type:'PURCHASE',lines});
}
function validateAccountingPayment(kind,amount){
  const lines=kind==='customer'
    ? [AccountingIntegrity.line('Payment_Account',amount,0),AccountingIntegrity.line('Accounts_Receivable',0,amount)]
    : [AccountingIntegrity.line('Accounts_Payable',amount,0),AccountingIntegrity.line('Payment_Account',0,amount)];
  return AccountingIntegrity.validate({type:kind==='customer'?'CUSTOMER_PAYMENT':'SUPPLIER_PAYMENT',lines});
}
function validateAccountingOutflow(kind,amount){
  const expense=kind==='salary'?'Salary_Expense':'Expense';
  return AccountingIntegrity.validate({type:kind.toUpperCase(),lines:[AccountingIntegrity.line(expense,amount,0),AccountingIntegrity.line('Payment_Account',0,amount)]});
}
function validateAccountingTransfer(amount){
  return AccountingIntegrity.validate({type:'VAULT_TRANSFER',lines:[AccountingIntegrity.line('Destination_Account',amount,0),AccountingIntegrity.line('Source_Account',0,amount)]});
}

function cleanDecimalInputValue(v){
  let s=normalizeDigits(v).replace(/[^0-9.,\-]/g,'');
  const neg=s.startsWith('-')?'-':''; s=s.replace(/-/g,'');
  const firstSep=[s.indexOf('.'),s.indexOf(',')].filter(i=>i>=0).sort((a,b)=>a-b)[0];
  if(firstSep==null) return neg+s;
  const int=s.slice(0,firstSep).replace(/[.,]/g,'');
  const dec=s.slice(firstSep+1).replace(/[.,]/g,'');
  return neg+int+s[firstSep]+dec;
}
function setupDecimalInputs(){
  document.addEventListener('input',e=>{
    const el=e.target;
    if(!el?.matches?.('input[inputmode="decimal"]')) return;
    const cleaned=cleanDecimalInputValue(el.value);
    if(el.value!==cleaned){const pos=el.selectionStart; el.value=cleaned; try{el.setSelectionRange(Math.max(0,pos-1),Math.max(0,pos-1))}catch(_){}}
  });
  document.addEventListener('blur',e=>{
    const el=e.target;
    if(!el?.matches?.('input[inputmode="decimal"]')) return;
    if(String(el.value).trim()!=='') el.value=String(parseDecimal(el.value));
  },true);
}
function setSyncState(state,msg){const el=q('syncState'); if(!el)return; el.classList.remove('sync-online','sync-syncing','sync-cache','sync-offline'); el.classList.add('sync-'+state); el.textContent=msg;}
function showLoading(v){q('loading').style.display=v?'block':'none'; setSyncState(v?'syncing':(navigator.onLine?'online':'offline'), v?'جاري المزامنة...':(navigator.onLine?'متصل مع Supabase':'غير متصل'))}
function toast(msg,type='info'){
  const t=q('toast'); const colors={success:'var(--good)',error:'var(--bad)',warn:'var(--warn)',info:'var(--blue)'};
  const icons={success:'ti-circle-check',error:'ti-alert-circle',warn:'ti-alert-triangle',info:'ti-info-circle'};
  t.style.borderRightColor=colors[type]||colors.info;
  t.innerHTML=`<i class="ti ${icons[type]||icons.info}" style="color:${colors[type]||colors.info};margin-inline-end:8px;vertical-align:middle"></i>${esc(msg)}`;
  t.style.display='block'; clearTimeout(t._t); t._t=setTimeout(()=>t.style.display='none', type==='error'?6000:3500);
}
function friendlyError(err){
  const m=String(err&&err.message||err||'');
  if(/Failed to fetch|NetworkError/i.test(m)) return 'تعذّر الاتصال بالخادم — تحقّق من الإنترنت';
  if(/duplicate key|already exists/i.test(m)) return 'القيمة موجودة مسبقًا';
  if(/permission|RLS|not authorized/i.test(m)) return 'لا تملك صلاحية لهذه العملية';
  if(/relation .* does not exist|404/i.test(m)) return 'هذا القسم غير مُفعّل في قاعدة البيانات بعد';
  return m||'حدث خطأ غير متوقع';
}
function badgeStatus(balance){balance=Number(balance||0); if(balance>0) return `<span class="badge red">علينا للمورد</span>`; if(balance<0) return `<span class="badge green">لنا عند المورد</span>`; return `<span class="badge gray">متوازن</span>`}
function typeLabel(t){return {branch:'فرع بيع',warehouse:'مخزن',opening:'رصيد افتتاحي',purchase:'فاتورة شراء',payment:'دفعة',return:'مرتجع',adjustment:'تسوية',cash:'نقدي',bank_transfer:'تحويل مصرفي',card:'بطاقة',mixed:'مختلط',credit:'آجل / دين',posted:'مرحلة',draft:'مسودة',cancelled:'ملغاة',transfer_in:'تحويل وارد',transfer_out:'تحويل صادر',sale:'بيع',return_supplier:'مرتجع مورد',return_customer:'مرتجع زبون',customer_refund:'استرداد للزبون'}[t]||t}

function staffEmail(id){return String(id||'').trim().toLowerCase()+'@bag.com'}
function jwtExp(token){try{return JSON.parse(atob(String(token||'').split('.')[1]||''))?.exp||0;}catch(e){return 0}}
function authExpiredSoon(){const exp=Number(authSession?.expires_at||jwtExp(authSession?.access_token)); return !exp || (Date.now()/1000) > (exp-90);}
async function refreshAuth(){
  if(!authSession?.refresh_token) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const res=await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:SUPABASE_KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:authSession.refresh_token})});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error_description||data.msg||data.message||'تعذر تحديث الجلسة');
  authSession={...authSession,...data};
  localStorage.setItem('posAuthSession',JSON.stringify(authSession));
  return authSession;
}
async function ensureAuth(){
  if(!appUser?.id && !authSession?.access_token) return;
  if(authExpiredSoon()) await refreshAuth();
}
async function authSignIn(identifier,code){const res=await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:SUPABASE_KEY,'Content-Type':'application/json'},body:JSON.stringify({email:staffEmail(identifier),password:code})}); const data=await res.json().catch(()=>({})); if(!res.ok)throw new Error(data.error_description||data.msg||data.message||'auth failed'); authSession=data; localStorage.setItem('posAuthSession',JSON.stringify(authSession)); return data.user}
async function fetchWithAuthRetry(url, options={}, parseEmptyAs=null){
  await ensureAuth();
  let res=await fetch(url, options);
  let text=await res.text(); let data=text?JSON.parse(text):parseEmptyAs;
  const msg=String(data?.message||text||'');
  if((res.status===401 || /JWT expired|PGRST303/i.test(msg)) && authSession?.refresh_token){
    await refreshAuth();
    res=await fetch(url, options);
    text=await res.text(); data=text?JSON.parse(text):parseEmptyAs;
  }
  if(!res.ok) throw new Error(data?.message || text || 'Supabase error');
  return data;
}
async function api(table, opts={}){
  const qs = opts.qs || '';
  return fetchWithAuthRetry(`${SUPABASE_URL}/rest/v1/${table}${qs}`, { method: opts.method||'GET', headers:H, body: opts.body?JSON.stringify(opts.body):undefined }, null);
}


async function rpc(name, body){
  return fetchWithAuthRetry(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:H,body:JSON.stringify(body)},null);
}

async function apiAll(table, qs='', batch=1000){
  let from=0, all=[];
  while(true){
    const data = await fetchWithAuthRetry(`${SUPABASE_URL}/rest/v1/${table}${qs}`, { method:'GET', headers:{...H, Range:`${from}-${from+batch-1}`} }, []);
    all = all.concat(data||[]);
    if(!data || data.length < batch) break;
    from += batch;
  }
  return all;
}

const ESSENTIAL_CACHE_KEY='posEssentialCacheV1';
function saveEssentialCache(){
  try{
    const data={saved_at:new Date().toISOString(),locations,suppliers,stock,purchases,purchaseItems,products,transfers,sales,saleItems,salePayments,customers,customerLedger,userRoles,financeAccounts,financeMovements,expenseCategories,expenses,dailyCashClosings};
    localStorage.setItem(ESSENTIAL_CACHE_KEY,JSON.stringify(data));
  }catch(e){console.warn('essential cache save failed',e)}
}
function loadEssentialCache(){
  try{return JSON.parse(localStorage.getItem(ESSENTIAL_CACHE_KEY)||'null')}catch(e){return null}
}
function applyEssentialCache(c){
  if(!c) return false;
  locations=c.locations||[]; suppliers=c.suppliers||[]; stock=c.stock||[]; purchases=c.purchases||[]; purchaseItems=c.purchaseItems||[]; products=c.products||[]; transfers=c.transfers||[]; sales=c.sales||[]; saleItems=c.saleItems||[]; salePayments=c.salePayments||[]; customers=c.customers||[]; customerLedger=c.customerLedger||[]; userRoles=c.userRoles||[]; financeAccounts=c.financeAccounts||[]; financeMovements=c.financeMovements||[]; expenseCategories=c.expenseCategories||[]; expenses=c.expenses||[]; dailyCashClosings=c.dailyCashClosings||[];
  ['productCategoryFilter','productBrandFilter','productColorFilter','productSupplierFilter','stockCategoryFilter','stockBrandFilter','stockSupplierFilter'].forEach(id=>{if(q(id)) q(id).dataset.ready='';});
  buildProductCostIndex(); buildProductSearchIndex();
  renderAll();
  setSyncState(navigator.onLine?'cache':'offline',`بيانات محفوظة محليًا ${c.saved_at?('من '+c.saved_at.replace('T',' ').slice(0,16)):''}`);
  return true;
}
function initConnectivity(){
  window.addEventListener('online',()=>setSyncState('online','عاد الاتصال - يمكنك التحديث'));
  window.addEventListener('offline',()=>setSyncState('offline','غير متصل - تعمل من البيانات المحفوظة'));
  setSyncState(navigator.onLine?'online':'offline',navigator.onLine?'متصل مع Supabase':'غير متصل');
}

function downloadBackup(){
  const data={_meta:{app:'benamor-pos',exported_at:new Date().toISOString(),branch:appUser?.branch_name||'',user:appUser?.identifier||''},
    locations,suppliers,supplier_ledger:ledger,supplier_payments:payments,stock,purchases,purchaseItems,products,transfers,
    sales,saleItems,salePayments,proformas,proformaItems,saleReturns,saleReturnItems,stockMovements,customers,customerLedger,
    userRoles,financeAccounts,financeMovements,dailyCashClosings,expenseCategories,expenses,employees,salaryPayments,
    settings:{businessName:APP_CONFIG.businessName,tagline:APP_CONFIG.tagline,currency:APP_CONFIG.currency,lowStockThreshold:APP_CONFIG.lowStockThreshold}};
  const blob=new Blob([JSON.stringify(data)],{type:'application/json'});
  const url=URL.createObjectURL(blob); const a=document.createElement('a');
  a.href=url; a.download=`pos-backup-${new Date().toISOString().slice(0,10)}-${(appUser?.branch_name||'branch').replace(/\s+/g,'_')}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),3000);
  toast('تم تنزيل النسخة الاحتياطية','success');
}
function restoreBackup(input){
  const file=input.files?.[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const data=JSON.parse(reader.result);
      const cache={saved_at:new Date().toISOString(),
        locations:data.locations||[],suppliers:data.suppliers||[],stock:data.stock||[],
        purchases:data.purchases||[],purchaseItems:data.purchaseItems||[],products:data.products||[],
        transfers:data.transfers||[],sales:data.sales||[],saleItems:data.saleItems||[],
        salePayments:data.salePayments||[],customers:data.customers||[],customerLedger:data.customerLedger||[],
        userRoles:data.userRoles||[],financeAccounts:data.financeAccounts||[],financeMovements:data.financeMovements||[],
        expenseCategories:data.expenseCategories||[],expenses:data.expenses||[],dailyCashClosings:data.dailyCashClosings||[]};
      localStorage.setItem(ESSENTIAL_CACHE_KEY,JSON.stringify(cache));
      applyEssentialCache(cache);
      toast('تمت استعادة النسخة الاحتياطية محليًا وعرضها. عند توفّر الاتصال سيتم تحديثها تلقائيًا من الخادم.','success');
    }catch(e){console.error(e);toast('ملف النسخة الاحتياطية غير صالح','error')}
    input.value='';
  };
  reader.onerror=()=>{toast('تعذّر قراءة الملف','error'); input.value='';};
  reader.readAsText(file);
}
/* ===== النسخ الاحتياطي على Google Drive (مجلد مخفي appDataFolder) ===== */
let gDrive={token:null,expires:0,email:'',clientId:localStorage.getItem('posGDriveClientID')||'',fileId:localStorage.getItem('posGDriveFileID')||'',lastSync:localStorage.getItem('posGDriveLastSync')||'',auto:localStorage.getItem('posGDriveAuto')==='1'};
const GDRIVE_SCOPE='https://www.googleapis.com/auth/drive.appdata openid email';
const GDRIVE_FILE='pos-backup.json';
function gatherBackupData(){return {_meta:{app:'benamor-pos',exported_at:new Date().toISOString(),branch:appUser?.branch_name||'',user:appUser?.identifier||''},locations,suppliers,supplier_ledger:ledger,supplier_payments:payments,stock,purchases,purchaseItems,products,transfers,sales,saleItems,salePayments,proformas,proformaItems,saleReturns,saleReturnItems,stockMovements,customers,customerLedger,userRoles,financeAccounts,financeMovements,dailyCashClosings,expenseCategories,expenses,employees,salaryPayments,settings:{businessName:APP_CONFIG.businessName,tagline:APP_CONFIG.tagline,currency:APP_CONFIG.currency,lowStockThreshold:APP_CONFIG.lowStockThreshold}};}
function applyBackupData(data){const cache={saved_at:new Date().toISOString(),locations:data.locations||[],suppliers:data.suppliers||[],stock:data.stock||[],purchases:data.purchases||[],purchaseItems:data.purchaseItems||[],products:data.products||[],transfers:data.transfers||[],sales:data.sales||[],saleItems:data.saleItems||[],salePayments:data.salePayments||[],customers:data.customers||[],customerLedger:data.customerLedger||[],userRoles:data.userRoles||[],financeAccounts:data.financeAccounts||[],financeMovements:data.financeMovements||[],expenseCategories:data.expenseCategories||[],expenses:data.expenses||[],dailyCashClosings:data.dailyCashClosings||[]};localStorage.setItem(ESSENTIAL_CACHE_KEY,JSON.stringify(cache));applyEssentialCache(cache);}
function renderGDriveStatus(){
  const inp=q('gDriveClientID'); if(inp && !inp.value && gDrive.clientId) inp.value=gDrive.clientId;
  const cb=q('gDriveAuto'); if(cb) cb.checked=!!gDrive.auto;
  const el=q('gDriveStatus'); if(!el) return;
  el.innerHTML=gDrive.clientId?`<div class="mini">الحالة: ${gDrive.email?('مرتبط بـ '+esc(gDrive.email)):'<b>غير مرتبط</b> — اضغط «ربط Google Drive».'}</div>${gDrive.lastSync?`<div class="mini">آخر نسخة على Drive: ${esc(gDrive.lastSync)}</div>`:''}`:`<div class="mini">أدخل معرّف العميل (Client ID) من Google Cloud ثم اضغط «حفظ المعرّف».</div>`;
}
function gDriveSaveClientID(){const v=(q('gDriveClientID')?.value||'').trim(); if(!v){toast('الصق معرّف العميل (Client ID)','warn');return;} gDrive.clientId=v; localStorage.setItem('posGDriveClientID',v); toast('تم حفظ معرّف العميل','success'); renderGDriveStatus();}
function gDriveEnsureToken(){return new Promise((resolve,reject)=>{
  if(!gDrive.clientId){reject(new Error('لم يُضبط معرّف العميل (Client ID)'));return;}
  if(gDrive.token && Date.now()<gDrive.expires-60000){resolve(gDrive.token);return;}
  if(!window.google?.accounts?.oauth2){reject(new Error('لم يُحمّل سكربت Google بعد — تأكد من الاتصال بالإنترنت'));return;}
  const client=window.google.accounts.oauth2.initTokenClient({client_id:gDrive.clientId,scope:GDRIVE_SCOPE,
    callback:resp=>{if(resp.error){reject(new Error(String(resp.error)));return;} gDrive.token=resp.access_token; gDrive.expires=Date.now()+(Number(resp.expires_in)||3600)*1000;
      fetch('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{Authorization:'Bearer '+resp.access_token}}).then(r=>r.json()).then(u=>{gDrive.email=u.email||'';renderGDriveStatus();}).catch(()=>{});
      resolve(resp.access_token);},
    error_callback:err=>reject(new Error((err&&(err.message||err.type))||'فشل تسجيل الدخول إلى Google'))});
  client.requestAccessToken({prompt:(gDrive.token?'':'consent')});
});}
function gDriveConnect(){gDriveEnsureToken().then(()=>toast('تم ربط Google Drive','success')).catch(e=>toast('تعذّر الربط: '+e.message,'error'));}
async function gDriveFindFile(token){const r=await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent("name='"+GDRIVE_FILE+"'")}&spaces=appDataFolder&fields=files(id,name,modifiedTime,size)&orderBy=modifiedTime%20desc`,{headers:{Authorization:'Bearer '+token}}); if(!r.ok) throw new Error('تعذّر البحث في Drive'); const j=await r.json(); return (j.files&&j.files[0])||null;}
async function gDriveSave(){
  try{
    const token=await gDriveEnsureToken(); showLoading(true);
    const content=JSON.stringify(gatherBackupData());
    const existing=gDrive.fileId?{id:gDrive.fileId}:await gDriveFindFile(token).catch(()=>null);
    if(existing&&existing.id){
      const r=await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media&fields=id,modifiedTime`,{method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:content});
      if(!r.ok) throw new Error('تعذّر تحديث الملف في Drive'); const j=await r.json(); gDrive.fileId=existing.id; gDrive.lastSync=(j.modifiedTime||'').replace('T',' ').slice(0,19);
    }else{
      const meta={name:GDRIVE_FILE,parents:['appDataFolder']}; const boundary='pos_'+Date.now();
      const body=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
      const r=await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'multipart/related; boundary='+boundary},body});
      if(!r.ok) throw new Error('تعذّر رفع الملف إلى Drive'); const j=await r.json(); gDrive.fileId=j.id; gDrive.lastSync=(j.modifiedTime||'').replace('T',' ').slice(0,19);
    }
    localStorage.setItem('posGDriveFileID',gDrive.fileId); localStorage.setItem('posGDriveLastSync',gDrive.lastSync);
    renderGDriveStatus(); toast('تم حفظ النسخة الاحتياطية على Google Drive','success');
  }catch(e){console.error(e);toast('تعذّر الحفظ على Drive: '+e.message,'error')}finally{showLoading(false)}
}
async function gDriveRestore(){
  try{
    const token=await gDriveEnsureToken(); showLoading(true);
    let file=gDrive.fileId?{id:gDrive.fileId}:null;
    if(file){const t=await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}`,{headers:{Authorization:'Bearer '+token}}); if(!t.ok) file=null;}
    if(!file) file=await gDriveFindFile(token);
    if(!file){toast('لا توجد نسخة احتياطية على Drive بعد','warn');return;}
    const r=await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,{headers:{Authorization:'Bearer '+token}});
    if(!r.ok) throw new Error('تعذّر تنزيل النسخة'); const data=await r.json();
    applyBackupData(data); gDrive.fileId=file.id; gDrive.lastSync=(file.modifiedTime||'').replace('T',' ').slice(0,19);
    localStorage.setItem('posGDriveFileID',gDrive.fileId); localStorage.setItem('posGDriveLastSync',gDrive.lastSync);
    renderGDriveStatus(); toast('تمت الاستعادة من Google Drive','success');
  }catch(e){console.error(e);toast('تعذّرت الاستعادة من Drive: '+e.message,'error')}finally{showLoading(false)}
}
function gDriveToggleAuto(cb){gDrive.auto=!!cb.checked; localStorage.setItem('posGDriveAuto',gDrive.auto?'1':'0'); toast(gDrive.auto?'تم تفعيل الحفظ التلقائي على Drive بعد كل تحديث':'تم إيقاف الحفظ التلقائي','success');}
let gDriveAutoTimer=null;
function gDriveMaybeAuto(){if(!gDrive.auto||!gDrive.clientId)return; clearTimeout(gDriveAutoTimer); gDriveAutoTimer=setTimeout(()=>{gDriveSave().catch(()=>{});},8000);}
async function loadAll(){
  // على الإنترنت الضعيف: اعرض آخر بيانات محفوظة فوراً ثم حدّث من الخادم بالخلفية
  if(!products.length){ const _c=loadEssentialCache(); if(_c) applyEssentialCache(_c); }
  try{
    showLoading(true);
    [locations, suppliers, ledger, payments, stock, purchases, purchaseItems, products, transfers, sales, saleItems, salePayments, proformas, proformaItems, saleReturns, saleReturnItems, stockMovements, customers, customerLedger, userRoles, financeAccounts, financeMovements, dailyCashClosings, expenseCategories, expenses, employees, salaryPayments, compositeItems] = await Promise.all([
      api('pos_locations',{qs:'?select=*&order=name.asc'}),
      api('pos_supplier_balances',{qs:'?select=*&order=name.asc'}),
      api('pos_supplier_ledger',{qs:'?select=*&order=entry_date.desc,created_at.desc'}),
      api('pos_supplier_payments',{qs:'?select=*&order=payment_date.desc,created_at.desc&limit=50'}),
      apiAll('pos_stock','?select=*&order=updated_at.desc'),
      apiAll('pos_purchases','?select=*&order=purchase_date.desc,created_at.desc'),
      apiAll('pos_purchase_items','?select=*&order=created_at.desc').catch(e=>{console.warn('purchase items not setup yet',e); return []}),
      apiAll('pos_product_stock_summary','?select=*&order=code.asc').catch(e=>{console.warn('products not imported yet', e); return []}),
      api('pos_stock_transfers',{qs:'?select=*&order=transfer_date.desc,created_at.desc&limit=50'}),
      apiAll('pos_sales','?select=*&order=sale_date.desc,created_at.desc').catch(e=>{console.warn('sales not setup yet',e); return []}),
      apiAll('pos_sale_items','?select=*&order=created_at.desc').catch(e=>{console.warn('sale items not setup yet',e); return []}),
      apiAll('pos_sale_payments','?select=*&order=created_at.desc').catch(e=>{console.warn('sale payments not setup yet',e); return []}),
      apiAll('pos_proformas','?select=*&order=proforma_date.desc,created_at.desc').catch(e=>{console.warn('proformas not setup yet',e); return []}),
      apiAll('pos_proforma_items','?select=*&order=created_at.desc').catch(e=>{console.warn('proforma items not setup yet',e); return []}),
      apiAll('pos_sale_returns','?select=*&order=return_date.desc,created_at.desc').catch(e=>{console.warn('sale returns not setup yet',e); return []}),
      apiAll('pos_sale_return_items','?select=*&order=created_at.desc').catch(e=>{console.warn('sale return items not setup yet',e); return []}),
      apiAll('pos_stock_movements','?select=*&order=movement_date.desc&limit=50').catch(e=>{console.warn('stock movements not setup yet',e); return []}),
      apiAll('pos_customer_balances','?select=*&order=name.asc').catch(e=>{console.warn('customers not setup yet',e); return []}),
      apiAll('pos_customer_ledger','?select=*&order=entry_date.desc,created_at.desc').catch(e=>{console.warn('customer ledger not setup yet',e); return []}),
      apiAll('pos_user_roles','?select=*&order=identifier.asc').catch(e=>{console.warn('user roles not setup yet',e); return []}),
      apiAll('pos_finance_account_balances','?select=*&order=name.asc').catch(e=>{console.warn('finance accounts not setup yet',e); return []}),
      apiAll('pos_finance_movements','?select=*&order=movement_date.desc,created_at.desc&limit=200').catch(e=>{console.warn('finance movements not setup yet',e); return []}),
      apiAll('pos_daily_cash_closings','?select=*&order=closing_date.desc,created_at.desc&limit=100').catch(e=>{console.warn('daily cash closings not setup yet',e); return []}),
      apiAll('pos_expense_categories','?select=*&order=name.asc').catch(e=>{console.warn('expense categories not setup yet',e); return []}),
      apiAll('pos_expenses','?select=*&order=expense_date.desc,created_at.desc&limit=100').catch(e=>{console.warn('expenses not setup yet',e); return []}),
      apiAll('pos_employees','?select=*&order=name.asc').catch(e=>{console.warn('employees not setup yet',e); return []}),
      apiAll('pos_salary_payments','?select=*&order=payment_date.desc,created_at.desc&limit=100').catch(e=>{console.warn('salary payments not setup yet',e); return []}),
      apiAll('pos_composite_items','?select=*&order=created_at.asc').catch(e=>{console.warn('composite items not setup yet',e); return []})
    ]);
    ['productCategoryFilter','productBrandFilter','productColorFilter','productSupplierFilter','stockCategoryFilter','stockBrandFilter','stockSupplierFilter'].forEach(id=>{if(q(id)) q(id).dataset.ready='';});
    buildProductCostIndex(); buildProductSearchIndex(); renderAll(); saveEssentialCache(); setSyncState('online','متصل - تم تحديث البيانات'); gDriveMaybeAuto();
  }catch(e){ console.error(e); const used=applyEssentialCache(loadEssentialCache()); if(used) toast('الاتصال ضعيف: تم استعمال آخر بيانات محفوظة','warn'); else toast('خطأ: '+e.message+' - لا توجد بيانات محفوظة محليًا'); }
  finally{showLoading(false);window.__busy=false}
}

function renderAll(){renderDashboard();renderLocations();renderProductDatalist();renderProducts();renderSuppliers();renderCustomers();fillSupplierSelects();renderLedger();renderCustomerLedger();renderPayments();renderSales();renderProformas();renderPurchases();renderStock();renderTransfers();renderFinance();renderReports();renderRoles();renderStatusBar();renderSettingsExpenseCategories();renderProductOptionSettings();refreshAuditLog();renderComposites();applyPermissions();setTimeout(setupTableSorting,0)}
function renderDashboard(){
  q('branchesCount').textContent=locations.filter(x=>x.location_type==='branch').length;
  q('warehousesCount').textContent=locations.filter(x=>x.location_type==='warehouse').length;
  q('suppliersCount').textContent=suppliers.length;
  q('productsCount').textContent=products.length;
  q('salesCount').textContent=sales.length;
  q('customersDebtTotal').textContent=money(customers.reduce((a,c)=>a+Math.max(0,Number(c.balance||0)),0));
  q('suppliersBalance').textContent=money(suppliers.reduce((a,s)=>a+Number(s.balance||0),0));
  const today=new Date().toISOString().slice(0,10); const todaySales=sales.filter(s=>s.sale_date===today);
  if(q('todaySalesTotal')) q('todaySalesTotal').textContent=money(todaySales.reduce((a,s)=>a+Number(s.total||0),0));
  if(q('todaySalesCount')) q('todaySalesCount').textContent=todaySales.length;
  renderDashboardLists();
  renderReorderAlerts();
}


function renderDashboardLists(){
  if(q('dashLastSalesBody')) q('dashLastSalesBody').innerHTML=sales.slice(0,5).map(sl=>{const l=locations.find(x=>x.id===sl.location_id); const c=customers.find(x=>x.id===sl.customer_id); return `<tr><td class="ltr"><b>${esc(sl.invoice_no||sl.id.slice(0,8))}</b></td><td>${esc(sl.sale_date)}</td><td>${esc(l?.name)}</td><td>${esc(c?.name||'زبون نقدي')}</td><td><b>${money(sl.total)}</b></td><td>${money(sl.balance_due)}</td></tr>`}).join('')||'<tr><td colspan="5">لا توجد فواتير بيع بعد.</td></tr>';
  if(q('dashMovementsBody')) q('dashMovementsBody').innerHTML=stockMovements.slice(0,8).map(m=>{const l=locations.find(x=>x.id===m.location_id); return `<tr><td>${esc((m.movement_date||m.created_at||'').replace('T',' ').slice(0,19))}</td><td>${esc(typeLabel(m.movement_type))}</td><td>${esc(m.product_name||m.product_code)}</td><td>${esc(l?.name)}</td><td class="${Number(m.qty_change)>0?'stock-positive':'stock-negative'}"><b>${money(m.qty_change)}</b></td></tr>`}).join('')||'<tr><td colspan="5">لا توجد حركات مخزون بعد.</td></tr>';
}


const LOGIN_FALLBACK_BRANCHES=['فرع 11 يونيو','فرع السراج'];
function setLoginMessage(msg,type='info'){
  const el=q('loginHelp'); if(!el) return;
  const colors={info:'#64748b',warn:'var(--warn)',error:'var(--bad)',success:'var(--good)'};
  el.style.color=colors[type]||colors.info; el.textContent=msg;
}
function renderLoginBranches(list=[]){
  const sel=q('loginBranch'); if(!sel) return;
  const prev=sel.value||appUser?.branch_id||appUser?.branch_name||'';
  const rows=(list&&list.length?list:LOGIN_FALLBACK_BRANCHES.map(name=>({id:name,name,is_sales_location:true})));
  sel.innerHTML='<option value="">اختر الفرع</option>'+rows.map(l=>`<option value="${esc(l.id||l.name)}">${esc(l.name||l.id)}</option>`).join('');
  if(prev && [...sel.options].some(o=>o.value===prev)) sel.value=prev;
  else if(appUser?.branch_name){const opt=[...sel.options].find(o=>o.textContent===appUser.branch_name); if(opt) sel.value=opt.value;}
}
async function loadLoginBranches(){
  renderLoginBranches(locations.filter(l=>l.is_sales_location));
  try{
    const rows=await api('pos_locations',{qs:'?select=id,name,is_sales_location,location_type&order=name.asc'});
    if(Array.isArray(rows)&&rows.length){
      locations=rows;
      renderLoginBranches(rows.filter(l=>l.is_sales_location || l.location_type==='branch'));
      setLoginMessage('اختر الفرع ثم اكتب المعرّف والكود للدخول.');
    }
  }catch(e){
    console.warn('login branches fallback used',e);
    setLoginMessage('إذا لم تظهر الفروع الحقيقية، اختر الفرع ثم سجّل الدخول وسيتم ربطه بعد التحميل.','warn');
  }
}
function resolveSelectedLoginBranch(selectedValue, selectedText){
  return locations.find(l=>String(l.id)===String(selectedValue)) ||
    locations.find(l=>String(l.name)===String(selectedValue)) ||
    locations.find(l=>String(l.name)===String(selectedText)) || null;
}

const ROLE_LABELS={admin:'مدير',seller_11:'بائع فرع 11 يونيو',seller_sarraj:'بائع فرع السراج',sales_purchase:'بيع وشراء الفرعين',warehouse:'مخزن',accountant:'محاسب',viewer:'مشاهدة فقط'};
const ROLE_TABS={
  admin:['dashboard','locations','products','suppliers','ledger','payments','sales','salesList','proformas','customers','purchases','stock','stockCount','composites','transfers','expensesQuick','dailyCashClosing','finance','reports','auditLog','users','settings'],
  seller_11:['dashboard','products','sales','salesList','proformas','stock','expensesQuick','dailyCashClosing'],
  seller_sarraj:['dashboard','products','sales','salesList','proformas','stock','expensesQuick','dailyCashClosing'],
  sales_purchase:['dashboard','products','suppliers','sales','salesList','proformas','customers','purchases','stock','stockCount','composites','expensesQuick','dailyCashClosing'],
  warehouse:['dashboard','products','stock','stockCount','composites','transfers','purchases'],
  accountant:['dashboard','suppliers','ledger','payments','customers','expensesQuick','dailyCashClosing','finance','reports','auditLog'],
  viewer:['dashboard','products','stock','reports']
};
const SUPERVISOR_DISCOUNT_THRESHOLD=0.10;
let saleSupervisorApproved=false;
async function verifySupervisorCredentials(identifier,code){
  identifier=String(identifier||'').trim().toLowerCase(); code=String(code||'').trim();
  if(!identifier||!code) return false;
  const res=await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:SUPABASE_KEY,'Content-Type':'application/json'},body:JSON.stringify({email:staffEmail(identifier),password:code})});
  const data=await res.json().catch(()=>({}));
  if(!res.ok || !data.access_token) return false;
  const r=await fetch(`${SUPABASE_URL}/rest/v1/pos_user_roles?select=identifier,role,active&identifier=eq.${encodeURIComponent(identifier)}&limit=1`,{headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${data.access_token}`}});
  const rows=await r.json().catch(()=>[]);
  return r.ok && rows?.[0]?.role==='admin' && rows?.[0]?.active!==false;
}
async function requestSupervisorApproval(reason, details=''){
  if(currentRole?.role==='admin') return true;
  if(saleSupervisorApproved) return true;
  const id=prompt(`موافقة مدير مطلوبة\n${reason}\n${details?details+'\n':''}\nمعرّف المدير:`,'');
  if(id==null) return false;
  const code=prompt('كود المدير:','');
  if(code==null) return false;
  try{
    const ok=await verifySupervisorCredentials(id,code);
    if(!ok){toast('لم يتم اعتماد موافقة المدير','warn');return false;}
    saleSupervisorApproved=true;
    try{const log=JSON.parse(localStorage.getItem('posSupervisorApprovals')||'[]'); log.unshift({at:new Date().toISOString(),reason,details,approved_by:id,operator:appUser?.identifier||''}); localStorage.setItem('posSupervisorApprovals',JSON.stringify(log.slice(0,200)));}catch(e){}
    toast('تم اعتماد موافقة المدير','success');
    return true;
  }catch(e){console.error(e);toast('تعذر التحقق من المدير','error');return false;}
}
function getUserRole(){
  if(!appUser?.identifier) return null;
  return userRoles.find(r=>(r.identifier||'').toLowerCase()===appUser.identifier.toLowerCase()) || null;
}
async function ensureRoleAfterLogin(){
  let role=getUserRole();
  if(!role && userRoles.length===0){
    const created=await api('pos_user_roles',{method:'POST',body:{identifier:appUser.identifier,display_name:appUser.identifier,role:'admin',active:true,notes:'أول مستخدم - مدير تلقائي'}});
    userRoles.push(created[0]); role=created[0];
  }
  currentRole=role || {identifier:appUser.identifier,role:'viewer',active:true};
}
async function loginPOS(create=false){
  if(create){toast('إنشاء المستخدمين يتم من المدير فقط','warn');return;}
  const identifier=q('loginIdentifier').value.trim().toLowerCase(); const code=q('loginCode').value.trim();
  const branchSelect=q('loginBranch');
  const selectedBranch=branchSelect?.value||'';
  const selectedBranchText=branchSelect?.selectedOptions?.[0]?.textContent?.trim()||'';
  if(identifier.length<2||code.length<3){toast('اكتب المعرّف والكود','warn'); setLoginMessage('اكتب المعرّف والكود أولاً.','warn'); return;}
  if(!selectedBranch){toast('يجب اختيار الفرع قبل الدخول','warn'); setLoginMessage('اختر الفرع قبل الضغط على دخول.','warn'); return;}
  try{
    q('loginBtn')?.setAttribute('disabled','disabled');
    showLoading(true);
    const user=await authSignIn(identifier,code);
    await loadAll();
    const loc=resolveSelectedLoginBranch(selectedBranch, selectedBranchText);
    if(!loc){throw new Error('تعذر ربط الفرع المختار. حدّث الصفحة وحاول مرة أخرى.');}
    appUser={id:user.id,identifier,branch_id:loc.id,branch_name:loc.name}; localStorage.setItem('posUser',JSON.stringify(appUser));
    await ensureRoleAfterLogin(); updateAuthUI(); applyPermissions(); renderStatusBar(); renderCustomers(); toast(create?'تم إنشاء المستخدم والدخول':'تم الدخول','success');
  }catch(err){console.error(err);toast(create?'تعذر إنشاء المستخدم أو المعرّف موجود':'المعرّف أو الكود غير صحيح','error'); setLoginMessage(friendlyError(err),'error')}
  finally{showLoading(false);window.__busy=false; q('loginBtn')?.removeAttribute('disabled')}
}
function logoutPOS(){localStorage.removeItem('posUser'); localStorage.removeItem('posAuthSession'); appUser=null; authSession=null; currentRole=null; updateAuthUI(); q('loginScreen').classList.add('show'); loadLoginBranches(); q('loginIdentifier')?.focus()}
function updateAuthUI(){
  const logged=!!(appUser?.id && appUser?.branch_id && authSession?.access_token);
  document.body.classList.toggle('auth-locked',!logged);
  q('loginScreen').classList.toggle('show',!logged);
  q('userPill').classList.toggle('hidden',!logged);
  q('userLabel').textContent=logged?`${appUser.identifier} - ${ROLE_LABELS[currentRole?.role]||'بدون صلاحية'}${appUser.branch_name?' - '+appUser.branch_name:''}`:'';
}
function canTab(tab){return (ROLE_TABS[currentRole?.role]||[]).includes(tab)}
function tidyNavGroups(){
  document.querySelectorAll('nav .nav-group').forEach(g=>{
    let n=g.nextElementSibling, anyVisible=false;
    while(n && !n.classList.contains('nav-group')){ if(n.tagName==='BUTTON' && n.style.display!=='none'){anyVisible=true;break;} n=n.nextElementSibling; }
    g.style.display=anyVisible?'':'none';
  });
}
function canSelectSaleBranch(){return currentRole?.role==='admin'||currentRole?.role==='sales_purchase'}
function applyPermissions(){
  if(!appUser?.id){updateAuthUI();return;}
  currentRole=getUserRole()||currentRole||{role:'viewer'}; updateAuthUI();
  document.querySelectorAll('nav button[data-tab]').forEach(b=>{b.style.display=canTab(b.dataset.tab)?'block':'none'});
  tidyNavGroups(); initNavGroups();
  const active=document.querySelector('nav button.active');
  if(active && active.style.display==='none'){
    const first=[...document.querySelectorAll('nav button[data-tab]')].find(b=>b.style.display!=='none'); if(first) first.click();
  }
  const saleLoc=q('saleLocation');
  if(saleLoc){
    // الفرع يُحدَّد من تسجيل الدخول فقط ولا يمكن تغييره عند البيع
    saleLoc.disabled=true;
    if(appUser?.branch_id) saleLoc.value=appUser.branch_id;
  }
  // Branch sellers are locked to their branch in sales screen.
  if(currentRole?.role==='seller_11' || currentRole?.role==='seller_sarraj'){
    const wanted=currentRole.role==='seller_11'?'فرع 11 يونيو':'فرع السراج'; const loc=locations.find(l=>l.name===wanted);
    if(loc && q('saleLocation')){q('saleLocation').value=loc.id; q('saleLocation').disabled=true;}
  }
}
function renderRoles(){
  if(!q('rolesBody')) return;
  q('rolesBody').innerHTML=userRoles.map(r=>`<tr><td class="ltr"><b>${esc(r.identifier)}</b></td><td>${esc(r.display_name||'')}</td><td>${esc(ROLE_LABELS[r.role]||r.role)}</td><td>${r.active?'<span class="badge green">نشط</span>':'<span class="badge gray">متوقف</span>'}</td><td>${esc(r.notes||'')}</td><td><button class="btn secondary" onclick="editRole('${String(r.id).replace(/'/g,"\'")}')">تعديل</button></td></tr>`).join('') || '<tr><td colspan="6">لا توجد صلاحيات بعد. أول مستخدم يدخل يصبح مدير تلقائيًا.</td></tr>';
}
function editRole(id){
  const r=userRoles.find(x=>x.id===id); if(!r)return;
  q('roleIdentifier').value=r.identifier||''; q('roleDisplayName').value=r.display_name||''; q('roleName').value=r.role||'viewer'; q('roleNotes').value=r.notes||'';
}


function renderReorderAlerts(){
  const rows=products.filter(p=>Number(p.reorder_point||0)>0 && Number(p.total_stock||0)<=Number(p.reorder_point||0));
  if(q('reorderCount')) q('reorderCount').textContent=rows.length;
  if(q('reorderBody')) q('reorderBody').innerHTML=rows.slice(0,80).map(p=>`<tr><td class="ltr"><b>${esc(p.code)}</b></td><td>${esc(p.name)}</td><td><b>${money(p.total_stock)}</b></td><td>${money(p.reorder_point)}</td><td>${esc(p.supplier_name)}</td></tr>`).join('') || '<tr><td colspan="5">لا توجد أصناف تحت حد الطلب.</td></tr>';
}

function renderLocations(){
  q('locationsBody').innerHTML = locations.map(l=>`<tr><td><b>${esc(l.name)}</b></td><td>${esc(typeLabel(l.location_type))}</td><td>${l.is_sales_location?'<span class="badge green">نعم</span>':'<span class="badge yellow">لا</span>'}</td><td>${l.active?'<span class="badge green">نشط</span>':'<span class="badge gray">غير نشط</span>'}</td><td>${esc(l.notes||'')}</td></tr>`).join('') || '<tr><td colspan="5">لا توجد بيانات. شغل ملف SQL.</td></tr>';
}



function normText(v){
  return String(v==null?'':v).toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g,'')
    .replace(/[إأآا]/g,'ا').replace(/ى/g,'ي').replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/ة/g,'ه')
    .replace(/[ـ\-_/\\.,;:|()[\]{}+*؟?،]/g,' ')
    .replace(/\s+/g,' ').trim();
}
function editDistance(a,b,limit=2){
  a=normText(a); b=normText(b); if(a===b) return 0; if(Math.abs(a.length-b.length)>limit) return limit+1;
  const dp=Array(b.length+1).fill(0).map((_,i)=>i);
  for(let i=1;i<=a.length;i++){
    let prev=dp[0]; dp[0]=i; let best=dp[0];
    for(let j=1;j<=b.length;j++){
      const tmp=dp[j];
      dp[j]=Math.min(dp[j]+1,dp[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));
      prev=tmp; best=Math.min(best,dp[j]);
    }
    if(best>limit) return limit+1;
  }
  return dp[b.length];
}
function smartMatch(query, fields){
  const q=normText(query); if(!q) return true;
  const hay=normText(Array.isArray(fields)?fields.join(' '):fields);
  if(hay.includes(q)) return true;
  const hayWords=hay.split(' ').filter(Boolean);
  return q.split(' ').filter(Boolean).every(tok=>{
    if(!tok) return true;
    if(hay.includes(tok)) return true;
    const lim=tok.length>=7?2:(tok.length>=5?1:0);
    return hayWords.some(w=>w.startsWith(tok)||w.includes(tok)||(lim&&editDistance(tok,w,lim)<=lim));
  });
}
function productSearchFields(p){return [p.product_no,p.code,p.barcode,p.sku,p.item_no,p.name,p.brand,p.model,p.color,p.category,p.supplier_name]}

function renderProductDatalist(){
  const dl=q('productsDatalist');
  if(!dl) return;
  // Limit text length to keep the page fast, but include all products for selection.
  dl.innerHTML = products.map(p=>{
    const label = `${p.name||''} ${p.brand?'- '+p.brand:''} ${p.model?'- '+p.model:''} ${p.color?'- '+p.color:''} ${p.supplier_name?'- '+p.supplier_name:''}`.replace(/"/g,'&quot;');
    const value = `${p.code} | ${p.name||''}`.replace(/"/g,'&quot;');
    return `<option value="${value}" label="${label}"></option>`;
  }).join('');
  const cdl=q('categoryDatalist');
  if(cdl){
    const cats=[...new Set(products.map(p=>p.category).filter(Boolean))].sort();
    cdl.innerHTML=cats.map(c=>`<option value="${String(c).replace(/"/g,'&quot;')}"></option>`).join('');
  }
  const lists={brandDatalist:'brand',modelDatalist:'model',colorDatalist:'color'};
  const extra={brand:APP_CONFIG.customBrands||[],model:APP_CONFIG.customModels||[],color:APP_CONFIG.customColors||[]};
  Object.entries(lists).forEach(([id,key])=>{const el=q(id); if(el){const vals=[...new Set([...(products.map(p=>p[key]).filter(Boolean)),...(extra[key]||[])])].sort(); el.innerHTML=vals.map(v=>`<option value="${esc(v)}"></option>`).join('')}});
}
function findProductByInput(value){
  value=(value||'').trim();
  if(!value) return null;
  const codePart=value.includes('|') ? value.split('|')[0].trim() : value;
  return products.find(p=>String(p.code||'').toLowerCase()===codePart.toLowerCase())
      || products.find(p=>String(p.name||'').trim()===value)
      || null;
}
function fillPurchaseRow(input){
  const p=findProductByInput(input.value);
  if(!p) return;
  const tr=input.closest('tr');
  tr.querySelector('.pi-code').value=p.code||'';
  tr.querySelector('.pi-name').value=p.name||'';
  tr.querySelector('.pi-cost').value=Number(p.purchase_price||0);
  const brandModel=[p.brand,p.model].filter(Boolean).join(' / ');
  const note=tr.querySelector('.pi-product-note');
  if(note) note.textContent = [brandModel, p.supplier_name, p.category].filter(Boolean).join(' - ');
  updatePurchaseTotal();
}


let _productCatCounts=null, _productCatCountKey=-1;
function renderProductCategoryTree(activeCat=''){
  if(!q('productCategoryTree')) return;
  if(_productCatCountKey!==products.length){ _productCatCountKey=products.length; const counts={}; for(const p of products){const c=p.category||'بدون تصنيف'; counts[c]=(counts[c]||0)+1;} _productCatCounts=counts; }
  q('allProductsCountSide').textContent=products.length;
  q('productCategoryTree').innerHTML=Object.entries(_productCatCounts||{}).sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0],'ar')).map(([cat,count])=>`<div class="category-node ${activeCat===cat?'active':''}" onclick="selectProductCategory('${String(cat).replace(/'/g,"\'")}')"><span>${esc(cat)}</span><span class="count">${count}</span></div>`).join('');
}
function selectProductCategory(cat){
  q('productCategoryFilter').value=cat||'';
  renderProducts();
}

function buildProductSearchIndex(){ for(const p of products){ if(!p) continue; if(p._hay===undefined) p._hay=normText(productSearchFields(p).join(' ')); if(p._cost===undefined){ const c=productCost(p.code); p._cost=c; p._mv=Number(p.retail_price||0)-c; p._mp=(c>0)?(p._mv/c*100):0; } } }
let _renderProductsTimer=null;
function debounceRenderProducts(){ clearTimeout(_renderProductsTimer); _renderProductsTimer=setTimeout(renderProducts,180); }
function renderProducts(){
  const filterDefs=[['productCategoryFilter','category','كل التصنيفات'],['productBrandFilter','brand','كل الماركات'],['productColorFilter','color','كل الألوان'],['productSupplierFilter','supplier_name','كل الموردين']];
  filterDefs.forEach(([id,key,label])=>{const el=q(id); if(el && !el.dataset.ready){const vals=[...new Set(products.map(p=>p[key]).filter(Boolean))].sort(); el.innerHTML=`<option value="">${label}</option>`+vals.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join(''); el.dataset.ready='1';}});
  if(q('productBottomSearch')) q('productBottomSearch').value=q('productSearch')?.value||'';
  const term=(q('productSearch')?.value||'').trim().toLowerCase();
  const cat=q('productCategoryFilter')?.value||'', brand=q('productBrandFilter')?.value||'', color=q('productColorFilter')?.value||'', supplier=q('productSupplierFilter')?.value||'';
  renderProductCategoryTree(cat);
  if(products.length && products[0]._hay===undefined) buildProductSearchIndex();
  const normTerm=normText(term);
  const rows=products.filter(p=>{
    return (!cat || p.category===cat) && (!brand || p.brand===brand) && (!color || p.color===color) && (!supplier || p.supplier_name===supplier) && (!normTerm || (p._hay||'').includes(normTerm));
  });
  const productCols=['product_no','code','name','brand','color','barcode','supplier_name','category','purchase_price','retail_price','margin_value','margin_pct','reorder_point','stock_11_june','stock_sarraj','stock_janzour','total_stock'];
  const key=productCols[productSortIndex]||'total_stock';
  rows.sort((a,b)=>{const va=key==='margin_value'?a._mv:(key==='margin_pct'?a._mp:(a[key]??'')), vb=key==='margin_value'?b._mv:(key==='margin_pct'?b._mp:(b[key]??'')); const na=parseFloat(va), nb=parseFloat(vb); const c=(!isNaN(na)&&!isNaN(nb))?na-nb:String(va).localeCompare(String(vb),'ar'); return productSortDir==='asc'?c:-c;});
  const shown=rows.slice(0,100);
  q('productsBody').innerHTML = shown.map(p=>{const safe=String(p.code||'').replace(/'/g,"\\'"); const isComp=isCompositeProduct(p.code); const vS=isComp?getCompositeVirtualStock(p.code):null; const nm=isComp?esc(p.name)+' <span style="background:#ede9fe;color:#6d28d9;border-radius:6px;padding:1px 6px;font-size:10px;font-weight:800">مركّب</span>':esc(p.name); const s1=isComp?'<span style="color:#8b5cf6">—</span>':money(p.stock_11_june); const s2=isComp?'<span style="color:#8b5cf6">—</span>':money(p.stock_sarraj); const s3=isComp?'<span style="color:#8b5cf6">—</span>':money(p.stock_janzour); const st=isComp?('<b style="color:#7c3aed;background:#ede9fe;border-radius:6px;padding:2px 8px">'+(vS!==null?vS:0)+'</b>'):('<b>'+money(p.total_stock)+'</b>'); return `<tr class="${selectedProductCode===p.code?'selected-row':''}" onclick="selectProductRow('${safe}')"><td class="ltr">${esc(p.product_no)}</td><td class="ltr"><b>${esc(p.code)}</b></td><td>${nm}</td><td>${esc(p.brand)}<div class="mini ltr">${esc(p.model)}</div></td><td>${esc(p.color)}</td><td class="ltr">${esc(p.barcode)}</td><td>${esc(p.supplier_name)}</td><td>${esc(p.category)}</td><td>${money(p.purchase_price)}</td><td>${money(p.retail_price)}</td><td>${money(p._mv)}</td><td>${money(p._mp)}%</td><td>${money(p.reorder_point)}</td><td>${s1}</td><td>${s2}</td><td>${s3}</td><td>${st}</td></tr>`}).join('') || '<tr><td colspan="17">لا توجد منتجات.</td></tr>';
  const sp=selectedProductCode?products.find(p=>p.code===selectedProductCode):null;
  if(q('selectedProductInfo')) q('selectedProductInfo').textContent=sp?`المحدد: ${sp.code} - ${sp.name}`:'اختر منتجًا من الجدول أولاً';
  q('productsInfo').textContent = `عرض ${shown.length} من ${rows.length} منتج` + (rows.length>100 ? ' - اكتب في البحث لتضييق النتائج' : '');
}



function selectProductRow(code){selectedProductCode=code; renderProducts()}
function getSelectedProduct(){
  const p=products.find(x=>String(x.code)===String(selectedProductCode));
  if(!p){toast('اختر منتجًا من الجدول أولاً'); return null;}
  return p;
}
function editSelectedProduct(){const p=getSelectedProduct(); if(p) editProduct(p.code)}
function openSelectedProductMovements(){const p=getSelectedProduct(); if(p) openProductMovements(p.code)}
function viewSelectedProduct(){
  const p=getSelectedProduct(); if(!p) return;
  q('productViewTitle').textContent=p.name||'مشاهدة المنتج';
  q('productViewSub').textContent=p.code||'';
  q('productViewBody').innerHTML=`<div class="grid cards" style="grid-template-columns:repeat(2,minmax(0,1fr))">
    <div class="card"><h3>الكود</h3><div class="ltr"><b>${esc(p.code||'')}</b></div></div>
    <div class="card"><h3>التصنيف</h3><div>${esc(p.category||'')}</div></div>
    <div class="card"><h3>الماركة</h3><div>${esc(p.brand||'')}</div></div>
    <div class="card"><h3>الموديل</h3><div class="ltr">${esc(p.model||'')}</div></div>
    <div class="card"><h3>اللون</h3><div>${esc(p.color)}</div></div>
    <div class="card"><h3>الباركود</h3><div class="ltr">${esc(p.barcode)}</div></div>
    <div class="card"><h3>حد الطلب</h3><div class="num">${money(p.reorder_point)}</div></div>
    <div class="card"><h3>المورد</h3><div>${esc(p.supplier_name)}</div></div>
    <div class="card"><h3>سعر الشراء</h3><div class="num">${money(p.purchase_price)}</div></div>
    <div class="card"><h3>سعر البيع</h3><div class="num">${money(p.retail_price)}</div></div>
    <div class="card"><h3>فرع 11 يونيو</h3><div class="num">${money(p.stock_11_june)}</div></div>
    <div class="card"><h3>فرع السراج</h3><div class="num">${money(p.stock_sarraj)}</div></div>
    <div class="card"><h3>مخزن جنزور</h3><div class="num">${money(p.stock_janzour)}</div></div>
    <div class="card"><h3>الإجمالي</h3><div class="num">${money(p.total_stock)}</div></div>
  </div>`;
  q('productViewModal').classList.add('show');
}
function closeProductViewModal(){q('productViewModal').classList.remove('show')}
function fillPickerSelect(id,key,label){
  const el=q(id); if(!el) return;
  const old=el.value;
  const vals=[...new Set(products.map(p=>p[key]).filter(Boolean))].sort();
  el.innerHTML=`<option value="">${label}</option>`+vals.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
  if(vals.includes(old)) el.value=old;
}
async function openPriceCheckerCarts(){
  try{
    showLoading(true);
    priceCheckerCarts=await rpc('pos_get_branch_pricechecker_carts',{p_dummy:{}});
    q('priceCheckerCartsModal').classList.add('show');
    renderPriceCheckerCarts();
    setTimeout(()=>q('priceCartSearch')?.focus(),50);
  }catch(e){console.error(e);toast('تعذر تحميل سلات الباحث: '+friendlyError(e),'error')}
  finally{showLoading(false);window.__busy=false}
}
function closePriceCheckerCarts(){q('priceCheckerCartsModal')?.classList.remove('show')}
function renderPriceCheckerCarts(){
  const term=normText(q('priceCartSearch')?.value||'');
  const rows=(priceCheckerCarts||[]).filter(c=>!term||normText([c.customer_name,c.customer_phone,c.owner_identifier].join(' ')).includes(term));
  q('priceCheckerCartsBody').innerHTML=rows.map(c=>{const items=Array.isArray(c.items)?c.items:[]; return `<tr><td>${esc(c.customer_name||'زبون نقدي')}</td><td class="ltr">${esc(c.customer_phone||'')}</td><td>${esc(c.owner_identifier||'')}</td><td>${items.length}</td><td><b>${money(c.total)}</b></td><td>${esc((c.updated_at||'').replace('T',' ').slice(0,19))}</td><td><button class="btn secondary" type="button" onclick="loadPriceCheckerCart('${c.id}')">فتح</button></td></tr>`}).join('')||'<tr><td colspan="7">لا توجد سلات مفتوحة.</td></tr>';
}
function loadPriceCheckerCart(id){
  const c=(priceCheckerCarts||[]).find(x=>x.id===id); if(!c)return;
  if(saleHasContent()&&!confirm('سيتم استبدال الفاتورة الحالية بهذه السلة. متابعة؟'))return;
  suppressSaleDraftSave=true;
  sourcePriceCheckerCartId=id;
  openTab('sales');
  q('saleItemsBody').innerHTML='';
  const phone=String(c.customer_phone||'').replace(/[^0-9+]/g,'');
  const existing=customers.find(x=>String(x.phone||'').replace(/[^0-9+]/g,'')===phone && phone);
  q('saleCustomer').value=existing?.id||'';
  q('saleNewCustomerName').value=existing?'':(c.customer_name||'');
  q('saleNewCustomerPhone').value=existing?'':(c.customer_phone||'');
  q('saleNotes').value=c.notes||'';
  q('saleDiscount').value=Number(c.discount_percent||0);
  const items=Array.isArray(c.items)?c.items:[];
  items.forEach(it=>addSaleRow({product_code:it.product_code,product_name:it.product_name,qty:Number(it.quantity||1),unit_price:Number(it.unit_price||0),discount_text:''}));
  updateSaleTotal(); refreshSaleAvailability(); renderSaleCustomerInfo();
  suppressSaleDraftSave=false; saveActiveSaleDraft();
  closePriceCheckerCarts();
  toast('تم فتح السلة في فاتورة البيع ويمكن تعديلها','success');
}
function openSaleProductPicker(){
  productPickerTarget='sale';
  if(q('saleLocation') && appUser?.branch_id) q('saleLocation').value=appUser.branch_id; if(!q('saleLocation').value){toast('اختر فرع البيع أولاً'); return;}
  fillPickerSelect('salePickerCategory','category','كل التصنيفات');
  fillPickerSelect('salePickerBrand','brand','كل الماركات');
  fillPickerSelect('salePickerColor','color','كل الألوان');
  fillPickerSelect('salePickerSupplier','supplier_name','كل الموردين');
  q('salePickerQty').value=q('salePickerQty').value||'1';
  pickerSelectedIndex=-1;
  q('saleProductPickerModal').classList.add('show');
  renderSaleProductPicker();
  setTimeout(()=>q('salePickerSearch')?.focus(),50);
}
function closeSaleProductPicker(){q('saleProductPickerModal').classList.remove('show')}
function openProformaProductPicker(){
  productPickerTarget='proforma';
  if(!q('proformaLocation').value){toast('اختر الفرع أولاً'); return;}
  fillPickerSelect('salePickerCategory','category','كل التصنيفات');
  fillPickerSelect('salePickerBrand','brand','كل الماركات');
  fillPickerSelect('salePickerColor','color','كل الألوان');
  fillPickerSelect('salePickerSupplier','supplier_name','كل الموردين');
  q('salePickerQty').value=q('salePickerQty').value||'1';
  pickerSelectedIndex=-1;
  q('saleProductPickerModal').classList.add('show');
  renderSaleProductPicker();
  setTimeout(()=>q('salePickerSearch')?.focus(),50);
}

function openPurchaseProductPicker(){
  productPickerTarget='purchase';
  if(!q('purchaseLocation').value){toast('اختر مكان دخول البضاعة أولاً'); return;}
  fillPickerSelect('salePickerCategory','category','كل التصنيفات');
  fillPickerSelect('salePickerBrand','brand','كل الماركات');
  fillPickerSelect('salePickerColor','color','كل الألوان');
  fillPickerSelect('salePickerSupplier','supplier_name','كل الموردين');
  q('salePickerQty').value=q('salePickerQty').value||'1';
  pickerSelectedIndex=-1;
  q('saleProductPickerModal').classList.add('show');
  renderSaleProductPicker();
  setTimeout(()=>q('salePickerSearch')?.focus(),50);
}

function openTransferProductPicker(){
  productPickerTarget='transfer';
  if(!q('transferFrom').value){toast('اختر الفرع / المخزن المصدر أولاً'); return;}
  fillPickerSelect('salePickerCategory','category','كل التصنيفات');
  fillPickerSelect('salePickerBrand','brand','كل الماركات');
  fillPickerSelect('salePickerColor','color','كل الألوان');
  fillPickerSelect('salePickerSupplier','supplier_name','كل الموردين');
  q('salePickerQty').value=q('salePickerQty').value||'1';
  pickerSelectedIndex=-1;
  q('saleProductPickerModal').classList.add('show');
  renderSaleProductPicker();
  setTimeout(()=>q('salePickerSearch')?.focus(),50);
}

function renderSaleProductPicker(){
  const term=(q('salePickerSearch')?.value||'').trim().toLowerCase();
  const cat=q('salePickerCategory')?.value||'', brand=q('salePickerBrand')?.value||'', color=q('salePickerColor')?.value||'', supplier=q('salePickerSupplier')?.value||'';
  const rows=products.filter(p=>{
    return (!cat||p.category===cat)&&(!brand||p.brand===brand)&&(!color||p.color===color)&&(!supplier||p.supplier_name===supplier)&&smartMatch(term, productSearchFields(p));
  });
  const pickerCols=['code','name','brand','color','supplier_name','available','retail_price','margin_value','margin_pct'];
  const key=pickerCols[pickerSortIndex]||'available';
  const loc=(productPickerTarget==='proforma'?q('proformaLocation')?.value:(productPickerTarget==='purchase'?q('purchaseLocation')?.value:(productPickerTarget==='transfer'?q('transferFrom')?.value:(canSelectSaleBranch()?q('saleLocation')?.value:(appUser?.branch_id||q('saleLocation')?.value)))))||'';
  rows.sort((a,b)=>{const av=key==='available'?getStockQty(loc,a.code):(key==='margin_value'?marginValue(a.code,a.retail_price):(key==='margin_pct'?marginPct(a.code,a.retail_price):(a[key]??''))); const bv=key==='available'?getStockQty(loc,b.code):(key==='margin_value'?marginValue(b.code,b.retail_price):(key==='margin_pct'?marginPct(b.code,b.retail_price):(b[key]??''))); const na=parseFloat(av), nb=parseFloat(bv); const c=(!isNaN(na)&&!isNaN(nb))?na-nb:String(av).localeCompare(String(bv),'ar'); return pickerSortDir==='asc'?c:-c;});
  const shown=rows.slice(0,250);
  if(!shown.length) pickerSelectedIndex=-1; else if(pickerSelectedIndex>=shown.length) pickerSelectedIndex=shown.length-1;
  q('salePickerBody').innerHTML=shown.map((p,i)=>{const safe=String(p.code||'').replace(/'/g,"\\'"); const available=loc?getStockQty(loc,p.code):0; return `<tr class="${i===pickerSelectedIndex?'selected-row':''}" onclick="selectSalePickerRow(${i},this)" ondblclick="addSaleProductFromPicker('${safe}',1)"><td class="ltr"><b>${esc(p.code||'')}</b><div class="mini ltr">${esc(p.barcode||p.product_no||'')}</div></td><td>${esc(p.name)}</td><td>${esc(p.brand)}<div class="mini ltr">${esc(p.model)}</div></td><td>${esc(p.color)}</td><td>${esc(p.supplier_name)}</td><td class="${available>0?'stock-positive':available<0?'stock-negative':''}"><b>${money(available)}</b></td><td>${money(p.retail_price)}</td><td>${money(p._mv)}</td><td>${money(p._mp)}%</td><td><button class="btn secondary" type="button" onclick="event.stopPropagation();addSaleProductFromPicker('${safe}')">إضافة</button></td></tr>`}).join('') || '<tr><td colspan="10">لا توجد منتجات مطابقة للبحث أو الفلاتر.</td></tr>';
  q('salePickerInfo').textContent=`عرض ${shown.length} من ${rows.length} منتج` + (rows.length>250?' - استخدم البحث أو الفلاتر لتضييق النتائج':'');
  setupTableSorting();
}

function selectSalePickerRow(index,tr){
  pickerSelectedIndex=index;
  q('salePickerBody')?.querySelectorAll('tr').forEach(r=>r.classList.remove('selected-row'));
  tr?.classList.add('selected-row');
}

function handleSalePickerKey(e){
  const rows=[...q('salePickerBody').querySelectorAll('tr')];
  if(e.key==='ArrowDown'){e.preventDefault();pickerSelectedIndex=Math.min(rows.length-1,pickerSelectedIndex+1);renderSaleProductPicker();}
  if(e.key==='ArrowUp'){e.preventDefault();pickerSelectedIndex=Math.max(0,pickerSelectedIndex-1);renderSaleProductPicker();}
  if(e.key==='Enter'){e.preventDefault();const btn=q('salePickerBody').querySelectorAll('button')[pickerSelectedIndex]; if(btn) btn.click();}
}

function addSaleProductFromPicker(code,qtyOverride=null){
  const p=products.find(x=>String(x.code)===String(code)); if(!p){toast('لم يتم العثور على المنتج'); return;}
  const qty=Number((qtyOverride ?? q('salePickerQty').value) || 1);
  if(productPickerTarget==='proforma') addOrIncrementProformaProduct(p,qty); else if(productPickerTarget==='purchase') addOrIncrementPurchaseProduct(p,qty); else if(productPickerTarget==='transfer') addOrIncrementTransferProduct(p,qty); else addOrIncrementSaleProduct(p,qty);
  q('salePickerQty').value='1';
  toast('تمت إضافة المنتج للفاتورة');
}

function resetProductForm(){
  editingProductComponents=[]; if(q('productComponentsBody'))renderProductComponents(); const psec=q('productComponentsSection'); if(psec)psec.classList.add('hidden');
  productFormMode='create'; editingProductCode=null;
  q('productForm').reset(); q('productPurchasePrice').value=0; q('productRetailPrice').value=0; q('productReorderPoint').value=0;
  q('productSubmitBtn').textContent='حفظ المنتج'; q('productCode').readOnly=false;
}
function editProduct(code){
  const p=products.find(x=>String(x.code)===String(code)); if(!p){toast('لم يتم العثور على المنتج'); return;}
  productFormMode='edit'; editingProductCode=p.code;
  document.querySelector('[data-tab="products"]').click();
  q('productCode').value=p.code||''; q('productName').value=p.name||''; q('productCategory').value=p.category||'';
  q('productBrand').value=p.brand||''; q('productModel').value=p.model||''; q('productColor').value=p.color||''; q('productBarcode').value=p.barcode||''; q('productReorderPoint').value=Number(p.reorder_point||0); q('productPurchasePrice').value=Number(p.purchase_price||0); q('productRetailPrice').value=Number(p.retail_price||0); q('productWholesalePrice').value=Number(p.wholesale_price||0);
  editingProductComponents=compositeItems.filter(ci=>ci.composite_code===p.code).map(ci=>({code:ci.component_code,name:ci.component_name||ci.component_code,qty:Number(ci.qty||1)}));
  renderProductComponents();
  const sec=q('productComponentsSection'); if(sec)sec.classList.toggle('hidden',!editingProductComponents.length);
  const sup=suppliers.find(s=>s.name===p.supplier_name); q('productSupplier').value=sup?.id||'';
  q('productSubmitBtn').textContent='حفظ تعديل المنتج';
  q('productCode').readOnly=true;
  q('productName').focus();
}


function nextProductCodeFrom(baseCode){
  const m=String(baseCode||'').match(/^(.*?)(\d+)$/);
  if(!m) return String(baseCode||'')+'-COPY';
  const prefix=m[1], width=m[2].length; let n=Number(m[2])+1;
  const used=new Set(products.map(p=>String(p.code||'').toLowerCase()));
  let code='';
  do{code=prefix+String(n).padStart(width,'0'); n++;}while(used.has(code.toLowerCase()));
  return code;
}
function duplicateProduct(code){
  const p=products.find(x=>String(x.code)===String(code)); if(!p){toast('اختر منتجًا أولاً','warn'); return;}
  productFormMode='duplicate'; editingProductCode=null;
  document.querySelector('[data-tab="products"]').click();
  q('productCode').readOnly=false;
  q('productCode').value=nextProductCodeFrom(p.code);
  q('productName').value=p.name||'';
  q('productCategory').value=p.category||'';
  q('productBrand').value=p.brand||'';
  q('productModel').value=p.model||'';
  q('productColor').value=p.color||'';
  q('productBarcode').value=p.barcode||'';
  q('productReorderPoint').value=Number(p.reorder_point||0);
  q('productPurchasePrice').value=Number(p.purchase_price||0);
  q('productRetailPrice').value=Number(p.retail_price||0);
  const sup=suppliers.find(s=>s.name===p.supplier_name); q('productSupplier').value=sup?.id||'';
  q('productSubmitBtn').textContent='حفظ المنتج المنسوخ';
  q('productCode').focus(); q('productCode').select();
  toast('تم نسخ بيانات المنتج. راجع الكود والباركود ثم احفظ.','success');
}
function duplicateSelectedProduct(){const p=getSelectedProduct(); if(p) duplicateProduct(p.code); else toast('اختر منتجًا من الجدول أولاً','warn')}

function movementDocInfo(m){
  const table=m.reference_table||''; const id=m.reference_id||''; let doc=null, no='', seller=(String(m.notes||'').match(/المستخدم:\s*([^|]+)/)?.[1]?.trim()||'غير مسجل'), branch='';
  if(table==='pos_sales'){
    doc=sales.find(x=>x.id===id); no=doc?.invoice_no||doc?.id?.slice(0,8)||id?.slice(0,8)||''; branch=locations.find(l=>l.id===doc?.location_id)?.name||'';
  }else if(table==='pos_purchases'){
    doc=purchases.find(x=>x.id===id); no=doc?.invoice_no||doc?.id?.slice(0,8)||id?.slice(0,8)||''; branch=locations.find(l=>l.id===doc?.location_id)?.name||'';
  }else if(table==='pos_stock_transfers'){
    doc=transfers.find(x=>x.id===id); no=doc?.id?.slice(0,8)||id?.slice(0,8)||''; const from=locations.find(l=>l.id===doc?.from_location_id)?.name||''; const to=locations.find(l=>l.id===doc?.to_location_id)?.name||''; branch=from&&to?`${from} ← ${to}`:'';
  }else if(table==='pos_sale_returns'){
    doc=saleReturns.find(x=>x.id===id); no=doc?.id?.slice(0,8)||id?.slice(0,8)||''; branch=locations.find(l=>l.id===doc?.location_id)?.name||'';
  }
  if(!branch) branch=locations.find(l=>l.id===m.location_id)?.name||'';
  return {no,seller,branch,table,id};
}
function openMovementDocument(table,id){
  if(!table||!id){toast('لا يوجد مستند مرتبط بهذه الحركة','warn');return;}
  if(table==='pos_sales') return openSaleForEdit(id);
  if(table==='pos_purchases') return openPurchaseForEdit(id);
  if(table==='pos_stock_transfers') return openTransferForEdit(id);
  if(table==='pos_sale_returns') return toast('هذه الحركة مرتبطة بفاتورة مرتجع. افتح فاتورة البيع الأصلية من فواتير البيع.','info');
  toast('نوع المستند غير معروف','warn');
}

async function openProductMovements(code){
  try{
    showLoading(true);
    const p=products.find(x=>String(x.code)===String(code));
    q('movementsTitle').textContent='حركات الصنف: '+code;
    q('movementsSub').textContent=p ? (p.name||'') : '';
    const rows=await api('pos_stock_movements',{qs:`?select=*&product_code=eq.${encodeURIComponent(code)}&order=movement_date.desc&limit=300`});
    q('movementsBody').innerHTML = rows.map(m=>{
      const qty=Number(m.qty_change||0); const info=movementDocInfo(m); const table=String(info.table||'').replace(/'/g,"\'"); const id=String(info.id||'').replace(/'/g,"\'");
      return `<tr data-ref-table="${esc(info.table)}" data-ref-id="${esc(info.id)}" ondblclick="openMovementDocument('${table}','${id}')"><td>${esc((m.movement_date||m.created_at||'').replace('T',' ').slice(0,19))}</td><td>${esc(typeLabel(m.movement_type))}</td><td class="ltr"><b>${esc(info.no)}</b></td><td>${esc(info.seller)}</td><td>${esc(info.branch)}</td><td class="${qty>0?'stock-positive':qty<0?'stock-negative':''}"><b>${money(qty)}</b></td><td>${esc(m.notes)}</td></tr>`;
    }).join('') || '<tr><td colspan="7">لا توجد حركات لهذا الصنف حتى الآن. ملاحظة: المخزون المستورد كبداية لا يظهر كحركة شراء.</td></tr>';
    q('movementsModal').classList.add('show');
  }catch(err){console.error(err);toast('خطأ في تحميل حركات الصنف: '+err.message)} finally{showLoading(false);window.__busy=false}
}
function closeMovementsModal(){q('movementsModal').classList.remove('show')}
function productStockSummaryText(code,mode='all'){
  const clean=String(code||'').split(/\s+/)[0].trim();
  const p=productByCode(clean)||products.find(x=>String(x.code||'').toLowerCase()===clean.toLowerCase());
  const productCode=p?.code||clean;
  const rows=stock.filter(st=>String(st.product_code||'').toLowerCase()===String(productCode||'').toLowerCase());
  const wanted=rows.filter(st=>{const l=locations.find(x=>x.id===st.location_id); if(mode==='branches') return l?.location_type==='branch'||l?.is_sales_location; if(mode==='warehouses') return l?.location_type==='warehouse'; return true;});
  let lines=wanted.map(st=>{const l=locations.find(x=>x.id===st.location_id); return `${l?.name||st.location_id}: ${money(st.qty)}`;});
  if(!lines.length && p){
    const fallback=[['فرع 11 يونيو',p.stock_11_june],['فرع السراج',p.stock_sarraj],['مخزن جنزور',p.stock_janzour],['الإجمالي',p.total_stock]].filter(x=>Number(x[1]||0)!==0);
    lines=fallback.map(x=>`${x[0]}: ${money(x[1])}`);
  }
  return `${p?.name||productCode}
الكود: ${productCode}
سعر الشراء: ${money(productCost(productCode))} ${APP_CONFIG.currency}
سعر البيع: ${money(p?.retail_price||0)} ${APP_CONFIG.currency}

${lines.join(String.fromCharCode(10))||'لا يوجد رصيد مخزون مسجل لهذا الصنف.'}`;
}
function showProductStockSummary(code,mode='all'){setTimeout(()=>alert(productStockSummaryText(code,mode)),50);}
function viewProductFromCode(code){selectedProductCode=code; setTimeout(()=>viewSelectedProduct(),50);}

function renderSuppliers(){
  const term=(q('supplierSearch')?.value||'').trim();
  const rows=suppliers.filter(s=>!term || (s.name||'').includes(term) || (s.phone||'').includes(term));
  q('suppliersBody').innerHTML = rows.map(s=>`<tr><td><b>${esc(s.name)}</b><div class="muted">${esc(s.notes||'')}</div></td><td class="ltr">${esc(s.phone||'')}</td><td><b>${money(s.balance)}</b></td><td>${badgeStatus(s.balance)}</td><td><button class="btn secondary" onclick="openLedger('${String(s.id).replace(/'/g,"\'")}')">كشف الحساب</button></td></tr>`).join('') || '<tr><td colspan="5">لا يوجد موردون بعد.</td></tr>';
}

function badgeCustomer(balance){
  balance=Number(balance||0);
  if(balance>0) return `<span class="badge red">على الزبون</span>`;
  if(balance<0) return `<span class="badge green">للزبون رصيد</span>`;
  return `<span class="badge gray">متوازن</span>`;
}
function renderCustomers(){
  const term=(q('customerSearch')?.value||'').trim();
  const showInactive=q('customerShowInactive')?.checked;
  const isAdmin=currentRole?.role==='admin';
  const rows=customers.filter(c=>(!term || (c.name||'').includes(term) || (c.phone||'').includes(term)) && (showInactive || c.active!==false));
  q('customersBody').innerHTML = rows.map(c=>{
    const inactive=c.active===false;
    const actions=[`<button class="btn secondary" onclick="openCustomerLedger('${c.id}')">كشف الحساب</button>`,`<button class="btn secondary" onclick="editCustomer('${c.id}')">تعديل</button>`];
    if(inactive) actions.push(`<button class="btn" onclick="toggleCustomerActive('${c.id}',true)">تفعيل</button>`);
    else if(isAdmin) actions.push(`<button class="btn danger" onclick="deleteCustomer('${c.id}')">حذف</button>`);
    return `<tr${inactive?' style="opacity:.55"':''}><td class="ltr"><b>${esc(c.customer_no)}</b></td><td><b>${c.name}</b>${inactive?' <span class="badge gray">معطّل</span>':''}<div class="muted">${c.notes||''}</div></td><td class="ltr">${c.phone||''}</td><td>${c.address||''}</td><td><b>${money(c.balance)}</b></td><td>${badgeCustomer(c.balance)}</td><td><div class="row">${actions.join('')}</div></td></tr>`;
  }).join('') || '<tr><td colspan="7">لا يوجد زبائن بعد.</td></tr>';
}
function openCustomerLedger(id){document.querySelector('[data-tab="customers"]').click(); q('customerLedgerCustomer').value=id; renderCustomerLedger()}
function renderCustomerLedger(){
  const cid=q('customerLedgerCustomer')?.value||'';
  const rows=customerLedger.filter(l=>l.customer_id===cid).sort((a,b)=> new Date(a.entry_date+'T00:00:00')-new Date(b.entry_date+'T00:00:00') || new Date(a.created_at)-new Date(b.created_at));
  let running=0;
  const rendered=rows.map(l=>{running += Number(l.debit||0)-Number(l.credit||0); return `<tr><td>${esc(l.entry_date)}</td><td>${esc(typeLabel(l.entry_type))}</td><td>${esc(l.description||'')}</td><td>${money(l.debit)}</td><td>${money(l.credit)}</td><td><b>${money(running)}</b></td></tr>`}).reverse().join('');
  const bal=rows.reduce((a,l)=>a+Number(l.debit||0)-Number(l.credit||0),0);
  q('customerLedgerBalance').textContent=money(bal); q('customerLedgerStatus').innerHTML=badgeCustomer(bal);
  q('customerLedgerBody').innerHTML = cid ? (rendered || '<tr><td colspan="6">لا توجد حركات لهذا الزبون.</td></tr>') : '<tr><td colspan="6">اختر الزبون أولاً.</td></tr>';
}

function fillSupplierSelects(){
  const options = '<option value="">اختر المورد</option>' + suppliers.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  q('ledgerSupplier').innerHTML = options;
  q('paymentSupplier').innerHTML = options;
  q('purchaseSupplier').innerHTML = options;
  q('productSupplier').innerHTML = '<option value="">بدون مورد</option>' + suppliers.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  const locOptions = '<option value="">اختر المكان</option>' + locations.map(l=>`<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');
  if(q('loginBranch')){const prev=q('loginBranch').value||appUser?.branch_id||''; q('loginBranch').innerHTML='<option value="">اختر الفرع</option>'+locations.filter(l=>l.is_sales_location).map(l=>`<option value="${esc(l.id)}">${esc(l.name)}</option>`).join(''); if(prev) q('loginBranch').value=prev;}
  q('purchaseLocation').innerHTML = locOptions;
  q('transferFrom').innerHTML = locOptions;
  q('transferTo').innerHTML = locOptions;
  q('stockLocationFilter').innerHTML = '<option value="">كل الفروع والمخازن</option>' + locations.map(l=>`<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');
  q('saleLocation').innerHTML = '<option value="">اختر فرع البيع</option>' + locations.filter(l=>l.is_sales_location).map(l=>`<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');
  const savedLoc=localStorage.getItem('posLastSaleLocation');
  if(savedLoc && [...q('saleLocation').options].some(o=>o.value===savedLoc)) q('saleLocation').value=savedLoc;
  q('saleCustomer').innerHTML = '<option value="">زبون نقدي / بدون زبون</option>' + customers.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}${c.phone?' - '+esc(c.phone):''}${Number(c.balance||0)>0?' - دين '+money(c.balance):''}</option>`).join('');
  if(q('proformaCustomer')) q('proformaCustomer').innerHTML = '<option value="">بدون زبون</option>' + customers.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}${c.phone?' - '+esc(c.phone):''}</option>`).join('');
  if(q('proformaLocation')) q('proformaLocation').innerHTML = '<option value="">اختر الفرع</option>' + locations.filter(l=>l.is_sales_location).map(l=>`<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');
  const customerOptions = '<option value="">اختر الزبون</option>' + customers.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}${c.phone?' - '+esc(c.phone):''}</option>`).join('');
  q('customerPaymentCustomer').innerHTML = customerOptions;
  q('customerLedgerCustomer').innerHTML = customerOptions;
  q('reportLocation').innerHTML = '<option value="">كل الفروع</option>' + locations.map(l=>`<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');
  if(q('paymentFinanceAccount')) q('paymentFinanceAccount').innerHTML=financeAccountOptionsFor(q('paymentMethod')?.value||'cash','تلقائي حسب الطريقة');
  if(q('customerPaymentFinanceAccount')) q('customerPaymentFinanceAccount').innerHTML=financeAccountOptionsFor(q('customerPaymentMethod')?.value||'cash','تلقائي حسب الطريقة');

  const accountOpts='<option value="">اختر الحساب</option>'+financeAccounts.map(a=>`<option value="${esc(a.id)}">${esc(a.name)} - ${money(a.balance)}</option>`).join('');
  ['financeTransferFrom','financeTransferTo','salaryAccount'].forEach(id=>{if(q(id)) q(id).innerHTML=accountOpts});
  if(q('financeAccountLocation')) q('financeAccountLocation').innerHTML='<option value="">بدون فرع / عام</option>'+locations.map(l=>`<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');
  if(q('expenseLocation')){q('expenseLocation').innerHTML='<option value="">اختر الفرع</option>'+locations.filter(l=>l.is_sales_location||l.location_type==='branch').map(l=>`<option value="${esc(l.id)}">${esc(l.name)}</option>`).join(''); if(appUser?.branch_id) q('expenseLocation').value=appUser.branch_id; q('expenseLocation').disabled=true;}
  if(q('expenseCategory')) q('expenseCategory').innerHTML='<option value="">بدون تصنيف</option>'+expenseCategories.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  selectDefaultExpenseAccount();
  if(q('salaryEmployee')) q('salaryEmployee').innerHTML='<option value="">اختر الموظف</option>'+employees.map(e=>`<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');
  if(q('saleCashAccount')) q('saleCashAccount').innerHTML='<option value="">خزينة الفرع تلقائيًا</option>'+financeAccounts.filter(a=>a.account_type==='cash').map(a=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
  if(q('saleBankAccount')) q('saleBankAccount').innerHTML=financeAccountOptionsFor('bank_transfer','اختر مصرف التحويل');
  if(q('saleCardAccount')) q('saleCardAccount').innerHTML=financeAccountOptionsFor('card','اختر حساب البطاقة');
  if(q('purchaseFinanceAccount')) q('purchaseFinanceAccount').innerHTML=financeAccountOptionsFor(q('purchasePaymentMethod')?.value||'cash','تلقائي حسب الطريقة');
}
function openLedger(id){document.querySelector('[data-tab="ledger"]').click(); q('ledgerSupplier').value=id; renderLedger()}
function renderLedger(){
  const sid=q('ledgerSupplier').value;
  const rows = ledger.filter(l=>l.supplier_id===sid).sort((a,b)=> new Date(a.entry_date+'T00:00:00')-new Date(b.entry_date+'T00:00:00') || new Date(a.created_at)-new Date(b.created_at));
  let running=0;
  const rendered = rows.map(l=>{running += Number(l.credit||0)-Number(l.debit||0); return `<tr><td>${esc(l.entry_date)}</td><td>${esc(typeLabel(l.entry_type))}</td><td>${esc(l.description||'')}</td><td>${money(l.debit)}</td><td>${money(l.credit)}</td><td><b>${money(running)}</b></td></tr>`}).reverse().join('');
  const bal = rows.reduce((a,l)=>a+Number(l.credit||0)-Number(l.debit||0),0);
  q('ledgerBalance').textContent=money(bal); q('ledgerStatus').innerHTML=badgeStatus(bal);
  q('ledgerBody').innerHTML = sid ? (rendered || '<tr><td colspan="6">لا توجد حركات لهذا المورد.</td></tr>') : '<tr><td colspan="6">اختر المورد أولاً.</td></tr>';
}
function renderPayments(){
  q('paymentsBody').innerHTML = payments.map(p=>{const s=suppliers.find(x=>x.id===p.supplier_id);return `<tr><td>${esc(p.payment_date)}</td><td>${esc(s?.name||'')}</td><td><b>${money(p.amount)}</b></td><td>${esc(typeLabel(p.payment_method))}</td><td>${esc(p.notes||'')}</td></tr>`}).join('') || '<tr><td colspan="5">لا توجد دفعات بعد.</td></tr>';
}

function renderPurchases(){
  q('purchasesBody').innerHTML = purchases.map(p=>{
    const s=suppliers.find(x=>x.id===p.supplier_id); const l=locations.find(x=>x.id===p.location_id);
    return `<tr><td class="ltr"><b>${esc(p.purchase_no||p.id.slice(0,8))}</b></td><td>${p.purchase_date}</td><td>${s?.name||''}</td><td>${l?.name||''}</td><td>${p.invoice_no||''}</td><td><b>${money(p.total)}</b></td><td><span class="badge green">${typeLabel(p.status)}</span></td><td><button class="btn secondary" onclick="openPurchaseForEdit('${p.id}')">فتح / تعديل</button></td></tr>`;
  }).join('') || '<tr><td colspan="8">لا توجد فواتير شراء بعد.</td></tr>';
}
function fillStockFilters(){
  const fill=(id,key,label)=>{
    const el=q(id); if(!el || el.dataset.ready==='1') return;
    const old=el.value;
    const vals=[...new Set(products.map(p=>p[key]).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'ar'));
    el.innerHTML=`<option value="">${label}</option>`+vals.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
    if([...el.options].some(o=>o.value===old)) el.value=old;
    el.dataset.ready='1';
  };
  fill('stockCategoryFilter','category','كل التصنيفات');
  fill('stockBrandFilter','brand','كل الماركات');
  fill('stockSupplierFilter','supplier_name','كل الموردين');
}
function renderStock(){
  fillStockFilters();
  const loc=q('stockLocationFilter')?.value||'';
  const cat=q('stockCategoryFilter')?.value||'';
  const brand=q('stockBrandFilter')?.value||'';
  const supplier=q('stockSupplierFilter')?.value||'';
  const status=q('stockStatusFilter')?.value||'';
  const term=(q('stockSearch')?.value||'').trim().toLowerCase();
  const rows=stock.filter(r=>{
    const p=productByCode(r.product_code);
    const qty=Number(r.qty||0);
    const lowLimit=Number(p?.reorder_point||APP_CONFIG.lowStockThreshold||0);
    const hay=[r.product_code,r.product_name,p?.barcode,p?.brand,p?.model,p?.color,p?.supplier_name,p?.category].join(' ').toLowerCase();
    if(loc && r.location_id!==loc) return false;
    if(cat && p?.category!==cat) return false;
    if(brand && p?.brand!==brand) return false;
    if(supplier && p?.supplier_name!==supplier) return false;
    if(status==='positive' && !(qty>0)) return false;
    if(status==='zero' && qty!==0) return false;
    if(status==='negative' && !(qty<0)) return false;
    if(status==='low' && !(qty<=lowLimit)) return false;
    return !term || smartMatch(term, hay);
  });
  const stockCols=['location','product_code','product_name','category','supplier_name','qty','unit_cost','value','updated_at'];
  const key=stockCols[stockSortIndex]||'qty';
  rows.sort((a,b)=>{
    const pa=productByCode(a.product_code), pb=productByCode(b.product_code);
    const val=(r,p)=>key==='location'?(locations.find(x=>x.id===r.location_id)?.name||''):
      key==='category'?(p?.category||''):
      key==='supplier_name'?(p?.supplier_name||''):
      key==='unit_cost'?productCost(r.product_code):
      key==='value'?Number(r.qty||0)*productCost(r.product_code):
      (r[key]??'');
    const va=val(a,pa), vb=val(b,pb); const na=parseFloat(va), nb=parseFloat(vb);
    const c=(!isNaN(na)&&!isNaN(nb))?na-nb:String(va||'').localeCompare(String(vb||''),'ar');
    return stockSortDir==='asc'?c:-c;
  });
  const qtyTotal=rows.reduce((a,r)=>a+Number(r.qty||0),0);
  const valueTotal=rows.reduce((a,r)=>a+Number(r.qty||0)*productCost(r.product_code),0);
  const lowCount=rows.filter(r=>{const p=productByCode(r.product_code); return Number(r.qty||0)<=Number(p?.reorder_point||APP_CONFIG.lowStockThreshold||0)}).length;
  if(q('stockValueTotal')) q('stockValueTotal').textContent=money(valueTotal)+' '+APP_CONFIG.currency;
  if(q('stockQtyTotal')) q('stockQtyTotal').textContent=money(qtyTotal);
  if(q('stockItemsCount')) q('stockItemsCount').textContent=rows.length;
  if(q('stockLowCount')) q('stockLowCount').textContent=lowCount;
  q('stockBody').innerHTML = rows.map(r=>{
    const l=locations.find(x=>x.id===r.location_id); const p=productByCode(r.product_code); const qty=Number(r.qty||0); const cost=productCost(r.product_code); const val=qty*cost;
    return `<tr><td>${esc(l?.name)}</td><td class="ltr"><b>${esc(r.product_code)}</b></td><td>${esc(r.product_name||p?.name||'')}</td><td>${esc(p?.category||'')}</td><td>${esc(p?.supplier_name||'')}</td><td class="${qty>0?'stock-positive':qty<0?'stock-negative':''}">${money(qty)}</td><td>${money(cost)}</td><td><b>${money(val)}</b></td><td class="mini">${esc((r.updated_at||'').replace('T',' ').slice(0,19))}</td></tr>`;
  }).join('') || '<tr><td colspan="9">لا يوجد مخزون مطابق للفلاتر. أدخل فاتورة شراء أولاً.</td></tr>';
}

function getStockQty(location_id, product_code){
  const r=stock.find(x=>x.location_id===location_id && String(x.product_code||'').toLowerCase()===String(product_code||'').toLowerCase());
  return Number(r?.qty||0);
}
async function adjustStockOnly(location_id, item, qtyChange){
  const code=encodeURIComponent(item.product_code);
  const loc=encodeURIComponent(location_id);
  const found=await api('pos_stock',{qs:`?select=*&location_id=eq.${loc}&product_code=eq.${code}&limit=1`});
  if(found && found.length){
    const newQty=Number(found[0].qty||0)+Number(qtyChange||0);
    await api('pos_stock',{method:'PATCH',qs:`?id=eq.${found[0].id}`,body:{qty:newQty,product_name:item.product_name,updated_at:new Date().toISOString()}});
  }else{
    await api('pos_stock',{method:'POST',body:{location_id,product_code:item.product_code,product_name:item.product_name,qty:qtyChange}});
  }
}
async function deleteStockMovements(referenceTable, referenceId){
  await api('pos_stock_movements',{method:'DELETE',qs:`?reference_table=eq.${referenceTable}&reference_id=eq.${referenceId}`});
}
async function adjustStock(location_id, item, qtyChange, movementType, referenceId, notes){
  await rpc('pos_adjust_stock_checked',{
    p_location_id:location_id,
    p_product_code:item.product_code,
    p_product_name:item.product_name,
    p_qty_change:qtyChange,
    p_movement_type:movementType,
    p_reference_table:'pos_stock_transfers',
    p_reference_id:referenceId,
    p_notes:notes
  });
}
function renderTransfers(){
  q('transfersBody').innerHTML = transfers.map(t=>{
    const from=locations.find(x=>x.id===t.from_location_id); const to=locations.find(x=>x.id===t.to_location_id);
    return `<tr><td class="ltr"><b>${esc(t.transfer_no||t.id.slice(0,8))}</b></td><td>${t.transfer_date}</td><td>${from?.name||''}</td><td>${to?.name||''}</td><td><span class="badge green">${typeLabel(t.status)}</span></td><td>${t.notes||''}</td><td><button class="btn secondary" onclick="openTransferForEdit('${t.id}')">فتح / تعديل</button></td></tr>`;
  }).join('') || '<tr><td colspan="7">لا توجد تحويلات مخزون بعد.</td></tr>';
}
function addOrIncrementTransferProduct(p, qty=1){
  const rows=[...q('transferItemsBody').querySelectorAll('tr')];
  const existing=rows.find(tr=>String(tr.querySelector('.ti-code')?.value||'').trim().toLowerCase()===String(p.code||'').toLowerCase());
  if(existing){const inp=existing.querySelector('.ti-qty'); inp.value=Number(inp.value||0)+Number(qty||1); updateTransferAvailable(inp); return;}
  addTransferRow({product_code:p.code,product_name:p.name,qty});
  const last=q('transferItemsBody').lastElementChild; if(last){const note=last.querySelector('.ti-product-note'); if(note) note.textContent=[p.brand,p.model,p.color,p.category].filter(Boolean).join(' - '); updateTransferAvailable(last.querySelector('.ti-qty'));}
}
function addTransferRow(item={}){
  const tr=document.createElement('tr');
  tr.innerHTML=`<td><input class="ti-code ltr" list="productsDatalist" value="${esc(item.product_code||'')}" placeholder="اكتب الكود أو الاسم" oninput="fillTransferRow(this)" onchange="fillTransferRow(this)"><div class="mini ti-product-note"></div></td><td><input class="ti-name" value="${esc(item.product_name||'')}" required placeholder="اسم المنتج"></td><td><input class="ti-qty" type="number" step="1" min="1" value="${esc(item.qty||1)}" oninput="updateTransferAvailable(this)"></td><td class="ti-available"><b>0.00</b></td><td><button type="button" class="btn danger" onclick="this.closest('tr').remove()">حذف</button></td>`;
  q('transferItemsBody').appendChild(tr); updateTransferAvailable(tr.querySelector('.ti-qty'));
}
function fillTransferRow(input){
  const p=findProductByInput(input.value);
  if(!p) return;
  const tr=input.closest('tr');
  tr.querySelector('.ti-code').value=p.code||'';
  tr.querySelector('.ti-name').value=p.name||'';
  const brandModel=[p.brand,p.model].filter(Boolean).join(' / ');
  const note=tr.querySelector('.ti-product-note');
  if(note) note.textContent = [brandModel, p.supplier_name, p.category].filter(Boolean).join(' - ');
  updateTransferAvailable(input);
}
function updateTransferAvailable(el){
  const tr=el.closest('tr'); const from=q('transferFrom').value;
  let code=tr.querySelector('.ti-code').value.trim(); const picked=findProductByInput(code); if(picked) code=picked.code; if(code.includes('|')) code=code.split('|')[0].trim();
  const available=from && code ? getStockQty(from, code) : 0;
  tr.querySelector('.ti-available').innerHTML=`<b class="${available>0?'stock-positive':available<0?'stock-negative':''}">${money(available)}</b>`;
}
function refreshTransferAvailability(){[...q('transferItemsBody').querySelectorAll('.ti-qty')].forEach(updateTransferAvailable)}
function getTransferItems(){
  return [...q('transferItemsBody').querySelectorAll('tr')].map(tr=>{
    let code=tr.querySelector('.ti-code').value.trim(); let name=tr.querySelector('.ti-name').value.trim();
    const picked=findProductByInput(code);
    if(picked){ code=picked.code||code; if(!name) name=picked.name||name; }
    if(code.includes('|')) code=code.split('|')[0].trim();
    const qty=Number(tr.querySelector('.ti-qty').value||0);
    return {product_code:code||name, product_name:name, qty};
  }).filter(x=>x.product_name && x.qty>0);
}
function groupTransferItems(items){
  const m=new Map();
  items.forEach(it=>{
    const k=String(it.product_code||'').toLowerCase();
    const row=m.get(k)||{product_code:it.product_code,product_name:it.product_name,qty:0};
    row.qty+=Number(it.qty||0);
    if(!row.product_name) row.product_name=it.product_name;
    m.set(k,row);
  });
  return [...m.values()].filter(x=>x.product_code && x.product_name && x.qty>0);
}


function fillSaleListFilterOptions(){
  const keep=(id,html)=>{const el=q(id); if(!el)return; const v=el.value; el.innerHTML=html; if([...el.options].some(o=>o.value===v)) el.value=v;};
  keep('saleFilterCustomer','<option value="">كل الزبائن</option>'+customers.map(c=>`<option value="${c.id}">${esc(c.name)}${c.phone?' - '+esc(c.phone):''}</option>`).join(''));
  keep('saleFilterBranch','<option value="">كل الفروع</option>'+locations.filter(l=>l.is_sales_location||l.location_type==='branch').map(l=>`<option value="${l.id}">${esc(l.name)}</option>`).join(''));
  keep('saleFilterWarehouse','<option value="">كل المخازن / غير مطبق</option>'+locations.filter(l=>l.location_type==='warehouse').map(l=>`<option value="${l.id}">${esc(l.name)}</option>`).join(''));
}
function salePaymentStatus(sl){
  const total=Number(sl.total||0), paid=Number(sl.paid_amount||0), due=Number(sl.balance_due||0);
  if(due>0 && paid>0) return 'partial';
  if(due>0 && paid<=0) return 'unpaid';
  return 'paid';
}
function saleSearchText(sl){
  const c=customers.find(x=>x.id===sl.customer_id), l=locations.find(x=>x.id===sl.location_id);
  const rows=saleItems.filter(it=>it.sale_id===sl.id);
  const prodText=rows.map(it=>{const p=productByCode(it.product_code); return [it.product_code,it.product_name,p?.barcode,p?.sku,p?.model,p?.brand].filter(Boolean).join(' ')}).join(' ');
  return [sl.invoice_no,sl.id,sl.sale_date,c?.name,c?.phone,l?.name,sl.payment_method,sl.status,sl.notes,prodText].filter(Boolean).join(' ');
}
function saleMatchesFilters(sl){
  const term=(q('saleListSearch')?.value||'').trim(); if(term && !smartMatch(term,saleSearchText(sl))) return false;
  const from=q('saleFilterFrom')?.value||'', to=q('saleFilterTo')?.value||'', month=q('saleFilterMonth')?.value||'', year=(q('saleFilterYear')?.value||'').trim();
  const d=sl.sale_date||''; if(from && d<from) return false; if(to && d>to) return false; if(month && !d.startsWith(month)) return false; if(year && !d.startsWith(year)) return false;
  const typ=q('saleFilterType')?.value||''; const hasReturn=saleItems.some(it=>it.sale_id===sl.id && Number(it.qty||0)<0); if(typ==='sale' && hasReturn) return false; if(typ==='mixed_return' && !hasReturn) return false;
  const user=(q('saleFilterUser')?.value||'').trim(); if(user && !smartMatch(user,[sl.seller,sl.cashier,sl.created_by,sl.notes].filter(Boolean).join(' '))) return false;
  const cust=q('saleFilterCustomer')?.value||''; if(cust && sl.customer_id!==cust) return false;
  const branch=q('saleFilterBranch')?.value||''; if(branch && sl.location_id!==branch) return false;
  const pay=q('saleFilterPayment')?.value||''; const st=salePaymentStatus(sl); if(pay==='due' && Number(sl.balance_due||0)<=0) return false; if(pay && pay!=='due' && st!==pay) return false;
  return true;
}
function renderSales(){
  fillSaleListFilterOptions();
  const rows=sales.filter(saleMatchesFilters);
  q('salesBody').innerHTML = rows.map(sl=>{
    const l=locations.find(x=>x.id===sl.location_id); const c=customers.find(x=>x.id===sl.customer_id); const safe=String(sl.id).replace(/'/g,"\'"); const st=salePaymentStatus(sl);
    const badge=st==='paid'?'<span class="badge green">مدفوعة</span>':(st==='partial'?'<span class="badge yellow">مدفوعة جزئيًا</span>':'<span class="badge red">غير مدفوعة</span>');
    return `<tr class="${selectedSaleId===sl.id?'selected-row':''}" onclick="selectSaleRow('${safe}')"><td class="ltr"><b>${esc(sl.invoice_no||sl.id.slice(0,8))}</b></td><td>${esc(sl.sale_date)}</td><td>${esc(l?.name)}</td><td>${esc(c?.name||'زبون نقدي')}<div class="mini ltr">${esc(c?.phone||'')}</div></td><td>${badge}<div class="mini">${esc(typeLabel(sl.payment_method))} — ${esc(paymentBreakdownText(salePayments.filter(p=>p.sale_id===sl.id)))}</div></td><td><b>${money(sl.total)}</b></td><td>${money(sl.paid_amount)}</td><td class="${Number(sl.balance_due)>0?'stock-negative':''}"><b>${money(sl.balance_due)}</b></td></tr>`;
  }).join('') || '<tr><td colspan="8">لا توجد فواتير مطابقة. غيّر البحث أو الفلاتر.</td></tr>';
  const totalDue=rows.reduce((a,x)=>a+Math.max(0,Number(x.balance_due||0)),0);
  const sl=selectedSaleId?sales.find(x=>x.id===selectedSaleId):null;
  if(q('selectedSaleInfo')) q('selectedSaleInfo').textContent=sl?`المحدد: ${sl.sale_date} - ${money(sl.total)} ${APP_CONFIG.currency} | النتائج: ${rows.length} | الديون: ${money(totalDue)} ${APP_CONFIG.currency}`:`النتائج: ${rows.length} | إجمالي الديون: ${money(totalDue)} ${APP_CONFIG.currency}`;
}
function clearSaleFilters(){['saleListSearch','saleFilterFrom','saleFilterTo','saleFilterMonth','saleFilterYear','saleFilterUser'].forEach(id=>{if(q(id))q(id).value=''}); ['saleFilterType','saleFilterCustomer','saleFilterBranch','saleFilterWarehouse','saleFilterPayment'].forEach(id=>{if(q(id))q(id).value=''}); renderSales();}
function showDueSalesOnly(){if(q('saleFilterPayment'))q('saleFilterPayment').value='due'; renderSales();}
function selectSaleRow(id){selectedSaleId=id;renderSales()}
function getSelectedSaleId(){if(!selectedSaleId){toast('اختر فاتورة من الجدول أولاً');return null;} return selectedSaleId}
function openSelectedSaleForEdit(){const id=getSelectedSaleId(); if(id) openSaleForEdit(id)}
function printSelectedSale(){const id=getSelectedSaleId(); if(id) printSale(id)}
function openSelectedSaleReturn(){const id=getSelectedSaleId(); if(id) openSaleReturn(id)}
function convertSelectedSaleToProforma(){const id=getSelectedSaleId(); if(id) convertSaleToProforma(id)}
async function adjustStockDoc(location_id, item, qtyChange, movementType, referenceTable, referenceId, notes){
  await rpc('pos_adjust_stock_checked',{
    p_location_id:location_id,
    p_product_code:item.product_code,
    p_product_name:item.product_name,
    p_qty_change:qtyChange,
    p_movement_type:movementType,
    p_reference_table:referenceTable,
    p_reference_id:referenceId,
    p_notes:(notes||'')+(appUser?.identifier?' | المستخدم: '+appUser.identifier:'')
  });
}
function addSaleRow(item={}){
  const tr=document.createElement('tr');
  const isReturn=Number(item.qty||1)<0 || item.line_type==='return'; const qv=Math.abs(Number(item.qty||1))||1;
  tr.innerHTML=`<td><input class="si-code ltr" list="productsDatalist" value="${esc(item.product_code||'')}" placeholder="اكتب الكود أو الاسم" onkeydown="if(event.key==='Enter'){event.preventDefault();fillSaleRow(this)}" onchange="fillSaleRow(this)"><select class="si-kind hidden" onchange="updateSaleLineKind(this);updateSaleTotal()"><option value="sale" selected>بيع</option></select><div class="mini si-product-note"></div></td><td><textarea class="si-name" required readonly tabindex="-1" placeholder="يتم تعبئته من المنتج">${esc(item.product_name||'')}</textarea></td><td><input class="si-qty" type="number" step="1" min="1" value="${qv}" onfocus="this.select()" onkeydown="if(event.key==='Enter'){event.preventDefault();this.closest('tr').querySelector('.si-price').focus()}" oninput="updateSaleTotal();updateSaleAvailable(this)"></td><td><input class="si-price" type="text" inputmode="decimal" value="${esc(item.unit_price||0)}" onfocus="this.select()" onkeydown="if(event.key==='Enter'){event.preventDefault();addSaleRowAndFocus()}" oninput="updateSaleTotal()"></td><td class="si-margin">0.00</td><td class="si-margin-pct">0%</td><td><input class="si-discount" value="${esc(item.discount_text||item.line_discount||0)}" placeholder="مثال: 5 = 5%" onfocus="this.select()" oninput="updateSaleTotal()"></td><td class="si-available"><b>0.00</b></td><td class="si-line"><b>0.00</b></td><td><button type="button" class="btn danger" onclick="this.closest('tr').remove();updateSaleTotal()">حذف</button></td>`;
  q('saleItemsBody').appendChild(tr); updateSaleTotal(); updateSaleAvailable(tr.querySelector('.si-qty'));
}
function updateSaleLineKind(el){
  const tr=el.closest('tr');
  tr?.classList.toggle('return-line', el.value==='return');
}
function fillSaleRow(input){
  const p=findProductByInput(input.value); if(!p) return;
  const tr=input.closest('tr');
  tr.querySelector('.si-code').value=p.code||''; tr.querySelector('.si-name').value=p.name||''; tr.querySelector('.si-price').value=Number(p.retail_price||0);
  if(mergeSaleDuplicateRows(tr,p.code)) return;
  const brandModel=[p.brand,p.model].filter(Boolean).join(' / '); const note=tr.querySelector('.si-product-note');
  if(note) note.textContent=[brandModel,p.category].filter(Boolean).join(' - ');
  updateSaleTotal(); updateSaleAvailable(input); renderSaleStockInfo(p.code);
}
function updateSaleAvailable(el){
  const tr=el.closest('tr'); const loc=q('saleLocation').value;
  let code=tr.querySelector('.si-code').value.trim(); const picked=findProductByInput(code); if(picked) code=picked.code; if(code.includes('|')) code=code.split('|')[0].trim();
  const available=loc && code ? getStockQty(loc, code) : 0;
  tr.querySelector('.si-available').innerHTML=`<b class="${available>0?'stock-positive':available<0?'stock-negative':''}">${money(available)}</b>`;
}
function refreshSaleAvailability(){[...q('saleItemsBody').querySelectorAll('.si-qty')].forEach(updateSaleAvailable)}

function calcLineDiscount(raw, base){
  raw=String(raw||'').trim();
  if(!raw) return 0;
  const lower=raw.toLowerCase();
  if(lower.startsWith('amount:') || /د|دل|dinar|lyd/.test(lower)){
    const amount=moneyVal(lower.replace('amount:',''));
    return Math.min(base, Math.max(0, amount));
  }
  const pct=moneyVal(raw.replace('%',''));
  return Math.min(base, Math.max(0, base*pct/100));
}
function findProductByCodeOrBarcode(value){
  const v=String(value||'').trim().toLowerCase(); if(!v) return null;
  return products.find(p=>String(p.code||'').toLowerCase()===v || String(p.barcode||'').toLowerCase()===v) || null;
}
function addOrIncrementSaleProduct(p, qty=1){
  const comps=compositeItems.filter(ci=>ci.composite_code===p.code);
  if(comps.length>0){
    const compProducts=comps.map(ci=>{const cp=products.find(x=>x.code===ci.component_code);return cp?{p:cp,qty:Number(ci.qty||1)*qty}:null}).filter(Boolean);
    if(!compProducts.length){toast('لا توجد مكوّنات صالحة','warn');return;}
    const compTotal=compProducts.reduce((a,c)=>a+Number(c.p.retail_price||0)*c.qty,0);
    const ratio=compTotal>0?Number(p.retail_price||0)/compTotal:1;
    compProducts.forEach(c=>{
      const existing=[...q('saleItemsBody').querySelectorAll('tr')].find(tr=>String(tr.querySelector('.si-code')?.value||'').split('|')[0].trim().toLowerCase()===String(c.p.code).toLowerCase());
      if(existing){const inp=existing.querySelector('.si-qty');inp.value=Number(inp.value||0)+c.qty;updateSaleTotal();return;}
      const price=Math.round(Number(c.p.retail_price||0)*ratio*100)/100;
      addSaleRow({product_code:c.p.code,product_name:c.p.name,qty:c.qty,unit_price:price});
    });
    updateSaleTotal();
    toast(`تمت إضافة «${p.name}» بمكوّناته (${compProducts.length} أصناف)`,'success');
    return;
  }
  const rows=[...q('saleItemsBody').querySelectorAll('tr')];
  const existing=rows.find(tr=>String(tr.querySelector('.si-code')?.value||'').trim().toLowerCase()===String(p.code||'').toLowerCase());
  if(existing){const inp=existing.querySelector('.si-qty'); inp.value=Number(inp.value||0)+Number(qty||1); updateSaleTotal(); updateSaleAvailable(inp); return;}
  addSaleRow({product_code:p.code,product_name:p.name,qty,unit_price:(getSaleWholesale()&&Number(p.wholesale_price)>0)?Number(p.wholesale_price):Number(p.retail_price||0)});
  const last=q('saleItemsBody').lastElementChild; if(last){const note=last.querySelector('.si-product-note'); if(note) note.textContent=[p.brand,p.model,p.color,p.category].filter(Boolean).join(' - '); updateSaleAvailable(last.querySelector('.si-qty'));} renderSaleStockInfo(p.code);
}

function mergeSaleDuplicateRows(currentTr, productCode){
  const rows=[...q('saleItemsBody').querySelectorAll('tr')];
  const existing=rows.find(tr=>tr!==currentTr && String(tr.querySelector('.si-code')?.value||'').trim().toLowerCase()===String(productCode||'').toLowerCase());
  if(existing){
    const exQty=existing.querySelector('.si-qty');
    const curQty=currentTr.querySelector('.si-qty');
    exQty.value=Number(exQty.value||0)+Number(curQty.value||1);
    currentTr.remove();
    updateSaleTotal(); updateSaleAvailable(exQty);
    toast('المنتج موجود في الفاتورة، تم إضافة الكمية إلى السطر الموجود');
    return true;
  }
  return false;
}
function applyQtyModifier(raw){
  const m=String(raw||'').trim().match(/^\+(\d+(?:[.,]\d+)?)$/);
  if(!m) return false;
  const tr=lastFocusedSaleRow || q('saleItemsBody')?.lastElementChild;
  if(!tr){toast('لا يوجد سطر لتعديل الكمية','warn');return true;}
  const inp=tr.querySelector('.si-qty');
  inp.value=Number(inp.value||0)+moneyVal(m[1]);
  updateSaleTotal(); updateSaleAvailable(inp); selectSaleItemRow(tr);
  return true;
}
function handleBarcodeKey(e){if(e.key==='Enter'){e.preventDefault();const raw=q('saleBarcodeInput').value.trim(); if(applyQtyModifier(raw)){q('saleBarcodeInput').value=''; q('saleBarcodeInput').focus(); return;} const p=findProductByCodeOrBarcode(raw); if(p){addOrIncrementSaleProduct(p,1); q('saleBarcodeInput').value=''; q('saleBarcodeInput').focus();}else toast('لم يتم العثور على المنتج أو الباركود');}}
function handleBarcodeInput(){const v=q('saleBarcodeInput').value.trim(); if(v.startsWith('+')) return; const p=findProductByCodeOrBarcode(v); if(p && v.length>=4){addOrIncrementSaleProduct(p,1); q('saleBarcodeInput').value='';}}

// Hardware barcode scanner guard: rapid key streams are redirected to the barcode input.
let scannerBuffer='', scannerLastTs=0;
document.addEventListener('keydown',e=>{
  if(!q('sales')?.classList.contains('active')) return;
  if(e.ctrlKey||e.altKey||e.metaKey) return;
  const now=performance.now();
  const rapid=(now-scannerLastTs)<28;
  scannerLastTs=now;
  if(!rapid) scannerBuffer='';
  if(e.key==='Enter'){
    if(scannerBuffer.length>=5){
      e.preventDefault();
      const inp=q('saleBarcodeInput');
      if(inp){inp.value=scannerBuffer; handleBarcodeKey({key:'Enter',preventDefault(){}});}
    }
    scannerBuffer='';
    return;
  }
  if(e.key.length===1){
    scannerBuffer+=e.key;
    if(rapid && scannerBuffer.length>=3 && document.activeElement!==q('saleBarcodeInput')) e.preventDefault();
  }
},true);

function getSaleItems(){
  return [...q('saleItemsBody').querySelectorAll('tr')].map(tr=>{
    let code=tr.querySelector('.si-code').value.trim(); let name=tr.querySelector('.si-name').value.trim();
    const picked=findProductByInput(code); if(picked){code=picked.code||code; name=picked.name||name;}
    if(code.includes('|')) code=code.split('|')[0].trim();
    const qtyRaw=Math.abs(Number(tr.querySelector('.si-qty').value||0)); const sign=tr.querySelector('.si-kind')?.value==='return'?-1:1; const qty=sign*qtyRaw; const unit_price=moneyVal(tr.querySelector('.si-price').value); const baseAbs=qtyRaw*unit_price; const discount_text=tr.querySelector('.si-discount')?.value||''; const line_discount=calcLineDiscount(discount_text,baseAbs);
    return {product_code:code||name, product_name:name, qty, unit_price, line_discount, discount_text, line_total:sign*Math.max(0,baseAbs-line_discount)};
  }).filter(x=>x.product_name && x.qty!==0);
}

function getSalePaymentBreakdown(){
  return [
    {payment_method:'cash',amount:moneyVal(q('saleCashAmount')?.value)},
    {payment_method:'bank_transfer',amount:moneyVal(q('saleBankAmount')?.value)},
    {payment_method:'card',amount:moneyVal(q('saleCardAmount')?.value)}
  ].filter(x=>x.amount>0);
}
function detectSalePaymentMethod(balanceDue=0){
  if(balanceDue>0) return 'credit';
  const rows=getSalePaymentBreakdown();
  if(rows.length===0) return q('salePaymentMethod').value||'cash';
  return rows.length===1 ? rows[0].payment_method : 'mixed';
}
function syncPaymentPreset(total){
  const method=q('salePaymentMethod').value;
  const cash=q('saleCashAmount'), bank=q('saleBankAmount'), card=q('saleCardAmount');
  if(!cash||!bank||!card) return;
  if(method==='credit'){cash.value=0;bank.value=0;card.value=0;}
}
function paymentBreakdownText(rows){return rows.map(r=>`${typeLabel(r.payment_method)}: ${money(r.amount)} ${APP_CONFIG.currency}`).join(' | ')}


function setActivePayInput(el){
  if(!el) return; activePayInputId=el.id;
  ['saleCashAmount','saleBankAmount','saleCardAmount'].forEach(id=>q(id)?.classList.toggle('active-pay',id===activePayInputId));
}
function focusPay(type){
  const id=type==='bank'?'saleBankAmount':type==='card'?'saleCardAmount':'saleCashAmount';
  const el=q(id); if(el){el.focus();setActivePayInput(el);}
}

function setFullPayment(type){
  const total=Math.abs(Number((q('saleTotal').textContent||'0').replace(/,/g,''))||0);
  ['saleCashAmount','saleBankAmount','saleCardAmount'].forEach(id=>{if(q(id))q(id).value=0});
  const id=type==='bank'?'saleBankAmount':type==='card'?'saleCardAmount':'saleCashAmount';
  if(q(id)) q(id).value=total;
  q('salePaymentMethod').value=type==='bank'?'bank_transfer':type==='card'?'card':'cash';
  focusPay(type); updateSaleTotal();
}
function defaultFinanceAccountFor(method){
  if(method==='cash') return financeAccounts.find(a=>a.account_type==='cash' && a.location_id===appUser?.branch_id)?.id || financeAccounts.find(a=>a.account_type==='cash')?.id || null;
  if(method==='bank_transfer') return financeAccounts.find(a=>a.account_type==='bank')?.id || financeAccounts.find(a=>a.account_type==='card')?.id || null;
  if(method==='card') return financeAccounts.find(a=>a.account_type==='card')?.id || financeAccounts.find(a=>a.account_type==='bank')?.id || null;
  return null;
}

function keypadTarget(){const el=q(activePayInputId)||q('saleCashAmount'); setActivePayInput(el); return el;}
function keypadInput(v){const el=keypadTarget(); if(v==='.' && String(el.value).includes('.')) return; el.value=String(el.value||'0')==='0'?String(v):String(el.value)+String(v); updateSaleTotal();}
function keypadBackspace(){const el=keypadTarget(); el.value=String(el.value||'').slice(0,-1)||'0'; updateSaleTotal();}
function keypadClear(){const el=keypadTarget(); el.value='0'; updateSaleTotal();}
function keypadAddExact(){
  updateSaleTotal();
  const total=Math.abs(Number((q('saleTotal').textContent||'0').replace(/,/g,''))||0);
  const current=getSalePaymentBreakdown().reduce((a,x)=>a+Number(x.amount||0),0);
  const remaining=Math.max(0,total-current);
  const el=keypadTarget(); el.value=Number(el.value||0)+remaining; updateSaleTotal();
}
function setCreditSale(){q('salePaymentMethod').value='credit'; ['saleCashAmount','saleBankAmount','saleCardAmount'].forEach(id=>{if(q(id))q(id).value=0}); updateSaleTotal();}
function renderSaleCustomerInfo(){
  const c=customers.find(x=>x.id===q('saleCustomer')?.value);
  const bal=Number(c?.balance||0);
  if(q('saleCustomerBalance')) q('saleCustomerBalance').textContent=money(bal);
  if(q('saleCustomerInfo')) q('saleCustomerInfo').textContent=c?`${c.name}${c.phone?' - '+c.phone:''}`:'زبون نقدي / بدون زبون';
}
function renderSaleStockInfo(productCode){
  const code=productCode || q('saleItemsBody')?.lastElementChild?.querySelector('.si-code')?.value || '';
  const p=products.find(x=>String(x.code||'').toLowerCase()===String(code||'').toLowerCase());
  if(!q('saleStockInfo')) return;
  if(!p){q('saleStockInfo').innerHTML='اختر منتجًا لعرض المخزون في الفروع';return;}
  q('saleStockInfo').innerHTML=`<div><b>${esc(p.code)} - ${esc(p.name)}</b></div><div class="stock-chips">${locations.map(l=>`<span class="stock-chip">${esc(l.name)}: ${money(getStockQty(l.id,p.code))}</span>`).join('')}</div>`;
}

function updateSaleTotal(){
  let subtotal=0;
  [...q('saleItemsBody').querySelectorAll('tr')].forEach(tr=>{
    const qtyRaw=Math.abs(Number(tr.querySelector('.si-qty').value||0)); const sign=tr.querySelector('.si-kind')?.value==='return'?-1:1; const qty=sign*qtyRaw; const price=moneyVal(tr.querySelector('.si-price').value); const code=(tr.querySelector('.si-code')?.value||'').split('|')[0].trim(); const baseAbs=qtyRaw*price; const line=sign*Math.max(0,baseAbs-calcLineDiscount(tr.querySelector('.si-discount')?.value||'',baseAbs)); subtotal+=line; tr.classList.toggle('return-line',sign<0);
    const cost=productCost(code), mv=(price-cost)*qty, mp=cost?((price-cost)/cost*100):0; if(tr.querySelector('.si-margin')) tr.querySelector('.si-margin').innerHTML=cost?`<b class="${mv>=0?'stock-positive':'stock-negative'}">${money(mv)}</b>`:'<span class="muted">لا تكلفة</span>'; if(tr.querySelector('.si-margin-pct')) tr.querySelector('.si-margin-pct').innerHTML=cost?`<span class="${mv>=0?'stock-positive':'stock-negative'}">${money(mp)}%</span>`:'<span class="muted">—</span>';
    tr.querySelector('.si-line').innerHTML=`<b>${money(line)}</b>`;
  });
  const discount=moneyVal(q('saleDiscount').value); const total=subtotal-discount;
  syncPaymentPreset(total);
  const rawPaid=getSalePaymentBreakdown().reduce((a,x)=>a+Number(x.amount||0),0); const isRefund=total<0; const required=isRefund?Math.abs(total):total; const over=Math.max(0,rawPaid-required); const bal=isRefund?Math.max(0,required-rawPaid):Math.max(0,total-rawPaid);
  q('salePaidAmount').value=money(isRefund?-rawPaid:rawPaid);
  q('saleTotal').textContent=money(total); if(q('saleHeaderTotal')) q('saleHeaderTotal').textContent=money(total); if(q('saleFinishTotal')) q('saleFinishTotal').textContent=money(total); if(q('salePaymentScreenTotal')) q('salePaymentScreenTotal').textContent=isRefund?'استرداد '+money(required):money(total); q('saleBalance').textContent=over>0?('+'+money(over)):money(bal); if(q('saleFinishBalance')) q('saleFinishBalance').textContent=isRefund?('المطلوب رده للزبون: '+money(required)+' '+APP_CONFIG.currency):((over>0?'زيادة: ':'المتبقي: ')+money(over>0?over:bal)+' '+APP_CONFIG.currency); renderSaleCustomerInfo(); if(q('salePaymentDetected')) {q('salePaymentDetected').textContent=isRefund?(over>0?'تنبيه: مبلغ الاسترداد أكبر من المطلوب بمبلغ '+money(over)+' '+APP_CONFIG.currency:'استرداد للزبون: '+money(required)+' '+APP_CONFIG.currency+' — '+(paymentBreakdownText(getSalePaymentBreakdown())||'اختر طريقة الاسترداد')):(over>0?'تنبيه: المدفوع أكبر من إجمالي الفاتورة بمبلغ '+money(over)+' '+APP_CONFIG.currency:'طريقة الدفع: '+typeLabel(detectSalePaymentMethod(bal))+' — '+(paymentBreakdownText(getSalePaymentBreakdown())||'لم يتم إدخال دفع')); q('salePaymentDetected').style.color=(over>0||isRefund)?'var(--bad)':'';}
}
function normalizePhoneLY(p){
  let d=String(p||'').replace(/[^0-9]/g,'');
  if(!d) return '';
  if(d.startsWith('00218')) d=d.slice(5);
  else if(d.startsWith('218')) d=d.slice(3);
  else if(d.startsWith('0')) d=d.slice(1);
  return d;
}
function matchExistingCustomerByPhone(phone){
  const norm=normalizePhoneLY(phone);
  if(!norm) return null;
  return customers.find(c=>normalizePhoneLY(c.phone)===norm && norm) || null;
}
async function ensureSaleCustomer(balanceDue){
  let customer_id=q('saleCustomer').value||null;
  const newName=q('saleNewCustomerName').value.trim(); const newPhone=q('saleNewCustomerPhone').value.trim();
  if(!customer_id && newPhone){
    // التعرف على الزبون المسجّل عبر رقم الهاتف بدل إنشاء نسخة مكررة (تفادي رسالة "الرقم مسجّل")
    let existing=matchExistingCustomerByPhone(newPhone);
    if(!existing){
      const variants=[...new Set([newPhone, String(newPhone).replace(/[^0-9]/g,''), '+'+String(newPhone).replace(/[^0-9]/g,'')])].filter(Boolean);
      for(const v of variants){
        if(!v) continue;
        try{
          const rows=await api('pos_customers',{qs:`?select=id,name,phone&phone=eq.${encodeURIComponent(v)}&limit=1`});
          if(rows&&rows.length){ existing=rows[0]; if(!customers.find(c=>c.id===existing.id)) customers.push(existing); break; }
        }catch(e){ console.warn('customer phone lookup failed',e); }
      }
    }
    if(existing){
      customer_id=existing.id;
      if(q('saleCustomer')) q('saleCustomer').value=existing.id;
      q('saleNewCustomerName').value=''; q('saleNewCustomerPhone').value='';
      try{renderSaleCustomerInfo();}catch(e){}
      toast(`تم التعرف على الزبون المسجّل: ${existing.name||''} واعتماده في الفاتورة`,'success');
    }
  }
  if(!customer_id && newName){
    const created=await api('pos_customers',{method:'POST',body:{name:newName,phone:newPhone||null,active:true}});
    customer_id=created[0].id;
  }
  if(balanceDue>0 && !customer_id) throw new Error('يجب اختيار أو إضافة زبون إذا كانت الفاتورة آجل أو فيها مبلغ متبقي');
  return customer_id;
}
function resetSaleForm(){
  suppressSaleDraftSave=true; saleSupervisorApproved=false; sourcePriceCheckerCartId=null;
  editingSaleId=null; originalSale=null; originalSaleItems=[];
  q('saleForm').reset(); if(q('saleLocation') && appUser?.branch_id) q('saleLocation').value=appUser.branch_id; if(q('saleCashAmount')){q('saleCashAmount').value=0;q('saleBankAmount').value=0;q('saleCardAmount').value=0;} q('saleItemsBody').innerHTML=''; setToday(); ensureSaleInvoiceNo(true);
  q('saleSubmitBtn').textContent='حفظ البيع'; q('saleCancelEditBtn').classList.add('hidden'); q('saleEditAlert')?.classList.add('hidden'); setActivePayInput(q('saleCashAmount')); renderSaleStockInfo(''); renderSaleCustomerInfo(); updateSaleTotal(); suppressSaleDraftSave=false; setTimeout(()=>q('saleBarcodeInput')?.focus(),50);
}
async function openSaleForEdit(id){
  try{
    showLoading(true);
    const rows=await api('pos_sale_items',{qs:`?select=*&sale_id=eq.${id}&order=created_at.asc`});
    const sl=sales.find(x=>x.id===id) || (await api('pos_sales',{qs:`?select=*&id=eq.${id}&limit=1`}))[0];
    if(!sl){toast('لم يتم العثور على فاتورة البيع'); return;}
    editingSaleId=id; originalSale={...sl}; originalSaleItems=rows.map(x=>({...x}));
    document.querySelector('[data-tab="sales"]').click();
    q('saleLocation').value=sl.location_id||''; q('saleDate').value=sl.sale_date||''; q('salePaymentMethod').value=sl.payment_method||'cash'; q('saleInvoiceNo').value=sl.invoice_no||'';
    q('saleCustomer').value=sl.customer_id||''; q('saleNewCustomerName').value=''; q('saleNewCustomerPhone').value=''; q('saleNotes').value=sl.notes||''; q('saleDiscount').value=Number(sl.discount||0); q('salePaidAmount').value=Number(sl.paid_amount||0);
    if(q('saleCashAmount')){q('saleCashAmount').value=0;q('saleBankAmount').value=0;q('saleCardAmount').value=0; salePayments.filter(p=>p.sale_id===id).forEach(p=>{if(p.payment_method==='cash')q('saleCashAmount').value=Number(p.amount||0); if(p.payment_method==='bank_transfer')q('saleBankAmount').value=Number(p.amount||0); if(p.payment_method==='card')q('saleCardAmount').value=Number(p.amount||0);});}
    q('saleItemsBody').innerHTML=''; rows.forEach(it=>addSaleRow({product_code:it.product_code,product_name:it.product_name,qty:it.qty,unit_price:it.unit_price,line_discount:it.line_discount,discount_text:it.discount_text}));
    updateSaleTotal(); refreshSaleAvailability(); q('saleSubmitBtn').textContent='حفظ تعديل البيع وتحديث المخزون'; q('saleCancelEditBtn').classList.remove('hidden'); q('saleEditAlert')?.classList.remove('hidden');
    toast('تم فتح فاتورة البيع للتعديل');
  }catch(err){console.error(err);toast('خطأ في فتح فاتورة البيع: '+err.message)} finally{showLoading(false);window.__busy=false}
}
async function reverseSaleEffects(){
  if(!editingSaleId || !originalSale) return;
  // عند تعديل فاتورة البيع نرجع المخزون بدون تسجيل حركة مرتجع وهمية، ثم نحذف حركات البيع القديمة.
  for(const it of originalSaleItems){
    await adjustStockOnly(originalSale.location_id,{product_code:it.product_code,product_name:it.product_name},Number(it.qty||0));
  }
  await deleteStockMovements('pos_sales', editingSaleId);
  await api('pos_customer_ledger',{method:'DELETE',qs:`?reference_table=eq.pos_sales&reference_id=eq.${editingSaleId}`});
}
let printPreviewPrinting=false;
function showInAppPrint(html){
  const modal=q('printPreviewModal'), frame=q('printPreviewFrame');
  if(!modal||!frame){toast('تعذر فتح معاينة الطباعة','error');return;}
  modal.classList.add('show');
  printPreviewPrinting=false;
  frame.onload=null;
  frame.dataset.hasContent='1';
  frame.onload=()=>{
    frame.onload=null; // Important: clearing srcdoc later must NOT print a blank page.
    setTimeout(()=>printPreviewNow(true),350);
  };
  frame.srcdoc=html;
}
function printPreviewNow(auto=false){
  const frame=q('printPreviewFrame');
  if(!frame || frame.dataset.hasContent!=='1') return;
  if(printPreviewPrinting) return;
  printPreviewPrinting=true;
  try{
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
  }catch(e){toast('تعذر فتح نافذة الطباعة','error')}
  finally{setTimeout(()=>{printPreviewPrinting=false;},1200)}
}
function closePrintPreview(){
  q('printPreviewModal')?.classList.remove('show');
  const frame=q('printPreviewFrame');
  if(frame){
    frame.onload=null;
    frame.dataset.hasContent='0';
    frame.srcdoc='';
  }
  printPreviewPrinting=false;
}

async function printSale(id){
  try{
    const sl=sales.find(x=>x.id===id) || (await api('pos_sales',{qs:`?select=*&id=eq.${id}&limit=1`}))[0];
    const items=await api('pos_sale_items',{qs:`?select=*&sale_id=eq.${id}&order=created_at.asc`});
    const payRows=salePayments.filter(p=>p.sale_id===id);
    const loc=locations.find(x=>x.id===sl.location_id); const cust=customers.find(x=>x.id===sl.customer_id);
    const itemCount=items.reduce((a,it)=>a+Number(it.qty||0),0);
    const subtotal=items.reduce((a,it)=>a+Number(it.line_total||0),0);
    const paid=Number(sl.paid_amount||0), balance=Number(sl.balance_due||0);
    const statusBadge=balance>0?'<span class="st st-due">آجل / متبقٍ</span>':'<span class="st st-paid">مدفوعة بالكامل</span>';
    const rows=items.map((it,i)=>`<tr><td class="n">${i+1}</td><td class="ltr">${esc(it.product_code)}</td><td>${esc(it.product_name)}</td><td class="n">${money(it.qty)}</td><td class="n">${money(it.unit_price)}</td><td class="n">${money(it.line_discount||0)}</td><td class="n"><b>${money(it.line_total)}</b></td></tr>`).join('');
    const html=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>فاتورة بيع ${esc(sl.invoice_no||sl.id.slice(0,8))}</title></head><body>
    <div class="bar"><button class="pbtn" onclick="window.print()">طباعة</button><button class="pbtn ghost" onclick="window.close()">إغلاق</button></div>
    <div class="sheet">
      <div class="top">
        <div class="biz"><div class="logo">${esc(APP_CONFIG.businessName)}</div><div><h1>${esc(APP_CONFIG.businessName)}</h1><div class="tag">${esc(APP_CONFIG.tagline)}</div></div></div>
        <div class="doc"><div class="title">فاتورة بيع</div><div class="meta">رقم: <b class="ltr">${esc(sl.invoice_no||sl.id.slice(0,8))}</b><br>التاريخ: <b>${esc(sl.sale_date)}</b></div><div>${statusBadge}</div></div>
      </div>
      <div class="info">
        <div class="cell"><div class="lbl">الزبون</div><div class="val">${esc(cust?.name||'زبون نقدي')}</div></div>
        <div class="cell"><div class="lbl">الهاتف</div><div class="val ltr" style="text-align:right">${esc(cust?.phone||'-')}</div></div>
        <div class="cell"><div class="lbl">الفرع</div><div class="val">${esc(loc?.name||'-')}</div></div>
        <div class="cell"><div class="lbl">طريقة الدفع</div><div class="val">${esc(typeLabel(sl.payment_method))}</div></div>
      </div>
      <table><thead><tr><th class="n">#</th><th>الكود</th><th>الصنف</th><th class="n">الكمية</th><th class="n">السعر</th><th class="n">خصم</th><th class="n">الإجمالي</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="foot">
        <div class="notes"><b>عدد الأصناف:</b> ${items.length} — <b>إجمالي القطع:</b> ${money(itemCount)}<br><b>تفصيل الدفع:</b> ${esc(paymentBreakdownText(payRows)||'-')}${sl.notes?'<br><b>ملاحظات:</b> '+esc(sl.notes):''}</div>
        <div class="totals">
          <div class="r"><span>المجموع</span><b>${money(subtotal)} ${esc(APP_CONFIG.currency)}</b></div>
          <div class="r"><span>الخصم</span><b>${money(sl.discount)} ${esc(APP_CONFIG.currency)}</b></div>
          <div class="r grand"><span>الإجمالي</span><b>${money(sl.total)} ${esc(APP_CONFIG.currency)}</b></div>
          <div class="r"><span>المدفوع</span><b>${money(paid)} ${esc(APP_CONFIG.currency)}</b></div>
          <div class="r"><span>المتبقي</span><b>${money(balance)} ${esc(APP_CONFIG.currency)}</b></div>
        </div>
      </div>
      <div class="sign"><div>توقيع البائع</div><div>توقيع الزبون</div></div>
      <div class="thanks">شكرًا لتعاملكم معنا — ${esc(APP_CONFIG.businessName)}</div>
    </div></body></html>`;
    showInAppPrint(html);
  }catch(err){console.error(err);toast('خطأ في طباعة الفاتورة: '+err.message)}
}


function addProformaRow(item={}){
  const tr=document.createElement('tr');
  tr.innerHTML=`<td><input class="pr-code ltr" list="productsDatalist" value="${esc(item.product_code||'')}" placeholder="اكتب الكود أو الاسم" onkeydown="if(event.key==='Enter'){event.preventDefault();fillProformaRow(this)}" onchange="fillProformaRow(this)"><div class="mini pr-note"></div></td><td><input class="pr-name" value="${esc(item.product_name||'')}" required placeholder="اسم المنتج"></td><td><input class="pr-qty" type="number" step="1" min="1" value="${esc(item.qty||1)}" oninput="updateProformaTotal()"></td><td><input class="pr-price" type="text" inputmode="decimal" value="${esc(item.unit_price||0)}" oninput="updateProformaTotal()"></td><td class="pr-margin">0.00</td><td class="pr-margin-pct">0%</td><td><input class="pr-discount" value="${esc(item.discount_text||item.line_discount||0)}" placeholder="0 أو 10%" oninput="updateProformaTotal()"></td><td class="pr-line"><b>0.00</b></td><td><button type="button" class="btn danger" onclick="this.closest('tr').remove();updateProformaTotal()">حذف</button></td>`;
  q('proformaItemsBody').appendChild(tr); updateProformaTotal();
}
function fillProformaRow(input){
  const p=findProductByInput(input.value); if(!p) return;
  const tr=input.closest('tr');
  tr.querySelector('.pr-code').value=p.code||''; tr.querySelector('.pr-name').value=p.name||''; tr.querySelector('.pr-price').value=Number(p.retail_price||0);
  if(mergeProformaDuplicateRows(tr,p.code)) return;
  const note=tr.querySelector('.pr-note'); if(note) note.textContent=[p.brand,p.model,p.color,p.category].filter(Boolean).join(' - ');
  updateProformaTotal();
}
function mergeProformaDuplicateRows(currentTr, productCode){
  const rows=[...q('proformaItemsBody').querySelectorAll('tr')];
  const existing=rows.find(tr=>tr!==currentTr && String(tr.querySelector('.pr-code')?.value||'').trim().toLowerCase()===String(productCode||'').toLowerCase());
  if(existing){existing.querySelector('.pr-qty').value=Number(existing.querySelector('.pr-qty').value||0)+Number(currentTr.querySelector('.pr-qty').value||1); currentTr.remove(); updateProformaTotal(); toast('المنتج موجود، تم إضافة الكمية للسطر الموجود'); return true;}
  return false;
}
function addOrIncrementProformaProduct(p, qty=1){
  const rows=[...q('proformaItemsBody').querySelectorAll('tr')];
  const existing=rows.find(tr=>String(tr.querySelector('.pr-code')?.value||'').trim().toLowerCase()===String(p.code||'').toLowerCase());
  if(existing){const inp=existing.querySelector('.pr-qty'); inp.value=Number(inp.value||0)+Number(qty||1); updateProformaTotal(); return;}
  addProformaRow({product_code:p.code,product_name:p.name,qty,unit_price:Number(p.retail_price||0)});
}
function getProformaItems(){
  return [...q('proformaItemsBody').querySelectorAll('tr')].map(tr=>{
    let code=tr.querySelector('.pr-code').value.trim(); let name=tr.querySelector('.pr-name').value.trim(); const picked=findProductByInput(code); if(picked){code=picked.code||code; if(!name) name=picked.name||name;} if(code.includes('|')) code=code.split('|')[0].trim();
    const qty=Number(tr.querySelector('.pr-qty').value||0), unit_price=moneyVal(tr.querySelector('.pr-price').value), base=qty*unit_price, discount_text=tr.querySelector('.pr-discount').value||'', line_discount=calcLineDiscount(discount_text,base);
    return {product_code:code||name,product_name:name,qty,unit_price,line_discount,discount_text,line_total:Math.max(0,base-line_discount)};
  }).filter(x=>x.product_name&&x.qty>0);
}
function updateProformaTotal(){
  let subtotal=0; [...q('proformaItemsBody').querySelectorAll('tr')].forEach(tr=>{const qty=Number(tr.querySelector('.pr-qty').value||0), price=moneyVal(tr.querySelector('.pr-price').value), code=(tr.querySelector('.pr-code')?.value||'').split('|')[0].trim(), base=qty*price, line=Math.max(0,base-calcLineDiscount(tr.querySelector('.pr-discount').value||'',base)); subtotal+=line; const mv=marginValue(code,price)*qty, mp=marginPct(code,price); if(tr.querySelector('.pr-margin')) tr.querySelector('.pr-margin').innerHTML=`<b class="${mv>=0?'stock-positive':'stock-negative'}">${money(mv)}</b>`; if(tr.querySelector('.pr-margin-pct')) tr.querySelector('.pr-margin-pct').innerHTML=`<span class="${mv>=0?'stock-positive':'stock-negative'}">${money(mp)}%</span>`; tr.querySelector('.pr-line').innerHTML=`<b>${money(line)}</b>`});
  const total=Math.max(0,subtotal-moneyVal(q('proformaDiscount').value)); q('proformaTotal').textContent=money(total);
}
function resetProformaForm(){editingProformaId=null; q('proformaForm').reset(); q('proformaItemsBody').innerHTML=''; addProformaRow(); setToday(); q('proformaSubmitBtn').textContent='حفظ الفاتورة المبدئية'; q('proformaCancelEditBtn').classList.add('hidden'); updateProformaTotal();}
function renderProformas(){
  if(!q('proformasBody')) return;
  q('proformasBody').innerHTML=proformas.map(pr=>{const l=locations.find(x=>x.id===pr.location_id), c=customers.find(x=>x.id===pr.customer_id); return `<tr><td class="ltr"><b>${esc(pr.proforma_no||pr.id.slice(0,8))}</b></td><td>${esc(pr.proforma_date)}</td><td>${esc(l?.name)}</td><td>${esc(c?.name||pr.customer_name||'')}</td><td><b>${money(pr.total)}</b></td><td>${esc(pr.status)}</td><td><div class="row"><button class="btn secondary" onclick="openProformaForEdit('${pr.id}')">فتح / تعديل</button><button class="btn secondary" onclick="convertProformaToSale('${pr.id}')">تحويل إلى بيع</button></div></td></tr>`}).join('')||'<tr><td colspan="7">لا توجد فواتير مبدئية.</td></tr>';
}
async function openProformaForEdit(id){
  try{showLoading(true); const rows=await api('pos_proforma_items',{qs:`?select=*&proforma_id=eq.${id}&order=created_at.asc`}); const pr=proformas.find(x=>x.id===id)||(await api('pos_proformas',{qs:`?select=*&id=eq.${id}&limit=1`}))[0]; if(!pr){toast('لم يتم العثور على الفاتورة');return;} editingProformaId=id; openTab('proformas'); q('proformaLocation').value=pr.location_id||''; q('proformaDate').value=pr.proforma_date||''; q('proformaNo').value=pr.proforma_no||''; q('proformaCustomer').value=pr.customer_id||''; q('proformaCustomerName').value=pr.customer_name||''; q('proformaCustomerPhone').value=pr.customer_phone||''; q('proformaNotes').value=pr.notes||''; q('proformaDiscount').value=Number(pr.discount||0); q('proformaItemsBody').innerHTML=''; rows.forEach(it=>addProformaRow(it)); updateProformaTotal(); q('proformaSubmitBtn').textContent='حفظ تعديل المبدئية'; q('proformaCancelEditBtn').classList.remove('hidden');}catch(e){console.error(e);toast('خطأ في فتح المبدئية: '+e.message)}finally{showLoading(false);window.__busy=false}}
async function convertSaleToProforma(id){
  try{showLoading(true); const sl=sales.find(x=>x.id===id)||(await api('pos_sales',{qs:`?select=*&id=eq.${id}&limit=1`}))[0]; const rows=await api('pos_sale_items',{qs:`?select=*&sale_id=eq.${id}&order=created_at.asc`}); const c=customers.find(x=>x.id===sl.customer_id); const subtotal=rows.reduce((a,x)=>a+Number(x.line_total||0),0); const pr=await api('pos_proformas',{method:'POST',body:{proforma_date:sl.sale_date,location_id:sl.location_id,customer_id:sl.customer_id,customer_name:c?.name||null,customer_phone:c?.phone||null,subtotal,discount:Number(sl.discount||0),total:Number(sl.total||subtotal),status:'draft',source_sale_id:id,notes:'تم إنشاؤها من فاتورة بيع'}}); await api('pos_proforma_items',{method:'POST',body:rows.map(it=>({proforma_id:pr[0].id,product_code:it.product_code,product_name:it.product_name,qty:it.qty,unit_price:it.unit_price,line_discount:it.line_discount||0,discount_text:it.discount_text||'',line_total:it.line_total}))}); toast('تم تحويل فاتورة البيع إلى مبدئية'); await loadAll(); openTab('proformas');}catch(e){console.error(e);toast('خطأ في التحويل: '+e.message+' - تأكد من تشغيل SQL المبدئية')}finally{showLoading(false);window.__busy=false}}
async function convertProformaToSale(id){
  try{showLoading(true); const pr=proformas.find(x=>x.id===id)||(await api('pos_proformas',{qs:`?select=*&id=eq.${id}&limit=1`}))[0]; const rows=await api('pos_proforma_items',{qs:`?select=*&proforma_id=eq.${id}&order=created_at.asc`}); openTab('sales'); resetSaleForm(); q('saleLocation').value=pr.location_id||''; q('saleCustomer').value=pr.customer_id||''; q('saleNewCustomerName').value=pr.customer_name||''; q('saleNewCustomerPhone').value=pr.customer_phone||''; q('saleNotes').value='من فاتورة مبدئية '+(pr.proforma_no||pr.id.slice(0,8)); q('saleDiscount').value=Number(pr.discount||0); q('saleItemsBody').innerHTML=''; rows.forEach(it=>addSaleRow({product_code:it.product_code,product_name:it.product_name,qty:it.qty,unit_price:it.unit_price,line_discount:it.line_discount,discount_text:it.discount_text})); updateSaleTotal(); await api('pos_proformas',{method:'PATCH',qs:`?id=eq.${id}`,body:{status:'converted'}}).catch(()=>{}); toast('تم فتح الفاتورة في شاشة البيع، راجع الدفع ثم احفظ البيع');}catch(e){console.error(e);toast('خطأ في تحويل المبدئية إلى بيع: '+e.message)}finally{showLoading(false);window.__busy=false}}


function addOrIncrementPurchaseProduct(p, qty=1){
  const rows=[...q('purchaseItemsBody').querySelectorAll('tr')];
  const existing=rows.find(tr=>String(tr.querySelector('.pi-code')?.value||'').trim().toLowerCase()===String(p.code||'').toLowerCase());
  if(existing){const inp=existing.querySelector('.pi-qty'); inp.value=Number(inp.value||0)+Number(qty||1); updatePurchaseTotal(); return;}
  addPurchaseRow({product_code:p.code,product_name:p.name,qty,unit_cost:Number(p.purchase_price||0)});
}

function addPurchaseRow(item={}){
  const tr=document.createElement('tr');
  const p=item.product_code?productByCode(item.product_code):null;
  const oldCost=Number(item.old_cost ?? p?.purchase_price ?? item.unit_cost ?? 0);
  tr.dataset.oldCost=oldCost;
  tr.innerHTML=`<td><input class="pi-code ltr" list="productsDatalist" value="${esc(item.product_code||'')}" placeholder="اكتب الكود أو الاسم" oninput="fillPurchaseRow(this)" onchange="fillPurchaseRow(this)"><div class="mini pi-product-note"></div></td><td><textarea class="pi-name" readonly tabindex="-1" required placeholder="يتم تعبئته من المنتج">${esc(item.product_name||'')}</textarea></td><td><input class="pi-qty" type="number" step="1" min="1" value="${item.qty||1}" oninput="updatePurchaseTotal()"></td><td><input class="pi-cost" type="text" inputmode="decimal" value="${item.unit_cost||0}" onfocus="this.select()" oninput="updatePurchaseTotal()"><div class="mini pi-cost-note"></div></td><td class="pi-line"><b>0.00</b></td><td><button type="button" class="btn danger" onclick="this.closest('tr').remove();updatePurchaseTotal()">حذف</button></td>`;
  q('purchaseItemsBody').appendChild(tr); updatePurchaseCostColor(tr); updatePurchaseTotal();
}
function updatePurchaseCostColor(tr){
  if(!tr) return;
  const inp=tr.querySelector('.pi-cost'); if(!inp) return;
  const oldCost=Number(tr.dataset.oldCost||0), val=moneyVal(inp.value);
  inp.classList.toggle('cost-up', oldCost>0 && val>oldCost);
  inp.classList.toggle('cost-down', oldCost>0 && val<oldCost);
  const note=tr.querySelector('.pi-cost-note');
  if(note) note.textContent=oldCost>0 ? (val>oldCost?`أعلى من القديم ${money(oldCost)}`:(val<oldCost?`أقل من القديم ${money(oldCost)}`:`نفس السعر القديم ${money(oldCost)}`)) : '';
}
function getPurchaseItems(){
  return [...q('purchaseItemsBody').querySelectorAll('tr')].map(tr=>{
    let code=tr.querySelector('.pi-code').value.trim(); let name=tr.querySelector('.pi-name').value.trim();
    const picked=findProductByInput(code);
    if(picked){ code=picked.code||code; if(!name) name=picked.name||name; }
    if(code.includes('|')) code=code.split('|')[0].trim();
    const qty=Number(tr.querySelector('.pi-qty').value||0); const unit_cost=moneyVal(tr.querySelector('.pi-cost').value);
    return {product_code:code||name, product_name:name, qty, unit_cost, line_total:qty*unit_cost};
  }).filter(x=>x.product_name && x.qty>0);
}
function updatePurchaseTotal(){
  let subtotal=0;
  [...q('purchaseItemsBody').querySelectorAll('tr')].forEach(tr=>{
    const qty=Number(tr.querySelector('.pi-qty').value||0); const cost=moneyVal(tr.querySelector('.pi-cost').value); updatePurchaseCostColor(tr); const line=qty*cost; subtotal+=line;
    tr.querySelector('.pi-line').innerHTML=`<b>${money(line)}</b>`;
  });
  const discount=moneyVal(q('purchaseDiscount').value); q('purchaseTotal').textContent=money(Math.max(0, subtotal-discount));
}
async function updateStock(location_id, item, purchaseId){
  const code=encodeURIComponent(item.product_code);
  const loc=encodeURIComponent(location_id);
  const found=await api('pos_stock',{qs:`?select=*&location_id=eq.${loc}&product_code=eq.${code}&limit=1`});
  if(found && found.length){
    const newQty=Number(found[0].qty||0)+Number(item.qty||0);
    await api('pos_stock',{method:'PATCH',qs:`?id=eq.${found[0].id}`,body:{qty:newQty,product_name:item.product_name,updated_at:new Date().toISOString()}});
  }else{
    await api('pos_stock',{method:'POST',body:{location_id,product_code:item.product_code,product_name:item.product_name,qty:item.qty}});
  }
  await api('pos_stock_movements',{method:'POST',body:{location_id,product_code:item.product_code,product_name:item.product_name,movement_type:'purchase',qty_change:item.qty,reference_table:'pos_purchases',reference_id:purchaseId,notes:'فاتورة شراء'}});
}

function openTab(tab){const btn=document.querySelector(`nav button[data-tab="${tab}"]`); if(btn && btn.style.display!=='none') btn.click();}


q('saleItemsBody')?.addEventListener('focusin',e=>{const tr=e.target.closest('tr'); if(tr) lastFocusedSaleRow=tr;});
function selectSaleItemRow(tr){
  if(!tr) return;
  q('saleItemsBody')?.querySelectorAll('tr').forEach(r=>r.classList.remove('selected-row'));
  tr.classList.add('selected-row');
  lastFocusedSaleRow=tr;
}
q('saleItemsBody')?.addEventListener('click',e=>{const tr=e.target.closest('tr'); if(tr) selectSaleItemRow(tr);});
function firstEditableSaleCell(){return q('saleItemsBody')?.querySelector('tr .si-qty, tr .si-code')}
function focusBarcode(){const el=q('saleBarcodeInput'); if(el){el.focus();el.select?.();}}
function setupSaleTabFlow(){
  const ids=['saleCustomer','saleInvoiceNo','salePrintAfterSave','saleNewCustomerName','saleNewCustomerPhone','saleNotes'];
  ids.forEach(id=>{const el=q(id); if(el) el.tabIndex=-1;});
  if(q('saleBarcodeInput')) q('saleBarcodeInput').tabIndex=1;
}
function toggleSupervisorMargins(){
  const sales=q('sales'); if(!sales)return;
  const hidden=sales.classList.toggle('hide-margins');
  const btn=[...document.querySelectorAll('.rail-btn')].find(b=>b.textContent.includes('الهامش'));
  btn?.classList.toggle('margin-toggle-active',!hidden);
  toast(hidden?'تم إخفاء الهامش':'تم إظهار الهامش');
}
function removeSelectedSaleRow(){
  const tr=lastFocusedSaleRow;
  if(!tr || !tr.closest('#saleItemsBody')){toast('اختر سطرًا أولاً','warn');return;}
  tr.remove(); lastFocusedSaleRow=null; updateSaleTotal(); focusBarcode();
}
function focusSelectedQty(){
  const tr=lastFocusedSaleRow || q('saleItemsBody')?.lastElementChild;
  const inp=tr?.querySelector('.si-qty');
  if(inp){selectSaleItemRow(tr); inp.focus(); inp.select();}
}
async function instantCashOut(){
  if(!q('sales')?.classList.contains('active')) return;
  const items=getSaleItems();
  if(!items.length){toast('أضف صنفًا أولاً','warn'); focusBarcode(); return;}
  setFullPayment('cash');
  saleSaveMode='new';
  q('salePrintAfterSave').value='yes';
  q('saleForm').requestSubmit();
}
function closeTopSaleLayer(){
  if(q('saleProductPickerModal')?.classList.contains('show')){closeSaleProductPicker();return true;}
  if(q('productViewModal')?.classList.contains('show')){closeProductViewModal();return true;}
  if(q('movementsModal')?.classList.contains('show')){closeMovementsModal();return true;}
  if(q('printPreviewModal')?.classList.contains('show')){closePrintPreview();return true;}
  if(q('quickProductModal')?.classList.contains('show')){closeQuickProductModal();return true;}
  if(q('saleReturnModal')?.classList.contains('show')){closeSaleReturnModal();return true;}
  if(q('shortcutsModal')?.classList.contains('show')){q('shortcutsModal').classList.remove('show');return true;}
  if(q('calculatorPanel')?.classList.contains('show')){q('calculatorPanel').classList.remove('show');return true;}
  if(q('salePaymentScreen')?.classList.contains('payment-open')){closeSalePaymentScreen();return true;}
  return false;
}
function saleModalOpen(){return !!document.querySelector('#saleProductPickerModal.show,#productViewModal.show,#movementsModal.show,#printPreviewModal.show,#quickProductModal.show,#saleReturnModal.show,#shortcutsModal.show')}


q('saleForm')?.addEventListener('input',saveActiveSaleDraft);
q('saleForm')?.addEventListener('change',saveActiveSaleDraft);

document.querySelectorAll('nav button').forEach(btn=>btn.addEventListener('click',()=>{
  if(q('sales')?.classList.contains('active') && btn.dataset.tab!=='sales' && saleHasContent() && !confirm('يوجد فاتورة بيع غير محفوظة. هل تريد مغادرة الشاشة وفقدانها؟')) return;
  document.querySelectorAll('nav button').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  btn.classList.add('active');
  q(btn.dataset.tab).classList.add('active');
  if(btn.dataset.tab==='sales') document.body.classList.add('nav-collapsed');
  else document.body.classList.toggle('nav-collapsed', (localStorage.getItem('posNavCollapsed')==='1'));
  if(btn.dataset.tab==='sales'){ if(!editingSaleId && !saleHasContent()){q('saleItemsBody').innerHTML=''; ensureSaleInvoiceNo(false);} setTimeout(()=>q('saleBarcodeInput')?.focus(),50); }
  if(btn.dataset.tab==='reports' && btn.dataset.reportDefault){setTimeout(()=>showReport(btn.dataset.reportDefault),50);}
  if(btn.dataset.tab==='dailyCashClosing'){setTimeout(()=>renderDailyCashReport(),50);}
}));
window.addEventListener('beforeunload',e=>{ if(saleHasContent()){ e.preventDefault(); e.returnValue=''; } });
document.addEventListener('keydown',e=>{
  const salesActive=q('sales')?.classList.contains('active');
  const tag=(document.activeElement?.tagName||'').toLowerCase();
  const textFocused=['input','textarea','select'].includes(tag);
  if(e.key==='F1'||e.key==='?'||e.key==='؟'){e.preventDefault();q('shortcutsModal').classList.toggle('show');return;}
  if(e.key==='Escape'){if(closeTopSaleLayer()){e.preventDefault(); focusBarcode();} return;}
  if(e.key==='F3'){e.preventDefault(); if(q('proformas')?.classList.contains('active')) openProformaProductPicker(); else if(q('purchases')?.classList.contains('active')) openPurchaseProductPicker(); else if(q('transfers')?.classList.contains('active')) openTransferProductPicker(); else openSaleProductPicker();return;}
  if(!salesActive) return;
  if((e.shiftKey&&e.key==='Enter') || e.code==='NumpadAdd'){e.preventDefault(); instantCashOut(); return;}
  if((e.key==='/'||e.key==='~') && !saleModalOpen()){e.preventDefault(); focusBarcode(); return;}
  if(e.key==='Delete' && !textFocused && !saleModalOpen()){e.preventDefault(); removeSelectedSaleRow(); return;}
  if(e.key==='F2'){e.preventDefault(); focusSelectedQty(); return;}
  if(e.key==='F6'){e.preventDefault();saleSaveMode='new';q('salePrintAfterSave').value='no'; if(q('salePaymentScreen')?.classList.contains('payment-open')) q('saleForm').requestSubmit(); else openSalePaymentScreen();return;}
  if(e.key==='F7'){e.preventDefault();saleSaveMode='new';q('salePrintAfterSave').value='yes'; if(q('salePaymentScreen')?.classList.contains('payment-open')) q('saleForm').requestSubmit(); else openSalePaymentScreen();return;}
  if(e.key==='F8'){e.preventDefault(); openSalePaymentScreen(); setFullPayment('cash'); return;}
  if(e.key==='F9'){e.preventDefault(); openSalePaymentScreen(); setFullPayment('bank'); return;}
  if(e.key==='F10'){e.preventDefault(); openSalePaymentScreen(); setFullPayment('card'); return;}
  if(document.activeElement===q('saleBarcodeInput') && e.key==='Tab'){
    e.preventDefault();
    const target=lastFocusedSaleRow?.querySelector('.si-qty') || firstEditableSaleCell();
    if(target){target.focus(); target.select?.();} else addSaleRowAndFocus();
    return;
  }
  // Broad-spectrum focus: if the cashier types while no field/modal is active, send input to scanner box.
  if(!textFocused && !saleModalOpen() && e.key.length===1){focusBarcode();}
});








function draftKeyName(type){return `posDraftKey_${type}_${appUser?.identifier||'user'}_${appUser?.branch_id||'branch'}`}
function getDraftKey(type){
  const k=draftKeyName(type); let v=localStorage.getItem(k);
  if(!v){v=(crypto?.randomUUID?.()||(`${type}-`+Date.now()+'-'+Math.random().toString(36).slice(2))); localStorage.setItem(k,v);}
  return v;
}
function clearDraftKey(type){try{localStorage.removeItem(draftKeyName(type))}catch(e){}}
function makeSaleInvoiceNo(){return ''}
function ensureSaleInvoiceNo(force=false){
  const el=q('saleInvoiceNo'); if(!el) return '';
  if(force || !el.value) el.value='سيولد تلقائيًا';
  return el.value;
}

function saleDraftStorageKey(){return `posActiveSaleDraft_${appUser?.identifier||'user'}_${appUser?.branch_id||'branch'}`}
function parkedSalesKey(){return `posParkedSales_${appUser?.identifier||'user'}_${appUser?.branch_id||'branch'}`}
let suppressSaleDraftSave=false, saleDraftTimer=null;
function collectSaleDraft(){
  return {
    ts:Date.now(),
    location_id:q('saleLocation')?.value||appUser?.branch_id||'',
    sale_date:q('saleDate')?.value||'',
    customer_id:q('saleCustomer')?.value||'',
    customer_name:q('saleNewCustomerName')?.value||'',
    customer_phone:q('saleNewCustomerPhone')?.value||'',
    notes:q('saleNotes')?.value||'',
    discount:q('saleDiscount')?.value||'0',
    print_after:q('salePrintAfterSave')?.value||'yes',
    cash:q('saleCashAmount')?.value||'0', bank:q('saleBankAmount')?.value||'0', card:q('saleCardAmount')?.value||'0',
    items:[...q('saleItemsBody').querySelectorAll('tr')].map(tr=>({
      product_code:tr.querySelector('.si-code')?.value||'',
      product_name:tr.querySelector('.si-name')?.value||'',
      qty:tr.querySelector('.si-qty')?.value||'1',
      unit_price:tr.querySelector('.si-price')?.value||'0',
      discount_text:tr.querySelector('.si-discount')?.value||''
    })).filter(x=>x.product_code||x.product_name)
  };
}
function restoreSaleDraft(d){
  if(!d) return;
  suppressSaleDraftSave=true;
  q('saleItemsBody').innerHTML='';
  if(q('saleLocation')) q('saleLocation').value=d.location_id||appUser?.branch_id||'';
  if(q('saleDate')) q('saleDate').value=d.sale_date||new Date().toISOString().slice(0,10);
  if(q('saleCustomer')) q('saleCustomer').value=d.customer_id||'';
  if(q('saleNewCustomerName')) q('saleNewCustomerName').value=d.customer_name||'';
  if(q('saleNewCustomerPhone')) q('saleNewCustomerPhone').value=d.customer_phone||'';
  if(q('saleNotes')) q('saleNotes').value=d.notes||'';
  if(q('saleDiscount')) q('saleDiscount').value=d.discount||0;
  if(q('salePrintAfterSave')) q('salePrintAfterSave').value=d.print_after||'yes';
  (d.items||[]).forEach(it=>addSaleRow(it));
  if(q('saleCashAmount')){q('saleCashAmount').value=d.cash||0; q('saleBankAmount').value=d.bank||0; q('saleCardAmount').value=d.card||0;}
  updateSaleTotal(); refreshSaleAvailability();
  suppressSaleDraftSave=false;
  saveActiveSaleDraft();
}
function saveActiveSaleDraft(){
  if(suppressSaleDraftSave) return;
  clearTimeout(saleDraftTimer);
  saleDraftTimer=setTimeout(()=>{
    try{const d=collectSaleDraft(); if(d.items.length) localStorage.setItem(saleDraftStorageKey(),JSON.stringify(d)); else localStorage.removeItem(saleDraftStorageKey());}catch(e){console.warn('draft save failed',e)}
  },180);
}
function clearActiveSaleDraft(){try{localStorage.removeItem(saleDraftStorageKey())}catch(e){}}
function tryRestoreActiveSaleDraft(){
  try{
    const raw=localStorage.getItem(saleDraftStorageKey()); if(!raw) return;
    const d=JSON.parse(raw); if(!d?.items?.length) return;
    if(confirm('توجد فاتورة بيع غير محفوظة. هل تريد استرجاعها؟')) restoreSaleDraft(d); else clearActiveSaleDraft();
  }catch(e){console.warn('draft restore failed',e)}
}
function resetSaleFormWithConfirm(){
  if(saleHasContent() && !confirm('يوجد أصناف في الفاتورة. هل تريد تفريغها وبدء فاتورة جديدة؟')) return;
  clearActiveSaleDraft(); clearDraftKey('sale'); resetSaleForm();
}
function parkCurrentSale(){
  const d=collectSaleDraft();
  if(!d.items.length){toast('لا توجد فاتورة لتعليقها','warn');return;}
  const arr=JSON.parse(localStorage.getItem(parkedSalesKey())||'[]');
  arr.unshift({...d,id:crypto?.randomUUID?.()||String(Date.now())});
  localStorage.setItem(parkedSalesKey(),JSON.stringify(arr.slice(0,30)));
  clearActiveSaleDraft(); clearDraftKey('sale'); resetSaleForm(); toast('تم تعليق الفاتورة','success');
}
function resumeParkedSale(){
  const arr=JSON.parse(localStorage.getItem(parkedSalesKey())||'[]');
  if(!arr.length){toast('لا توجد فواتير معلقة','info');return;}
  const label=arr.map((d,i)=>`${i+1}) ${new Date(d.ts).toLocaleString('ar-LY')} - ${d.items.length} صنف - ${d.customer_name||'زبون نقدي'}`).join('\n');
  const n=Number(prompt('اختر رقم الفاتورة المعلقة:\n'+label,'1'));
  if(!n||!arr[n-1]) return;
  if(saleHasContent() && !confirm('سيتم استبدال الفاتورة الحالية. متابعة؟')) return;
  const [d]=arr.splice(n-1,1); localStorage.setItem(parkedSalesKey(),JSON.stringify(arr));
  restoreSaleDraft(d); openTab('sales'); toast('تم استرجاع الفاتورة المعلقة','success');
}
function saleHasContent(){ return q('saleItemsBody') && getSaleItems().length>0; }

function openSalePaymentScreen(){
  const items=getSaleItems();
  if(!items.length){toast('أضف صنفًا واحدًا على الأقل قبل الدفع');return;}
  updateSaleTotal();
  const total=Number((q('saleTotal').textContent||'0').replace(/,/g,''))||0;
  const entered=getSalePaymentBreakdown().reduce((a,x)=>a+Number(x.amount||0),0);
  const method=q('salePaymentMethod').value;
  const payType=method==='bank_transfer'?'bank':method==='card'?'card':'cash';
  if(entered===0 && method!=='credit' && total!==0){
    const id=payType==='bank'?'saleBankAmount':payType==='card'?'saleCardAmount':'saleCashAmount';
    if(q(id)) q(id).value=Math.abs(total);
    updateSaleTotal();
  }
  q('paymentBackdrop')?.classList.add('show');
  q('salePaymentScreen')?.classList.add('payment-open');
  setTimeout(()=>focusPay(payType),80);
}
function closeSalePaymentScreen(){
  q('paymentBackdrop')?.classList.remove('show');
  q('salePaymentScreen')?.classList.remove('payment-open');
  setTimeout(()=>q('saleBarcodeInput')?.focus(),50);
}

function addSaleRowAndFocus(){addSaleRow(); setTimeout(()=>q('saleItemsBody')?.lastElementChild?.querySelector('.si-code')?.focus(),30)}
function currentSaleLine(){return lastFocusedSaleRow || q('saleItemsBody')?.lastElementChild || null}
async function editSelectedSaleLinePrice(){
  const tr=currentSaleLine(); if(!tr){toast('لا يوجد صنف لتعديل السعر');return;}
  const inp=tr.querySelector('.si-price'); const v=prompt('اكتب السعر الجديد', inp?.value||'0');
  if(v==null) return; const n=moneyVal(v); if(isNaN(n)||n<0){toast('السعر غير صحيح');return;}
  const code=(tr.querySelector('.si-code')?.value||'').split('|')[0].trim(); const p=productByCode(code); const oldPrice=Number(p?.retail_price||inp.value||0);
  if(Math.abs(n-oldPrice)>0.0001){const ok=await requestSupervisorApproval('تعديل سعر البيع',`${code} من ${money(oldPrice)} إلى ${money(n)}`); if(!ok)return;}
  inp.value=n; updateSaleTotal(); inp.focus();
}
function applyDiscountCoupon(){
  const raw=prompt('اكتب قيمة الخصم أو نسبة مثل 10%',''); if(raw==null) return;
  let subtotal=0; [...q('saleItemsBody').querySelectorAll('tr')].forEach(tr=>{const qty=Number(tr.querySelector('.si-qty')?.value||0), price=moneyVal(tr.querySelector('.si-price')?.value), base=qty*price; subtotal+=Math.max(0,base-calcLineDiscount(tr.querySelector('.si-discount')?.value||'',base));});
  q('saleDiscount').value=calcLineDiscount(raw,subtotal); updateSaleTotal();
}
function openQuickProductModal(){q('quickProductModal').classList.add('show'); setTimeout(()=>q('quickProductCode')?.focus(),50)}
function closeQuickProductModal(){q('quickProductModal').classList.remove('show')}
async function saveQuickProduct(){
  const code=q('quickProductCode').value.trim(), name=q('quickProductName').value.trim();
  if(!code||!name){toast('اكتب الكود واسم الصنف');return;}
  try{
    showLoading(true);
    let p=products.find(x=>String(x.code)===String(code));
    if(!p){
      await api('pos_products',{method:'POST',body:{code,name,retail_price:moneyVal(q('quickProductRetail').value),purchase_price:moneyVal(q('quickProductCost').value),barcode:q('quickProductBarcode').value.trim()||null,category:q('quickProductCategory').value.trim()||null,active:true,updated_at:new Date().toISOString()}});
      await loadAll(); p=products.find(x=>String(x.code)===String(code));
      toast('تم إنشاء الصنف وإضافته للفاتورة');
    }else toast('الكود موجود مسبقًا، تمت إضافته للفاتورة');
    if(p) addOrIncrementSaleProduct(p,1);
    closeQuickProductModal(); ['quickProductCode','quickProductName','quickProductRetail','quickProductCost','quickProductBarcode','quickProductCategory'].forEach(id=>{if(q(id))q(id).value=''});
  }catch(err){console.error(err);toast('خطأ في إنشاء الصنف: '+err.message)} finally{showLoading(false);window.__busy=false}
}
function toggleCalculator(){q('calculatorPanel').classList.toggle('show')}
function calcUpdate(){q('calcDisplay').value=calcExpr||'0'}
function calcPress(v){if(calcExpr==='0')calcExpr=''; calcExpr+=v; calcUpdate()}
function calcClear(){calcExpr=''; calcUpdate()}
function calcBack(){calcExpr=calcExpr.slice(0,-1); calcUpdate()}
function calcEquals(){try{const safe=calcExpr.replace(/[^0-9+\-*/.()]/g,''); calcExpr=String(Function('return ('+safe+')')()); calcUpdate()}catch(e){toast('عملية غير صحيحة')}}
function calcCopyToPrice(){calcEquals(); const tr=currentSaleLine(); const inp=tr?.querySelector('.si-price'); if(inp){inp.value=moneyVal(q('calcDisplay').value); updateSaleTotal(); inp.focus();}else toast('اختر سطر صنف أولاً')}

function closeSaleReturnModal(){q('saleReturnModal').classList.remove('show')}
async function openSaleReturn(id){
  try{
    showLoading(true);
    returningSale=sales.find(x=>x.id===id) || (await api('pos_sales',{qs:`?select=*&id=eq.${id}&limit=1`}))[0];
    returningSaleId=id;
    returningSaleItems=await api('pos_sale_items',{qs:`?select=*&sale_id=eq.${id}&order=created_at.asc`});
    q('saleReturnTitle').textContent='فاتورة مرتجع بيع';
    q('saleReturnSub').textContent=(returningSale.invoice_no||returningSale.id.slice(0,8))+' - '+returningSale.sale_date;
    const rl=locations.find(x=>x.id===returningSale.location_id), rc=customers.find(x=>x.id===returningSale.customer_id);
    q('returnInvoiceInfo').innerHTML=`<div class="cell"><div class="lbl">الزبون</div><div class="val">${esc(rc?.name||'زبون نقدي')}</div></div><div class="cell"><div class="lbl">الفرع</div><div class="val">${esc(rl?.name||'')}</div></div><div class="cell"><div class="lbl">الفاتورة الأصلية</div><div class="val ltr">${esc(returningSale.invoice_no||returningSale.id.slice(0,8))}</div></div><div class="cell"><div class="lbl">الإجمالي الأصلي</div><div class="val">${money(returningSale.total)} ${APP_CONFIG.currency}</div></div>`;
    q('saleReturnDate').value=new Date().toISOString().slice(0,10);
    q('saleReturnRefundMethod').value=Number(returningSale.balance_due||0)>0?'credit_reduction':'cash';
    q('saleReturnItemsBody').innerHTML=returningSaleItems.map(it=>`<tr><td class="ltr">${esc(it.product_code)}</td><td>${esc(it.product_name)}</td><td>${money(it.qty)}</td><td>${money(it.unit_price)}</td><td>${money(it.line_discount||0)}</td><td><input class="ri-qty" data-item-id="${it.id}" type="number" step="1" min="0" max="${Number(it.qty||0)}" value="0" oninput="updateSaleReturnTotal()"></td></tr>`).join('');
    updateSaleReturnTotal(); q('saleReturnModal').classList.add('show');
  }catch(err){console.error(err);toast('خطأ في فتح المرتجع: '+err.message)} finally{showLoading(false);window.__busy=false}
}
function getReturnItems(){
  return [...q('saleReturnItemsBody').querySelectorAll('.ri-qty')].map(inp=>{
    const it=returningSaleItems.find(x=>x.id===inp.dataset.itemId); const qty=Math.min(Number(inp.value||0),Number(it?.qty||0));
    const base=qty*Number(it?.unit_price||0); const perUnitDiscount=Number(it?.qty||0)>0?Number(it?.line_discount||0)/Number(it.qty):0; const line_discount=Math.min(base, perUnitDiscount*qty);
    return it&&qty>0?{sale_item_id:it.id,product_code:it.product_code,product_name:it.product_name,qty,unit_price:Number(it.unit_price||0),line_discount,line_total:Math.max(0,base-line_discount)}:null;
  }).filter(Boolean);
}
function updateSaleReturnTotal(){const total=getReturnItems().reduce((a,x)=>a+Number(x.line_total||0),0); q('saleReturnTotal').textContent=`الإجمالي: ${money(total)} ${APP_CONFIG.currency}`}




function accountTypeLabel(t){return {cash:'خزينة نقدية',bank:'حساب مصرفي',card:'حساب بطاقة'}[t]||t}
function accountAcceptedMethods(a){
  // Simplified workflow: every bank account automatically supports both bank transfer and card payments.
  if(a?.account_type==='cash') return ['cash'];
  if(a?.account_type==='bank') return ['bank_transfer','card'];
  if(a?.account_type==='card') return ['card'];
  return [];
}
function accountSupports(a,method){return accountAcceptedMethods(a).includes(method)}
function financeAccountOptionsFor(method,blank='اختر الحساب'){
  const branch=appUser?.branch_id||'';
  const rows=financeAccounts.filter(a=>{
    if(method==='cash') return a.account_type==='cash' && (!branch || a.location_id===branch);
    if(method==='bank_transfer' || method==='card') return a.account_type==='bank' || a.account_type==='card';
    return accountSupports(a,method);
  });
  return `<option value="">${blank}</option>`+rows.map(a=>`<option value="${esc(a.id)}">${esc(a.name)} - ${esc(accountTypeLabel(a.account_type))}</option>`).join('');
}
function toggleFinancePaymentMethods(){
  const box=q('financePaymentMethodsBox'); if(box) box.style.display='none';
}
function selectedFinanceAcceptedMethods(){
  const type=q('financeAccountType')?.value;
  if(type==='cash') return ['cash'];
  if(type==='bank') return ['bank_transfer','card'];
  if(type==='card') return ['card'];
  return [];
}
function financeAccountName(id){return financeAccounts.find(a=>a.id===id)?.name||''}
function defaultAccountFor(method, location_id){
  if(method==='cash') return q('saleCashAccount')?.value || financeAccounts.find(a=>accountSupports(a,'cash') && a.location_id===location_id)?.id || financeAccounts.find(a=>accountSupports(a,'cash'))?.id || null;
  if(method==='bank_transfer') return q('saleBankAccount')?.value || financeAccounts.find(a=>accountSupports(a,'bank_transfer'))?.id || null;
  if(method==='card') return q('saleCardAccount')?.value || financeAccounts.find(a=>accountSupports(a,'card'))?.id || null;
  return null;
}
async function addFinanceMovement(account_id,direction,movement_type,amount,date,reference_table,reference_id,notes,strict=true){
  if(!account_id) throw new Error('لم يتم اختيار حساب مالي للحركة');
  if(!(Number(amount)>0)) throw new Error('مبلغ الحركة المالية غير صحيح');
  await api('pos_finance_movements',{method:'POST',body:{account_id,direction,movement_type,amount:Number(amount),movement_date:date,reference_table,reference_id,notes}});
}
async function recordSaleFinanceMovements(saleId, location_id, saleDate, payRows, saleTotal=0){
  const isRefund=Number(saleTotal||0)<0;
  for(const r of payRows){
    await addFinanceMovement(defaultAccountFor(r.payment_method,location_id),isRefund?'out':'in',isRefund?'customer_refund':'sale_payment',r.amount,saleDate,'pos_sales',saleId,isRefund?`Customer Refund / استرداد للزبون - فاتورة ${q('saleInvoiceNo')?.value||''}${appUser?.identifier?' - المستخدم: '+appUser.identifier:''}`:`تحصيل فاتورة بيع${appUser?.identifier?' - المستخدم: '+appUser.identifier:''}`,isRefund)
  }
}
function renderFinance(){
  if(!q('financeAccountsBody')) return;
  const cash=financeAccounts.filter(a=>a.account_type==='cash').reduce((x,a)=>x+Number(a.balance||0),0), bank=financeAccounts.filter(a=>a.account_type==='bank').reduce((x,a)=>x+Number(a.balance||0),0), card=financeAccounts.filter(a=>a.account_type==='card').reduce((x,a)=>x+Number(a.balance||0),0);
  q('financeCashTotal').textContent=money(cash); q('financeBankTotal').textContent=money(bank); q('financeCardTotal').textContent=money(card);
  const month=new Date().toISOString().slice(0,7); q('financeMonthExpenses').textContent=money(expenses.filter(e=>(e.expense_date||'').startsWith(month)).reduce((a,e)=>a+Number(e.amount||0),0)+salaryPayments.filter(e=>(e.payment_date||'').startsWith(month)).reduce((a,e)=>a+Number(e.amount||0),0));
  q('financeAccountsBody').innerHTML=financeAccounts.map(a=>{const l=locations.find(x=>x.id===a.location_id); const methods=accountAcceptedMethods(a).map(typeLabel).join(' / '); return `<tr><td>${esc(a.name)}</td><td>${accountTypeLabel(a.account_type)}</td><td>${esc(methods)}</td><td>${esc(l?.name||'عام')}</td><td>${esc(a.bank_name)}</td><td><b>${money(a.balance)}</b></td><td><button class="btn secondary" type="button" onclick="editFinanceAccount('${a.id}')">تعديل</button></td></tr>`}).join('')||'<tr><td colspan="7">لا توجد حسابات مالية.</td></tr>';
  q('financeMovementsBody').innerHTML=financeMovements.slice(0,80).map(m=>`<tr><td>${esc(m.movement_date)}</td><td>${esc(financeAccountName(m.account_id))}</td><td>${esc(typeLabel(m.movement_type))}</td><td>${m.direction==='in'?money(m.amount):''}</td><td>${m.direction==='out'?money(m.amount):''}</td><td>${esc(m.notes)}</td></tr>`).join('')||'<tr><td colspan="6">لا توجد حركات مالية.</td></tr>';
}

function resetFinanceAccountForm(){
  editingFinanceAccountId=null;
  q('financeAccountForm')?.reset();
  if(q('financeOpeningBalance')) q('financeOpeningBalance').value=0;
  if(q('financeAccountSubmitBtn')) q('financeAccountSubmitBtn').textContent='حفظ الحساب';
  q('financeAccountCancelBtn')?.classList.add('hidden');
  toggleFinancePaymentMethods();
}
function editFinanceAccount(id){
  const a=financeAccounts.find(x=>x.id===id); if(!a){toast('لم يتم العثور على الحساب','warn'); return;}
  editingFinanceAccountId=id;
  openTab('finance');
  q('financeAccountName').value=a.name||'';
  q('financeAccountType').value=a.account_type||'bank';
  q('financeAccountLocation').value=a.location_id||'';
  q('financeBankName').value=a.bank_name||'';
  q('financeAccountNo').value=a.account_no||'';
  q('financeOpeningBalance').value=Number(a.opening_balance||0);
  q('financeAccountNotes').value=a.notes||'';
  const methods=accountAcceptedMethods(a);
  if(q('financeAcceptBankTransfer')) q('financeAcceptBankTransfer').checked=methods.includes('bank_transfer');
  if(q('financeAcceptCard')) q('financeAcceptCard').checked=methods.includes('card');
  toggleFinancePaymentMethods();
  if(q('financeAccountSubmitBtn')) q('financeAccountSubmitBtn').textContent='حفظ تعديل الحساب';
  q('financeAccountCancelBtn')?.classList.remove('hidden');
  q('financeAccountName').focus();
}
function fillSettingsForm(){if(!q('settingsBusinessName'))return; q('settingsBusinessName').value=APP_CONFIG.businessName; q('settingsTagline').value=APP_CONFIG.tagline; q('settingsCurrency').value=APP_CONFIG.currency; q('settingsLowStock').value=APP_CONFIG.lowStockThreshold;}
function resetLocalSettings(){localStorage.removeItem('posAppConfig'); location.reload()}

q('saleReturnForm').addEventListener('submit', async e=>{
  e.preventDefault();
  if(window.__busy) return; window.__busy=true;
  const items=getReturnItems(); if(!items.length){toast('اختر كمية مرتجع أولاً','warn'); window.__busy=false; return;}
  try{
    showLoading(true);
    const method=q('saleReturnRefundMethod').value;
    const account_id=['cash','bank_transfer','card'].includes(method) ? defaultFinanceAccountFor(method) : null;
    if(['cash','bank_transfer','card'].includes(method) && !account_id){toast('اختر/أنشئ حساب مالي لطريقة الاسترداد أولاً','warn'); window.__busy=false; return;}
    const body={sale_id:returningSaleId,return_date:q('saleReturnDate').value,location_id:returningSale.location_id,customer_id:returningSale.customer_id,refund_method:method,account_id,notes:q('saleReturnNotes').value.trim()||null};
    const idem=getDraftKey('saleReturn');
    await rpc('post_sale_return_transaction',{p_return:body,p_items:items,p_idempotency_key:idem,p_user_identifier:appUser?.identifier||''});
    await logAction('sale_return','pos_sale_returns',body.sale_id,`${items.length} صنف - ${money(items.reduce((a,x)=>a+x.line_total,0))} ${APP_CONFIG.currency}`);
    clearDraftKey('saleReturn');
    closeSaleReturnModal(); toast('تم حفظ فاتورة المرتجع وتحديث المخزون','success'); await loadAll();
  }catch(err){console.error(err);toast('خطأ في حفظ فاتورة المرتجع: '+friendlyError(err),'error')}
  finally{showLoading(false);window.__busy=false}
});




q('financeAccountForm')?.addEventListener('submit',async e=>{e.preventDefault();if(window.__busy)return;window.__busy=true;try{showLoading(true);const body={name:q('financeAccountName').value.trim(),account_type:q('financeAccountType').value,location_id:q('financeAccountLocation').value||null,bank_name:q('financeBankName').value.trim()||null,account_no:q('financeAccountNo').value.trim()||null,opening_balance:moneyVal(q('financeOpeningBalance').value),notes:q('financeAccountNotes').value.trim()||null}; if(editingFinanceAccountId){await api('pos_finance_accounts',{method:'PATCH',qs:`?id=eq.${editingFinanceAccountId}`,body:{...body,updated_at:new Date().toISOString()}}); toast('تم تعديل الحساب');}else{await api('pos_finance_accounts',{method:'POST',body}); toast('تم حفظ الحساب');} resetFinanceAccountForm(); await loadAll();}catch(err){console.error(err);toast('خطأ في حفظ الحساب: '+err.message+' - تأكد من تشغيل SQL طرق الدفع للحسابات')}finally{showLoading(false);window.__busy=false}});
q('financeTransferForm')?.addEventListener('submit',async e=>{e.preventDefault();if(window.__busy)return;window.__busy=true;try{showLoading(true);const from=q('financeTransferFrom').value,to=q('financeTransferTo').value,amount=moneyVal(q('financeTransferAmount').value),date=q('financeTransferDate').value,notes=q('financeTransferNotes').value.trim()||'تحويل مالي';if(from===to){toast('لا يمكن التحويل لنفس الحساب','warn');window.__busy=false;return;}validateAccountingTransfer(amount);await addFinanceMovement(from,'out','transfer_out',amount,date,'pos_finance_movements',null,notes);await addFinanceMovement(to,'in','transfer_in',amount,date,'pos_finance_movements',null,notes);e.target.reset();setToday();toast('تم حفظ التحويل');await loadAll();}catch(err){console.error(err);toast('خطأ في التحويل: '+err.message)}finally{showLoading(false);window.__busy=false}});
q('expenseForm')?.addEventListener('submit',async e=>{e.preventDefault();if(window.__busy)return;window.__busy=true;try{showLoading(true);const method=q('expensePaymentMethod')?.value||'cash'; if(q('expenseLocation')&&appUser?.branch_id) q('expenseLocation').value=appUser.branch_id; if(method==='cash') selectDefaultExpenseAccount(); const body={expense_date:q('expenseDate').value,location_id:q('expenseLocation')?.value||appUser?.branch_id||null,account_id:q('expenseAccount').value,category_id:q('expenseCategory').value||null,title:q('expenseTitle').value.trim(),amount:moneyVal(q('expenseAmount').value),notes:q('expenseNotes').value.trim()||null}; if(!body.location_id)throw new Error('لا يوجد فرع مرتبط بالمستخدم'); if(!body.account_id)throw new Error('اختر الخزينة / الحساب'); validateAccountingOutflow('expense',body.amount);const r=await api('pos_expenses',{method:'POST',body});await logAction('expense','pos_expenses',r[0].id,`${body.title} - ${money(body.amount)} ${APP_CONFIG.currency}`);await addFinanceMovement(body.account_id,'out','expense',body.amount,body.expense_date,'pos_expenses',r[0].id,body.title);e.target.reset(); if(q('expenseLocation')&&appUser?.branch_id) q('expenseLocation').value=appUser.branch_id; selectDefaultExpenseAccount(); setToday();toast('تم حفظ المصروف');await loadAll();}catch(err){console.error(err);toast('خطأ في حفظ المصروف: '+err.message)}finally{showLoading(false);window.__busy=false}});
q('employeeForm')?.addEventListener('submit',async e=>{e.preventDefault();if(window.__busy)return;window.__busy=true;try{showLoading(true);await api('pos_employees',{method:'POST',body:{name:q('employeeName').value.trim(),phone:q('employeePhone').value.trim()||null,position:q('employeePosition').value.trim()||null,monthly_salary:moneyVal(q('employeeMonthlySalary').value)}});e.target.reset();toast('تم حفظ الموظف');await loadAll();}catch(err){console.error(err);toast('خطأ في حفظ الموظف: '+err.message)}finally{showLoading(false);window.__busy=false}});
q('salaryPaymentForm')?.addEventListener('submit',async e=>{e.preventDefault();if(window.__busy)return;window.__busy=true;try{showLoading(true);const body={employee_id:q('salaryEmployee').value,account_id:q('salaryAccount').value,payment_date:q('salaryPaymentDate').value,period:q('salaryPeriod').value.trim()||null,amount:moneyVal(q('salaryAmount').value),notes:q('salaryNotes').value.trim()||null};validateAccountingOutflow('salary',body.amount);const r=await api('pos_salary_payments',{method:'POST',body});await addFinanceMovement(body.account_id,'out','salary',body.amount,body.payment_date,'pos_salary_payments',r[0].id,'مرتب موظف');e.target.reset();setToday();toast('تم دفع المرتب');await loadAll();}catch(err){console.error(err);toast('خطأ في دفع المرتب: '+err.message)}finally{showLoading(false);window.__busy=false}});

q('settingsForm')?.addEventListener('submit',e=>{
  e.preventDefault();
  Object.assign(APP_CONFIG,{businessName:q('settingsBusinessName').value.trim()||APP_CONFIG.businessName,tagline:q('settingsTagline').value.trim()||APP_CONFIG.tagline,currency:q('settingsCurrency').value.trim()||APP_CONFIG.currency,lowStockThreshold:Number(q('settingsLowStock').value||0)});
  localStorage.setItem('posAppConfig',JSON.stringify({businessName:APP_CONFIG.businessName,tagline:APP_CONFIG.tagline,currency:APP_CONFIG.currency,lowStockThreshold:APP_CONFIG.lowStockThreshold,customBrands:APP_CONFIG.customBrands||[],customModels:APP_CONFIG.customModels||[],customColors:APP_CONFIG.customColors||[]}));
  initBranding(); renderAll(); toast('تم حفظ الإعدادات');
});

q('productOptionForm')?.addEventListener('submit',e=>{
  e.preventDefault();
  const type=q('productOptionType').value, value=q('productOptionValue').value.trim();
  if(!value)return;
  addProductOption(type,value);
  q('productOptionValue').value='';
  toast('تمت إضافة القيمة إلى القوائم');
});

q('expenseCategoryForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const name=q('newExpenseCategoryName').value.trim(); if(!name)return;
  if(window.__busy)return; window.__busy=true;
  try{showLoading(true); await api('pos_expense_categories',{method:'POST',body:{name,active:true}}); q('newExpenseCategoryName').value=''; toast('تم إضافة تصنيف المصروف'); await loadAll();}
  catch(err){console.error(err);toast('خطأ في إضافة التصنيف: '+friendlyError(err),'error')}
  finally{showLoading(false);window.__busy=false}
});

q('roleForm').addEventListener('submit', async e=>{
  e.preventDefault();
  if(window.__busy) return; window.__busy=true;
  if(currentRole?.role!=='admin'){toast('هذه الصفحة للمدير فقط','warn'); window.__busy=false; return;}
  try{
    showLoading(true);
    const identifier=q('roleIdentifier').value.trim().toLowerCase();
    const body={identifier,display_name:q('roleDisplayName').value.trim()||null,role:q('roleName').value,location_name:null,active:true,notes:q('roleNotes').value.trim()||null,updated_at:new Date().toISOString()};
    const found=userRoles.find(r=>r.identifier===identifier);
    const newCode=q('roleCode')?.value.trim()||'';
    if(!found){
      if(!newCode) throw new Error('للمستخدم الجديد يجب كتابة كود الدخول أولاً');
      try{
        await rpc('create_app_user',{p_identifier:identifier,p_code:newCode});
      }catch(e){
        console.error('create app user failed',e);
        throw new Error('تم منع إنشاء مستخدم الدخول. أنشئ المستخدم في Supabase Auth أولاً: '+identifier+'@bag.com ثم احفظ الصلاحية. التفاصيل: '+friendlyError(e));
      }
    }else if(newCode){
      toast('ملاحظة: تغيير كود مستخدم موجود يتم من Supabase Auth وليس من جدول الصلاحيات','warn');
    }
    await rpc('upsert_pos_user_role',{p_identifier:identifier,p_display_name:body.display_name,p_role:body.role,p_notes:body.notes,p_active:true});
    toast(found?'تم تعديل الصلاحية':'تم حفظ الصلاحية وإنشاء مستخدم الدخول','success');
    e.target.reset(); await loadAll();
  }catch(err){console.error(err);toast('خطأ في حفظ الصلاحية: '+err.message+' - تأكد من تشغيل ملف users SQL')}
  finally{showLoading(false);window.__busy=false}
});

let editingCustomerId=null;
function resetCustomerForm(){
  editingCustomerId=null;
  const f=q('customerForm'); if(f) f.reset();
  if(q('customerOpening')) q('customerOpening').value=0;
  const btn=q('customerSubmitBtn'); if(btn) btn.textContent='حفظ الزبون';
  q('customerCancelEditBtn')?.classList.add('hidden');
}
function editCustomer(id){
  const c=customers.find(x=>x.id===id); if(!c){toast('لم يتم العثور على الزبون','warn');return;}
  editingCustomerId=id;
  openTab('customers');
  if(q('customerName')) q('customerName').value=c.name||'';
  if(q('customerPhone')) q('customerPhone').value=c.phone||'';
  if(q('customerAddress')) q('customerAddress').value=c.address||'';
  if(q('customerNotes')) q('customerNotes').value=c.notes||'';
  if(q('customerOpening')) q('customerOpening').value=0;
  const btn=q('customerSubmitBtn'); if(btn) btn.textContent='حفظ التعديل';
  q('customerCancelEditBtn')?.classList.remove('hidden');
  q('customerName')?.focus();
}
async function toggleCustomerActive(id, makeActive){
  if(window.__busy) return; window.__busy=true;
  try{
    showLoading(true);
    await api('pos_customers',{method:'PATCH',qs:`?id=eq.${id}`,body:{active:!!makeActive,updated_at:new Date().toISOString()}});
    toast(makeActive?'تم تفعيل الزبون':'تم تعطيل الزبون','success');
    if(editingCustomerId===id && !makeActive) resetCustomerForm();
    await loadAll();
  }catch(err){console.error(err);toast('تعذر تغيير حالة الزبون: '+friendlyError(err),'error')}
  finally{showLoading(false);window.__busy=false}
}
async function deleteCustomer(id){
  if(currentRole?.role!=='admin'){toast('الحذف متاح للمدير فقط','warn');return;}
  const c=customers.find(x=>x.id===id); if(!c){toast('لم يتم العثور على الزبون','warn');return;}
  if(!confirm(`هل تريد حذف الزبون "${c.name||''}"؟`)) return;
  if(window.__busy) return; window.__busy=true;
  try{
    showLoading(true);
    const hasSales=sales.some(s=>s.customer_id===id);
    const hasBalance=Math.abs(Number(c.balance||0))>0.001;
    if(hasSales||hasBalance){
      // لدى الزبون فواتير/رصيد: لا نحذف نهائيًا حتى لا نُتلف سجل الديون (يُحذف كشف الحساب تلقائيًا بسبب القيد المرجعي). نعطّله بدلًا من ذلك.
      await api('pos_customers',{method:'PATCH',qs:`?id=eq.${id}`,body:{active:false,updated_at:new Date().toISOString()}});
      await logAction('customer_deactivate','pos_customers',id,`تعطيل: ${c.name} - ${c.phone||''}`);
      const reasons=[]; if(hasSales) reasons.push('لديه فواتير بيع'); if(hasBalance) reasons.push(`لديه رصيد ${money(c.balance)} ${APP_CONFIG.currency}`);
      toast('لا يمكن الحذف النهائي ('+reasons.join('، ')+') — تم تعطيل الزبون وإخفاؤه. أظهره بخانة "إظهار المعطّلين" ثم فعّله إن لزم.','warn');
    }else{
      await api('pos_customers',{method:'DELETE',qs:`?id=eq.${id}`});
      await logAction('customer_delete','pos_customers',id,`حذف نهائي: ${c.name} - ${c.phone||''}`);
      toast('تم حذف الزبون نهائيًا','success');
    }
    if(editingCustomerId===id) resetCustomerForm();
    await loadAll();
  }catch(err){console.error(err);toast('تعذر حذف الزبون: '+friendlyError(err)+' — تأكد من تشغيل ملف صلاحية حذف الزبائن للمدير','error')}
  finally{showLoading(false);window.__busy=false}
}
q('customerForm').addEventListener('submit', async e=>{
  e.preventDefault();
  if(window.__busy) return; window.__busy=true;
  try{
    showLoading(true);
    const body={name:q('customerName').value.trim(),phone:q('customerPhone').value.trim()||null,address:q('customerAddress').value.trim()||null,notes:q('customerNotes').value.trim()||null};
    if(!body.name){toast('اكتب اسم الزبون','warn');return;}
    if(body.phone){
      const norm=normalizePhoneLY;
      const dup=customers.find(x=>x.id!==editingCustomerId && norm(x.phone)===norm(body.phone) && norm(body.phone));
      if(dup){toast(`رقم الهاتف مسجّل لزبون آخر: ${dup.name||''}`,'warn');return;}
    }
    if(editingCustomerId){
      await api('pos_customers',{method:'PATCH',qs:`?id=eq.${editingCustomerId}`,body:{...body,updated_at:new Date().toISOString()}});
      await logAction('customer_edit','pos_customers',editingCustomerId,`تعديل زبون: ${body.name} - ${body.phone||''}`);
      toast('تم تعديل بيانات الزبون','success');
    }else{
      const opening=Math.abs(moneyVal(q('customerOpening').value));
      const created=await api('pos_customers',{method:'POST',body:{...body,active:true}});
      const c=created[0];
      if(opening>0){
        const isDebit=q('customerOpeningType').value==='debit';
        await api('pos_customer_ledger',{method:'POST',body:{customer_id:c.id,entry_type:'opening',description:'رصيد افتتاحي',debit:isDebit?opening:0,credit:isDebit?0:opening}});
      }
      toast('تم حفظ الزبون','success');
    }
    resetCustomerForm(); await loadAll();
  }catch(err){console.error(err);toast('خطأ في حفظ الزبون: '+friendlyError(err),'error')}
  finally{showLoading(false);window.__busy=false}
});

q('customerPaymentForm').addEventListener('submit', async e=>{
  e.preventDefault();
  if(window.__busy) return; window.__busy=true;
  try{
    showLoading(true);
    const amount=moneyVal(q('customerPaymentAmount').value);
    validateAccountingPayment('customer',amount);
    const method=typeLabel(q('customerPaymentMethod').value);
    const notes=q('customerPaymentNotes').value.trim();
    const cp=await api('pos_customer_ledger',{method:'POST',body:{customer_id:q('customerPaymentCustomer').value,entry_date:q('customerPaymentDate').value,entry_type:'payment',description:notes||`دفعة زبون - ${method}`,debit:0,credit:amount}});
    await addFinanceMovement(q('customerPaymentFinanceAccount')?.value||defaultFinanceAccountFor(q('customerPaymentMethod').value),'in','customer_payment',amount,q('customerPaymentDate').value,'pos_customer_ledger',cp?.[0]?.id||null,notes||'دفعة من الزبون');
    e.target.reset(); setToday(); toast('تم تسجيل دفعة الزبون'); await loadAll();
  }catch(err){console.error(err);toast('خطأ في تسجيل الدفعة: '+err.message)}
  finally{showLoading(false);window.__busy=false}
});

q('saleForm').addEventListener('submit', async e=>{
  e.preventDefault();
  if(window.__busy) return; window.__busy=true;
  document.querySelectorAll('#salePaymentScreen .btn,.pos-mini-keypad .enter').forEach(b=>b.disabled=true);
  const items=getSaleItems();
  if(!items.length){toast('أضف صنف واحد على الأقل','warn'); window.__busy=false; document.querySelectorAll('#salePaymentScreen .btn,.pos-mini-keypad .enter').forEach(b=>b.disabled=false); return;}
  const location_id=canSelectSaleBranch() ? q('saleLocation').value : (appUser?.branch_id || q('saleLocation').value); if(q('saleLocation') && location_id) q('saleLocation').value=location_id; if(!location_id){toast('اختر فرع البيع','warn'); window.__busy=false; document.querySelectorAll('#salePaymentScreen .btn,.pos-mini-keypad .enter').forEach(b=>b.disabled=false); return;}
  updateSaleTotal();
  const subtotal=items.reduce((a,x)=>a+x.line_total,0); const discount=moneyVal(q('saleDiscount').value); const total=subtotal-discount;
  const payRows=getSalePaymentBreakdown(); const rawPaid=payRows.reduce((a,x)=>a+Number(x.amount||0),0); const isRefundInvoice=total<0; const refundRequired=Math.abs(total);
  if(!isRefundInvoice && rawPaid>total){toast('المدفوع أكبر من إجمالي الفاتورة. صحّح مبالغ الدفع قبل الحفظ.','warn'); openSalePaymentScreen(); window.__busy=false; document.querySelectorAll('#salePaymentScreen .btn,.pos-mini-keypad .enter').forEach(b=>b.disabled=false); return;}
  if(isRefundInvoice && Math.abs(rawPaid-refundRequired)>0.001){toast('هذه فاتورة مرتجع. يجب إدخال مبلغ الاسترداد كاملًا: '+money(refundRequired)+' '+APP_CONFIG.currency,'warn'); openSalePaymentScreen(); window.__busy=false; document.querySelectorAll('#salePaymentScreen .btn,.pos-mini-keypad .enter').forEach(b=>b.disabled=false); return;}
  if(isRefundInvoice){const missing=payRows.find(r=>!defaultAccountFor(r.payment_method,location_id)); if(missing){toast('اختر حسابًا ماليًا لطريقة الاسترداد: '+typeLabel(missing.payment_method),'warn'); openSalePaymentScreen(); window.__busy=false; document.querySelectorAll('#salePaymentScreen .btn,.pos-mini-keypad .enter').forEach(b=>b.disabled=false); return;}}
  const paid=isRefundInvoice?-rawPaid:rawPaid; const balance_due=isRefundInvoice?0:Math.max(0,total-rawPaid); if(total>0 && payRows.length===0 && balance_due===total){toast('يجب تحديد طريقة الدفع: كاش أو تحويل أو بطاقة أو آجل','warn'); window.__busy=false; document.querySelectorAll('#salePaymentScreen .btn,.pos-mini-keypad .enter').forEach(b=>b.disabled=false); return;} validateAccountingForSale(items,total,payRows,balance_due);
  const positiveSubtotal=items.filter(x=>Number(x.qty)>0).reduce((a,x)=>a+Math.max(0,Number(x.qty||0)*Number(x.unit_price||0)-Number(x.line_discount||0)),0);
  if(discount>0 && positiveSubtotal>0 && discount/positiveSubtotal>SUPERVISOR_DISCOUNT_THRESHOLD){const ok=await requestSupervisorApproval('خصم عالي على الفاتورة',`الخصم ${money(discount)} من إجمالي ${money(positiveSubtotal)}`); if(!ok){window.__busy=false; document.querySelectorAll('#salePaymentScreen .btn,.pos-mini-keypad .enter').forEach(b=>b.disabled=false); return;}}
  if(items.some(x=>Number(x.qty)<0)){const ok=await requestSupervisorApproval('مرتجع داخل فاتورة البيع','يفضل استعمال مرتجع من الفاتورة الأصلية'); if(!ok){window.__busy=false; document.querySelectorAll('#salePaymentScreen .btn,.pos-mini-keypad .enter').forEach(b=>b.disabled=false); return;}}
  const virtualStock=new Map(stock.map(r=>[`${r.location_id}|${String(r.product_code).toLowerCase()}`,Number(r.qty||0)]));
  if(editingSaleId && originalSale){
    for(const it of originalSaleItems){
      const k=`${originalSale.location_id}|${String(it.product_code).toLowerCase()}`;
      virtualStock.set(k,(virtualStock.get(k)||0)+Number(it.qty||0));
    }
  }
  const oversold=[];
  for(const it of items){
    const available=virtualStock.get(`${location_id}|${String(it.product_code).toLowerCase()}`)||0;
    if(it.qty>0 && available < it.qty) oversold.push(`${it.product_code} المتوفر ${money(available)} والمطلوب ${money(it.qty)}`);
  }
  if(oversold.length && !confirm('تنبيه: توجد منتجات كميتها غير كافية. هل تريد البيع بدون مخزون؟\n'+oversold.join('\n'))){window.__busy=false; document.querySelectorAll('#salePaymentScreen .btn,.pos-mini-keypad .enter').forEach(b=>b.disabled=false); return;}
  try{
    showLoading(true);
    const customer_id=await ensureSaleCustomer(balance_due);
    const invoice_no=editingSaleId ? q('saleInvoiceNo').value.trim() : null; const body={invoice_no,sale_date:q('saleDate').value,location_id,customer_id,payment_method:detectSalePaymentMethod(balance_due),subtotal,discount,total,paid_amount:paid,balance_due,status:'posted',notes:q('saleNotes').value.trim()};
    let saleId=editingSaleId;
    if(!editingSaleId){
      const paymentsForRpc=payRows.map(r=>({...r,account_id:defaultAccountFor(r.payment_method,location_id),notes:''}));
      const idem=getDraftKey('sale');
      const saved=await rpc('post_sale_transaction',{p_sale:body,p_items:items,p_payments:paymentsForRpc,p_idempotency_key:idem,p_user_identifier:appUser?.identifier||''});
      saleId=saved.id; body.invoice_no=saved.invoice_no||body.invoice_no; q('saleInvoiceNo').value=body.invoice_no||'';
      if(sourcePriceCheckerCartId){await rpc('mark_pricechecker_cart_converted',{p_cart_id:sourcePriceCheckerCartId}).catch(console.warn); sourcePriceCheckerCartId=null;}
      clearDraftKey('sale'); clearActiveSaleDraft();
      await logAction('sale','pos_sales',saleId,`${body.invoice_no||saleId.slice(0,8)} - ${money(body.total)} ${APP_CONFIG.currency}`);
      const msg='تم حفظ فاتورة البيع وتحديث المخزون';
      const shouldPrint=q('salePrintAfterSave').value==='yes'; const mode=saleSaveMode||'new'; closeSalePaymentScreen(); clearActiveSaleDraft(); resetSaleForm(); await loadAll(); toast(msg,'success'); if(shouldPrint) setTimeout(()=>printSale(saleId),300); if(mode==='close') openTab('salesList'); saleSaveMode='new';
      return;
    }
    if(editingSaleId){
      await reverseSaleEffects();
      await api('pos_sales',{method:'PATCH',qs:`?id=eq.${editingSaleId}`,body:{...body,updated_at:new Date().toISOString()}});
      await api('pos_sale_items',{method:'DELETE',qs:`?sale_id=eq.${editingSaleId}`});
      await api('pos_sale_payments',{method:'DELETE',qs:`?sale_id=eq.${editingSaleId}`}).catch(()=>{});
      await api('pos_finance_movements',{method:'DELETE',qs:`?reference_table=eq.pos_sales&reference_id=eq.${editingSaleId}`}).catch(()=>{});
    }else{
      const sale=await api('pos_sales',{method:'POST',body}); saleId=sale[0].id; body.invoice_no=sale[0].invoice_no||body.invoice_no; q('saleInvoiceNo').value=body.invoice_no||'';
    }
    await api('pos_sale_items',{method:'POST',body:items.map(it=>({...it,sale_id:saleId}))});
    const paymentsToSave=payRows.map(r=>({...r,sale_id:saleId,payment_date:body.sale_date}));
    if(paymentsToSave.length) await api('pos_sale_payments',{method:'POST',body:paymentsToSave}).catch(e=>console.warn('sale payments save failed',e));
    await recordSaleFinanceMovements(saleId, body.location_id, body.sale_date, paymentsToSave, body.total);
    for(const it of items){ await adjustStockDoc(location_id,it,-Number(it.qty||0),'sale','pos_sales',saleId,it.qty<0?'مرتجع داخل فاتورة بيع':'فاتورة بيع'); }
    if(balance_due>0){
      await api('pos_customer_ledger',{method:'POST',body:{customer_id,entry_date:body.sale_date,entry_type:'sale',description:body.invoice_no?`فاتورة بيع رقم ${body.invoice_no}`:'فاتورة بيع',debit:balance_due,credit:0,reference_table:'pos_sales',reference_id:saleId}});
    }
    const msg=editingSaleId?'تم تعديل فاتورة البيع وتحديث المخزون':'تم حفظ فاتورة البيع وتحديث المخزون';
    const shouldPrint=q('salePrintAfterSave').value==='yes'; const mode=saleSaveMode||'new'; closeSalePaymentScreen(); resetSaleForm(); await loadAll(); toast(msg,'success'); if(shouldPrint) setTimeout(()=>printSale(saleId),300); if(mode==='close') openTab('salesList'); saleSaveMode='new';
  }catch(err){console.error(err);toast('خطأ في حفظ البيع: '+friendlyError(err),'error')}
  finally{showLoading(false);window.__busy=false;document.querySelectorAll('#salePaymentScreen .btn,.pos-mini-keypad .enter').forEach(b=>b.disabled=false)}
});

q('productForm').addEventListener('submit', async e=>{
  e.preventDefault();
  if(window.__busy) return; window.__busy=true;
  try{
    showLoading(true);
    const code=q('productCode').value.trim();
    const body={
      code,
      name:q('productName').value.trim(),
      brand:q('productBrand').value.trim()||null,
      model:q('productModel').value.trim()||null,
      color:q('productColor').value.trim()||null,
      barcode:q('productBarcode').value.trim()||null,
      reorder_point:Number(q('productReorderPoint').value||0),
      category:q('productCategory').value.trim()||null,
      supplier_id:q('productSupplier').value||null,
      purchase_price:moneyVal(q('productPurchasePrice').value),
      retail_price:moneyVal(q('productRetailPrice').value),
      wholesale_price:moneyVal(q('productWholesalePrice').value),
      active:true,
      updated_at:new Date().toISOString()
    };
    if(!(body.wholesale_price>0)&&body.purchase_price>0){body.wholesale_price=Math.round(body.purchase_price*1.3*100)/100;}
    const exists=await api('pos_products',{qs:`?select=code&code=eq.${encodeURIComponent(code)}&limit=1`});
    if(productFormMode==='edit'){
      if(code!==editingProductCode){toast('لا يمكن تغيير كود منتج موجود من وضع التعديل. استخدم نسخ المنتج لإنشاء كود جديد.','warn'); return;}
      const patch={...body}; delete patch.code;
      await api('pos_products',{method:'PATCH',qs:`?code=eq.${encodeURIComponent(editingProductCode)}`,body:patch});
      toast('تم تعديل المنتج');
    }else{
      if(exists && exists.length){toast('كود المنتج موجود مسبقًا. اختر كودًا آخر.','warn'); return;}
      await api('pos_products',{method:'POST',body});
      toast(productFormMode==='duplicate'?'تم إنشاء المنتج المنسوخ':'تم إنشاء المنتج');
    }
    await saveProductComponents(code); resetProductForm(); await loadAll();
  }catch(err){console.error(err);toast('خطأ في حفظ المنتج: '+err.message+' - إذا ظهر pos_products غير موجود شغل ملف إعداد المنتجات')}
  finally{showLoading(false);window.__busy=false}
});

q('supplierForm').addEventListener('submit', async e=>{
  e.preventDefault();
  if(window.__busy) return; window.__busy=true;
  try{
    showLoading(true);
    const opening=Math.abs(moneyVal(q('supplierOpening').value));
    const supplier = await api('pos_suppliers',{method:'POST',body:{name:q('supplierName').value.trim(),phone:q('supplierPhone').value.trim(),notes:q('supplierNotes').value.trim(),opening_balance:opening}});
    const s=supplier[0];
    if(opening>0){
      const isCredit=q('openingType').value==='credit';
      await api('pos_supplier_ledger',{method:'POST',body:{supplier_id:s.id,entry_type:'opening',description:'رصيد افتتاحي',credit:isCredit?opening:0,debit:isCredit?0:opening}});
    }
    e.target.reset(); q('supplierOpening').value=0; toast('تم حفظ المورد'); await loadAll();
  }catch(err){console.error(err);toast('خطأ في حفظ المورد: '+err.message)} finally{showLoading(false);window.__busy=false}
});

function selectDefaultSupplierPaymentAccount(){const m=q('paymentMethod')?.value; if(q('paymentFinanceAccount')) q('paymentFinanceAccount').innerHTML=financeAccountOptionsFor(m,'تلقائي حسب الطريقة'); const id=defaultFinanceAccountFor(m); if(q('paymentFinanceAccount')&&id) q('paymentFinanceAccount').value=id;}
function selectDefaultPurchasePaymentAccount(){const m=q('purchasePaymentMethod')?.value; if(q('purchaseFinanceAccount')) q('purchaseFinanceAccount').innerHTML=financeAccountOptionsFor(m,'تلقائي حسب الطريقة'); const id=defaultFinanceAccountFor(m); if(q('purchaseFinanceAccount')&&id) q('purchaseFinanceAccount').value=id;}
function selectDefaultCustomerPaymentAccount(){const m=q('customerPaymentMethod')?.value; if(q('customerPaymentFinanceAccount')) q('customerPaymentFinanceAccount').innerHTML=financeAccountOptionsFor(m,'تلقائي حسب الطريقة'); const id=defaultFinanceAccountFor(m); if(q('customerPaymentFinanceAccount')&&id) q('customerPaymentFinanceAccount').value=id;}
function expenseAccountsForMethod(method){
  const branch=q('expenseLocation')?.value||appUser?.branch_id||'';
  let rows=[];
  if(method==='cash') rows=financeAccounts.filter(a=>a.account_type==='cash' && (!branch || a.location_id===branch));
  else rows=financeAccounts.filter(a=>a.account_type==='bank'||a.account_type==='card');
  return '<option value="">اختر الحساب</option>'+rows.map(a=>`<option value="${esc(a.id)}">${esc(a.name)} - ${esc(accountTypeLabel(a.account_type))} - ${money(a.balance)}</option>`).join('');
}
function selectDefaultExpenseAccount(){
  const method=q('expensePaymentMethod')?.value||'cash';
  const acc=q('expenseAccount'); if(!acc)return;
  acc.innerHTML=expenseAccountsForMethod(method);
  if(method==='cash'){
    const branch=q('expenseLocation')?.value||appUser?.branch_id||'';
    const cash=financeAccounts.find(a=>a.account_type==='cash' && (!branch||a.location_id===branch));
    if(cash) acc.value=cash.id;
  }
}
function renderSettingsExpenseCategories(){
  const body=q('settingsExpenseCategoriesBody'); if(!body)return;
  body.innerHTML=(expenseCategories||[]).map(c=>`<tr><td>${esc(c.name)}</td><td>${c.active===false?'<span class="badge gray">متوقف</span>':'<span class="badge green">نشط</span>'}</td></tr>`).join('')||'<tr><td colspan="2">لا توجد تصنيفات بعد.</td></tr>';
}
function renderProductOptionSettings(){
  const render=(id,arr)=>{const el=q(id); if(el) el.innerHTML=(arr&&arr.length)?arr.map(x=>`<span class="badge gray" style="margin:2px">${esc(x)}</span>`).join(''):'لا توجد إضافات';};
  render('settingsBrandsList',APP_CONFIG.customBrands||[]);
  render('settingsModelsList',APP_CONFIG.customModels||[]);
  render('settingsColorsList',APP_CONFIG.customColors||[]);
}
function addProductOption(type,value){
  const key=type==='brand'?'customBrands':(type==='model'?'customModels':'customColors');
  const arr=APP_CONFIG[key]||[];
  if(!arr.some(x=>String(x).toLowerCase()===String(value).toLowerCase())) arr.push(value);
  APP_CONFIG[key]=arr.sort((a,b)=>String(a).localeCompare(String(b),'ar'));
  localStorage.setItem('posAppConfig',JSON.stringify({businessName:APP_CONFIG.businessName,tagline:APP_CONFIG.tagline,currency:APP_CONFIG.currency,lowStockThreshold:APP_CONFIG.lowStockThreshold,customBrands:APP_CONFIG.customBrands||[],customModels:APP_CONFIG.customModels||[],customColors:APP_CONFIG.customColors||[]}));
  renderProductDatalist(); renderProductOptionSettings();
}


q('paymentForm').addEventListener('submit', async e=>{
  e.preventDefault();
  if(window.__busy) return; window.__busy=true;
  try{
    showLoading(true);
    const body={supplier_id:q('paymentSupplier').value,payment_date:q('paymentDate').value,amount:moneyVal(q('paymentAmount').value),payment_method:q('paymentMethod').value,notes:q('paymentNotes').value.trim()};
    validateAccountingPayment('supplier',body.amount);
    const pay=await api('pos_supplier_payments',{method:'POST',body});
    await api('pos_supplier_ledger',{method:'POST',body:{supplier_id:body.supplier_id,entry_date:body.payment_date,entry_type:'payment',description:body.notes||'دفعة للمورد',debit:body.amount,credit:0,reference_table:'pos_supplier_payments',reference_id:pay[0].id}});
    await addFinanceMovement(q('paymentFinanceAccount')?.value||defaultFinanceAccountFor(body.payment_method),'out','supplier_payment',body.amount,body.payment_date,'pos_supplier_payments',pay[0].id,body.notes||'دفعة للمورد');
    e.target.reset(); setToday(); toast('تم حفظ الدفعة وتحديث كشف الحساب'); await loadAll();
  }catch(err){console.error(err);toast('خطأ في حفظ الدفعة: '+err.message)} finally{showLoading(false);window.__busy=false}
});


function resetPurchaseForm(){
  editingPurchaseId=null; originalPurchase=null; originalPurchaseItems=[];
  q('purchaseForm').reset(); q('purchaseItemsBody').innerHTML=''; if(q('purchaseAutoNo')) q('purchaseAutoNo').value='سيولد تلقائيًا'; setToday();
  q('purchaseSubmitBtn').textContent='حفظ الفاتورة وزيادة المخزون';
  q('purchaseCancelEditBtn').classList.add('hidden');
}
async function openPurchaseForEdit(id){
  try{
    showLoading(true);
    const rows=await api('pos_purchase_items',{qs:`?select=*&purchase_id=eq.${id}&order=created_at.asc`});
    const p=purchases.find(x=>x.id===id) || (await api('pos_purchases',{qs:`?select=*&id=eq.${id}&limit=1`}))[0];
    if(!p){toast('لم يتم العثور على الفاتورة'); return;}
    editingPurchaseId=id; originalPurchase={...p}; originalPurchaseItems=rows.map(x=>({...x}));
    document.querySelector('[data-tab="purchases"]').click();
    q('purchaseSupplier').value=p.supplier_id||''; q('purchaseLocation').value=p.location_id||''; q('purchaseDate').value=p.purchase_date||''; if(q('purchaseAutoNo')) q('purchaseAutoNo').value=p.purchase_no||p.id?.slice(0,8)||'';
    q('purchaseInvoiceNo').value=p.invoice_no||''; q('purchaseNotes').value=p.notes||''; q('purchaseDiscount').value=Number(p.discount||0);
    q('purchaseItemsBody').innerHTML='';
    rows.forEach(it=>addPurchaseRow({product_code:it.product_code, product_name:it.product_name, qty:it.qty, unit_cost:it.unit_cost}));
    updatePurchaseTotal();
    q('purchaseSubmitBtn').textContent='حفظ التعديل وتحديث المخزون';
    q('purchaseCancelEditBtn').classList.remove('hidden');
    toast('تم فتح فاتورة الشراء للتعديل');
  }catch(err){console.error(err);toast('خطأ في فتح الفاتورة: '+err.message)} finally{showLoading(false);window.__busy=false}
}
async function reversePurchaseEffects(){
  if(!editingPurchaseId || !originalPurchase) return;
  // عند تعديل الفاتورة نعكس تأثير المخزون بدون تسجيل حركة وهمية، ثم نحذف حركات الفاتورة القديمة.
  for(const it of originalPurchaseItems){
    await adjustStockOnly(originalPurchase.location_id,{product_code:it.product_code,product_name:it.product_name},-Math.abs(Number(it.qty||0)));
  }
  await deleteStockMovements('pos_purchases', editingPurchaseId);
  await api('pos_supplier_ledger',{method:'DELETE',qs:`?reference_table=eq.pos_purchases&reference_id=eq.${editingPurchaseId}`});
}


q('proformaForm')?.addEventListener('submit',async e=>{
  e.preventDefault(); const items=getProformaItems(); if(!items.length){toast('أضف صنف واحد على الأقل');return;}
  try{showLoading(true); const subtotal=items.reduce((a,x)=>a+Number(x.line_total||0),0), discount=moneyVal(q('proformaDiscount').value), total=Math.max(0,subtotal-discount); const body={proforma_no:q('proformaNo').value.trim()||null,proforma_date:q('proformaDate').value,location_id:q('proformaLocation').value,customer_id:q('proformaCustomer').value||null,customer_name:q('proformaCustomerName').value.trim()||null,customer_phone:q('proformaCustomerPhone').value.trim()||null,subtotal,discount,total,status:'draft',notes:q('proformaNotes').value.trim()||null}; let id=editingProformaId; if(id){await api('pos_proformas',{method:'PATCH',qs:`?id=eq.${id}`,body:{...body,updated_at:new Date().toISOString()}}); await api('pos_proforma_items',{method:'DELETE',qs:`?proforma_id=eq.${id}`});}else{const pr=await api('pos_proformas',{method:'POST',body}); id=pr[0].id;} await api('pos_proforma_items',{method:'POST',body:items.map(it=>({...it,proforma_id:id}))}); resetProformaForm(); toast('تم حفظ الفاتورة المبدئية'); await loadAll();}catch(err){console.error(err);toast('خطأ في حفظ المبدئية: '+err.message+' - تأكد من تشغيل SQL المبدئية')}finally{showLoading(false);window.__busy=false}
});

q('purchaseForm').addEventListener('submit', async e=>{
  e.preventDefault();
  if(window.__busy) return; window.__busy=true;
  const items=getPurchaseItems();
  if(!items.length){toast('أضف صنف واحد على الأقل','warn'); window.__busy=false; document.querySelectorAll('#salePaymentScreen .btn,.pos-mini-keypad .enter').forEach(b=>b.disabled=false); return;}
  try{
    showLoading(true);
    updatePurchaseTotal();
    const subtotal=items.reduce((a,x)=>a+x.line_total,0); const discount=moneyVal(q('purchaseDiscount').value); const total=Math.max(0, subtotal-discount);
    const purchasePaid=moneyVal(q('purchasePaidAmount')?.value); const purchasePayMethod=q('purchasePaymentMethod')?.value||'cash'; validateAccountingForPurchase(total,purchasePaid); const body={supplier_id:q('purchaseSupplier').value,location_id:q('purchaseLocation').value,invoice_no:q('purchaseInvoiceNo').value.trim(),purchase_date:q('purchaseDate').value,subtotal,discount,total,paid_amount:purchasePaid,status:'posted',notes:q('purchaseNotes').value.trim()};
    let purchaseId=editingPurchaseId;
    if(!editingPurchaseId){
      const payment={amount:purchasePaid,payment_method:purchasePayMethod,account_id:(q('purchaseFinanceAccount')?.value||defaultFinanceAccountFor(purchasePayMethod))};
      const idem=getDraftKey('purchase');
      const saved=await rpc('post_purchase_transaction',{p_purchase:body,p_items:items,p_payment:payment,p_idempotency_key:idem,p_user_identifier:appUser?.identifier||''});
      clearDraftKey('purchase');
      await logAction('purchase','pos_purchases',saved.id,`${saved.purchase_no||saved.id?.slice(0,8)||''} - ${money(total)} ${APP_CONFIG.currency}`);
      purchaseId=saved.id; if(q('purchaseAutoNo')) q('purchaseAutoNo').value=saved.purchase_no||saved.id?.slice(0,8)||'';
      resetPurchaseForm(); toast('تم حفظ فاتورة الشراء وزيادة المخزون رقم '+(saved.purchase_no||''),'success'); await loadAll();
      return;
    }
    if(editingPurchaseId){
      await reversePurchaseEffects();
      await api('pos_purchases',{method:'PATCH',qs:`?id=eq.${editingPurchaseId}`,body:{...body,updated_at:new Date().toISOString()}});
      await api('pos_purchase_items',{method:'DELETE',qs:`?purchase_id=eq.${editingPurchaseId}`});
    }else{
      const purchase=await api('pos_purchases',{method:'POST',body}); purchaseId=purchase[0].id;
    }
    await api('pos_purchase_items',{method:'POST',body:items.map(it=>({...it,purchase_id:purchaseId}))});
    for(const it of items){ await updateStock(body.location_id,it,purchaseId); }
    if(total>0){
      await api('pos_supplier_ledger',{method:'POST',body:{supplier_id:body.supplier_id,entry_date:body.purchase_date,entry_type:'purchase',description:body.invoice_no?`فاتورة شراء رقم ${body.invoice_no}`:'فاتورة شراء',debit:0,credit:total,reference_table:'pos_purchases',reference_id:purchaseId}});
    }
    if(purchasePaid>0){
      await api('pos_supplier_ledger',{method:'POST',body:{supplier_id:body.supplier_id,entry_date:body.purchase_date,entry_type:'payment',description:'دفعة على فاتورة شراء',debit:Math.min(purchasePaid,total),credit:0,reference_table:'pos_purchases',reference_id:purchaseId}});
      await addFinanceMovement(q('purchaseFinanceAccount')?.value||defaultFinanceAccountFor(purchasePayMethod),'out','supplier_payment',Math.min(purchasePaid,total),body.purchase_date,'pos_purchases',purchaseId,'دفع فاتورة شراء');
    }
    const msg=editingPurchaseId?'تم تعديل فاتورة الشراء وتحديث المخزون':'تم حفظ فاتورة الشراء وزيادة المخزون';
    resetPurchaseForm(); toast(msg); await loadAll();
  }catch(err){console.error(err);toast('خطأ في حفظ فاتورة الشراء: '+err.message)} finally{showLoading(false);window.__busy=false}
});


function resetTransferForm(){
  editingTransferId=null; originalTransfer=null; originalTransferItems=[];
  q('transferForm').reset(); q('transferItemsBody').innerHTML=''; addTransferRow(); setToday();
  q('transferSubmitBtn').textContent='حفظ التحويل وتحديث المخزون';
  q('transferCancelEditBtn').classList.add('hidden');
}
async function openTransferForEdit(id){
  try{
    showLoading(true);
    const rows=await api('pos_stock_transfer_items',{qs:`?select=*&transfer_id=eq.${id}&order=created_at.asc`});
    const t=transfers.find(x=>x.id===id) || (await api('pos_stock_transfers',{qs:`?select=*&id=eq.${id}&limit=1`}))[0];
    if(!t){toast('لم يتم العثور على التحويل'); return;}
    editingTransferId=id; originalTransfer={...t}; originalTransferItems=rows.map(x=>({...x}));
    document.querySelector('[data-tab="transfers"]').click();
    q('transferFrom').value=t.from_location_id||''; q('transferTo').value=t.to_location_id||''; q('transferDate').value=t.transfer_date||''; q('transferNotes').value=t.notes||'';
    q('transferItemsBody').innerHTML='';
    rows.forEach(it=>addTransferRow({product_code:it.product_code, product_name:it.product_name, qty:it.qty}));
    refreshTransferAvailability();
    q('transferSubmitBtn').textContent='حفظ التعديل وتحديث المخزون';
    q('transferCancelEditBtn').classList.remove('hidden');
    toast('تم فتح التحويل للتعديل');
  }catch(err){console.error(err);toast('خطأ في فتح التحويل: '+err.message)} finally{showLoading(false);window.__busy=false}
}
async function reverseTransferEffects(){
  if(!editingTransferId || !originalTransfer) return;
  // نعكس التحويل القديم بدون تسجيل حركات وهمية، ثم نحذف حركات التحويل القديمة.
  for(const it of originalTransferItems){
    await adjustStockOnly(originalTransfer.from_location_id,it,Math.abs(Number(it.qty||0)));
    await adjustStockOnly(originalTransfer.to_location_id,it,-Math.abs(Number(it.qty||0)));
  }
  await deleteStockMovements('pos_stock_transfers', editingTransferId);
}

q('transferForm').addEventListener('submit', async e=>{
  e.preventDefault();
  if(window.__busy) return; window.__busy=true;
  const from=q('transferFrom').value, to=q('transferTo').value;
  if(!from || !to){toast('اختر مكان التحويل من وإلى','warn'); window.__busy=false; return;}
  if(from===to){toast('لا يمكن التحويل لنفس المكان','warn'); window.__busy=false; return;}
  let items=groupTransferItems(getTransferItems());
  if(!items.length){toast('أضف صنف واحد على الأقل','warn'); window.__busy=false; document.querySelectorAll('#salePaymentScreen .btn,.pos-mini-keypad .enter').forEach(b=>b.disabled=false); return;}
  // In edit mode, available stock should include the old transfer quantities reversed first.
  const virtualStock = new Map(stock.map(r=>[`${r.location_id}|${String(r.product_code).toLowerCase()}`, Number(r.qty||0)]));
  if(editingTransferId && originalTransfer){
    for(const it of originalTransferItems){
      const c=String(it.product_code||'').toLowerCase();
      virtualStock.set(`${originalTransfer.from_location_id}|${c}`,(virtualStock.get(`${originalTransfer.from_location_id}|${c}`)||0)+Number(it.qty||0));
      virtualStock.set(`${originalTransfer.to_location_id}|${c}`,(virtualStock.get(`${originalTransfer.to_location_id}|${c}`)||0)-Number(it.qty||0));
    }
  }
  for(const it of items){
    const available=virtualStock.get(`${from}|${String(it.product_code||'').toLowerCase()}`)||0;
    if(available < it.qty){toast(`الكمية غير كافية للمنتج ${it.product_code}. المتوفر ${money(available)}`); window.__busy=false; return;}
  }
  try{
    showLoading(true);
    const body={from_location_id:from,to_location_id:to,transfer_date:q('transferDate').value,status:'posted',notes:q('transferNotes').value.trim()};
    let transferId=editingTransferId;
    if(!editingTransferId){
      const idem=getDraftKey('transfer');
      const saved=await rpc('post_stock_transfer_transaction',{p_transfer:body,p_items:items,p_idempotency_key:idem,p_user_identifier:appUser?.identifier||''});
      await logAction('transfer','pos_stock_transfers',saved.id,`${items.length} صنف - ${locations.find(l=>l.id===from)?.name||''} → ${locations.find(l=>l.id===to)?.name||''}`);
      clearDraftKey('transfer');
      transferId=saved.id;
      resetTransferForm(); toast('تم حفظ التحويل وتحديث المخزون','success'); await loadAll();
      return;
    }
    if(editingTransferId){
      await reverseTransferEffects();
      await api('pos_stock_transfers',{method:'PATCH',qs:`?id=eq.${editingTransferId}`,body:{...body,updated_at:new Date().toISOString()}});
      await api('pos_stock_transfer_items',{method:'DELETE',qs:`?transfer_id=eq.${editingTransferId}`});
    }else{
      const transfer=await api('pos_stock_transfers',{method:'POST',body}); transferId=transfer[0].id;
    }
    await api('pos_stock_transfer_items',{method:'POST',body:items.map(it=>({...it,transfer_id:transferId}))});
    for(const it of items){
      await adjustStock(from,it,-Math.abs(it.qty),'transfer_out',transferId,'تحويل مخزون صادر');
      await adjustStock(to,it,Math.abs(it.qty),'transfer_in',transferId,'تحويل مخزون وارد');
    }
    const msg=editingTransferId?'تم تعديل التحويل وتحديث المخزون':'تم حفظ التحويل وتحديث المخزون';
    resetTransferForm(); toast(msg); await loadAll();
  }catch(err){console.error(err);toast('خطأ في حفظ التحويل: '+err.message)} finally{showLoading(false);window.__busy=false}
});

q('transferFrom').addEventListener('change', refreshTransferAvailability);


function inDateRange(date, from, to){
  if(!date) return true;
  if(from && date < from) return false;
  if(to && date > to) return false;
  return true;
}
let productCostCache=new Map();
function buildProductCostIndex(){
  productCostCache=new Map();
  const acc=new Map();
  for(const it of (purchaseItems||[])){ const q=Number(it.qty||0); if(q>0){ const k=String(it.product_code||'').trim().toLowerCase(); if(!k) continue; const o=acc.get(k); if(o){o.qty+=q; o.total+=Number(it.line_total||0);} else acc.set(k,{qty:q,total:Number(it.line_total||0)}); } }
  for(const [k,o] of acc){ if(o.qty>0){ const avg=o.total/o.qty; if(avg>0) productCostCache.set(k,avg); } }
  const hist=new Map();
  for(const s of (saleItems||[])){ const c=Number(s.unit_cost_at_sale||0); if(c>0){ const k=String(s.product_code||'').trim().toLowerCase(); if(!k||productCostCache.has(k)) continue; const o=hist.get(k); if(o){o.sum+=c;o.n++;} else hist.set(k,{sum:c,n:1}); } }
  for(const [k,o] of hist){ if(o.n>0) productCostCache.set(k,o.sum/o.n); }
  for(const p of products){ const k=String(p.code||'').trim().toLowerCase(); if(k && !productCostCache.has(k)){ const v=Number(p.purchase_price||p.cost||0); if(v>0) productCostCache.set(k,v); } }
}
function productCost(code){
  const key=String(code||'').split('|')[0].trim().toLowerCase();
  if(!key) return 0;
  if(productCostCache.has(key)) return productCostCache.get(key);
  const hist=(saleItems||[]).filter(x=>String(x.product_code||'').trim().toLowerCase()===key && Number(x.unit_cost_at_sale||0)>0);
  let result=0;
  if(hist.length) result=hist.reduce((a,x)=>a+Number(x.unit_cost_at_sale||0),0)/hist.length;
  if(!result){ const p=products.find(x=>String(x.code||'').trim().toLowerCase()===key); result=Number(p?.purchase_price||p?.cost||0); }
  productCostCache.set(key,result||0);
  return result||0;
}

function marginValue(code, price){return Number(price||0)-productCost(code)}
function marginPct(code, price){const cost=productCost(code); return cost?marginValue(code,price)/cost*100:0}
function marginHtml(code, price){const m=marginValue(code,price), pct=marginPct(code,price); return `<div class="${m>=0?'stock-positive':'stock-negative'}"><b>${money(m)}</b><div class="mini">${money(pct)}%</div></div>`}

function bucketKey(date, period){
  if(!date) return '';
  const y=String(date).slice(0,4), mo=Number(String(date).slice(5,7))||1;
  if(period==='year') return y;
  if(period==='quarter') return `${y}-Q${Math.ceil(mo/3)}`;
  return String(date).slice(0,7);
}
function repScopeData(){
  const d=reportContext();
  return {from:d.from,to:d.to,loc:d.loc,fSales:d.filteredSales,fItems:d.filteredItems,fReturns:d.filteredReturns,fRetItems:d.filteredReturnItems,fExpenses:d.filteredExpenses,fSalaries:d.filteredSalaries};
}
function emptyRow(cols,msg='لا توجد بيانات.'){return `<tr><td colspan="${cols}">${esc(msg)}</td></tr>`}
function profitClass(n){return Number(n||0)>=0?'stock-positive':'stock-negative'}
function productByCode(code){return products.find(p=>String(p.code||'').toLowerCase()===String(code||'').toLowerCase())||null}
function itemProfitRows(){
  const d=repScopeData();
  const m={};
  d.fItems.forEach(it=>{const k=it.product_code; const o=m[k]||(m[k]={code:k,name:it.product_name,qty:0,sales:0,cost:0}); o.qty+=Number(it.qty||0); o.sales+=Number(it.line_total||0); o.cost+=productCost(k)*Number(it.qty||0);});
  d.fRetItems.forEach(it=>{const k=it.product_code; const o=m[k]||(m[k]={code:k,name:it.product_name,qty:0,sales:0,cost:0}); o.qty-=Number(it.qty||0); o.sales-=Number(it.line_total||0); o.cost-=productCost(k)*Number(it.qty||0);});
  return Object.values(m).map(r=>({...r,profit:r.sales-r.cost,margin:r.sales?(r.sales-r.cost)/r.sales*100:0}));
}
function customerProfitRows(){
  const d=repScopeData(); const bySale={}; d.fItems.forEach(it=>{(bySale[it.sale_id]||(bySale[it.sale_id]=[])).push(it)}); const m={};
  d.fSales.forEach(sl=>{const c=customers.find(x=>x.id===sl.customer_id); const k=sl.customer_id||'cash'; const o=m[k]||(m[k]={id:k,name:c?.name||'زبون نقدي',count:0,sales:0,cost:0,balance:Number(c?.balance||0)}); o.count++; o.sales+=Number(sl.total||0); (bySale[sl.id]||[]).forEach(it=>o.cost+=productCost(it.product_code)*Number(it.qty||0));});
  const byRet={}; d.fRetItems.forEach(it=>{(byRet[it.return_id]||(byRet[it.return_id]=[])).push(it)});
  d.fReturns.forEach(r=>{const c=customers.find(x=>x.id===r.customer_id); const k=r.customer_id||'cash'; const o=m[k]||(m[k]={id:k,name:c?.name||'زبون نقدي',count:0,sales:0,cost:0,balance:Number(c?.balance||0)}); o.sales-=Number(r.total||0); (byRet[r.id]||[]).forEach(it=>o.cost-=productCost(it.product_code)*Number(it.qty||0));});
  return Object.values(m).map(r=>({...r,profit:r.sales-r.cost}));
}
function renderReports(){
  if(!q('repSalesTotal')) return;
  const from=q('reportFrom')?.value||''; const to=q('reportTo')?.value||''; const loc=q('reportLocation')?.value||'';
  const filteredSales=sales.filter(sl=>inDateRange(sl.sale_date,from,to) && (!loc || sl.location_id===loc));
  const saleIds=new Set(filteredSales.map(s=>s.id));
  const filteredItems=saleItems.filter(it=>saleIds.has(it.sale_id));
  const salesTotal=filteredSales.reduce((a,s)=>a+Number(s.total||0),0);
  const paidTotal=filteredSales.reduce((a,s)=>a+Number(s.paid_amount||0),0);
  const balanceTotal=filteredSales.reduce((a,s)=>a+Number(s.balance_due||0),0);
  const profit=filteredItems.reduce((a,it)=>a+(Number(it.unit_price||0)-productCost(it.product_code))*Number(it.qty||0),0);
  const customerDebt=customers.reduce((a,c)=>a+Math.max(0,Number(c.balance||0)),0);
  const supplierDebt=suppliers.reduce((a,s)=>a+Math.max(0,Number(s.balance||0)),0);
  const stockValue=stock.reduce((a,st)=>a+Number(st.qty||0)*productCost(st.product_code),0);
  const returnsTotal=saleReturns.filter(r=>inDateRange(r.return_date,from,to) && (!loc || r.location_id===loc)).reduce((a,r)=>a+Number(r.total||0),0);
  q('repSalesTotal').textContent=money(salesTotal-returnsTotal); if(q('repReturnsTotal')) q('repReturnsTotal').textContent=money(returnsTotal); q('repSalesCount').textContent=filteredSales.length; q('repProfit').textContent=money(profit);
  q('repCustomerDebt').textContent=money(customerDebt); q('repSupplierDebt').textContent=money(supplierDebt); q('repStockValue').textContent=money(stockValue);

  const byBranch={};
  filteredSales.forEach(sl=>{const k=sl.location_id||'none'; if(!byBranch[k]) byBranch[k]={count:0,total:0,paid:0,balance:0}; byBranch[k].count++; byBranch[k].total+=Number(sl.total||0); byBranch[k].paid+=Number(sl.paid_amount||0); byBranch[k].balance+=Number(sl.balance_due||0);});
  q('repSalesByBranchBody').innerHTML=Object.entries(byBranch).map(([id,r])=>{const l=locations.find(x=>x.id===id); return `<tr><td>${esc(l?.name||'غير محدد')}</td><td>${r.count}</td><td><b>${money(r.total)}</b></td><td>${money(r.paid)}</td><td>${money(r.balance)}</td></tr>`}).join('') || '<tr><td colspan="5">لا توجد مبيعات في الفترة المحددة.</td></tr>';

  const top={};
  filteredItems.forEach(it=>{const k=it.product_code; if(!top[k]) top[k]={code:k,name:it.product_name,qty:0,total:0,profit:0}; top[k].qty+=Number(it.qty||0); top[k].total+=Number(it.line_total||0); top[k].profit+=(Number(it.unit_price||0)-productCost(it.product_code))*Number(it.qty||0);});
  q('repTopProductsBody').innerHTML=Object.values(top).sort((a,b)=>b.total-a.total).slice(0,30).map(r=>`<tr><td class="ltr"><b>${esc(r.code)}</b></td><td>${esc(r.name)}</td><td>${money(r.qty)}</td><td>${money(r.total)}</td><td>${money(r.profit)}</td></tr>`).join('') || '<tr><td colspan="5">لا توجد أصناف مباعة.</td></tr>';

  const low=stock.filter(st=>Number(st.qty||0)<=Number(APP_CONFIG.lowStockThreshold||0)).sort((a,b)=>Number(a.qty||0)-Number(b.qty||0)).slice(0,80);
  q('repLowStockBody').innerHTML=low.map(st=>{const l=locations.find(x=>x.id===st.location_id); return `<tr><td>${esc(l?.name||'')}</td><td class="ltr"><b>${esc(st.product_code)}</b></td><td>${esc(st.product_name||'')}</td><td class="${Number(st.qty)<0?'stock-negative':''}">${money(st.qty)}</td><td>${money(productCost(st.product_code))}</td></tr>`}).join('') || '<tr><td colspan="5">لا يوجد مخزون منخفض.</td></tr>';

  q('repSuppliersBody').innerHTML=suppliers.filter(s=>Number(s.balance||0)!==0).sort((a,b)=>Number(b.balance)-Number(a.balance)).slice(0,40).map(s=>`<tr><td>${esc(s.name)}</td><td><b>${money(s.balance)}</b></td><td>${badgeStatus(s.balance)}</td></tr>`).join('') || '<tr><td colspan="3">لا توجد أرصدة موردين.</td></tr>';
  q('repCustomersBody').innerHTML=customers.filter(c=>Number(c.balance||0)!==0).sort((a,b)=>Number(b.balance)-Number(a.balance)).slice(0,40).map(c=>`<tr><td>${esc(c.name)}</td><td><b>${money(c.balance)}</b></td><td>${badgeCustomer(c.balance)}</td></tr>`).join('') || '<tr><td colspan="3">لا توجد أرصدة زبائن.</td></tr>';
  renderReportsDetail();
}


function dailyCashMethodFromAccount(accountId){
  const a=financeAccounts.find(x=>x.id===accountId);
  if(!a) return 'cash';
  if(a.account_type==='cash') return 'cash';
  if(a.account_type==='card') return 'card';
  return 'bank_transfer';
}
function dailyCashEmpty(){return {cash:0,card:0,bank_transfer:0,total:0}}
function dailyCashAdd(bucket,method,amount){method=method==='bank'?'bank_transfer':method; if(!bucket[method] && bucket[method]!==0) bucket[method]=0; bucket[method]+=Number(amount||0); bucket.total+=Number(amount||0)}
function fillDailyCashBranches(){
  const el=q('dailyCashBranch'); if(!el) return;
  const old=el.value || appUser?.branch_id || '';
  el.innerHTML='<option value="">كل الفروع</option>'+locations.filter(l=>l.is_sales_location||l.location_type==='branch').map(l=>`<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');
  if([...el.options].some(o=>o.value===old)) el.value=old;
}
function dailyCashCountedKey(date, branch){ return `posDailyCountedCash_${branch||'all'}_${date||''}`; }
function dailyCashSellerForSale(saleId){
  const m=financeMovements.find(x=>x.reference_table==='pos_sales'&&x.reference_id===saleId);
  const s=(m?.notes||'').match(/المستخدم:\s*([^|,\n]+)/);
  return s?s[1].trim():'';
}
function dailyCashCustomerNameForMovement(m){
  let cid;
  if(m.reference_table==='pos_customer_ledger') cid=customerLedger.find(l=>l.id===m.reference_id)?.customer_id;
  if(!cid && m.reference_table==='pos_sale_returns') cid=saleReturns.find(x=>x.id===m.reference_id)?.customer_id;
  return cid?(customers.find(c=>c.id===cid)?.name||'زبون'):'';
}
function dailyCashSupplierNameForMovement(m){
  let sid;
  if(m.reference_table==='pos_supplier_payments'){ sid=ledger.find(l=>l.reference_table==='pos_supplier_payments'&&l.reference_id===m.reference_id)?.supplier_id; if(!sid) sid=payments.find(p=>p.id===m.reference_id)?.supplier_id; }
  if(!sid && m.reference_table==='pos_purchases') sid=purchases.find(p=>p.id===m.reference_id)?.supplier_id;
  if(!sid) sid=ledger.find(l=>l.reference_id===m.reference_id)?.supplier_id;
  return sid?(suppliers.find(s=>s.id===sid)?.name||'مورد'):'';
}
const DAILY_METHOD_LABELS={cash:'نقدي',card:'بطاقة',bank_transfer:'تحويل مصرفي',bank:'تحويل مصرفي',credit:'آجل',credit_reduction:'تخفيض دين',none:'بدون',mixed:'مختلط'};
function getDailyCashData(opts={}){
  if(!opts.date && !opts.dateFrom && !opts.dateTo) fillDailyCashBranches();
  const today=new Date().toISOString().slice(0,10);
  let from, to;
  if(opts.date){ from=opts.date; to=opts.date; }
  else {
    from=opts.dateFrom||(q('dailyCashDateFrom')?.value||today);
    to=opts.dateTo||(q('dailyCashDateTo')?.value||today);
    if(!opts.dateFrom && !opts.dateTo){
      if(q('dailyCashDateFrom') && !q('dailyCashDateFrom').value) q('dailyCashDateFrom').value=today;
      if(q('dailyCashDateTo') && !q('dailyCashDateTo').value) q('dailyCashDateTo').value=today;
    }
  }
  const date=to;
  const branch=(opts.branch!==undefined)?opts.branch:(q('dailyCashBranch')?.value || '');
  const branchName=branch?(locations.find(l=>l.id===branch)?.name||''):'كل الفروع';
  const isRange = from<to;
  const inR = d => !!d && d>=from && d<=to;
  const daySalesArr=sales.filter(s=>inR(s.sale_date) && (!branch||s.location_id===branch));
  const salesById={}; daySalesArr.forEach(s=>salesById[s.id]=s);
  const salesPay=dailyCashEmpty(), expensesPay=dailyCashEmpty(), customerPay=dailyCashEmpty(), supplierPay=dailyCashEmpty(), refundsPay=dailyCashEmpty();
  Object.values(salesById).forEach(sl=>{
    const rows=salePayments.filter(p=>p.sale_id===sl.id);
    if(rows.length) rows.forEach(p=>dailyCashAdd(salesPay,p.payment_method,p.amount));
    else if(Number(sl.paid_amount||0)>0) dailyCashAdd(salesPay,sl.payment_method,Math.abs(Number(sl.paid_amount||0)));
  });
  const dayExpenses=expenses.filter(e=>{
    if(!inR(e.expense_date)) return false;
    const a=financeAccounts.find(x=>x.id===e.account_id); const eloc=e.location_id||a?.location_id||'';
    return !branch || eloc===branch;
  });
  dayExpenses.forEach(e=>dailyCashAdd(expensesPay,dailyCashMethodFromAccount(e.account_id),e.amount));
  const dayCustomerPayMoves=[], daySupplierPayMoves=[];
  let settlementShortage=0, settlementSurplus=0;
  financeMovements.filter(m=>inR(m.movement_date)).forEach(m=>{
    const a=financeAccounts.find(x=>x.id===m.account_id); if(branch && a?.location_id!==branch) return;
    const method=dailyCashMethodFromAccount(m.account_id);
    if(m.movement_type==='customer_payment' && m.direction==='in'){ dailyCashAdd(customerPay,method,m.amount); dayCustomerPayMoves.push({m,method}); }
    if(m.movement_type==='supplier_payment' && m.direction==='out'){ dailyCashAdd(supplierPay,method,m.amount); daySupplierPayMoves.push({m,method}); }
    if(m.movement_type==='customer_refund' && m.direction==='out') dailyCashAdd(refundsPay,method,m.amount);
    if(m.movement_type==='cash_shortage' && m.direction==='out') settlementShortage+=Number(m.amount||0);
    if(m.movement_type==='cash_surplus' && m.direction==='in') settlementSurplus+=Number(m.amount||0);
  });
  const dayReturns=saleReturns.filter(r=>inR(r.return_date) && (!branch||r.location_id===branch));
  dayReturns.forEach(r=>{
    const hasMove=financeMovements.some(m=>m.reference_table==='pos_sale_returns' && m.reference_id===r.id && m.movement_type==='customer_refund');
    if(!hasMove && ['cash','card','bank_transfer'].includes(r.refund_method)) dailyCashAdd(refundsPay,r.refund_method,r.total);
  });
  const cashRemaining=salesPay.cash + customerPay.cash + settlementSurplus - expensesPay.cash - supplierPay.cash - refundsPay.cash - settlementShortage;
  const invoiceCount=Object.keys(salesById).length;
  // تفصيل يومي للفترات (صف لكل يوم)
  let days=[];
  if(isRange){
    const dm={};
    const ed=dt=>{ if(!dt) return null; const dd=String(dt).slice(0,10); if(!inR(dd)) return null; if(!dm[dd]) dm[dd]={date:dd,invoiceCount:0,salesTotal:0,cashIn:0,cashOut:0}; return dm[dd]; };
    daySalesArr.forEach(s=>{ const D=ed(s.sale_date); if(!D)return; D.invoiceCount++; D.salesTotal+=Number(s.total||0); const rows=salePayments.filter(p=>p.sale_id===s.id); let cin=0; if(rows.length) rows.forEach(p=>{if(p.payment_method==='cash')cin+=Number(p.amount||0);}); else if(Number(s.paid_amount||0)>0&&s.payment_method==='cash') cin+=Math.abs(Number(s.paid_amount||0)); D.cashIn+=cin; });
    dayExpenses.forEach(e=>{ const D=ed(e.expense_date); if(!D)return; if(dailyCashMethodFromAccount(e.account_id)==='cash') D.cashOut+=Number(e.amount||0); });
    financeMovements.filter(m=>inR(m.movement_date)).forEach(m=>{ const a=financeAccounts.find(x=>x.id===m.account_id); if(branch&&a?.location_id!==branch)return; if(dailyCashMethodFromAccount(m.account_id)!=='cash')return; const D=ed(m.movement_date); if(!D)return; if(m.movement_type==='customer_payment'&&m.direction==='in')D.cashIn+=Number(m.amount||0); if((m.movement_type==='supplier_payment'&&m.direction==='out')||(m.movement_type==='customer_refund'&&m.direction==='out')||(m.movement_type==='cash_shortage'&&m.direction==='out'))D.cashOut+=Number(m.amount||0); if(m.movement_type==='cash_surplus'&&m.direction==='in')D.cashIn+=Number(m.amount||0); });
    days=Object.values(dm).sort((a,b)=>a.date<b.date?-1:1);
    days.forEach(D=>D.cashRemaining=D.cashIn-D.cashOut);
  }
  const totalSales=daySalesArr.reduce((a,s)=>a+Number(s.total||0),0);
  const totalDiscounts=daySalesArr.reduce((a,s)=>a+Number(s.discount||0),0);
  const creditSales=daySalesArr.reduce((a,s)=>a+Math.max(0,Number(s.balance_due||0)),0);
  const avgInvoice=invoiceCount?totalSales/invoiceCount:0;
  const salesSummary={invoiceCount,totalSales,cashSales:salesPay.cash,cardSales:salesPay.card,bankSales:salesPay.bank_transfer,creditSales,totalDiscounts,avgInvoice};
  const invoices=daySalesArr.map(s=>{const c=customers.find(x=>x.id===s.customer_id); return {invoice_no:s.invoice_no||s.id.slice(0,8), time:(s.created_at||'').replace('T',' ').slice(0,19), customer:c?.name||'زبون نقدي', payment_method:s.payment_method, total:Number(s.total||0), paid:Number(s.paid_amount||0), balance_due:Number(s.balance_due||0), seller:dailyCashSellerForSale(s.id)};}).sort((a,b)=>(a.time||'').localeCompare(b.time||''));
  const catMap={};
  dayExpenses.forEach(e=>{const name=expenseCategories.find(c=>c.id===e.category_id)?.name||'بدون تصنيف'; const method=dailyCashMethodFromAccount(e.account_id); const o=catMap[name]||(catMap[name]={name,cash:0,card:0,bank_transfer:0,total:0}); dailyCashAdd(o,method,e.amount);});
  const expensesByCategory=Object.values(catMap).sort((a,b)=>b.total-a.total);
  const refunds=dayReturns.map(r=>{const orig=sales.find(s=>s.id===r.sale_id); const c=customers.find(x=>x.id===r.customer_id); return {time:(r.created_at||'').replace('T',' ').slice(0,19), original_invoice:orig?.invoice_no||'', refund_method:r.refund_method, amount:Number(r.total||0), customer:c?.name||'زبون نقدي'};});
  const customerPayments=dayCustomerPayMoves.map(({m,method})=>({customer:dailyCashCustomerNameForMovement(m)||'زبون', method, amount:Number(m.amount||0), notes:m.notes||''}));
  const supplierPayments=daySupplierPayMoves.map(({m,method})=>({supplier:dailyCashSupplierNameForMovement(m)||'مورد', method, amount:Number(m.amount||0), notes:m.notes||''}));
  const nonCash={cardSales:salesPay.card,bankSales:salesPay.bank_transfer,cardExpenses:expensesPay.card,bankExpenses:expensesPay.bank_transfer,cardRefunds:refundsPay.card,bankRefunds:refundsPay.bank_transfer,cardCustomer:customerPay.card,bankCustomer:customerPay.bank_transfer,cardSupplier:supplierPay.card,bankSupplier:supplierPay.bank_transfer};
  const saved=(dailyCashClosings||[]).find(x=>x.branch_id===branch && x.closing_date===date)||null;
  let savedStatus='غير محفوظ بعد';
  if(saved){ savedStatus=(saved.updated_at&&saved.created_at&&saved.updated_at!==saved.created_at)?'محفوظ — تم التحديث بموافقة المدير':'محفوظ'; }
  const countedCash=Number(localStorage.getItem(dailyCashCountedKey(date,branch))||0)||0;
  const difference=countedCash-cashRemaining;
  return {date,dateFrom:from,dateTo:to,isRange,branch,branchName,salesPay,expensesPay,customerPay,supplierPay,refundsPay,cashRemaining,invoiceCount,
    salesSummary,invoices,expensesByCategory,refunds,customerPayments,supplierPayments,nonCash,saved,savedStatus,countedCash,difference,settlementShortage,settlementSurplus,days};
}
function setCashPeriod(n){
  const to=new Date(); const from=new Date(); from.setDate(from.getDate()-(n-1));
  if(q('dailyCashDateTo')) q('dailyCashDateTo').value=to.toISOString().slice(0,10);
  if(q('dailyCashDateFrom')) q('dailyCashDateFrom').value=from.toISOString().slice(0,10);
  renderDailyCashReport();
}
function updateDailyCashDifference(){
  const inp=q('dailyCashCounted'); if(!inp)return;
  const counted=moneyVal(inp.value)||0;
  const expected=Number(inp.dataset.expected||0);
  const diff=counted-expected;
  const el=q('dailyCashDifference');
  if(el){ el.textContent=(diff>0?'+':'')+money(diff)+' '+APP_CONFIG.currency; el.style.color=Math.abs(diff)<0.001?'var(--good)':'var(--bad)'; el.style.fontWeight='800'; }
  try{ localStorage.setItem(dailyCashCountedKey(inp.dataset.date, inp.dataset.branch), String(counted)); }catch(e){}
}
function dailyCashTableRows(d){
  const row=(label,b)=>`<tr><td><b>${esc(label)}</b></td><td>${money(b.cash)}</td><td>${money(b.card)}</td><td>${money(b.bank_transfer)}</td><td><b>${money(b.total)}</b></td></tr>`;
  return row('المبيعات',d.salesPay)+row('المصاريف',d.expensesPay)+row('دفعات الزبائن',d.customerPay)+row('دفعات الموردين',d.supplierPay)+row('المرتجعات / الاسترداد',d.refundsPay);
}
function renderDailyCashReport(){
  if(!q('dailyCashReportBody')) return;
  const d=getDailyCashData();
  const M=DAILY_METHOD_LABELS, cur=APP_CONFIG.currency;
  const generated=new Date().toLocaleString('ar-LY',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const cashCls=n=>n>=0?'stock-positive':'stock-negative';
  const nz=v=>Math.abs(Number(v||0))>0.009;
  const MLM=[['كاش','cash'],['بطاقة','card'],['تحويل','bank_transfer']];
  const methodLines=(label,b)=>MLM.filter(([_,k])=>nz(b[k])).map(([m,k])=>`<tr><td>${label} — ${m}</td><td>${money(b[k])}</td></tr>`).join('');
  const sectionCard=(title,bodyHTML)=>`<div class="panel" style="box-shadow:none;padding:14px;margin-top:12px"><h2 style="font-size:16px;margin:0 0 10px">${title}</h2>${bodyHTML}</div>`;
  const tbl=(head,rows)=>`<div class="table-scroll"><table><thead><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')||`<tr><td colspan="${head.length}">لا توجد بيانات.</td></tr>`}</tbody></table></div>`;
  // رأس التقرير
  const header=`<div class="panel" style="padding:14px"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
    <div><div style="font-size:18px;font-weight:900;color:var(--blue)">${esc(APP_CONFIG.businessName)}</div><div class="muted">تقرير حالة الخزينة اليومية — إغلاق اليوم</div></div>
    <div class="mini" style="text-align:left;line-height:1.9">
      <div>الفرع: <b>${esc(d.branchName)}</b></div>
      ${(d.isRange?('<div>الفترة: <b>'+esc(d.dateFrom)+' ← '+esc(d.dateTo)+'</b></div>'):('<div>التاريخ: <b>'+esc(d.date)+'</b></div>'))}
      <div>المسؤول: <b>${esc(appUser?.identifier||'')}</b></div>
      <div>وقت التوليد: <b>${esc(generated)}</b></div>
      <div>الحالة: <b class="${d.saved?'stock-positive':''}">${esc(d.savedStatus)}</b></div>
    </div></div></div>`;
  // المداخيل (تُخفى الأصفار)
  let inRows=methodLines('مبيعات',d.salesPay)+methodLines('دفعات زبائن',d.customerPay);
  if(nz(d.settlementSurplus)) inRows+=`<tr><td>تسوية زيادة صندوق</td><td>${money(d.settlementSurplus)}</td></tr>`;
  const totalIn=d.salesPay.total+d.customerPay.total+(nz(d.settlementSurplus)?d.settlementSurplus:0);
  const inSec=sectionCard('المداخيل (حسب طريقة الدفع)', `<div class="table-scroll"><table><thead><tr><th>البيان</th><th>المبلغ</th></tr></thead><tbody>${inRows||'<tr><td colspan="2">لا توجد مداخيل.</td></tr>'}<tr style="background:var(--table-head)"><td><b>مجموع المداخيل</b></td><td><b>${money(totalIn)}</b></td></tr></tbody></table></div>`);
  // المصاريف (تُخفى الأصفار)
  let outRows=methodLines('مصاريف',d.expensesPay)+methodLines('دفعات موردين',d.supplierPay)+methodLines('مرتجعات/استرداد',d.refundsPay);
  if(nz(d.settlementShortage)) outRows+=`<tr><td>تسوية عجز صندوق (على المسؤول)</td><td>${money(d.settlementShortage)}</td></tr>`;
  const totalOut=d.expensesPay.total+d.supplierPay.total+d.refundsPay.total+(nz(d.settlementShortage)?d.settlementShortage:0);
  const outSec=sectionCard('المصاريف (حسب طريقة الدفع)', `<div class="table-scroll"><table><thead><tr><th>البيان</th><th>المبلغ</th></tr></thead><tbody>${outRows||'<tr><td colspan="2">لا توجد مصاريف.</td></tr>'}<tr style="background:var(--table-head)"><td><b>مجموع المصاريف</b></td><td><b>${money(totalOut)}</b></td></tr></tbody></table></div>`);
  // الباقي كاش
  const baqi=`<div class="panel" style="padding:14px;margin-top:12px;border:2px solid color-mix(in srgb,var(--blue) 30%,var(--border))"><div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px"><div><h2 style="font-size:16px;margin:0 0 4px">الباقي كاش (النقد فقط)</h2><div class="muted">البطاقة والتحويل لا يدخلان في الباقي الكاشي — فقط النقد الداخل ناقص النقد الخارج.</div></div><div class="num ${cashCls(d.cashRemaining)}" style="font-size:30px">${money(d.cashRemaining)} ${cur}</div></div></div>`;
  if(d.isRange){
    const dayRows=d.days.map(D=>`<tr><td class="ltr">${esc(D.date)}</td><td>${D.invoiceCount}</td><td>${money(D.salesTotal)}</td><td>${money(D.cashIn)}</td><td>${money(D.cashOut)}</td><td><b class="${cashCls(D.cashRemaining)}">${money(D.cashRemaining)}</b></td></tr>`);
    const daySec=sectionCard('تفصيل يومي ('+d.days.length+' يوم)', tbl(['التاريخ','عدد الفواتير','إجمالي المبيعات','الكاش الداخل','الكاش الخارج','المتبقي كاش'],dayRows));
    q('dailyCashReportBody').innerHTML=header+inSec+outSec+baqi+daySec+`<p class="muted" style="margin-top:10px">لعرض تفاصيل كاملة (فواتير/دفعات/تسوية) اجعل «من» = «إلى» ليوم واحد.</p>`;
    renderDailyCashClosings(); return;
  }
  // التسوية النهائية
  const settlement=`<div class="panel" style="padding:14px;margin-top:12px"><h2 style="font-size:16px;margin:0 0 10px">التسوية النهائية</h2>
    <div class="row" style="gap:16px;flex-wrap:wrap;align-items:end">
      <div><label>الكاش المعدود (اختياري — يُحفظ على هذا الجهاز فقط)</label><input id="dailyCashCounted" type="text" inputmode="decimal" placeholder="0" style="max-width:180px;font-size:18px;font-weight:800" data-expected="${d.cashRemaining}" data-date="${esc(d.date)}" data-branch="${esc(d.branch||'')}" value="${d.countedCash?money(d.countedCash).replace(/,/g,''):''}" oninput="updateDailyCashDifference()"></div>
      <div><label>الفرق (المعدود − المتوقع)</label><div class="num" id="dailyCashDifference" style="font-size:20px">${(d.difference>0?'+':'')+money(d.difference)} ${cur}</div></div>
    </div>
    <div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">${Math.abs(d.difference)>=0.01?`<button class="btn danger" type="button" onclick="settleDailyCashDifference()">تسوية الفرق (${(d.difference>0?'+':'')+money(d.difference)} ${cur})</button><span class="muted">العجز ← دين على المسؤول، الزيادة ← إيراد بالخزينة. يتطلب موافقة المدير.</span>`:`<span class="muted">المعدود يطابق المتوقع — لا حاجة للتسوية.${d.settlementShortage||d.settlementSurplus?' (تمت تسوية فرق هذا اليوم سابقاً)':''}</span>`}</div></div>`;
  // تفاصيل مختصرة قابلة للطي
  const ss=d.salesSummary;
  const salesRows=[`<tr><td>عدد الفواتير</td><td>${ss.invoiceCount}</td></tr>`,`<tr><td>إجمالي المبيعات</td><td><b>${money(ss.totalSales)}</b></td></tr>`,(nz(ss.creditSales)?`<tr><td>مبيعات آجل / غير محصّلة</td><td>${money(ss.creditSales)}</td></tr>`:''),(nz(ss.totalDiscounts)?`<tr><td>إجمالي الخصومات</td><td>${money(ss.totalDiscounts)}</td></tr>`:'')].filter(Boolean);
  const expCatRows=d.expensesByCategory.filter(c=>nz(c.total)).map(c=>`<tr><td><b>${esc(c.name)}</b></td><td>${money(c.total)}</td></tr>`);
  const invRows=d.invoices.map(i=>`<tr><td class="ltr">${esc(i.invoice_no)}</td><td class="ltr">${esc(i.time)}</td><td>${esc(i.customer)}</td><td>${esc(M[i.payment_method]||i.payment_method)}</td><td><b>${money(i.total)}</b></td><td>${money(i.paid)}</td><td class="${i.balance_due>0?'stock-negative':''}">${money(i.balance_due)}</td><td class="mini">${esc(i.seller||'—')}</td></tr>`);
  const refRows=d.refunds.map(r=>`<tr><td class="ltr">${esc(r.time)}</td><td class="ltr">${esc(r.original_invoice||'—')}</td><td>${esc(M[r.refund_method]||r.refund_method)}</td><td><b>${money(r.amount)}</b></td><td>${esc(r.customer)}</td></tr>`);
  const cpRows=d.customerPayments.map(p=>`<tr><td>${esc(p.customer)}</td><td>${esc(M[p.method]||p.method)}</td><td><b>${money(p.amount)}</b></td><td class="mini">${esc(p.notes||'')}</td></tr>`);
  const spRows=d.supplierPayments.map(p=>`<tr><td>${esc(p.supplier)}</td><td>${esc(M[p.method]||p.method)}</td><td><b>${money(p.amount)}</b></td><td class="mini">${esc(p.notes||'')}</td></tr>`);
  const details=(title,bodyHTML)=>`<details style="margin-top:10px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:6px 12px"><summary style="cursor:pointer;font-weight:800;padding:6px 0;color:var(--blue)">${title}</summary><div style="padding-top:6px">${bodyHTML}</div></details>`;
  const lists=`<div class="panel" style="box-shadow:none;margin-top:12px">
    ${details('ملخص المبيعات', tbl(['البيان','القيمة '+cur],salesRows))}
    ${expCatRows.length?details('المصاريف حسب التصنيف', tbl(['التصنيف','الإجمالي'],expCatRows)):''}
    ${details('قائمة الفواتير ('+d.invoices.length+')', tbl(['رقم الفاتورة','الوقت','الزبون','طريقة الدفع','الإجمالي','المدفوع','المتبقي','البائع'],invRows))}
    ${details('قائمة المرتجعات ('+d.refunds.length+')', tbl(['وقت المرتج','الفاتورة الأصلية','طريقة الاسترداد','المبلغ','الزبون'],refRows))}
    ${details('دفعات الزبائن ('+d.customerPayments.length+')', tbl(['الزبون','الطريقة','المبلغ','ملاحظات'],cpRows))}
    ${details('دفعات الموردين ('+d.supplierPayments.length+')', tbl(['المورد','الطريقة','المبلغ','ملاحظات'],spRows))}
  </div>`;
  q('dailyCashReportBody').innerHTML=header+inSec+outSec+baqi+settlement+lists;
  updateDailyCashDifference();
  renderDailyCashClosings();
}

function dailyCashPrintHtml(d, meta={}){
  const M=DAILY_METHOD_LABELS, cur=APP_CONFIG.currency;
  const responsible=meta.responsible!==undefined?meta.responsible:(appUser?.identifier||'');
  const generated=meta.generated||new Date().toLocaleString('ar-LY',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const savedStatus=meta.savedStatus!==undefined?meta.savedStatus:(d.savedStatus||'غير محفوظ بعد');
  const notes=meta.notes!==undefined?meta.notes:'';
  const cashCls=n=>n>=0?'pos':'neg';
  const nz=v=>Math.abs(Number(v||0))>0.009;
  const MLM=[['كاش','cash'],['بطاقة','card'],['تحويل','bank_transfer']];
  const methodLines=(label,b)=>MLM.filter(([_,k])=>nz(b[k])).map(([m,k])=>`<tr><td>${label} — ${m}</td><td>${money(b[k])}</td></tr>`).join('');
  const totalIn=d.salesPay.total+d.customerPay.total+(nz(d.settlementSurplus)?d.settlementSurplus:0);
  const totalOut=d.expensesPay.total+d.supplierPay.total+d.refundsPay.total+(nz(d.settlementShortage)?d.settlementShortage:0);
  let inRows=methodLines('مبيعات',d.salesPay)+methodLines('دفعات زبائن',d.customerPay);
  if(nz(d.settlementSurplus)) inRows+=`<tr><td>تسوية زيادة صندوق</td><td>${money(d.settlementSurplus)}</td></tr>`;
  if(inRows) inRows+=`<tr class="totalrow"><td>مجموع المداخيل</td><td>${money(totalIn)}</td></tr>`;
  let outRows=methodLines('مصاريف',d.expensesPay)+methodLines('دفعات موردين',d.supplierPay)+methodLines('مرتجعات/استرداد',d.refundsPay);
  if(nz(d.settlementShortage)) outRows+=`<tr><td>تسوية عجز صندوق (على المسؤول)</td><td>${money(d.settlementShortage)}</td></tr>`;
  if(outRows) outRows+=`<tr class="totalrow"><td>مجموع المصاريف</td><td>${money(totalOut)}</td></tr>`;
  const diff=d.difference!==undefined?d.difference:((d.countedCash||0)-d.cashRemaining);
  const ss=d.salesSummary||{};
  const salesRows=[`<tr><td>عدد الفواتير</td><td>${ss.invoiceCount??d.invoiceCount}</td></tr>`,`<tr><td>إجمالي المبيعات</td><td><b>${money(ss.totalSales??0)}</b></td></tr>`,(nz(ss.creditSales)?`<tr><td>مبيعات آجل / غير محصّلة</td><td>${money(ss.creditSales)}</td></tr>`:''),(nz(ss.totalDiscounts)?`<tr><td>إجمالي الخصومات</td><td>${money(ss.totalDiscounts)}</td></tr>`:'')].filter(Boolean);
  const expCatRows=(d.expensesByCategory||[]).filter(c=>nz(c.total)).map(c=>`<tr><td>${esc(c.name)}</td><td><b>${money(c.total)}</b></td></tr>`);
  const invRows=(d.invoices||[]).map(i=>`<tr><td>${esc(i.invoice_no)}</td><td>${esc(i.time)}</td><td>${esc(i.customer)}</td><td>${esc(M[i.payment_method]||i.payment_method)}</td><td><b>${money(i.total)}</b></td><td>${money(i.paid)}</td><td>${money(i.balance_due)}</td><td>${esc(i.seller||'—')}</td></tr>`);
  const refRows=(d.refunds||[]).map(r=>`<tr><td>${esc(r.time)}</td><td>${esc(r.original_invoice||'—')}</td><td>${esc(M[r.refund_method]||r.refund_method)}</td><td><b>${money(r.amount)}</b></td><td>${esc(r.customer)}</td></tr>`);
  const cpRows=(d.customerPayments||[]).map(p=>`<tr><td>${esc(p.customer)}</td><td>${esc(M[p.method]||p.method)}</td><td><b>${money(p.amount)}</b></td><td>${esc(p.notes||'')}</td></tr>`);
  const spRows=(d.supplierPayments||[]).map(p=>`<tr><td>${esc(p.supplier)}</td><td>${esc(M[p.method]||p.method)}</td><td><b>${money(p.amount)}</b></td><td>${esc(p.notes||'')}</td></tr>`);
  const T=(title,head,rows)=>`<h3>${title}</h3><table><thead><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')||`<tr><td colspan="${head.length}" class="empty">لا توجد بيانات.</td></tr>`}</tbody></table>`;
  if(d.isRange){
    const dayRows=(d.days||[]).map(D=>`<tr><td>${esc(D.date)}</td><td>${D.invoiceCount}</td><td>${money(D.salesTotal)}</td><td>${money(D.cashIn)}</td><td>${money(D.cashOut)}</td><td class="${cashCls(D.cashRemaining)}">${money(D.cashRemaining)}</td></tr>`);
    const periodLabel=esc(d.dateFrom)+' ← '+esc(d.dateTo);
    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير الخزينة للفترة — ${esc(d.branchName)}</title>
</head><body>
<div class="head"><div><div class="title">${esc(APP_CONFIG.businessName)}</div><div class="sub">تقرير حالة الخزينة للفترة</div></div>
<div class="meta">الفرع: <b>${esc(d.branchName)}</b><br>الفترة: <b>${periodLabel}</b><br>عدد الأيام: <b>${(d.days||[]).length}</b><br>المسؤول: <b>${esc(responsible)}</b><br>وقت التوليد: <b>${esc(generated)}</b></div></div>
<h3>المداخيل (حسب طريقة الدفع)</h3><table><thead><tr><th>البيان</th><th>المبلغ</th></tr></thead><tbody>${inRows||'<tr><td colspan="2">لا توجد مداخيل.</td></tr>'}</tbody></table>
<h3>المصاريف (حسب طريقة الدفع)</h3><table><thead><tr><th>البيان</th><th>المبلغ</th></tr></thead><tbody>${outRows||'<tr><td colspan="2">لا توجد مصاريف.</td></tr>'}</tbody></table>
<div class="baqi"><div class="lbl">الباقي كاش للفترة (النقد فقط)</div><div class="amt ${cashCls(d.cashRemaining)}">${money(d.cashRemaining)} ${cur}</div></div>
<h3>تفصيل يومي</h3><table><thead><tr><th>التاريخ</th><th>عدد الفواتير</th><th>إجمالي المبيعات</th><th>الكاش الداخل</th><th>الكاش الخارج</th><th>المتبقي كاش</th></tr></thead><tbody>${dayRows.join('')||'<tr><td colspan="6">لا توجد بيانات.</td></tr>'}</tbody></table>
<div class="small" style="margin-top:12px">تقرير مختصر للفترة — لتفاصيل يوم واحد اجعل «من» = «إلى».</div>
<div class="no-print" style="text-align:center;margin-top:14px"><button onclick="window.print()" style="background:#1d4ed8;color:#fff;border:0;border-radius:10px;padding:9px 22px;font:inherit;font-weight:700;cursor:pointer">طباعة</button></div>
</body></html>`;
  }
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير الخزينة اليومية — ${esc(d.branchName)} ${esc(d.date)}</title>
</head><body>
<div class="head"><div><div class="title">${esc(APP_CONFIG.businessName)}</div><div class="sub">تقرير حالة الخزينة اليومية — إغلاق اليوم</div></div>
<div class="meta">الفرع: <b>${esc(d.branchName)}</b><br>${d.isRange?('الفترة: <b>'+esc(d.dateFrom)+' ← '+esc(d.dateTo)+'</b>'):('التاريخ: <b>'+esc(d.date)+'</b>')}<br>المسؤول: <b>${esc(responsible)}</b><br>وقت التوليد: <b>${esc(generated)}</b><br>الحالة: <span class="badge">${esc(savedStatus)}</span></div></div>
<h3>المداخيل (حسب طريقة الدفع)</h3><table><thead><tr><th>البيان</th><th>المبلغ</th></tr></thead><tbody>${inRows||'<tr><td colspan="2" class="empty">لا توجد مداخيل.</td></tr>'}</tbody></table>
<h3>المصاريف (حسب طريقة الدفع)</h3><table><thead><tr><th>البيان</th><th>المبلغ</th></tr></thead><tbody>${outRows||'<tr><td colspan="2" class="empty">لا توجد مصاريف.</td></tr>'}</tbody></table>
<div class="baqi"><div><div class="lbl">الباقي كاش (النقد فقط)</div><div class="small">البطاقة والتحويل لا يدخلان في الباقي الكاشي — فقط النقد الداخل ناقص النقد الخارج.</div></div><div class="amt ${cashCls(d.cashRemaining)}">${money(d.cashRemaining)} ${cur}</div></div>
<div class="settle"><h3 style="margin:0 0 8px">التسوية النهائية</h3>
<div class="row">
<div><label>الكاش المعدود</label><div class="big">${money(d.countedCash||0)} ${cur}</div></div>
<div><label>الفرق (المعدود − المتوقع)</label><div class="big ${cashCls(diff)}">${(diff>0?'+':'')+money(diff)} ${cur}</div></div>
</div>
${notes?`<div class="small" style="margin-top:8px"><b>ملاحظات:</b> ${esc(notes)}</div>`:''}
<div class="sign"><div>توقيع مسؤول الفرع</div><div>توقيع الإدارة / المحاسب</div></div>
</div>
${T('ملخص المبيعات',['البيان','القيمة '+cur],salesRows)}
${expCatRows.length?T('المصاريف حسب التصنيف',['التصنيف','الإجمالي '+cur],expCatRows):''}
${T('قائمة الفواتير',['رقم الفاتورة','الوقت','الزبون','طريقة الدفع','الإجمالي','المدفوع','المتبقي','البائع'],invRows)}
${T('قائمة المرتجعات',['وقت المرتج','الفاتورة الأصلية','طريقة الاسترداد','المبلغ','الزبون'],refRows)}
${T('دفعات الزبائن',['الزبون','الطريقة','المبلغ','ملاحظات'],cpRows)}
${T('دفعات الموردين',['المورد','الطريقة','المبلغ','ملاحظات'],spRows)}
<div class="no-print" style="text-align:center;margin-top:18px"><button onclick="window.print()" style="background:#1d4ed8;color:#fff;border:0;border-radius:10px;padding:10px 22px;font:inherit;font-weight:700;cursor:pointer">طباعة</button></div>
</body></html>`;
}

function dailyCashClosingBody(d,notes=''){
  return {
    closing_date:d.date, branch_id:d.branch, branch_name:d.branchName,
    responsible_identifier:appUser?.identifier||'', invoice_count:d.invoiceCount,
    sales_cash:d.salesPay.cash, sales_card:d.salesPay.card, sales_bank_transfer:d.salesPay.bank_transfer,
    expenses_cash:d.expensesPay.cash, expenses_card:d.expensesPay.card, expenses_bank_transfer:d.expensesPay.bank_transfer,
    customer_payments_cash:d.customerPay.cash, customer_payments_card:d.customerPay.card, customer_payments_bank_transfer:d.customerPay.bank_transfer,
    supplier_payments_cash:d.supplierPay.cash, supplier_payments_card:d.supplierPay.card, supplier_payments_bank_transfer:d.supplierPay.bank_transfer,
    refunds_cash:d.refundsPay.cash, refunds_card:d.refundsPay.card, refunds_bank_transfer:d.refundsPay.bank_transfer,
    cash_remaining:d.cashRemaining, notes, created_by:appUser?.identifier||'', updated_at:new Date().toISOString()
  };
}
function renderDailyCashClosings(){
  const body=q('dailyCashClosingsBody'); if(!body)return;
  body.innerHTML=(dailyCashClosings||[]).slice(0,80).map(r=>`<tr><td>${esc(r.closing_date)}</td><td>${esc(r.branch_name||locations.find(l=>l.id===r.branch_id)?.name||'')}</td><td>${esc(r.responsible_identifier||r.created_by||'')}</td><td>${Number(r.invoice_count||0)}</td><td><b class="${Number(r.cash_remaining||0)>=0?'stock-positive':'stock-negative'}">${money(r.cash_remaining)}</b></td><td>${esc((r.created_at||'').replace('T',' ').slice(0,19))}</td><td>${esc(r.notes||'')}</td><td><button class="btn secondary" type="button" onclick="printSavedDailyCashClosing('${r.id}')">طباعة</button></td></tr>`).join('')||'<tr><td colspan="8">لا توجد إغلاقات محفوظة.</td></tr>';
}
async function saveDailyCashClosing(){
  const d=getDailyCashData({date:q('dailyCashDateTo')?.value});
  if(!d.branch){toast('اختر فرعًا محددًا قبل حفظ الإغلاق','warn');return;}
  const existing=(dailyCashClosings||[]).find(x=>x.branch_id===d.branch && x.closing_date===d.date);
  if(existing && !(await requestSupervisorApproval('تعديل إغلاق خزينة محفوظ',`${d.branchName} - ${d.date}`))) return;
  const notes=prompt('ملاحظات الإغلاق اليومية (اختياري):', existing?.notes||''); if(notes===null)return;
  const body=dailyCashClosingBody(d,notes);
  try{
    showLoading(true);
    if(existing){await api('pos_daily_cash_closings',{method:'PATCH',qs:`?id=eq.${existing.id}`,body}); await logAction('closing_update','pos_daily_cash_closings',existing.id,`${d.branchName} - ${d.date} - كاش ${money(d.cashRemaining)}`); toast('تم تحديث إغلاق اليوم','success');}
    else {await api('pos_daily_cash_closings',{method:'POST',body}); toast('تم حفظ إغلاق اليوم','success');}
    dailyCashClosings=await apiAll('pos_daily_cash_closings','?select=*&order=closing_date.desc,created_at.desc&limit=100');
    renderDailyCashReport();
  }catch(e){console.error(e);toast('تعذر حفظ إغلاق الخزينة: '+friendlyError(e),'error')}
  finally{showLoading(false);window.__busy=false}
}
function printSavedDailyCashClosing(id){
  const r=(dailyCashClosings||[]).find(x=>x.id===id); if(!r)return;
  // التقرير يُعاد حسابه حيّاً من بيانات ذلك اليوم/الفرع حتى يعكس أي تغيير بعد الموافقة.
  const d=getDailyCashData({date:r.closing_date, branch:r.branch_id});
  const meta={responsible:r.responsible_identifier||r.created_by||'', savedStatus:(r.updated_at&&r.created_at&&r.updated_at!==r.created_at)?'محفوظ — تم التحديث بموافقة المدير':'محفوظ', notes:r.notes||''};
  showInAppPrint(dailyCashPrintHtml(d,meta));
}

async function settleDailyCashDifference(){
  const d=getDailyCashData({date:q('dailyCashDateTo')?.value});
  const diff=Number(d.difference||0);
  if(Math.abs(diff)<0.009){toast('لا يوجد فرق للتسوية — المعدود يطابق المتوقع','warn');return;}
  if(!d.branch){toast('اختر فرعاً محدداً قبل التسوية','warn');return;}
  const kind=diff<0?'عجز':'زيادة';
  const reason=prompt(`سبب التسوية (${kind} ${money(Math.abs(diff))} ${APP_CONFIG.currency}):`,'');
  if(reason===null) return;
  if(!reason.trim()){toast('اكتب سبب التسوية','warn');return;}
  const ok=await requestSupervisorApproval('تسوية فرق الصندوق',`${kind} ${money(Math.abs(diff))} ${APP_CONFIG.currency} - ${d.branchName} - ${d.date}`);
  if(!ok){toast('لم يتم اعتماد التسوية','warn');return;}
  if(window.__busy) return; window.__busy=true;
  try{
    showLoading(true);
    const cashAccount=financeAccounts.find(a=>a.account_type==='cash' && a.location_id===d.branch) || financeAccounts.find(a=>a.account_type==='cash');
    if(!cashAccount){toast('لا توجد خزينة نقدية لهذا الفرع لإنشاء قيد التسوية','warn');return;}
    if(diff<0){
      // عجز = دين على المسؤول + إخراج النقد من خزينة الفرع (قيد مزدوج يُغلق التسوية)
      const amt=Math.abs(diff);
      const custName=`عجز صندوق — ${appUser?.identifier||'المسؤول'}`;
      let cust=customers.find(c=>(c.name||'').trim()===custName);
      if(!cust){const created=await api('pos_customers',{method:'POST',body:{name:custName,active:false,notes:'زبون آلي لتتبع عجز الصندوق على المسؤولين'}}); cust=created[0]; customers.push(cust);}
      await api('pos_customer_ledger',{method:'POST',body:{customer_id:cust.id,entry_date:d.date,entry_type:'adjustment',description:`عجز صندوق يوم ${d.date} - فرع ${d.branchName} - المسؤول: ${appUser?.identifier||''}${reason.trim()?' - '+reason.trim():''}`,debit:amt,credit:0}});
      await addFinanceMovement(cashAccount.id,'out','cash_shortage',amt,d.date,'pos_daily_cash_closings',null,`عجز صندوق - ${d.branchName} - ${d.date} - المسؤول: ${appUser?.identifier||''}${reason.trim()?' - '+reason.trim():''}`);
      await logAction('settle_shortage','pos_finance_movements',null,`عجز ${money(amt)} ${APP_CONFIG.currency} - دين على ${custName} - ${reason.trim()}`);
      toast(`تمت تسوية العجز ${money(amt)} ${APP_CONFIG.currency} كدين على «${custName}»`,'success');
    }else{
      // زيادة = إيراد يُدخل إلى الخزينة
      const amt=diff;
      await addFinanceMovement(cashAccount.id,'in','cash_surplus',amt,d.date,'pos_daily_cash_closings',null,`زيادة صندوق - ${d.branchName} - ${d.date}${reason.trim()?' - '+reason.trim():''}`);
      await logAction('settle_surplus','pos_finance_movements',null,`زيادة ${money(amt)} ${APP_CONFIG.currency} - ${reason.trim()}`);
      toast(`تمت تسوية الزيادة ${money(amt)} ${APP_CONFIG.currency} كإيراد في الخزينة`,'success');
    }
    await loadAll();
    renderDailyCashReport();
  }catch(e){console.error(e);toast('تعذرت تسوية الفرق: '+friendlyError(e),'error')}
  finally{showLoading(false);window.__busy=false}
}
function printDailyCashReport(){
  const d=getDailyCashData();
  showInAppPrint(dailyCashPrintHtml(d,{responsible:appUser?.identifier||'', savedStatus:d.savedStatus, notes:d.saved?.notes||''}));
}

function prepareDailyCashTransfer(){
  const d=getDailyCashData({date:q('dailyCashDateTo')?.value});
  if(!(d.cashRemaining>0)){toast('لا يوجد متبقي كاش للتحويل','warn');return;}
  openTab('finance');
  const cash=financeAccounts.find(a=>a.account_type==='cash' && (!d.branch || a.location_id===d.branch));
  if(q('financeTransferFrom')&&cash) q('financeTransferFrom').value=cash.id;
  if(q('financeTransferAmount')) q('financeTransferAmount').value=money(d.cashRemaining).replace(/,/g,'');
  if(q('financeTransferDate')) q('financeTransferDate').value=d.date;
  if(q('financeTransferNotes')) q('financeTransferNotes').value=`تصفية خزينة يوم ${d.date} - ${d.branchName}`;
  toast('اختر خزينة الإدارة في خانة إلى حساب ثم احفظ التحويل','info');
}

function showReport(name){
  currentReport=name;
  document.querySelectorAll('.rep-view').forEach(v=>v.classList.add('hidden'));
  q('rep-'+name)?.classList.remove('hidden');
  document.querySelectorAll('.seg-btn').forEach(b=>b.classList.toggle('active',b.dataset.rep===name));
  renderReportsDetail();
}
function reportContext(){
  const from=q('reportFrom')?.value||'', to=q('reportTo')?.value||'', loc=q('reportLocation')?.value||'';
  const filteredSales=sales.filter(sl=>inDateRange(sl.sale_date,from,to)&&(!loc||sl.location_id===loc));
  const saleIds=new Set(filteredSales.map(s=>s.id));
  const filteredItems=saleItems.filter(it=>saleIds.has(it.sale_id));
  const filteredReturns=saleReturns.filter(r=>inDateRange(r.return_date,from,to)&&(!loc||r.location_id===loc));
  const filteredReturnIds=new Set(filteredReturns.map(r=>r.id));
  const filteredReturnItems=saleReturnItems.filter(it=>filteredReturnIds.has(it.return_id));
  const filteredExpenses=expenses.filter(e=>inDateRange(e.expense_date,from,to));
  const filteredSalaries=salaryPayments.filter(e=>inDateRange(e.payment_date,from,to));
  return {from,to,loc,filteredSales,saleIds,filteredItems,filteredReturns,filteredReturnItems,filteredExpenses,filteredSalaries};
}
function aggregateItemProfit(items, returnItems=[]){
  const map={};
  items.forEach(it=>{const k=it.product_code; if(!map[k])map[k]={code:k,name:it.product_name,qty:0,sales:0,cost:0,returns:0,profit:0}; map[k].qty+=Number(it.qty||0); map[k].sales+=Number(it.line_total||0); map[k].cost+=productCost(k)*Number(it.qty||0);});
  returnItems.forEach(it=>{const k=it.product_code; if(!map[k])map[k]={code:k,name:it.product_name,qty:0,sales:0,cost:0,returns:0,profit:0}; map[k].qty-=Number(it.qty||0); map[k].returns+=Number(it.line_total||0); map[k].sales-=Number(it.line_total||0); map[k].cost-=productCost(k)*Number(it.qty||0);});
  Object.values(map).forEach(r=>{r.profit=r.sales-r.cost; r.margin=r.sales?((r.profit/r.sales)*100):0;});
  return Object.values(map);
}
function renderReportsDetail(){
  if(q('repHistCustomer') && !q('repHistCustomer').dataset.ready){q('repHistCustomer').innerHTML='<option value="">اختر الزبون</option>'+customers.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join(''); q('repHistCustomer').dataset.ready='1';}
  const ctx=reportContext();
  const salesTotal=ctx.filteredSales.reduce((a,s)=>a+Number(s.total||0),0);
  const returnsTotal=ctx.filteredReturns.reduce((a,r)=>a+Number(r.total||0),0);
  const itemAgg=aggregateItemProfit(ctx.filteredItems,ctx.filteredReturnItems);
  const cogs=itemAgg.reduce((a,r)=>a+Number(r.cost||0),0);
  const grossProfit=(salesTotal-returnsTotal)-cogs;
  const expenseTotal=ctx.filteredExpenses.reduce((a,e)=>a+Number(e.amount||0),0);
  const salaryTotal=ctx.filteredSalaries.reduce((a,e)=>a+Number(e.amount||0),0);
  const netProfit=grossProfit-expenseTotal-salaryTotal;
  if(q('repIncomeBody')) q('repIncomeBody').innerHTML=`<div class="report-kpi"><div class="card"><h3>صافي المبيعات</h3><div class="num">${money(salesTotal-returnsTotal)}</div></div><div class="card"><h3>تكلفة البضاعة</h3><div class="num">${money(cogs)}</div></div><div class="card"><h3>مجمل الربح</h3><div class="num ${grossProfit>=0?'profit-positive':'profit-negative'}">${money(grossProfit)}</div></div><div class="card"><h3>صافي الربح</h3><div class="num ${netProfit>=0?'profit-positive':'profit-negative'}">${money(netProfit)}</div></div></div><table><tbody><tr><td>إجمالي المبيعات</td><td>${money(salesTotal)}</td></tr><tr><td>المرتجعات</td><td>${money(returnsTotal)}</td></tr><tr><td>صافي المبيعات</td><td>${money(salesTotal-returnsTotal)}</td></tr><tr><td>تكلفة البضاعة المباعة</td><td>${money(cogs)}</td></tr><tr><td>مجمل الربح</td><td>${money(grossProfit)}</td></tr><tr><td>المصاريف</td><td>${money(expenseTotal)}</td></tr><tr><td>المرتبات</td><td>${money(salaryTotal)}</td></tr><tr><td><b>صافي الربح</b></td><td><b>${money(netProfit)}</b></td></tr></tbody></table>`;
  const term=(q('repItemSearch')?.value||'').trim().toLowerCase();
  if(q('repItemProfitBody')) q('repItemProfitBody').innerHTML=itemAgg.filter(r=>!term||[r.code,r.name].join(' ').toLowerCase().includes(term)).sort((a,b)=>b.profit-a.profit).slice(0,200).map(r=>`<tr><td class="ltr"><b>${esc(r.code)}</b></td><td>${esc(r.name)}</td><td>${money(r.qty)}</td><td>${money(r.sales)}</td><td>${money(r.cost)}</td><td class="${r.profit>=0?'profit-positive':'profit-negative'}">${money(r.profit)}</td><td>${money(r.margin)}%</td></tr>`).join('')||'<tr><td colspan="7">لا توجد بيانات.</td></tr>';
  const byCustomer={};
  ctx.filteredSales.forEach(sl=>{const c=customers.find(x=>x.id===sl.customer_id); const key=sl.customer_id||'cash'; if(!byCustomer[key])byCustomer[key]={name:c?.name||'زبون نقدي',count:0,sales:0,cost:0,profit:0,balance:Number(c?.balance||0)}; byCustomer[key].count++; byCustomer[key].sales+=Number(sl.total||0); saleItems.filter(it=>it.sale_id===sl.id).forEach(it=>byCustomer[key].cost+=productCost(it.product_code)*Number(it.qty||0));});
  Object.values(byCustomer).forEach(r=>r.profit=r.sales-r.cost);
  if(q('repCustomerProfitBody')) q('repCustomerProfitBody').innerHTML=Object.values(byCustomer).sort((a,b)=>b.sales-a.sales).map(r=>`<tr><td>${esc(r.name)}</td><td>${r.count}</td><td>${money(r.sales)}</td><td>${money(r.cost)}</td><td class="${r.profit>=0?'profit-positive':'profit-negative'}">${money(r.profit)}</td><td>${money(r.balance)}</td></tr>`).join('')||'<tr><td colspan="6">لا توجد بيانات.</td></tr>';
  if(q('repInvoiceProfitBody')) q('repInvoiceProfitBody').innerHTML=ctx.filteredSales.map(sl=>{const l=locations.find(x=>x.id===sl.location_id), c=customers.find(x=>x.id===sl.customer_id); const cost=saleItems.filter(it=>it.sale_id===sl.id).reduce((a,it)=>a+productCost(it.product_code)*Number(it.qty||0),0); const profit=Number(sl.total||0)-cost; const margin=Number(sl.total||0)?profit/Number(sl.total||0)*100:0; return `<tr><td class="ltr"><b>${esc(sl.invoice_no||sl.id.slice(0,8))}</b></td><td>${esc(sl.sale_date)}</td><td>${esc(l?.name)}</td><td>${esc(c?.name||'زبون نقدي')}</td><td>${money(sl.total)}</td><td>${money(cost)}</td><td class="${profit>=0?'profit-positive':'profit-negative'}">${money(profit)}</td><td>${money(margin)}%</td></tr>`}).join('')||'<tr><td colspan="7">لا توجد فواتير.</td></tr>';
  if(q('repExpenseTotal')){q('repExpenseTotal').textContent=money(expenseTotal); q('repSalaryTotal').textContent=money(salaryTotal); q('repExpenseSalaryTotal').textContent=money(expenseTotal+salaryTotal)}
  if(q('repExpensesBody')) q('repExpensesBody').innerHTML=[...ctx.filteredExpenses.map(e=>({date:e.expense_date,type:'مصروف',title:e.title,account:e.account_id,amount:e.amount})),...ctx.filteredSalaries.map(e=>({date:e.payment_date,type:'مرتب',title:e.period||'مرتب',account:e.account_id,amount:e.amount}))].sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(r=>`<tr><td>${esc(r.date)}</td><td>${esc(r.type)}</td><td>${esc(r.title)}</td><td>${esc(financeAccountName(r.account))}</td><td>${money(r.amount)}</td></tr>`).join('')||'<tr><td colspan="5">لا توجد مصاريف أو مرتبات.</td></tr>';
  const months={};
  ctx.filteredSales.forEach(s=>{const m=(s.sale_date||'').slice(0,7); if(!months[m])months[m]={sales:0,returns:0,cost:0,expenses:0}; months[m].sales+=Number(s.total||0); saleItems.filter(it=>it.sale_id===s.id).forEach(it=>months[m].cost+=productCost(it.product_code)*Number(it.qty||0));});
  ctx.filteredReturns.forEach(r=>{const m=(r.return_date||'').slice(0,7); if(!months[m])months[m]={sales:0,returns:0,cost:0,expenses:0}; months[m].returns+=Number(r.total||0);});
  ctx.filteredExpenses.forEach(e=>{const m=(e.expense_date||'').slice(0,7); if(!months[m])months[m]={sales:0,returns:0,cost:0,expenses:0}; months[m].expenses+=Number(e.amount||0);});
  ctx.filteredSalaries.forEach(e=>{const m=(e.payment_date||'').slice(0,7); if(!months[m])months[m]={sales:0,returns:0,cost:0,expenses:0}; months[m].expenses+=Number(e.amount||0);});
  if(q('repMonthlyBody')) q('repMonthlyBody').innerHTML=Object.entries(months).sort((a,b)=>b[0].localeCompare(a[0])).map(([m,r])=>{const net=r.sales-r.returns-r.cost-r.expenses; return `<tr><td>${esc(m)}</td><td>${money(r.sales)}</td><td>${money(r.returns)}</td><td>${money(r.cost)}</td><td>${money(r.expenses)}</td><td class="${profitClass(net)}">${money(net)}</td></tr>`}).join('')||emptyRow(6,'لا توجد بيانات شهرية.');

  const d=repScopeData();
  if(currentReport==='branchprofit' && q('repBranchProfitBody')){
    const bySale={}; d.fItems.forEach(it=>{(bySale[it.sale_id]||(bySale[it.sale_id]=[])).push(it);});
    const m={}; d.fSales.forEach(sl=>{const k=sl.location_id||'none'; const o=m[k]||(m[k]={id:k,count:0,rev:0,cost:0}); o.count++; o.rev+=Number(sl.total||0); (bySale[sl.id]||[]).forEach(it=>o.cost+=productCost(it.product_code)*Number(it.qty||0));});
    const byRet={}; d.fRetItems.forEach(it=>{(byRet[it.return_id]||(byRet[it.return_id]=[])).push(it);});
    d.fReturns.forEach(r=>{const o=m[r.location_id]; if(!o)return; o.rev-=Number(r.total||0); (byRet[r.id]||[]).forEach(it=>o.cost-=productCost(it.product_code)*Number(it.qty||0));});
    const rows=Object.values(m).map(r=>({...r,name:locations.find(l=>l.id===r.id)?.name||'غير محدد',profit:r.rev-r.cost,margin:r.rev?(r.rev-r.cost)/r.rev*100:0})).sort((a,b)=>b.profit-a.profit);
    q('repBranchProfitBody').innerHTML=rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${r.count}</td><td>${money(r.rev)}</td><td>${money(r.cost)}</td><td class="${profitClass(r.profit)}">${money(r.profit)}</td><td class="${profitClass(r.profit)}">${money(r.margin)}%</td></tr>`).join('')||emptyRow(6);
  }
  if(currentReport==='catprofit' && q('repCatProfitBody')){
    const m={}; const add=(it,sign=1)=>{const p=productByCode(it.product_code); const k=p?.category||'بدون تصنيف'; const o=m[k]||(m[k]={name:k,qty:0,rev:0,cost:0}); o.qty+=sign*Number(it.qty||0); o.rev+=sign*Number(it.line_total||0); o.cost+=sign*productCost(it.product_code)*Number(it.qty||0);};
    d.fItems.forEach(it=>add(it,1)); d.fRetItems.forEach(it=>add(it,-1)); const rows=Object.values(m).map(r=>({...r,profit:r.rev-r.cost,margin:r.rev?(r.rev-r.cost)/r.rev*100:0})).sort((a,b)=>b.profit-a.profit);
    q('repCatProfitBody').innerHTML=rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${money(r.qty)}</td><td>${money(r.rev)}</td><td>${money(r.cost)}</td><td class="${profitClass(r.profit)}">${money(r.profit)}</td><td class="${profitClass(r.profit)}">${money(r.margin)}%</td></tr>`).join('')||emptyRow(6);
  }
  if(currentReport==='supplierprofit' && q('repSupplierProfitBody')){
    const m={}; const add=(it,sign=1)=>{const p=productByCode(it.product_code); const k=p?.supplier_name||'بدون مورد'; const o=m[k]||(m[k]={name:k,rev:0,cost:0}); o.rev+=sign*Number(it.line_total||0); o.cost+=sign*productCost(it.product_code)*Number(it.qty||0);};
    d.fItems.forEach(it=>add(it,1)); d.fRetItems.forEach(it=>add(it,-1)); const rows=Object.values(m).map(r=>({...r,profit:r.rev-r.cost,margin:r.rev?(r.rev-r.cost)/r.rev*100:0})).sort((a,b)=>b.profit-a.profit);
    q('repSupplierProfitBody').innerHTML=rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${money(r.rev)}</td><td>${money(r.cost)}</td><td class="${profitClass(r.profit)}">${money(r.profit)}</td><td class="${profitClass(r.profit)}">${money(r.margin)}%</td></tr>`).join('')||emptyRow(5);
  }
  if(currentReport==='lossitems' && q('repLossItemsBody')){
    const rows=itemProfitRows().filter(r=>r.profit<0).sort((a,b)=>a.profit-b.profit);
    q('repLossItemsBody').innerHTML=rows.map(r=>`<tr><td class="ltr"><b>${esc(r.code)}</b></td><td>${esc(r.name)}</td><td>${money(r.qty)}</td><td>${money(r.sales)}</td><td>${money(r.cost)}</td><td class="stock-negative">${money(r.profit)}</td><td class="stock-negative">${money(r.margin)}%</td></tr>`).join('')||emptyRow(7,'لا توجد أصناف خاسرة في الفترة المحددة.');
  }
  if(currentReport==='losscustomers' && q('repLossCustomersBody')){
    const rows=customerProfitRows().filter(r=>r.profit<0).sort((a,b)=>a.profit-b.profit);
    q('repLossCustomersBody').innerHTML=rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${r.count}</td><td>${money(r.sales)}</td><td>${money(r.cost)}</td><td class="stock-negative">${money(r.profit)}</td><td>${money(r.balance)}</td></tr>`).join('')||emptyRow(6,'لا يوجد زبائن خاسرون في الفترة المحددة.');
  }
  if(currentReport==='itemhistory' && q('repItemHistoryBody')){
    const code=(q('repHistItemCode')?.value||'').split('|')[0].trim().toLowerCase(); const period=q('repHistPeriod')?.value||'month';
    if(!code){q('repItemHistoryBody').innerHTML=emptyRow(5,'اختر صنفًا أولاً.');}
    else{const saleDate={}; d.fSales.forEach(s=>saleDate[s.id]=s.sale_date); const m={}; d.fItems.filter(it=>String(it.product_code).toLowerCase()===code).forEach(it=>{const k=bucketKey(saleDate[it.sale_id],period); if(!k)return; const o=m[k]||(m[k]={k,qty:0,rev:0,cost:0}); o.qty+=Number(it.qty||0); o.rev+=Number(it.line_total||0); o.cost+=productCost(it.product_code)*Number(it.qty||0);}); const rows=Object.values(m).map(r=>({...r,profit:r.rev-r.cost})).sort((a,b)=>a.k.localeCompare(b.k)); q('repItemHistoryBody').innerHTML=rows.map(r=>`<tr><td>${esc(r.k)}</td><td>${money(r.qty)}</td><td>${money(r.rev)}</td><td>${money(r.cost)}</td><td class="${profitClass(r.profit)}">${money(r.profit)}</td></tr>`).join('')||emptyRow(5,'لا توجد حركة لهذا الصنف.');}
  }
  if(currentReport==='customerhistory' && q('repCustomerHistoryBody')){
    const cid=q('repHistCustomer')?.value||''; const period=q('repHistCustomerPeriod')?.value||'month';
    if(!cid){q('repCustomerHistoryBody').innerHTML=emptyRow(4,'اختر زبونًا أولاً.');}
    else{const saleById={}; d.fSales.forEach(s=>saleById[s.id]=s); const m={}; d.fItems.filter(it=>saleById[it.sale_id]?.customer_id===cid).forEach(it=>{const k=bucketKey(saleById[it.sale_id]?.sale_date,period); if(!k)return; const o=m[k]||(m[k]={k,rev:0,cost:0}); o.rev+=Number(it.line_total||0); o.cost+=productCost(it.product_code)*Number(it.qty||0);}); const rows=Object.values(m).map(r=>({...r,profit:r.rev-r.cost})).sort((a,b)=>a.k.localeCompare(b.k)); q('repCustomerHistoryBody').innerHTML=rows.map(r=>`<tr><td>${esc(r.k)}</td><td>${money(r.rev)}</td><td>${money(r.cost)}</td><td class="${profitClass(r.profit)}">${money(r.profit)}</td></tr>`).join('')||emptyRow(4,'لا توجد حركة لهذا الزبون.');}
  }
  if(currentReport==='compare' && q('repCompareBody')){
    const period=q('repComparePeriod')?.value||'month'; const m={}; const ensure=k=>m[k]||(m[k]={k,count:0,rev:0,cost:0,expenses:0});
    d.fSales.forEach(sl=>{const k=bucketKey(sl.sale_date,period), o=ensure(k); o.count++; o.rev+=Number(sl.total||0); saleItems.filter(it=>it.sale_id===sl.id).forEach(it=>o.cost+=productCost(it.product_code)*Number(it.qty||0));});
    d.fReturns.forEach(r=>{const k=bucketKey(r.return_date,period), o=ensure(k); o.rev-=Number(r.total||0); saleReturnItems.filter(it=>it.return_id===r.id).forEach(it=>o.cost-=productCost(it.product_code)*Number(it.qty||0));});
    d.fExpenses.forEach(e=>ensure(bucketKey(e.expense_date,period)).expenses+=Number(e.amount||0)); d.fSalaries.forEach(e=>ensure(bucketKey(e.payment_date,period)).expenses+=Number(e.amount||0));
    const rows=Object.values(m).filter(r=>r.k).sort((a,b)=>b.k.localeCompare(a.k)); q('repCompareBody').innerHTML=rows.map(r=>{const gp=r.rev-r.cost, net=gp-r.expenses; return `<tr><td>${esc(r.k)}</td><td>${r.count}</td><td>${money(r.rev)}</td><td>${money(r.cost)}</td><td class="${profitClass(gp)}">${money(gp)}</td><td>${money(r.expenses)}</td><td class="${profitClass(net)}">${money(net)}</td></tr>`}).join('')||emptyRow(7);
  }
}

function printReports(){
  const content=q('reports').innerHTML;
  const period=`${q('reportFrom')?.value||'—'} ← ${q('reportTo')?.value||'—'}`;
  const w=window.open('','_blank'); if(!w){toast('المتصفح منع نافذة الطباعة. اسمح بالنوافذ المنبثقة.'); return;}
  w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقارير ${esc(APP_CONFIG.businessName)}</title></head><body>
  <div class="bar"><button class="pbtn" onclick="window.print()">طباعة</button></div>
  <div class="sheet"><div class="top"><div class="logo">${esc(APP_CONFIG.businessName)}</div><div><h1>تقارير ${esc(APP_CONFIG.businessName)}</h1><div class="tag">الفترة: ${esc(period)} — تاريخ الطباعة: ${new Date().toISOString().slice(0,10)}</div></div></div>${content}</div>
  </body></html>`);
  w.document.close();
}


function setupTableSorting(){
  document.querySelectorAll('table').forEach(table=>{
    const ths=table.querySelectorAll('thead th');
    ths.forEach((th,idx)=>{
      if(th.dataset.sortReady) return;
      th.dataset.sortReady='1'; th.classList.add('sortable');
      th.title='اضغط للترتيب تصاعدي/تنازلي';
      th.addEventListener('click',()=>{
        const tbody=table.querySelector('tbody'); if(!tbody) return;
        const dir=th.dataset.dir==='asc'?'desc':'asc'; th.dataset.dir=dir;
        if(tbody.id==='productsBody'){productSortIndex=idx; productSortDir=dir; renderProducts(); return;}
        if(tbody.id==='stockBody'){stockSortIndex=idx; stockSortDir=dir; renderStock(); return;}
        if(tbody.id==='salePickerBody'){pickerSortIndex=idx; pickerSortDir=dir; renderSaleProductPicker(); return;}
        const rows=[...tbody.querySelectorAll('tr')].filter(r=>r.children.length>1);
        const val=(r)=>{let t=(r.children[idx]?.innerText||'').trim().replace(/,/g,''); let n=parseFloat(t); return isNaN(n)?t:n;};
        rows.sort((a,b)=>{const va=val(a), vb=val(b); let c=(typeof va==='number'&&typeof vb==='number')?va-vb:String(va).localeCompare(String(vb),'ar'); return dir==='asc'?c:-c;});
        rows.forEach(r=>tbody.appendChild(r));
      });
    });
  });
}

/* ===== Right-click context menus on data tables ===== */
const ctxMenu=document.createElement('div'); ctxMenu.className='ctx-menu'; document.body.appendChild(ctxMenu);
function hideCtxMenu(){ctxMenu.style.display='none';}
function ctxArg(el,fn){const a=el?.getAttribute('onclick')||''; const m=a.match(new RegExp(fn+"\\('([^']*)'\\)")); return m?m[1]:null;}
function copyText(txt){
  txt=String(txt||'').trim(); if(!txt){toast('لا يوجد نص للنسخ','warn');return;}
  if(navigator.clipboard?.writeText) navigator.clipboard.writeText(txt).then(()=>toast('تم نسخ النص','success')).catch(()=>prompt('انسخ النص:',txt));
  else prompt('انسخ النص:',txt);
}
function defaultCtxItemsForRow(tr,target){
  const cell=target?.closest?.('td,th');
  const items=[];
  if(cell) items.push({label:'نسخ الخلية',icon:'ti-copy',action:()=>copyText(cell.innerText)});
  items.push({label:'نسخ السطر',icon:'ti-copy',action:()=>copyText([...tr.children].map(td=>td.innerText.trim()).join(' | '))});
  const sel=String(window.getSelection?.()||'').trim();
  if(sel) items.push({label:'نسخ النص المحدد',icon:'ti-copy',action:()=>copyText(sel)});
  return items;
}
function showCtxMenu(x,y,items){
  const head=items.find(i=>i.head); const acts=items.filter(i=>!i.head);
  ctxMenu.innerHTML=(head?`<div class="ctx-head">${esc(head.head)}</div>`:'')+acts.map((it,i)=>it.sep?'<div class="ctx-sep"></div>':`<button type="button" class="ctx-item" data-i="${i}"><i class="ti ${it.icon||'ti-point'}"></i><span>${esc(it.label)}</span></button>`).join('');
  [...ctxMenu.querySelectorAll('.ctx-item')].forEach(btn=>{const it=acts[Number(btn.dataset.i)]; btn.addEventListener('click',()=>{hideCtxMenu(); try{Promise.resolve(it.action()).catch(err=>{console.error(err);toast('تعذر تنفيذ الإجراء');});}catch(err){console.error(err);toast('تعذر تنفيذ الإجراء');}});});
  ctxMenu.style.display='block'; ctxMenu.style.left='-9999px'; ctxMenu.style.top='0';
  const w=ctxMenu.offsetWidth, h=ctxMenu.offsetHeight;
  ctxMenu.style.left=Math.max(8,Math.min(x,window.innerWidth-w-8))+'px';
  ctxMenu.style.top=Math.max(8,Math.min(y,window.innerHeight-h-8))+'px';
}
document.addEventListener('click',hideCtxMenu);
document.addEventListener('scroll',hideCtxMenu,true);
window.addEventListener('resize',hideCtxMenu);
document.addEventListener('keydown',e=>{if(e.key==='Escape')hideCtxMenu();});

const CTX_BUILDERS={
  productsBody(tr){const code=tr.children[1]?.innerText.trim(); if(!code) return []; selectProductRow(code); const p=products.find(x=>String(x.code)===String(code));
    return [{head:p?`${code} — ${p.name||''}`:code},
      {label:'مشاهدة المنتج',icon:'ti-eye',action:()=>viewSelectedProduct()},
      {label:'تعديل المنتج',icon:'ti-edit',action:()=>editSelectedProduct()},
      {label:'نسخ المنتج',icon:'ti-copy',action:()=>duplicateProduct(code)},
      {label:'حركات المنتج',icon:'ti-history',action:()=>openSelectedProductMovements()},
      {sep:true},
      {label:'تحويل إلى منتج مركّب',icon:'ti-package',action:()=>{convertToComposite(code)}},
      {label:'إضافة إلى فاتورة بيع',icon:'ti-shopping-cart-plus',action:()=>{if(!p)return; openTab('sales'); addOrIncrementSaleProduct(p,1); toast('تمت إضافة المنتج إلى فاتورة البيع');}}];
  },
  salePickerBody(tr){const code=(tr.children[0]?.querySelector('b')?.textContent||tr.children[0]?.innerText||'').split(/\s+/)[0].trim(); if(!code) return []; const p=products.find(x=>String(x.code||'').toLowerCase()===String(code).toLowerCase());
    return [{head:p?`${code} — ${p.name||''}`:code},
      {label:'مشاهدة تفاصيل المنتج',icon:'ti-eye',action:()=>viewProductFromCode(code)},
      {label:'حركات المنتج / التاريخ',icon:'ti-history',action:()=>{setTimeout(()=>openProductMovements(code),50)}},
      {label:'المخزون الحالي',icon:'ti-stack-2',action:()=>showProductStockSummary(code,'all')},
      {label:'الكمية في كل فرع',icon:'ti-building-store',action:()=>showProductStockSummary(code,'branches')},
      {label:'الكمية في كل مخزن',icon:'ti-building-warehouse',action:()=>showProductStockSummary(code,'warehouses')},
      {sep:true},
      {label:'سعر الشراء: '+money(productCost(code))+' '+APP_CONFIG.currency,icon:'ti-cash',action:()=>showProductStockSummary(code,'all')},
      {label:'سعر البيع: '+money(p?.retail_price||0)+' '+APP_CONFIG.currency,icon:'ti-tag',action:()=>showProductStockSummary(code,'all')}];
  },
  salesBody(tr){const id=ctxArg(tr,'selectSaleRow'); if(!id) return []; selectSaleRow(id);
    return [{head:'فاتورة بيع'},
      {label:'فتح / تعديل',icon:'ti-edit',action:()=>openSaleForEdit(id)},
      {label:'طباعة الفاتورة',icon:'ti-printer',action:()=>printSale(id)},
      {label:'مرتجع',icon:'ti-arrow-back-up',action:()=>openSaleReturn(id)},
      {sep:true},
      {label:'تحويل إلى مبدئية',icon:'ti-file-description',action:()=>convertSaleToProforma(id)}];
  },
  suppliersBody(tr){const id=ctxArg(tr.querySelector('button[onclick^="openLedger"]'),'openLedger'); if(!id) return [];
    return [{head:'المورد'},
      {label:'كشف الحساب',icon:'ti-file-analytics',action:()=>openLedger(id)},
      {label:'تسجيل دفعة للمورد',icon:'ti-cash',action:()=>{openTab('payments'); if(q('paymentSupplier'))q('paymentSupplier').value=id;}}];
  },
  customersBody(tr){const id=ctxArg(tr.querySelector('button[onclick^="openCustomerLedger"]'),'openCustomerLedger'); if(!id) return [];
    const c=customers.find(x=>x.id===id);
    const items=[{head:'الزبون'},
      {label:'كشف الحساب',icon:'ti-file-analytics',action:()=>openCustomerLedger(id)},
      {label:'تعديل البيانات',icon:'ti-edit',action:()=>editCustomer(id)},
      {label:'تسجيل دفعة من الزبون',icon:'ti-cash',action:()=>{openTab('customers'); if(q('customerPaymentCustomer'))q('customerPaymentCustomer').value=id;}}];
    if(c){
      if(c.active===false) items.push({label:'تفعيل الزبون',icon:'ti-check',action:()=>toggleCustomerActive(id,true)});
      else if(currentRole?.role==='admin') items.push({label:'حذف (مدير)',icon:'ti-trash',action:()=>deleteCustomer(id)});
    }
    return items;
  },
  purchasesBody(tr){const id=ctxArg(tr.querySelector('button[onclick^="openPurchaseForEdit"]'),'openPurchaseForEdit'); if(!id) return [];
    return [{head:'فاتورة شراء'},{label:'فتح / تعديل',icon:'ti-edit',action:()=>openPurchaseForEdit(id)}];
  },
  transfersBody(tr){const id=ctxArg(tr.querySelector('button[onclick^="openTransferForEdit"]'),'openTransferForEdit'); if(!id) return [];
    return [{head:'تحويل مخزون'},{label:'فتح / تعديل',icon:'ti-edit',action:()=>openTransferForEdit(id)}];
  },
  proformasBody(tr){const id=ctxArg(tr.querySelector('button[onclick^="openProformaForEdit"]'),'openProformaForEdit'); if(!id) return [];
    return [{head:'فاتورة مبدئية'},
      {label:'فتح / تعديل',icon:'ti-edit',action:()=>openProformaForEdit(id)},
      {label:'تحويل إلى بيع',icon:'ti-shopping-cart',action:()=>convertProformaToSale(id)}];
  },

  saleItemsBody(tr){const code=tr.querySelector('.si-code')?.value?.split('|')[0]?.trim(); if(!code) return []; lastFocusedSaleRow=tr; const p=products.find(x=>String(x.code)===String(code));
    return [{head:p?`${code} — ${p.name||''}`:code},
      {label:'مشاهدة المنتج',icon:'ti-eye',action:()=>{selectedProductCode=code;viewSelectedProduct()}},
      {label:'حركات المنتج',icon:'ti-history',action:()=>openProductMovements(code)},
      {label:'تعديل السعر',icon:'ti-edit',action:()=>editSelectedSaleLinePrice()},
      {label:'زيادة الكمية +1',icon:'ti-plus',action:()=>{const qn=tr.querySelector('.si-qty'); qn.value=Number(qn.value||0)+1; updateSaleTotal(); updateSaleAvailable(qn);}},
      {label:'تغيير إلى مرتجع (مدير)',icon:'ti-arrow-back-up',action:async()=>{const ok=await requestSupervisorApproval('تحويل سطر بيع إلى مرتجع','يفضل استعمال مرتجع من الفاتورة الأصلية'); if(!ok)return; const sel=tr.querySelector('.si-kind'); if(sel && ![...sel.options].some(o=>o.value==='return')) sel.insertAdjacentHTML('beforeend','<option value="return">مرتجع</option>'); if(sel){sel.value='return'; updateSaleLineKind(sel); updateSaleTotal(); toast('تم تحويل السطر إلى مرتجع','success');}}},
      {label:'تغيير إلى بيع',icon:'ti-shopping-cart',action:()=>{const sel=tr.querySelector('.si-kind'); if(sel){sel.value='sale'; updateSaleLineKind(sel); updateSaleTotal();}}},
      {sep:true},{label:'حذف من الفاتورة',icon:'ti-trash',action:()=>{tr.remove(); updateSaleTotal();}}];
  },
  proformaItemsBody(tr){const code=tr.querySelector('.pr-code')?.value?.split('|')[0]?.trim(); if(!code) return []; const p=products.find(x=>String(x.code)===String(code));
    return [{head:p?`${code} — ${p.name||''}`:code},
      {label:'مشاهدة المنتج',icon:'ti-eye',action:()=>{selectedProductCode=code;viewSelectedProduct()}},
      {label:'حركات المنتج',icon:'ti-history',action:()=>openProductMovements(code)},
      {label:'تعديل السعر',icon:'ti-edit',action:()=>{const inp=tr.querySelector('.pr-price'); const v=prompt('اكتب السعر الجديد',inp.value||0); if(v!=null){inp.value=moneyVal(v); updateProformaTotal();}}},
      {label:'زيادة الكمية +1',icon:'ti-plus',action:()=>{const qn=tr.querySelector('.pr-qty'); qn.value=Number(qn.value||0)+1; updateProformaTotal();}},
      {sep:true},{label:'حذف من المبدئية',icon:'ti-trash',action:()=>{tr.remove(); updateProformaTotal();}}];
  },
  purchaseItemsBody(tr){const code=tr.querySelector('.pi-code')?.value?.split('|')[0]?.trim(); if(!code) return []; const p=products.find(x=>String(x.code)===String(code));
    return [{head:p?`${code} — ${p.name||''}`:code},
      {label:'مشاهدة المنتج',icon:'ti-eye',action:()=>{selectedProductCode=code;viewSelectedProduct()}},
      {label:'حركات المنتج',icon:'ti-history',action:()=>openProductMovements(code)},
      {label:'تعديل سعر الشراء',icon:'ti-edit',action:()=>{const inp=tr.querySelector('.pi-cost'); const v=prompt('اكتب سعر الشراء الجديد',inp.value||0); if(v!=null){inp.value=moneyVal(v); updatePurchaseTotal();}}},
      {label:'زيادة الكمية +1',icon:'ti-plus',action:()=>{const qn=tr.querySelector('.pi-qty'); qn.value=Number(qn.value||0)+1; updatePurchaseTotal();}},
      {sep:true},{label:'حذف من الفاتورة',icon:'ti-trash',action:()=>{tr.remove(); updatePurchaseTotal();}}];
  },

  movementsBody(tr){const table=tr.dataset.refTable, id=tr.dataset.refId; if(!table||!id) return [];
    return [{head:'حركة صنف'},
      {label:'فتح المستند المرتبط',icon:'ti-file-invoice',action:()=>openMovementDocument(table,id)},
      {label:'نسخ رقم الفاتورة',icon:'ti-copy',action:()=>{navigator.clipboard?.writeText(tr.children[2]?.innerText.trim()||'');toast('تم نسخ رقم الفاتورة','success')}}];
  },
  stockBody(tr){const code=tr.children[1]?.innerText.trim(); if(!code) return [];
    return [{head:code},{label:'حركات الصنف',icon:'ti-history',action:()=>openProductMovements(code)}];
  }
};
document.addEventListener('contextmenu',e=>{
  const tr=e.target.closest('tbody tr'); if(!tr) return;
  if(tr.querySelector('td[colspan]')) return;
  const tbody=tr.closest('tbody'); const builder=tbody&&CTX_BUILDERS[tbody.id];
  const copyItems=defaultCtxItemsForRow(tr,e.target);
  let items=[];
  if(builder){try{items=builder(tr)||[]}catch(err){console.warn(err);}}
  const hasActions=items&&items.length;
  const finalItems=hasActions?[...items,{sep:true},...copyItems]:copyItems;
  if(!finalItems.length) return;
  e.preventDefault(); showCtxMenu(e.clientX,e.clientY,finalItems);
});




function initNavGroups(){
  const saved=JSON.parse(localStorage.getItem('posCollapsedNavGroups')||'{}');
  document.querySelectorAll('nav .nav-group').forEach((g,idx)=>{
    const key=g.textContent.trim()||('group'+idx);
    g.title='إظهار / إخفاء الأقسام الفرعية';
    g.classList.toggle('collapsed',!!saved[key]);
    if(g.dataset.init==='1') return;
    g.dataset.init='1';
    g.addEventListener('click',()=>{
      const st=JSON.parse(localStorage.getItem('posCollapsedNavGroups')||'{}');
      st[key]=!g.classList.contains('collapsed');
      g.classList.toggle('collapsed',st[key]);
      localStorage.setItem('posCollapsedNavGroups',JSON.stringify(st));
    });
  });
}


/* ===== Long list picker: replaces native huge dropdowns ===== */
let longPickerState={target:null,type:'select',items:[],filtered:[],index:0,title:''};
const LONG_PICKER_IDS=new Set(['saleCustomer','purchaseSupplier','paymentSupplier','ledgerSupplier','productSupplier','proformaCustomer','customerPaymentCustomer','customerLedgerCustomer']);
const LONG_INPUT_IDS=new Set(['productBrand','productModel','productColor']);
function optionText(o){return (o?.textContent||'').trim()}
function longPickerItemsFor(el){
  if(!el) return [];
  const id=el.id;
  const customerIds=new Set(['saleCustomer','proformaCustomer','customerPaymentCustomer','customerLedgerCustomer']);
  const supplierIds=new Set(['purchaseSupplier','paymentSupplier','ledgerSupplier','productSupplier']);
  if(customerIds.has(id)){
    return (customers||[]).map(c=>({
      value:c.id,
      text:[c.customer_no,c.name].filter(Boolean).join(' - ') || c.id,
      sub:[c.phone?('هاتف: '+c.phone):'', Number(c.balance||0)?('الرصيد: '+money(c.balance)+' '+APP_CONFIG.currency):''].filter(Boolean).join(' | '),
      search:[c.customer_no,c.name,c.phone,c.balance].join(' ')
    }));
  }
  if(supplierIds.has(id)){
    return (suppliers||[]).map(x=>({
      value:x.id,
      text:[x.supplier_no,x.name].filter(Boolean).join(' - ') || x.id,
      sub:[x.phone?('هاتف: '+x.phone):'', Number(x.balance||0)?('الرصيد: '+money(x.balance)+' '+APP_CONFIG.currency):''].filter(Boolean).join(' | '),
      search:[x.supplier_no,x.name,x.phone,x.balance].join(' ')
    }));
  }
  if(el.tagName==='SELECT') return [...el.options].filter(o=>o.value!=='' || optionText(o)).map(o=>({value:o.value,text:optionText(o)||o.value,sub:'',search:optionText(o)+' '+o.value}));
  let arr=[];
  if(id==='productBrand') arr=[...new Set([...(products||[]).map(p=>p.brand).filter(Boolean),...(APP_CONFIG.customBrands||[])])];
  else if(id==='productModel') arr=[...new Set([...(products||[]).map(p=>p.model).filter(Boolean),...(APP_CONFIG.customModels||[])])];
  else if(id==='productColor') arr=[...new Set([...(products||[]).map(p=>p.color).filter(Boolean),...(APP_CONFIG.customColors||[])])];
  return arr.sort((a,b)=>String(a).localeCompare(String(b),'ar')).map(v=>({value:v,text:v,sub:'',search:v}));
}
function longPickerTitleFor(id){
  return {saleCustomer:'اختيار زبون',purchaseSupplier:'اختيار مورد لفاتورة الشراء',paymentSupplier:'اختيار مورد للدفع',ledgerSupplier:'اختيار مورد لكشف الحساب',productSupplier:'اختيار مورد للمنتج',proformaCustomer:'اختيار زبون للفاتورة المبدئية',customerPaymentCustomer:'اختيار زبون للدفع',customerLedgerCustomer:'اختيار زبون لكشف الحساب',productBrand:'اختيار الشركة / الماركة',productModel:'اختيار الموديل',productColor:'اختيار اللون'}[id]||'اختيار من القائمة';
}
function openLongPicker(targetId){
  const el=q(targetId); if(!el) return;
  const items=longPickerItemsFor(el);
  if(items.length<8 && el.tagName==='SELECT') return; // keep small lists native if any
  longPickerState={target:el,type:el.tagName==='SELECT'?'select':'input',items,filtered:items,index:0,title:longPickerTitleFor(targetId)};
  q('longPickerTitle').textContent=longPickerState.title;
  q('longPickerSearch').value='';
  q('longPickerModal').classList.add('show');
  renderLongPicker();
  setTimeout(()=>q('longPickerSearch')?.focus(),40);
}
function closeLongPicker(){q('longPickerModal')?.classList.remove('show')}
function renderLongPicker(){
  const term=normText(q('longPickerSearch')?.value||'');
  const rows=longPickerState.items.filter(it=>!term||normText(it.search||it.text).includes(term)||normText(it.value).includes(term));
  longPickerState.filtered=rows.slice(0,300);
  if(longPickerState.index>=longPickerState.filtered.length) longPickerState.index=Math.max(0,longPickerState.filtered.length-1);
  q('longPickerBody').innerHTML=longPickerState.filtered.map((it,i)=>`<tr class="${i===longPickerState.index?'active-row':''}" ondblclick="chooseLongPicker(${i})" onclick="longPickerState.index=${i};renderLongPicker()"><td><b>${esc(it.text)}</b>${it.sub?`<div class="mini">${esc(it.sub)}</div>`:''}</td><td><button class="btn secondary" type="button" onclick="event.stopPropagation();chooseLongPicker(${i})">اختيار</button></td></tr>`).join('')||'<tr><td colspan="2">لا توجد نتائج</td></tr>';
  q('longPickerInfo').textContent=`عرض ${longPickerState.filtered.length} من ${longPickerState.items.length}`;
}
function chooseLongPicker(i){
  const it=longPickerState.filtered[i]; const el=longPickerState.target; if(!it||!el)return;
  el.value=it.value;
  el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));
  if(el.tagName!=='SELECT') el.dispatchEvent(new Event('change',{bubbles:true}));
  closeLongPicker();
}
function handleLongPickerKey(e){
  const n=longPickerState.filtered.length;
  if(e.key==='ArrowDown'){e.preventDefault();longPickerState.index=Math.min(n-1,longPickerState.index+1);renderLongPicker();}
  if(e.key==='ArrowUp'){e.preventDefault();longPickerState.index=Math.max(0,longPickerState.index-1);renderLongPicker();}
  if(e.key==='Enter'){e.preventDefault();chooseLongPicker(longPickerState.index);}
  if(e.key==='Escape'){e.preventDefault();closeLongPicker();}
}
function setupLongPickers(){
  document.addEventListener('mousedown',e=>{const el=e.target.closest('select,input'); if(!el)return; if(LONG_PICKER_IDS.has(el.id)||LONG_INPUT_IDS.has(el.id)){e.preventDefault(); openLongPicker(el.id);}},true);
  document.addEventListener('keydown',e=>{const el=e.target; if(!el)return; if((LONG_PICKER_IDS.has(el.id)||LONG_INPUT_IDS.has(el.id))&&(e.key==='Enter'||e.key===' '||e.key==='ArrowDown')){e.preventDefault();openLongPicker(el.id);}},true);
}

function toggleNav(){
  document.body.classList.toggle('nav-collapsed');
  try{localStorage.setItem('posNavCollapsed',document.body.classList.contains('nav-collapsed')?'1':'0')}catch(e){}
}

/* ===== Status bar + Hijri/Gregorian dates ===== */
function hijriDate(d){try{return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura',{day:'numeric',month:'long',year:'numeric'}).format(d)+' هـ';}catch(e){return '';}}
function gregDate(d){try{return new Intl.DateTimeFormat('ar-LY',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(d);}catch(e){return d.toISOString().slice(0,10);}}
function renderStatusBar(){
  const d=new Date();
  if(q('sbCompany')) q('sbCompany').textContent=APP_CONFIG.businessName;
  if(q('sbUser')) q('sbUser').textContent=appUser?.id ? `${appUser.identifier}${currentRole?.role?(' · '+(ROLE_LABELS[currentRole.role]||'')):''}` : 'غير مسجّل';
  if(q('sbDate')) q('sbDate').innerHTML=`<span class="sb-date-greg">${esc(gregDate(d))} — </span>${esc(hijriDate(d))}`;
  const locName=locations.find(l=>l.id===(q('saleLocation')?.value||''))?.name;
  if(q('sbBranch')) q('sbBranch').textContent=locName||appUser?.branch_name||'الفرع الرئيسي';
  if(q('saleFooterBranch')) q('saleFooterBranch').textContent='الفرع: '+(locName||appUser?.branch_name||'');
}
setInterval(renderStatusBar,60000);

let auditLog=[];
async function refreshAuditLog(){try{auditLog=await apiAll('pos_audit_log','?order=created_at.desc&limit=200');renderAuditLog();}catch(e){console.warn('audit load failed',e);}}
function renderAuditLog(){
  const body=q('auditLogBody'); if(!body)return;
  const term=(q('auditLogSearch')?.value||'').trim().toLowerCase();
  const rows=(auditLog||[]).filter(a=>!term||[a.user_identifier,a.action,a.details,a.entity_type].join(' ').toLowerCase().includes(term));
  body.innerHTML=rows.map(a=>`<tr><td class="ltr">${esc((a.created_at||'').replace('T',' ').slice(0,19))}</td><td><b>${esc(a.user_identifier||'')}</b></td><td>${esc(a.action||'')}</td><td class="mini">${esc(a.details||'')}</td></tr>`).join('')||'<tr><td colspan="4">لا توجد سجلات.</td></tr>';
}
async function logAction(action,entityType='',entityId='',details=''){try{await api('pos_audit_log',{method:'POST',body:{user_identifier:appUser?.identifier||'',action,entity_type:entityType,entity_id:String(entityId||''),details,branch_id:appUser?.branch_id||null}});}catch(e){console.warn('audit log failed',e)}}
let stockCountData={};
function renderStockCount(){
  const locEl=q('stockCountLocation'); if(!locEl)return;
  if(!locEl.dataset.ready){locEl.innerHTML=locations.map(l=>`<option value="${l.id}">${esc(l.name)}</option>`).join(''); if(appUser?.branch_id) locEl.value=appUser.branch_id; locEl.dataset.ready='1';}
  const loc=locEl.value; if(!loc){q('stockCountBody').innerHTML='<tr><td colspan="5">اختر الفرع.</td></tr>';return;}
  const catEl=q('stockCountCategory');
  if(catEl && !catEl.dataset.ready){const cats=[...new Set(products.map(p=>p.category).filter(Boolean))].sort();catEl.innerHTML='<option value="">كل التصنيفات</option>'+cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');catEl.dataset.ready='1';}
  const term=(q('stockCountSearch')?.value||'').trim().toLowerCase();
  const cat=catEl?.value||'';
  const items=stock.filter(s=>s.location_id===loc).filter(s=>{
    if(term&&!(s.product_code||'').toLowerCase().includes(term)&&!(s.product_name||'').toLowerCase().includes(term))return false;
    if(cat){const p=products.find(x=>x.code===s.product_code);return p&&p.category===cat;}
    return true;
  });
  q('stockCountBody').innerHTML=items.map(s=>{const sc=String(s.product_code||'').replace(/'/g,'');const counted=stockCountData[sc];const diff=(counted!==undefined&&counted!=='')?(Number(counted)-Number(s.qty||0)):null;return `<tr><td class="ltr"><b>${esc(s.product_code)}</b></td><td>${esc(s.product_name)}</td><td>${money(s.qty)}</td><td><input type="number" step="any" value="${counted??''}" placeholder="${money(s.qty)}" style="max-width:100px;text-align:center" oninput="stockCountData['${sc}']=this.value;renderStockCountDiff(this,'${sc}',${Number(s.qty||0)})"></td><td id="scd_${sc}" class="${diff!==null&&diff>0?'stock-positive':diff<0?'stock-negative':''}">${diff!==null?money(diff):''}</td></tr>`}).join('')||'<tr><td colspan="5">لا توجد أصناف.</td></tr>';
}
function renderStockCountDiff(inp,code,sysQty){const el=q('scd_'+code);if(!el)return;if(inp.value===''){el.textContent='';el.className='';return;}const d=Number(inp.value)-Number(sysQty);el.textContent=money(d);el.className=d>0?'stock-positive':d<0?'stock-negative':'';}
async function saveStockCount(){
  const loc=q('stockCountLocation')?.value;if(!loc){toast('اختر الفرع','warn');return;}
  const items=stock.filter(s=>s.location_id===loc);const adj=[];
  items.forEach(s=>{const c=stockCountData[s.product_code];if(c!==undefined&&c!==''){const d=Number(c)-Number(s.qty||0);if(Math.abs(d)>0.001)adj.push({code:s.product_code,name:s.product_name,d:d});}});
  if(!adj.length){toast('لا توجد فروقات لتسويتها','warn');return;}
  if(!confirm(`تسوية ${adj.length} صنف؟`))return;
  if(window.__busy)return;window.__busy=true;
  try{showLoading(true);for(const a of adj){await adjustStockDoc(loc,{product_code:a.code,product_name:a.name},a.d,'adjustment',null,null,`جرد فعلي - ${appUser?.identifier||''}`);}
    await logAction('stock_count',null,null,`جرد ${adj.length} صنف في ${locations.find(l=>l.id===loc)?.name||''}`);
    stockCountData={};await loadAll();renderStockCount();toast(`تم تسوية ${adj.length} صنف`,'success');
  }catch(e){console.error(e);toast('تعذّر حفظ الجرد: '+friendlyError(e),'error')}finally{showLoading(false);window.__busy=false}
}
function getSaleWholesale(){return !!(q('saleWholesaleToggle')?.checked);}

let editingProductComponents=[];
function renderProductComponents(){
  const body=q('productComponentsBody'); if(!body)return;
  if(!editingProductComponents.length){body.innerHTML='<p class="mini">لا توجد مكوّنات — منتج عادي. أضف مكوّنات ليصبح مركّباً.</p>';return;}
  const total=editingProductComponents.reduce((a,c)=>{const p=products.find(x=>x.code===c.code);return a+(Number(p?.purchase_price||0)*c.qty);},0);
  body.innerHTML=`<table style="font-size:13px"><thead><tr><th>الكود</th><th>الاسم</th><th>الكمية</th><th>تكلفة الوحدة</th><th>الإجمالي</th><th></th></tr></thead><tbody>${editingProductComponents.map((c,i)=>{const p=products.find(x=>x.code===c.code);const cost=Number(p?.purchase_price||0);return `<tr><td class="ltr"><b>${esc(c.code)}</b></td><td>${esc(c.name)}</td><td style="text-align:center">${c.qty}</td><td>${money(cost)}</td><td>${money(cost*c.qty)}</td><td><button class="btn danger" type="button" onclick="removeProductComponent(${i})">حذف</button></td></tr>`}).join('')}<tr style="background:var(--table-head)"><td colspan="4"><b>التكلفة الإجمالية للمركّب</b></td><td><b>${money(total)}</b></td><td></td></tr></tbody></table>`;
}
function addProductComponent(){
  const input=(q('componentCodeInput')?.value||'').trim();
  const qty=Number(q('componentQtyInput')?.value||1)||1;
  if(!input){toast('اكتب كود أو اسم المكوّن','warn');return;}
  const lower=input.toLowerCase();
  const norm=normText(input);
  const p=products.find(x=>String(x.code).toLowerCase()===lower)
       || products.find(x=>String(x.name).toLowerCase()===lower)
       || products.find(x=>normText(x.name)===norm)
       || products.find(x=>normText(x.name).includes(norm)&&norm.length>=2)
       || products.find(x=>String(x.code).toLowerCase().startsWith(lower)&&lower.length>=2);
  if(!p){toast(`لم يتم العثور على منتج يطابق "${input}". جرّب كتابة الكود أو أول حروف من الاسم.`,'warn');return;}
  if(editingProductComponents.some(c=>c.code===p.code)){toast('المكوّن مضاف مسبقاً','warn');return;}
  editingProductComponents.push({code:p.code,name:p.name,qty});
  q('componentCodeInput').value=''; q('componentQtyInput').value=1;
  renderProductComponents();
  toast(`تمت إضافة: ${p.name} (${p.code})`,'success');
}
function removeProductComponent(i){editingProductComponents.splice(i,1);renderProductComponents();}
async function saveProductComponents(productCode){
  try{
    await api('pos_composite_items',{method:'DELETE',qs:`?composite_code=eq.${encodeURIComponent(productCode)}`});
    if(editingProductComponents.length){
      await api('pos_composite_items',{method:'POST',body:editingProductComponents.map(c=>({composite_code:productCode,component_code:c.code,component_name:c.name,qty:c.qty}))});
    }
  }catch(e){console.warn('composite save failed',e);}
}
function isCompositeProduct(code){return compositeItems.some(ci=>ci.composite_code===code);}
function getCompositeVirtualStock(code){
  const comps=compositeItems.filter(ci=>ci.composite_code===code);
  if(!comps.length) return null;
  let minStock=Infinity;
  for(const ci of comps){
    const stockQty=stock.filter(s=>s.product_code===ci.component_code).reduce((a,s)=>a+Number(s.qty||0),0);
    const possible=Math.floor(stockQty/Number(ci.qty||1));
    if(possible<minStock)minStock=possible;
  }
  return minStock===Infinity?0:minStock;
}

function convertToComposite(code){
  const p=products.find(x=>String(x.code)===String(code)); if(!p){toast('لم يتم العثور على المنتج','warn');return;}
  editProduct(code);
  const sec=q('productComponentsSection'); if(sec)sec.classList.remove('hidden');
  toast('أضف مكوّنات هذا المنتج ثم احفظ ليصبح مركّباً','info');
  q('componentCodeInput')?.focus();
}
function renderComposites(){
  const body=q('compositesBody'); if(!body)return;
  const codes=[...new Set(compositeItems.map(ci=>ci.composite_code))];
  body.innerHTML=codes.map(code=>{
    const p=products.find(x=>x.code===code); if(!p)return '';
    const comps=compositeItems.filter(ci=>ci.composite_code===code);
    const cost=comps.reduce((a,ci)=>{const cp=products.find(x=>x.code===ci.component_code);return a+(Number(cp?.purchase_price||0)*Number(ci.qty||1));},0);
    const vStock=getCompositeVirtualStock(code);
    const safe=String(code||'').replace(/'/g,"\\'");
    return `<tr><td class="ltr"><b>${esc(code)}</b></td><td>${esc(p.name)}</td><td><b>${money(p.retail_price)}</b></td><td>${money(cost)}</td><td><b style="color:#7c3aed;background:#ede9fe;border-radius:6px;padding:2px 8px">${vStock!==null?vStock:0}</b></td><td class="mini">${comps.map(ci=>`${esc(ci.component_name||ci.component_code)}×${Number(ci.qty||1)}`).join('، ')}</td><td><button class="btn secondary" type="button" onclick="editProduct('${safe}')">تعديل المكوّنات</button></td></tr>`;
  }).join('')||'<tr><td colspan="7">لا توجد منتجات مركبة. اضغط بزر الفأرة الأيمن على منتج واختر «تحويل إلى منتج مركّب».</td></tr>';
}

function setToday(){const d=new Date().toISOString().slice(0,10); q('paymentDate').value=d; q('purchaseDate').value=d; q('transferDate').value=d; q('saleDate').value=d; if(q('proformaDate')) q('proformaDate').value=d; q('customerPaymentDate').value=d; if(q('dailyCashDateFrom')) q('dailyCashDateFrom').value=d; if(q('dailyCashDateTo')) q('dailyCashDateTo').value=d; if(q('expenseLocation')&&appUser?.branch_id&&!q('expenseLocation').value) q('expenseLocation').value=appUser.branch_id; ['financeTransferDate','expenseDate','salaryPaymentDate'].forEach(id=>{if(q(id))q(id).value=d}); if(q('reportTo')) q('reportTo').value=d; if(q('reportFrom') && !q('reportFrom').value){const first=new Date(); first.setDate(1); q('reportFrom').value=first.toISOString().slice(0,10)}}
initBranding(); fillSettingsForm(); initConnectivity(); initNavGroups(); setupDecimalInputs(); setupSaleTabFlow(); setupLongPickers(); setTimeout(toggleFinancePaymentMethods,0); setToday(); q('saleLocation')?.addEventListener('change',function(){ if(this.value) localStorage.setItem('posLastSaleLocation',this.value); }); try{if(localStorage.getItem('posNavCollapsed')==='1') document.body.classList.add('nav-collapsed');}catch(e){} renderStatusBar(); renderGDriveStatus(); addTransferRow(); if(q('proformaItemsBody')) addProformaRow(); ensureSaleInvoiceNo(true); updateAuthUI(); loadLoginBranches(); setTimeout(tryRestoreActiveSaleDraft,600); if(appUser?.id && authSession?.access_token){loadAll().then(async()=>{await ensureRoleAfterLogin(); updateAuthUI(); applyPermissions(); renderCustomers();}).catch(e=>{console.error(e); logoutPOS(); toast('انتهت الجلسة، سجل الدخول مرة أخرى','warn')});}else{q('loginIdentifier')?.focus();}
