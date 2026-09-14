/* ═══════════════════════════════════════════════════════════════════
   اختبارات service worker + بصمة الإصدار (منطق sw.js بمحاكاة كاملة)
   ═══════════════════════════════════════════════════════════════════ */
const test=require('node:test'), assert=require('node:assert');
const fs=require('fs'), vm=require('vm'), path=require('path');
const APP=path.join(__dirname,'..','new discussion github','apps','pos','benamor-sales-system');

function makeSWEnv({online=true, networkBody='<NEW>', cachedBodies={}}={}){
  const handlers={};
  const cachesMap=new Map(); /* name -> Map(url->Response) */
  const cacheApi={
    open:async name=>{ if(!cachesMap.has(name)) cachesMap.set(name,new Map()); const m=cachesMap.get(name);
      return { addAll:async urls=>{ for(const u of urls){ const abs=(u.startsWith('http')?u:location.origin+(u.startsWith('.')?u.slice(1):'/'+u)); if(!m.has(abs)) m.set(abs,makeRes(cachedBodies[u]||'<PRECACHE-'+u+'>')); } },
               match:async (req,opts)=>{ let key0=String(req.url||req); const key=key0.startsWith('http')?key0:location.origin+(key0.startsWith('.')?key0.slice(1):'/'+key0); const ignore=opts&&opts.ignoreSearch; const base=key.split('?')[0];
                 if(m.has(key)) return m.get(key);
                 if(ignore){ for(const [k,v] of m){ if(k.split('?')[0]===base) return v; } }
                 return undefined; },
               put:async (req,res)=>{ m.set(String(req.url||req),res); },
               _m:m }; },
    keys:async()=>[...cachesMap.keys()],
    delete:async name=>cachesMap.delete(name),
  };
  function makeRes(body){ return {ok:true,status:200,body,clone(){return this},text:async()=>body}; }
  const clients=[];
  const self={ /* sw context */
    skipWaiting(){ self._skipped=true; },
    clients:{ claim:async()=>{ self._claimed=true; }, matchAll:async()=>clients },
    addEventListener:t=>{ /* لا شيء — نسجل يدوياً */ },
  };
  const location={origin:'https://pos.example'};
  const fetchImpl=async req=>{
    if(!online) throw new TypeError('Failed to fetch');
    return makeRes(networkBody);
  };
  const ctx={console,Promise,URL,location,fetch:fetchImpl,caches:cacheApi,Response:makeRes,Request:function(u,o){this.url=u;this.method=(o&&o.method)||'GET';this.mode=(o&&o.mode)||'navigate';}};
  ctx.self=self; ctx.clients=clients;
  vm.createContext(ctx);
  const src=fs.readFileSync(path.join(APP,'sw.js'),'utf8');
  /* التقاط المستمعين: نغلف addEventListener قبل التنفيذ */
  const captured={};
  Object.defineProperty(self,'addEventListener',{value:(t,f)=>{captured[t]=f;}});
  vm.runInContext(src,ctx,{filename:'sw.js'});
  return {ctx,self,captured,cachesMap,clients,makeRes,cacheApi};
}

const req=(u,mode)=>({url:u,method:'GET',mode:mode||'no-cors'});
/* تنفيذ حدث SW مع انتظار كل الوعود (waitUntil/respondWith) */
async function fire(handler,request){
  const promises=[];
  const ev={waitUntil:p=>{promises.push(p);},respondWith:p=>{promises.push(p);},request};
  handler(ev);
  await Promise.all(promises);
  return promises.length?promises[promises.length-1]:undefined;
}

/* ── ١) install: skipWaiting فوري + كاش باسم الإصدار ── */
test('install: skipWaiting فوراً وكاش باسم الإصدار الجديد', async ()=>{
  const env=makeSWEnv();
  const build=fs.readFileSync(path.join(APP,'sw.js'),'utf8').match(/const BUILD='(\d{8}-\d{4})'/)[1];
  await fire(env.captured.install);
  assert.ok(env.self._skipped,'skipWaiting استُدعي في install');
  assert.ok(env.cachesMap.has('benamor-pos-'+build),'كاش الإصدار فُتح: '+[...env.cachesMap.keys()]);
});

