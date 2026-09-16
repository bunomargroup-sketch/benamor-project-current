/* ═══════════════════════════════════════════════════════════════════
   اختبارات المهمة ١ — أقسام كل موقع (0050 + الشاشة)
   ═══════════════════════════════════════════════════════════════════ */
const test=require('node:test'), assert=require('node:assert');
const fs=require('fs'), vm=require('vm'), path=require('path');
const HERE=path.join(__dirname,'..');

/* ═══ الجزء الخادمي: الـmigration على بيانات تحاكي توقيع الإنتاج ═══ */
let PGlite,pgcrypto;
try{
  PGlite=require('@electric-sql/pglite').PGlite;
  pgcrypto=require('@electric-sql/pglite/contrib/pgcrypto').pgcrypto;
}catch(e){ console.error('⚠ شغّل npm install'); process.exit(1); }
let db;
const L11={valueOf:()=>globalThis.__L11}, LSR={valueOf:()=>globalThis.__LSR}, LJZ={valueOf:()=>globalThis.__LJZ}; /* تُحلّ في before بعد استعلام السلسلة */
async function q1(sql,p){ return (await db.query(sql,p||[])).rows[0]; }

test.before(async ()=>{
  db=new PGlite({extensions:{pgcrypto}});
  await db.exec(fs.readFileSync(path.join(HERE,'supabase/local-shim.sql'),'utf8'));
  for(const f of fs.readdirSync(path.join(HERE,'supabase/migrations')).filter(f=>f.endsWith('.sql')&&f<'0050').sort())
    await db.exec(fs.readFileSync(path.join(HERE,'supabase/migrations',f),'utf8'));
  /* السلسلة تزرع المواقع الثلاثة أصلاً (0001) — نستعلم معرفاتها */
  const locs=(await db.query(`select id,name from public.pos_locations`)).rows;
  const byName=new Map(locs.map(l=>[l.name,l.id]));
  globalThis.__L11=byName.get('فرع 11 يونيو'); globalThis.__LSR=byName.get('فرع السراج'); globalThis.__LJZ=byName.get('مخزن جنزور');
  await db.exec(`
    insert into public.pos_user_roles(identifier,role,active) values ('admin','admin',true),('cash1','seller_11',true)
    on conflict do nothing;
    insert into auth.users(id,email) values ('aaaa2222-0000-0000-0000-000000000001','admin@bag.com')
    on conflict do nothing;
    create or replace function auth.jwt() returns jsonb language sql stable as $$ select null::jsonb $$;
  `);
  /* 157 تصنيفاً: cat-001..cat-157
     السراج يحمل 154 (كلها إلا 3) · 11 يونيو 75 · جنزور 22 */
  await db.exec(`
    insert into public.pos_products(code,name,category,retail_price,purchase_price,active)
    select 'P-'||g, 'منتج '||g, 'cat-'||lpad(g::text,3,'0'), 10, 5, true
    from generate_series(1,157) g;
    -- السراج: تصنيفات 1..154 بكمية > 0
    insert into public.pos_stock(location_id,product_code,product_name,qty)
    select '${globalThis.__LSR}', 'P-'||g, 'منتج '||g, 3 from generate_series(1,154) g;
    -- 11 يونيو: تصنيفات 1..75
    insert into public.pos_stock(location_id,product_code,product_name,qty)
    select '${globalThis.__L11}', 'P-'||g, 'منتج '||g, 2 from generate_series(1,75) g;
    -- جنزور: تصنيفات 1..22
    insert into public.pos_stock(location_id,product_code,product_name,qty)
    select '${globalThis.__LJZ}', 'P-'||g, 'منتج '||g, 8 from generate_series(1,22) g;
    -- كمية صفرية لا تُحسب حملًا: تصنيف 155 في 11 يونيو بكمية 0
    insert into public.pos_stock(location_id,product_code,product_name,qty) values ('${globalThis.__L11}','P-155','منتج 155',0);
  `);
  await db.exec(fs.readFileSync(path.join(HERE,'supabase/migrations/0050_location_category_rules.sql'),'utf8'));
});

