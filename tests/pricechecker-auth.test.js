/* ═══════════════════════════════════════════════════════════════════
   اختبارات المهمة (أ) — عارض الأسعار: قراءة الكتالوج تشترط الدخول
   • لا جلسة ⇒ شاشة الدخول وصفر نداءات بيانات
   • جلسة صالحة ⇒ كل نداء REST يحمل Authorization: Bearer <توكن>
     (pos_products · product_costs · pos_locations · pos_stock · carts)
     وترويسة Range في pos_stock باقية
   • 401 ⇒ تجديد التوكن وإعادة المحاولة مرة واحدة بالتوكن الجديد
   • انقطاع الشبكة ⇒ العرض من الكاش المحلي دون تحديثه
   • الدخول من شاشة القفل ⇒ يحمّل الكتالوج
   • بصمة الإصدار ظاهرة (PC_BUILD + ?v= + كاش sw)
   ═══════════════════════════════════════════════════════════════════ */
const test=require('node:test'), assert=require('node:assert');
const fs=require('fs'), vm=require('vm'), path=require('path');
const HERE=path.join(__dirname,'..');
const PC_HTML=path.join(HERE,'new discussion github/apps/pricechecker/index.html');
const PC_SW=path.join(HERE,'new discussion github/apps/pricechecker/sw.js');

const HTML=fs.readFileSync(PC_HTML,'utf8');
const OPEN=HTML.indexOf('<script>',HTML.indexOf('<div id="toast"'));
const SRC=HTML.slice(OPEN+8,HTML.lastIndexOf('</script>'));

/* ═══ بيئة VM ═══ */
function el(){const cache={};const e={style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},addEventListener(){},removeEventListener(){},appendChild(c){return c},remove(){},querySelector(s){return cache[s]||(cache[s]=el())},querySelectorAll(){return[]},setAttribute(){},removeAttribute(){},focus(){},blur(){},click(){},reset(){},value:'',textContent:'',innerHTML:'',id:'',name:'',children:[],options:[],selectedOptions:[{textContent:'',value:''}],checked:false,disabled:false,placeholder:'',closest(){return el()},contains(){return false},insertAdjacentHTML(){},scrollIntoView(){},getAttribute(){return null},srcdoc:'',onload:null,onclick:null};return e;}