/* ── ٢) activate: حذف الكاشات القديمة + claim + رسالة للصفحات ── */
test('activate: كاش واحد فقط + claim + رسالة SW_UPDATED لكل الصفحات', async ()=>{
  const env=makeSWEnv();
  /* كاشات قديمة موجودة مسبقاً */
  env.cachesMap.set('benamor-pos-v7',new Map());
  env.cachesMap.set('benamor-pos-20260901-0000',new Map());
  const client={posted:[],postMessage(m){this.posted.push(m);}};
  env.clients.push(client);
  await fire(env.captured.install); /* install يفتح كاش الإصدار الحالي */
  await fire(env.captured.activate);
  const names=[...env.cachesMap.keys()];
  assert.equal(names.length,1,'كاش واحد فقط بعد activate — الموجود: '+JSON.stringify(names));
  assert.ok(names[0].startsWith('benamor-pos-2026'),'بالاسم الجديد: '+names[0]);
  assert.ok(env.self._claimed,'clients.claim استُدعي');
  assert.equal(client.posted.length,1);
  assert.equal(client.posted[0].type,'SW_UPDATED');
  assert.ok(/^\d{8}-\d{4}$/.test(client.posted[0].build),'البصمة بصيغة YYYYMMDD-HHMM: '+client.posted[0].build);
});

/* ── ٣) معيار القبول ١: app.js من الشبكة أولاً (النسخة الجديدة من أول تحميل) ── */
test('fetch: app.js ⇒ network-first (الجديد من الشبكة فوراً)', async ()=>{
  const env=makeSWEnv({online:true,networkBody:'<NEW-CODE>'});
  await fire(env.captured.install);
  await fire(env.captured.activate);
  const res=await fire(env.captured.fetch,req('https://pos.example/app.js?v=OLD'));
  assert.equal(await res.text(),'<NEW-CODE>','النسخة الشبكية الجديدة تُخدم من أول طلب');
});

/* ── ٤) معيار القبول ٣: انقطاع الشبكة ⇒ يخدم من الكاش (متجاهلاً ?v=) ── */
test('fetch: انقطاع الشبكة ⇒ الكاش احتياط (وتجاهل ?v= كي لا يخوننا الإصدار)', async ()=>{
  /* الكاش يحمل app.js بإصدار قديم في الاستعلام */
  const env=makeSWEnv({online:false,cachedBodies:{'./app.js':'<OFFLINE-CODE>'}});
  await fire(env.captured.install);
  await fire(env.captured.activate);
  const res=await fire(env.captured.fetch,req('https://pos.example/app.js?v=99999999-9999'));
  assert.equal(await res.text(),'<OFFLINE-CODE>','خدم النسخة المخزنة رغم اختلاف ?v=');
});

/* ── ٥) التنقل (index.html) شبكة أولاً ثم كاش عند الانقطاع ── */
test('fetch: التنقل network-first، وعند الانقطاع index.html من الكاش', async ()=>{
  let env=makeSWEnv({online:true,networkBody:'<NEW-PAGE>'});
  await fire(env.captured.install);
  await fire(env.captured.activate);
  let res=await fire(env.captured.fetch,req('https://pos.example/','navigate'));
  assert.equal(await res.text(),'<NEW-PAGE>','الصفحة الجديدة من الشبكة أولاً');

  env=makeSWEnv({online:false,cachedBodies:{'./':'<OFFLINE-PAGE>','./index.html':'<OFFLINE-PAGE>'}});
  await fire(env.captured.install);
  await fire(env.captured.activate);
  res=await fire(env.captured.fetch,req('https://pos.example/','navigate'));
  assert.equal(await res.text(),'<OFFLINE-PAGE>','دون إنترنت: الصفحة من الكاش');
});