test('(١) 471 صفاً كاملاً (157×3) — carried: السراج 154 · 11 يونيو 75 · جنزور 22', async ()=>{
  const total=await q1('select count(*)::int n from public.pos_location_category_rules');
  assert.equal(total.n,471,'471 صفاً');
  const per=await db.query(`
    select location_id, count(*) filter (where carried)::int as carried_true
    from public.pos_location_category_rules group by location_id`);
  const m=new Map(per.rows.map(r=>[r.location_id,Number(r.carried_true)]));
  assert.equal(m.get(globalThis.__LSR),154,'السراج 154');
  assert.equal(m.get(globalThis.__L11),75,'11 يونيو 75');
  assert.equal(m.get(globalThis.__LJZ),22,'جنزور 22');
  /* الكمية الصفرية لا تُحسب حَمْلاً: cat-155 في 11 يونيو carried=false */
  const z=await q1(`select carried from public.pos_location_category_rules where location_id='${globalThis.__L11}' and category='cat-155'`);
  assert.equal(z.carried,false,'كمية 0 ⇒ carried=false');
  /* min_qty فارغ افتراضياً */
  const mn=await q1('select count(*)::int n from public.pos_location_category_rules where min_qty is not null');
  assert.equal(mn.n,0,'min_qty=null ⇒ الحدّ العام');
});

test('(١-صلاحيات) البائع يقرأ ولا يكتب · المدير يكتب · anon مرفوض', async ()=>{
  await db.exec(`create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{"email":"cash1@bag.com"}'::jsonb $$;`);
  await db.exec(`set role 'authenticated'`); /* المستخدم الفائق يتجاوز RLS — نفحصها بدور حقيقي */
  /* UPDATE تحت RLS لا يرمي خطأً بل يُخفي الصفوف: البائع لا يرى صفّاً ليعدّله */
  const upd=await db.query(`update public.pos_location_category_rules set carried=false where location_id='${globalThis.__L11}' and category='cat-001'`);
  assert.equal(Number(upd.rowCount||upd.affectedRows||0),0,'UPDATE للبائع: صفر صفوف متأثرة (مخفية بـ RLS)');
  /* INSERT هو ما يُرفض صراحةً (WITH CHECK) */
  let denied=false;
  try{ await db.query(`insert into public.pos_location_category_rules(location_id,category,carried) values ('${globalThis.__L11}','cat-new-x',true)`); }
  catch(e){ denied=/new row violates row-level|policy|permission denied/i.test(String(e.message)); }
  assert.ok(denied,'INSERT للبائع مرفوض صراحةً');
  const read=await q1('select count(*)::int n from public.pos_location_category_rules');
  assert.equal(read.n,471,'البائع يقرأ الكل');
  await db.exec(`reset role`);
  await db.exec(`create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{"email":"admin@bag.com"}'::jsonb $$;`);
  await db.exec(`set role 'authenticated'`);
  await db.query(`update public.pos_location_category_rules set carried=false, min_qty=5 where location_id='${globalThis.__L11}' and category='cat-002'`);
  await db.exec(`reset role`);
  const after=await q1(`select carried,min_qty from public.pos_location_category_rules where location_id='${globalThis.__L11}' and category='cat-002'`);
  assert.equal(after.carried,false,'المدير كتب carried=false');
  assert.equal(Number(after.min_qty),5,'المدير كتب min_qty=5');
});