async function boot(seed,mode){
  seed=seed||{}; mode=mode||{};
  const els={}, qsCache={};
  const bodyClasses=new Set(['auth-locked']);
  const store=new Map(Object.entries(seed).map(([k,v])=>[k,String(v)]));
  const written=[];
  const ls={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>{store.set(k,String(v));written.push(k);},removeItem:k=>{store.delete(k);}};
  let calls=[];
  const J=(o,s=200)=>({ok:s<400,status:s,text:async()=>JSON.stringify(o),json:async()=>o,clone(){return this}});
  const smartFetch=async(url,opts={})=>{
    const u=String(url), h=opts.headers||{};
    calls.push({u,method:opts.method||'GET',headers:h,body:opts.body});
    if(u.includes('/auth/v1/token?grant_type=refresh_token')) return mode.refresh?J(mode.refresh):J({message:'refresh off'},400);
    if(u.includes('/auth/v1/token?grant_type=password'))       return mode.password?J(mode.password):J({message:'bad creds'},400);
    if(mode.offline) throw new TypeError('Failed to fetch');
    if(u.includes('/rest/v1/pos_products')) return typeof mode.products==='function'?mode.products(h):J(mode.products||[]);
    if(u.includes('product_costs'))         return typeof mode.costs==='function'?mode.costs(h):J(mode.costs||[]);
    if(u.includes('/rest/v1/pos_locations'))return typeof mode.locations==='function'?mode.locations(h):J(mode.locations||[]);
    if(u.includes('/rest/v1/pos_stock'))    return typeof mode.stock==='function'?mode.stock(h):J(mode.stock||[]);
    if(u.includes('/rest/v1/carts'))        return J(mode.carts||[]);
    return J([]);
  };
  const document={
    getElementById:id=>els[id]||(els[id]=el()),
    querySelector:s=>qsCache[s]||(qsCache[s]=el()),
    querySelectorAll:()=>[],
    createElement:()=>el(),
    documentElement:el(),
    addEventListener(){},
    body:{classList:{add:c=>bodyClasses.add(c),remove:c=>bodyClasses.delete(c),toggle:(c,f)=>{if(f===undefined)f=!bodyClasses.has(c);f?bodyClasses.add(c):bodyClasses.delete(c);},contains:c=>bodyClasses.has(c)},style:{}},
  };
  const ctx={console:{log(){},warn(){},error(){}},setTimeout:f=>{try{f()}catch(e){}},clearTimeout(){},setInterval:()=>({unref(){}}),clearInterval(){},
    Promise,JSON,Math,Date,Object,Array,Map,Set,Number,String,Boolean,Error,TypeError,RegExp,Intl,
    document,localStorage:ls,fetch:smartFetch,
    navigator:{serviceWorker:{register:async()=>({})}},
    location:{href:'',origin:'x'},open:()=>null,
    atob:s=>Buffer.from(s,'base64').toString('binary'),btoa:s=>Buffer.from(s,'binary').toString('base64'),
    URL:{createObjectURL:()=>'x',revokeObjectURL(){}},Blob:function(){},FileReader:function(){},FormData:function(){this.append=function(){}},
    Event:function(){},CustomEvent:function(){},requestAnimationFrame:f=>f(),crypto:{randomUUID:()=>'u'}};
  ctx.window=ctx;ctx.self=ctx;ctx.globalThis=ctx;
  ctx.addEventListener=()=>{};ctx.removeEventListener=()=>{};ctx.dispatchEvent=()=>true;
  vm.createContext(ctx);
  vm.runInContext(SRC,ctx,{filename:'pricechecker-index.html'});
  const flush=async(n=40)=>{for(let i=0;i<n;i++)await new Promise(r=>setTimeout(r,0));};
  return {ctx,els,qsCache,bodyClasses,calls,written,store,flush,
    byUrl:k=>calls.filter(c=>c.u.includes(k))};
}
const nowSec=()=>Math.floor(Date.now()/1000);
const VALID_SESSION=JSON.stringify({access_token:'tok-1',refresh_token:'ref-1',expires_at:nowSec()+3600,user:{id:'u1'}});
const VALID_USER=JSON.stringify({id:'u1',identifier:'tester',branch_name:'فرع السراج'});

/* ═══ ١) لا جلسة ⇒ صفر نداءات + شاشة الدخول + البصمة ظاهرة ═══ */
test('(أ-١) بلا جلسة: لا أي نداء بيانات، شاشة الدخول، والبصمة معروضة', async ()=>{
  const t=await boot({pcProductsCache:JSON.stringify([{code:'X1',name:'منتج قديم',price:1}])});
  await t.flush();
  assert.equal(t.calls.length,0,'صفر نداءات fetch — لا كتالوج ولا auth');
  assert.ok(t.bodyClasses.has('auth-locked'),'شاشة الدخول ظاهرة (auth-locked)');
  assert.ok((t.els.loginBuild.textContent||'').includes('b2026'),'سطر الإصدار في بطاقة الدخول: '+t.els.loginBuild.textContent);
  assert.ok((t.els.buildChip.textContent||'').startsWith('b2026'),'رقاقة الإصدار في الشريط العلوي: '+t.els.buildChip.textContent);
});