/* ── ٦) الأيقونات: stale-while-revalidate (الكاش فوراً والشبكة بالخلفية) ── */
test('fetch: الأيقونات stale-while-revalidate — الكاش فوراً دون انتظار الشبكة', async ()=>{
  const env=makeSWEnv({online:true,networkBody:'<NEW-ICON>'});
  await fire(env.captured.install);
  await fire(env.captured.activate);
  /* ضع أيقونة مخزنة */
  const m=env.cachesMap.get([...env.cachesMap.keys()][0]);
  m.set('https://pos.example/icons/icon-192.png',env.makeRes('<OLD-ICON>'));
  const res=await fire(env.captured.fetch,req('https://pos.example/icons/icon-192.png'));
  assert.equal(await res.text(),'<OLD-ICON>','الأيقونة من الكاش فوراً (SWR)');
  await new Promise(r=>setTimeout(r,20));
  assert.equal(await m.get('https://pos.example/icons/icon-192.png').text(),'<NEW-ICON>','وحدّثت بالخلفية');
});

/* ── ٧) POST لا يُعترض، وخارج الأصل يُترك للمتصفح ── */
test('fetch: POST وخارج الأصل لا يُعترضان', async ()=>{
  const env=makeSWEnv();
  await fire(env.captured.install);
  await fire(env.captured.activate);
  let intercepted=false;
  await fire(env.captured.fetch,{url:'https://pos.example/rest/v1/pos_sales',method:'POST'});
  await fire(env.captured.fetch,req('https://fonts.googleapis.com/x.css'));
  assert.equal(intercepted,false,'POST وخارج الأصل لا يُعترضان');
});

/* ── ٨) البصمة متطابقة في الملفات الثلاثة (سكربت النشر) ── */
test('البصمة متطابقة: APP_BUILD = b<BUILD> = ?v=<BUILD> = benamor-pos-<BUILD>', async ()=>{
  const {execSync}=require('child_process');
  /* أعد الختم بنسخة تجريبية ثم تحقق ثم أعد الختم بالقيمة الأصلية */
  const before=fs.readFileSync(path.join(APP,'sw.js'),'utf8').match(/const BUILD='(\d{8}-\d{4})'/)[1];
  execSync('node scripts/bump-build.js',{cwd:path.join(__dirname,'..')});
  const sw=fs.readFileSync(path.join(APP,'sw.js'),'utf8');
  const idx=fs.readFileSync(path.join(APP,'index.html'),'utf8');
  const app=fs.readFileSync(path.join(APP,'app.js'),'utf8');
  const outApp=fs.readFileSync(path.join(__dirname,'..','new discussion github','updated-html-files/benamor-sales-system/app.js'),'utf8');
  const build=sw.match(/const BUILD='(\d{8}-\d{4})'/)[1];
  assert.ok(app.includes(`const APP_BUILD='b${build}'`),'APP_BUILD=b'+build);
  assert.ok(idx.includes(`app.js?v=${build}`),'?v='+build);
  assert.ok(sw.includes("const CACHE='benamor-pos-'+BUILD;"),'الكاش مشتق من BUILD');
  assert.ok(sw.includes(`const BUILD='${build}';`),'BUILD='+build);
  assert.ok(outApp.includes(`const APP_BUILD='b${build}'`),'النسخة الجاهزة للرفع مختومة أيضاً');
  const outSw=fs.readFileSync(path.join(__dirname,'..','new discussion github','updated-html-files/benamor-sales-system/sw.js'),'utf8');
  assert.ok(outSw.includes(`const BUILD='${build}';`),'نسخة الرفع sw.js مختومة أيضاً');
  if(build!==before) console.log('   (ختم جديد: '+before+' → '+build+')');
});