test('(١-سلاسل) قاعدة نظيفة: الجدول يُنشأ والتعبئة صفرية بلا فشل', async ()=>{
  const db2=new PGlite({extensions:{pgcrypto}});
  await db2.exec(fs.readFileSync(path.join(HERE,'supabase/local-shim.sql'),'utf8'));
  for(const f of fs.readdirSync(path.join(HERE,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())
    await db2.exec(fs.readFileSync(path.join(HERE,'supabase/migrations',f),'utf8'));
  const r=await (await db2.query('select count(*)::int n from public.pos_location_category_rules')).rows[0];
  assert.equal(r.n,0,'لا منتجات ⇒ صفر صفوف (والبوابة ستفترض الحمل حتى يعبّئ المدير)');
});

/* ═══ الجزء الواجهي: الشاشة ═══ */
function el(){const cache={};const e={style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},addEventListener(){},removeEventListener(){},appendChild(c){return c},remove(){},querySelector(s){return cache[s]||(cache[s]=el())},querySelectorAll(){return[]},setAttribute(){},removeAttribute(){},focus(){},blur(){},click(){},reset(){},value:'',textContent:'',innerHTML:'',id:'',name:'',children:[],options:[],selectedOptions:[{textContent:'',value:''}],checked:false,disabled:false,placeholder:'',closest(){return el()},contains(){return false},insertAdjacentHTML(){},scrollIntoView(){},getAttribute(){return null}};return e;}
let calls=[], MODE={rules:[]};
const smartFetch=async(url,opts={})=>{
  const u=String(url); calls.push({u,method:opts.method||'GET',headers:opts.headers,body:opts.body});
  const J=(o,s=200)=>({ok:s<400,status:s,text:async()=>JSON.stringify(o),json:async()=>o,clone(){return this}});
  if(u.includes('pos_location_category_rules')&&opts.method==='POST') return J([]);
  if(u.includes('pos_location_category_rules')) return J(MODE.rules);
  if(u.includes('pos_audit_log')) return J([]);
  return J([]);
};
function makeCtx(){
  const els={};
  const ctx={console,setTimeout:f=>{try{f()}catch(e){};return{unref(){}}},clearTimeout,setInterval:()=>({unref(){}}),clearInterval,Promise,JSON,Math,Date,Object,Array,Map,Set,Number,String,Error,TypeError,RegExp,
    document:{querySelector:sel=>{ const m=String(sel).match(/input\[data-lcrmin="([^"|]+)\|([^"]+)"\]/); if(m){ /* خانة حد لزوج محدد */ const key='lcrmin:'+m[1]+'|'+m[2]; els[key]=els[key]||Object.assign(el(),{value:''}); return els[key]; } return els[sel]||(els[el_id(sel)]=el()); },querySelectorAll:sel=>{ if(sel==='input[data-lcr]') return MODE.cbs||[]; return []; },getElementById:id=>(els[id]||(els[id]=el())),createElement:()=>el(),body:el(),documentElement:el(),addEventListener(){},title:''},
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},fetch:smartFetch,
    navigator:{onLine:true,serviceWorker:{register:async()=>({})}},
    alert(){},prompt(){return null},confirm(){return false},
    atob:s=>Buffer.from(s,'base64').toString('binary'),btoa:s=>Buffer.from(s,'binary').toString('base64'),
    URL:{createObjectURL:()=>'x',revokeObjectURL(){}},Blob:function(){},FileReader:function(){},FormData:function(){this.append=function(){}},
    Event:function(){},CustomEvent:function(){},history:{},location:{href:'x',reload(){},origin:'x'},requestAnimationFrame:f=>f(),
    performance:{now:()=>Date.now()},crypto:{randomUUID:()=>'u'},google:{accounts:{oauth2:{init(){}}}},open:()=>null,structuredClone:o=>JSON.parse(JSON.stringify(o))};
  function el_id(sel){ return 'qs:'+sel; }
  ctx.window=ctx;ctx.self=ctx;ctx.globalThis=ctx;ctx.addEventListener=()=>{};ctx.removeEventListener=()=>{};ctx.dispatchEvent=()=>true;
  ctx.__els=els;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(HERE,'new discussion github/apps/pos/benamor-sales-system/app.js'),'utf8'),ctx,{filename:'app.js'});
  return ctx;
}
function seed(ctx){
  vm.runInContext(`
    locations=[{id:'L11',name:'فرع 11 يونيو',is_sales_location:true},{id:'LSR',name:'فرع السراج',is_sales_location:true},{id:'LJZ',name:'مخزن جنزور'}];
    products=[{code:'P1',name:'مطرقة',category:'أدوات',retail_price:10},{code:'P2',name:'خلاط',category:'خلاطات',retail_price:50}];
    currentRole={role:'admin'}; appUser={id:'u1',identifier:'admin',branch_id:'L11'}; authSession={access_token:'t',refresh_token:'r',expires_at:9999999999};
    locationCategoryRules=[
      {location_id:'L11',category:'أدوات',carried:false,min_qty:null},
      {location_id:'LSR',category:'أدوات',carried:true,min_qty:5},
      {location_id:'LJZ',category:'أدوات',carried:true,min_qty:null},
      {location_id:'L11',category:'خلاطات',carried:true,min_qty:null},
      {location_id:'LSR',category:'خلاطات',carried:true,min_qty:null},
      {location_id:'LJZ',category:'خلاطات',carried:false,min_qty:null}];
    locationCategoryRulesLoaded=true;
  `,ctx);
}