/* ═══ ٢) جلسة صالحة ⇒ كل نداء REST موقّع + Range باقية + الكمية لكل فرع ═══ */
test('(أ-٢) جلسة صالحة: كل نداءات REST تحمل Bearer والتوقيع، والعرض فيه الكمية واسم الفرع', async ()=>{
  const t=await boot({
    bo_user:VALID_USER, bo_authSession:VALID_SESSION,
  },{
    products:[{code:'T1',name:'خلاط تيست',brand:'',model:'',retail_price:12.5}],
    costs:[{code:'T1',cost:8}],
    locations:[{id:'L1',name:'فرع السراج'},{id:'L2',name:'فرع 11 يونيو'}],
    stock:[{product_code:'T1',location_id:'L1',qty:3},{product_code:'T1',location_id:'L2',qty:2}],
  });
  await t.flush();
  const rest=t.calls.filter(c=>c.u.includes('/rest/v1/'));
  const urls=rest.map(c=>c.u);
  assert.ok(urls.some(u=>u.includes('pos_products')),'نداء pos_products');
  assert.ok(urls.some(u=>u.includes('product_costs')),'نداء product_costs');
  assert.ok(urls.some(u=>u.includes('pos_locations')),'نداء pos_locations');
  assert.ok(urls.some(u=>u.includes('pos_stock')),'نداء pos_stock');
  assert.ok(urls.some(u=>u.includes('/carts')),'نداء carts (السلات المحفوظة)');
  for(const c of rest){
    assert.equal(c.headers.Authorization,'Bearer tok-1','توكن الجلسة في '+c.u.slice(0,60));
    assert.ok(String(c.headers.apikey||'').startsWith('eyJ'),'مفتاح apikey موجود');
  }
  const stockCall=t.byUrl('pos_stock')[0];
  assert.equal(stockCall.headers.Range,'0-999','ترويسة Range في pos_stock باقية كما هي');
  assert.ok(!t.bodyClasses.has('auth-locked'),'التطبيق مفتوح');
  assert.equal(t.els.login.style.display,'none','شاشة الدخول مخفية');
  assert.equal(t.els.totalProducts.textContent,'1','عدّاد المنتجات = 1');
  const sel=t.els.selected.innerHTML;
  assert.ok(sel.includes('خلاط تيست'),'الاسم معروض');
  assert.ok(sel.includes('متوفر: 5'),'الكمية الإجمالية معروضة (3+2)');
  assert.ok(sel.includes('فرع السراج: 3')&&sel.includes('فرع 11 يونيو: 2'),'الكمية في كل فرع مع اسم الفرع');
});

/* ═══ ٣) 401 ⇒ تجديد ومحاولة واحدة بالتوكن الجديد ═══ */
test('(أ-٣) 401: تجديد التوكن ثم إعادة المحاولة مرة واحدة بالتوكن الجديد', async ()=>{
  const t=await boot({
    bo_user:VALID_USER,
    bo_authSession:JSON.stringify({access_token:'tok-old',refresh_token:'ref-1',expires_at:nowSec()+3600,user:{id:'u1'}}),
  },{
    products:h=>h.Authorization==='Bearer tok-old'
      ? J401()
      : JOK([{code:'T1',name:'خلاط بعد التجديد',retail_price:5}]),
    costs:[],locations:[{id:'L1',name:'فرع السراج'}],stock:[],
    refresh:{access_token:'tok-new',refresh_token:'ref-2',expires_at:nowSec()+3600},
  });
  await t.flush();
  const pp=t.byUrl('pos_products');
  assert.equal(pp.length,2,'محاولتان فقط (الأصلية + إعادة واحدة)');
  assert.equal(pp[0].headers.Authorization,'Bearer tok-old');
  assert.equal(pp[1].headers.Authorization,'Bearer tok-new','إعادة المحاولة بالتوكن المجدَّد');
  assert.equal(t.byUrl('grant_type=refresh_token').length,1,'نداء تجديد واحد');
  assert.ok(t.store.get('bo_authSession').includes('tok-new'),'الجلسة المجدَّدة محفوظة محلياً');
  assert.ok(t.els.selected.innerHTML.includes('خلاط بعد التجديد'),'الكتالوج حُمّل بعد التجديد');
});
function J401(){return {ok:false,status:401,text:async()=>JSON.stringify({message:'JWT expired'}),json:async()=>({message:'JWT expired'}),clone(){return this}};}
function JOK(o){return {ok:true,status:200,text:async()=>JSON.stringify(o),json:async()=>o,clone(){return this}};}

/* ═══ ٤) 401 مستمر ⇒ محاولة واحدة فقط ولا حلقة ═══ */
test('(أ-٤) 401 مستمر: محاولتان ونداء تجديد واحد ثم توقف — لا حلقة', async ()=>{
  const t=await boot({
    bo_user:VALID_USER,
    bo_authSession:JSON.stringify({access_token:'tok-dead',refresh_token:'ref-1',expires_at:nowSec()+3600,user:{id:'u1'}}),
  },{
    products:()=>J401(),
    costs:[],locations:[],stock:[],
    refresh:{access_token:'tok-dead2',refresh_token:'ref-2',expires_at:nowSec()+3600},
  });
  await t.flush();
  assert.equal(t.byUrl('pos_products').length,2,'محاولتان لا أكثر');
  assert.equal(t.byUrl('grant_type=refresh_token').length,1,'تجديد واحد');
});