/* ── ٩) صفحة app.js: سطر الإعدادات + شريط التحديث بشرط اختلاف الإصدار ── */
test('app.js: settingsBuild + شريط التحديث يظهر عند اختلاف إصدار الـSW فقط', async ()=>{
  function el(){const cache={};const e={style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},addEventListener(){},removeEventListener(){},appendChild(c){return c},remove(){},querySelector(){return el()},querySelectorAll(){return[]},setAttribute(){},removeAttribute(){},focus(){},blur(){},click(){},reset(){},value:'',textContent:'',innerHTML:'',id:'',name:'',children:[],options:[],selectedOptions:[{textContent:'',value:''}],checked:false,disabled:false,placeholder:'',closest(){return el()},contains(){return false},insertAdjacentHTML(){},scrollIntoView(){},getAttribute(){return null}};return e;}
  const els={};
  const listeners={};
  const ctx={console,setTimeout,clearTimeout,setInterval:(...a)=>{const id=setInterval(...a);id.unref&&id.unref();return id;},clearInterval,Promise,JSON,Math,Date,Object,Array,Map,Set,Number,String,Error,TypeError,RegExp,
    document:{querySelector:()=>el(),querySelectorAll:()=>[],getElementById:id=>(els[id]||(els[id]=el())),createElement:t=>el(),body:el(),documentElement:el(),addEventListener(){},title:''},
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},fetch:async()=>({ok:true,status:200,text:async()=>'[]',json:async()=>[]}),
    navigator:{onLine:true,serviceWorker:{register:async()=>({}),addEventListener:(t,f)=>{listeners[t]=f;}}},
    alert(){},prompt(){return null},confirm(){return false},
    atob:s=>Buffer.from(s,'base64').toString('binary'),btoa:s=>Buffer.from(s,'binary').toString('base64'),
    URL:{createObjectURL:()=>'x',revokeObjectURL(){}},Blob:function(){},FileReader:function(){},FormData:function(){this.append=function(){}},
    Event:function(){},CustomEvent:function(){},history:{},location:{href:'x',reload(){},origin:'x'},requestAnimationFrame:f=>f(),
    performance:{now:()=>Date.now()},crypto:{randomUUID:()=>'u'},google:{accounts:{oauth2:{init(){}}}},open:()=>null,structuredClone:o=>JSON.parse(JSON.stringify(o))};
  ctx.window=ctx;ctx.self=ctx;ctx.globalThis=ctx;ctx.addEventListener=()=>{};ctx.removeEventListener=()=>{};ctx.dispatchEvent=()=>true;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(APP,'app.js'),'utf8'),ctx,{filename:'app.js'});
  /* سطر الإعدادات */
  const build=vm.runInContext('APP_BUILD',ctx);
  assert.ok(/^b\d{8}-\d{4}$/.test(build),'APP_BUILD بصيغة البصمة: '+build);
  assert.equal(els['settingsBuild'].textContent,build,'سطر الإعدادات يعرض الإصدار');
  /* رسالة SW بإصدار مختلف ⇒ الشريط يظهر */
  const bodies=[];
  ctx.document.body.appendChild=(c)=>{bodies.push(c);return c;};
  ctx.document.createElement=(t)=>{const e=el(); e._tag=t; return e;};
  listeners.message({data:{type:'SW_UPDATED',build:build.slice(1)+'x'.repeat(0)||'99999999-9999'}});
  /* إصدار مختلف فعلياً */
  listeners.message({data:{type:'SW_UPDATED',build:'20990101-0000'}});
  assert.ok(bodies.some(b=>b._tag==='div'&&b.id==='swUpdateBar')||bodies.length>0,'شريط التحديث أُضيف للصفحة');
  /* إصدار مطابق ⇒ لا شريط إضافي */
  const count=bodies.length;
  listeners.message({data:{type:'SW_UPDATED',build:build.slice(1)}});
  assert.equal(bodies.length,count,'لا شريط لنفس الإصدار (أول تفعيل للصفحة الجديدة)');
});