test('(و١) الجدول: 157 صفّاً مواقعها أعمدة — مربع + حد لكل خانة والتنبيه ظاهر', ()=>{
  const ctx=makeCtx(); seed(ctx);
  ['lcrHead','lcrBody','lcrSearch','lcrInfo','lcrAdminNote','lcrSaveBtn'].forEach(id=>ctx.document.getElementById(id));
  vm.runInContext(`renderLocationCategoryRules();`,ctx);
  const head=ctx.__els['lcrHead'].innerHTML;
  const body=ctx.__els['lcrBody'].innerHTML;
  assert.ok(head.includes('فرع 11 يونيو')&&head.includes('فرع السراج')&&head.includes('مخزن جنزور'),'أعمدة المواقع');
  assert.ok(head.includes('حدد الكل')&&head.includes('ألغِ الكل'),'أزرار العمود');
  assert.ok(body.includes('أدوات')&&body.includes('خلاطات'),'صفوف التصنيفات');
  assert.ok((body.match(/data-lcr=/g)||[]).length===6,'٦ خانات (2 تصنيفين × 3 مواقع)');
  assert.ok((body.match(/data-lcrmin=/g)||[]).length===6,'٦ حقول حد');
  /* قيمة من القاعدة: أدوات/السراج min_qty=5 · أدوات/11 يونيو unchecked */
  assert.ok(body.includes('data-lcr="LSR|أدوات" checked')||body.includes('data-lcr=\\"LSR|أدوات\\" checked'),'حمل السراج لأدوات');
});

test('(و١) البحث يصفّي · حدد/ألغِ الكل لعمود · غير المدير معطَّل', ()=>{
  const ctx=makeCtx(); seed(ctx);
  ['lcrHead','lcrBody','lcrSearch','lcrInfo','lcrAdminNote','lcrSaveBtn'].forEach(id=>ctx.document.getElementById(id));
  ctx.__els['lcrSearch'].value='خلاط';
  vm.runInContext(`renderLocationCategoryRules();`,ctx);
  const body=ctx.__els['lcrBody'].innerHTML;
  assert.ok(body.includes('خلاطات')&&!body.includes('>أدوات<'),'التصفية بالاسم');
  /* عمود: حدد الكل */
  const cbs=[];
  ['L11|خلاطات','LSR|خلاطات','LJZ|خلاطات'].forEach(k=>cbs.push(Object.assign(el(),{dataset:{lcr:k},checked:false})));
  MODE.cbs=cbs;
  vm.runInContext(`lcrToggleColumn('L11',true);`,ctx);
  assert.equal(cbs.find(c=>c.dataset.lcr.startsWith('L11')).checked,true,'خانة 11 يونيو عُلّمت');
  assert.equal(cbs.find(c=>c.dataset.lcr.startsWith('LSR')).checked,false,'خانات أخرى لم تُمسّ');
  /* غير المدير: معطَّل وزر الحفظ مخفي */
  vm.runInContext(`currentRole={role:'seller_11'}; renderLocationCategoryRules();`,ctx);
  assert.ok(ctx.__els['lcrBody'].innerHTML.includes('disabled'),'خانات معطّلة لغير المدير');
  assert.equal(ctx.__els['lcrSaveBtn'].style.display,'none','زر الحفظ مخفي');
});

test('(و١) الحفظ: نداء شبكة واحد (upsert) بكل الخانات — لا نداء لكل خلية', async ()=>{
  const ctx=makeCtx(); seed(ctx);
  ['lcrHead','lcrBody','lcrSearch','lcrInfo','lcrAdminNote','lcrSaveBtn'].forEach(id=>ctx.document.getElementById(id));
  vm.runInContext(`renderLocationCategoryRules();`,ctx);
  calls=[];
  MODE.cbs=[Object.assign(el(),{dataset:{lcr:'L11|أدوات'},checked:true}),
            Object.assign(el(),{dataset:{lcr:'LSR|أدوات'},checked:true}),
            Object.assign(el(),{dataset:{lcr:'LJZ|أدوات'},checked:true})];
  ctx.document.querySelector('input[data-lcrmin="L11|أدوات"]').value='3';
  ctx.document.querySelector('input[data-lcrmin="LSR|أدوات"]').value='';
  ctx.document.querySelector('input[data-lcrmin="LJZ|أدوات"]').value='';
  await vm.runInContext(`saveLocationCategoryRules();`,ctx);
  const posts=calls.filter(c=>c.method==='POST'&&c.u.includes('pos_location_category_rules'));
  assert.equal(posts.length,1,'نداء POST واحد فقط');
  assert.ok(String(posts[0].headers&&posts[0].headers.Prefer||'').includes('merge-duplicates'),'upsert على المفتاح المركّب');
  const payload=JSON.parse(posts[0].body);
  assert.equal(payload.length,3,'٣ خانات في النداء الواحد');
  const l11=payload.find(r=>r.location_id==='L11'&&r.category==='أدوات');
  assert.equal(l11.min_qty,3,'حد 11 يونيو = 3');
  assert.equal(l11.carried,true);
  assert.equal(l11.updated_by,'admin');
  const lsr=payload.find(r=>r.location_id==='LSR'&&r.category==='أدوات');
  assert.equal(lsr.min_qty,null,'حد فارغ ⇒ null ⇒ الحدّ العام');
});