/* ═══ ٥) انقطاع الشبكة ⇒ عرض من الكاش دون تحديثه ═══ */
test('(أ-٥) انقطاع الشبكة: العرض يستمر من الكاش والكاش لا يُحدَّث', async ()=>{
  const t=await boot({
    bo_user:VALID_USER, bo_authSession:VALID_SESSION,
    pcProductsCache:JSON.stringify([{code:'TC',name:'حوض كاش',price:7}]),
    pcStockCache2:JSON.stringify({saved_at:'2026-01-01T00:00:00Z',locs:[{id:'L1',name:'مخزن جنزور'}],m:[['TC',{t:5,locs:{L1:5}}]]}),
  },{offline:true});
  await t.flush();
  assert.ok(t.byUrl('pos_products').length===1,'حاول النداء وفشل (الشبكة مقطوعة)');
  assert.ok(!t.written.includes('pcProductsCache'),'الكاش لم يُحدَّث بعد فشل النداء');
  const sel=t.els.selected.innerHTML;
  assert.ok(sel.includes('حوض كاش'),'المنتج معروض من الكاش');
  assert.ok(sel.includes('متوفر: 5')&&sel.includes('مخزن جنزور'),'الكمية واسم الموقع معروضان من كاش المخزون');
  assert.equal(t.els.totalProducts.textContent,'1','العدّاد من الكاش');
});

/* ═══ ٦) الدخول من شاشة القفل ⇒ تحميل الكتالوج ═══ */
test('(أ-٦) الدخول بعد القفل: يحمّل الكتالوج وجميع النداءات بالتوكن الجديد', async ()=>{
  const t=await boot({},{
    password:{access_token:'tok-login',refresh_token:'rl-1',expires_at:nowSec()+3600,user:{id:'u9'}},
    products:[{code:'T1',name:'بعد الدخول',retail_price:3}],
    costs:[],locations:[{id:'L1',name:'فرع السراج'}],stock:[],
  });
  await t.flush();
  assert.equal(t.calls.length,0,'قبل الدخول: لا نداءات');
  const g=id=>t.ctx.document.getElementById(id);
  g('loginBranch').value='فرع السراج';
  g('loginIdentifier').value='tester';
  g('loginCode').value='1234';
  await t.els.loginBtn.onclick();
  await t.flush();
  const rest=t.calls.filter(c=>c.u.includes('/rest/v1/'));
  assert.ok(rest.length>=4,'نداءات الكتالوج بعد الدخول: '+rest.length);
  for(const c of rest) assert.equal(c.headers.Authorization,'Bearer tok-login','بعد الدخول كل نداء بتوكن الجلسة');
  assert.ok(!t.bodyClasses.has('auth-locked'),'التطبيق مفتوح بعد الدخول');
  assert.ok(t.store.get('bo_user').includes('tester'),'المستخدم محفوظ');
});

/* ═══ ٧) بصمة الإصدار في الملفات ═══ */
test('(أ-٧) بصمة الإصدار: PC_BUILD + ?v= + كاش sw — كلها بنفس البناء', async ()=>{
  const m=HTML.match(/const PC_BUILD='(b\d{8}-\d{4})';/);
  assert.ok(m,'ثابت PC_BUILD موجود');
  const build=m[1].slice(1);
  assert.ok(HTML.includes('manifest.webmanifest?v='+build),'?v= على manifest');
  assert.ok(HTML.includes('icons/icon-192.png?v='+build),'?v= على أيقونة apple-touch');
  const sw=fs.readFileSync(PC_SW,'utf8');
  assert.ok(sw.includes("CACHE='benamor-pricechecker-"+build+"'"),'كاش sw بنفس البناء');
  assert.ok(HTML.includes('id="loginBuild"')&&HTML.includes('id="buildChip"'),'موضعا العرض موجودان في الواجهة');
  /* لا نداءات REST خام متبقية في السكربت */
  const raw=(SRC.match(/await fetch\(SUPABASE_URL\+'\/rest\/v1\//g)||[]).length;
  assert.equal(raw,0,'لا نداء REST بلا تمرير عبر fetchWithAuthRetry');
});