test('(و١-٣) تصنيف جديد بلا صفوف ⇒ «غير محمول» في كل المواقع + شريط يعدّه', ()=>{
  const ctx=makeCtx(); seed(ctx);
  ['lcrHead','lcrBody','lcrSearch','lcrInfo','lcrAdminNote','lcrSaveBtn'].forEach(id=>ctx.document.getElementById(id));
  /* تصنيف جديد في المنتجات بلا أي صف قواعد */
  vm.runInContext(`products.push({code:'PX',name:'منتج جديد',category:'قسم جديد خاص بالسراج',retail_price:7});`,ctx);
  vm.runInContext(`renderLocationCategoryRules();`,ctx);
  const body=ctx.__els['lcrBody'].innerHTML;
  /* خاناته الثلاث غير محمولة */
  const m=body.match(/data-lcr="L[^"]*\|قسم جديد خاص بالسراج" checked/g)||[];
  assert.equal(m.length,0,'لا خانة محمولة للتصنيف الجديد');
  const mAll=(body.match(/data-lcr="L[^"]*\|قسم جديد خاص بالسراج"/g)||[]).length;
  assert.equal(mAll,3,'ثلاث خانات (لكل موقع) — كلها غير محمولة');
  /* الشريط */
  const note=ctx.__els['lcrAdminNote'].innerHTML;
  assert.ok(note.includes('🆕 1 تصنيفاً جديداً'),'الشريط يعدّه: '+note.slice(0,80));
  assert.ok(note.includes('قسم جديد خاص بالسراج'),'اسمه في الشريط');
  /* حدد الكل يفعّلها ثم الحفظ ينشئ صفوفها */
  const cbs=[['L11'],['LSR'],['LJZ']].map(([l])=>Object.assign(el(),{dataset:{lcr:l+'|قسم جديد خاص بالسراج'},checked:false}));
  MODE.cbs=cbs;
  vm.runInContext(`lcrToggleColumn('LSR',true);`,ctx);
  assert.equal(cbs[1].checked,true,'حدد الكل عملت للتصنيف الجديد');
});

test('(و١-٤) الحفظ يُبطل الكاش: جلبٌ جديد من الخادم بعد الـupsert مباشرة', async ()=>{
  const ctx=makeCtx(); seed(ctx);
  ['lcrHead','lcrBody','lcrSearch','lcrInfo','lcrAdminNote','lcrSaveBtn'].forEach(id=>ctx.document.getElementById(id));
  vm.runInContext(`renderLocationCategoryRules();`,ctx);
  calls=[];
  MODE.cbs=[Object.assign(el(),{dataset:{lcr:'L11|أدوات'},checked:false})];
  ctx.document.querySelector('input[data-lcrmin="L11|أدوات"]').value='';
  await vm.runInContext(`saveLocationCategoryRules();`,ctx);
  const seq=calls.map(c=>({m:c.method,u:c.u.includes('pos_location_category_rules')?'RULES':(c.u.includes('audit')?'AUDIT':'OTHER')}));
  const postIdx=seq.findIndex(x=>x.m==='POST'&&x.u==='RULES');
  const getIdx=seq.findIndex(x=>x.m==='GET'&&x.u==='RULES');
  assert.ok(postIdx>-1,'حُفظ الـupsert');
  assert.ok(getIdx>-1&&getIdx>postIdx,'⭐ جلب جديد من الخادم بعد الحفظ (الكاش أُبطل — force=true)');
});

test('(و١) الإعدادات: الحد الافتراضي يُحفظ ويُستعمل (الافتراضي 1)', ()=>{
  const ctx=makeCtx();
  assert.equal(vm.runInContext(`APP_CONFIG.transferMinQtyDefault`,ctx),1,'الافتراضي 1');
  ctx.__els['settingsTransferMinQty'].value='4';
  vm.runInContext(`Object.assign(APP_CONFIG,{transferMinQtyDefault:Math.max(0,Number(q('settingsTransferMinQty')?.value||1))});`,ctx);
  assert.equal(vm.runInContext(`APP_CONFIG.transferMinQtyDefault`,ctx),4,'يُقرأ من النموذج');
});
