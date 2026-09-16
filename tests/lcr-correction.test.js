/* ═══════════════════════════════════════════════════════════════════
   اختبارات 0056 — إعادة اشتقاق «محمول» من المخزون الفعلي
   • الخانة «محمولة» بلا مخزون (خطأ حدد-الكل) ⇒ تصبح غير محمولة
   • الخانة «غير محمولة» وبها مخزون موجب ⇒ تصبح محمولة
   • الخانات المطابقة لا تُمسّ (يبقى إمشانها الأصلي — السراج/جنزور)
   • إعادة التشغيل لا تغيّر شيئاً (idempotent)
   ═══════════════════════════════════════════════════════════════════ */
const test=require('node:test'), assert=require('node:assert');
const fs=require('fs'), path=require('path');
const HERE=path.join(__dirname,'..');
const DIR=path.join(HERE,'supabase/migrations');
const M56=fs.readFileSync(path.join(DIR,'0056_lcr_rederive_carried.sql'),'utf8');

let PGlite,pgcrypto;
try{
  PGlite=require('@electric-sql/pglite').PGlite;
  pgcrypto=require('@electric-sql/pglite/contrib/pgcrypto').pgcrypto;
}catch(e){ console.error('⚠ شغّل npm install'); process.exit(1); }

async function buildDB(){
  const db=new PGlite({extensions:{pgcrypto}});
  await db.exec(fs.readFileSync(path.join(HERE,'supabase/local-shim.sql'),'utf8'));
  for(const f of fs.readdirSync(DIR).filter(f=>f.endsWith('.sql')).sort())
    await db.exec(fs.readFileSync(path.join(DIR,f),'utf8'));
  return db;
}
async function run56(db){ /* كتلة DO وحدها (بلا تعليقات التحقق) */
  await db.exec(M56.slice(0,M56.indexOf('do $$'))+M56.slice(M56.indexOf('do $$'),M56.indexOf('-- ═══════════════════════════════════════════════════════════════════\n-- التحقق بعد التطبيق')));
}
const one=async(db,sql)=>(await db.query(sql)).rows[0];
const rows=async(db,sql)=>(await db.query(sql)).rows;

test('(0056-١) حدد-الكل الخاطئ يُلغى، والناقص يُستكمل، والمطابق لا يُمسّ', async ()=>{
  const db=await buildDB();
  const L11=(await db.query(`select id from public.pos_locations where name='فرع 11 يونيو'`)).rows[0].id;
  const LS=(await db.query(`select id from public.pos_locations where name='فرع السراج'`)).rows[0].id;
  await db.exec(`
    insert into public.pos_products(code,name,category,retail_price,purchase_price,active) values
      ('X1','صنف 1','قسم أ',10,5,true),
      ('X2','صنف 2','قسم ب',20,10,true),
      ('X3','صنف 3','قسم ج',30,15,true);
    insert into public.pos_stock(location_id,product_code,product_name,qty) values
      ('${L11}','X1','صنف 1',5),
      ('${L11}','X2','صنف 2',0),
      ('${L11}','X3','صنف 3',3),
      ('${LS}','X1','صنف 1',7),
      ('${LS}','X3','صنف 3',0);
    /* قواعد تحاكي الواقعة: حدد-الكل خاطئ في L11 (أ،ب محمولتان وبلا مخزون لب)
       وناقص في L11 (ج بها مخزون لكن غير محمولة) — وLS مطابقة تماماً */
    insert into public.pos_location_category_rules(location_id,category,carried,updated_by) values
      ('${L11}','قسم أ',true,'migration-0050'),
      ('${L11}','قسم ب',true,'1993'),
      ('${L11}','قسم ج',false,'migration-0050'),
      ('${LS}','قسم أ',true,'migration-0050'),
      ('${LS}','قسم ب',false,'migration-0050');
  `);
  await run56(db);
  const after=await rows(db,`select location_id,category,carried,updated_by from public.pos_location_category_rules order by category,location_id`);
  const get=(loc,cat)=>after.find(r=>r.category===cat&&(loc==='L11'?r.location_id===L11:r.location_id===LS));
  assert.equal(get('L11','قسم أ').carried,true,'بها مخزون ⇒ تبقى محمولة');
  assert.equal(get('L11','قسم ب').carried,false,'حدد-الكل بلا مخزون ⇒ أُلغيت');
  assert.equal(get('L11','قسم ج').carried,true,'بها مخزون ⇒ استُكملت');
  assert.equal(get('LS','قسم أ').carried,true,'السراج: مطابقة');
  assert.equal(get('LS','قسم ب').carried,false,'السراج: مطابقة');
  /* المطابق لا يُمسّ: إمشاء 1993 (الصف المتغيّر) صُحّح، والمطابق بقي كما هو */
  assert.equal(get('L11','قسم ب').updated_by,'correction-0056','الخاطئ صُحّح بإمضاء التصحيح');
  assert.equal(get('LS','قسم أ').updated_by,'migration-0050','المطابق لم يُمسّ — إمشاء الهجرة باقٍ');
  assert.equal(get('L11','قسم أ').updated_by,'migration-0050','المطابق لم يُمسّ');
  assert.equal(get('L11','قسم ج').updated_by,'correction-0056','الناقص استُكمل بإمضاء التصحيح');
  /* إعادة التشغيل: لا تغيير */
  await run56(db);
  const cnt=(await one(db,`select count(*)::int n from public.pos_location_category_rules where updated_by='correction-0056'`)).n;
  assert.equal(cnt,2,'التشغيل الثاني لم يضف شيئاً (idempotent)');
  await db.close();
});

test('(0056-٢) الملف: بيان واحد + إمشاء التصحيح + في updated-html-files', ()=>{
  assert.ok(M56.startsWith('-- ═══')||M56.startsWith('--'),'يبدأ بتعليق توثيقي');
  const doCount=(M56.match(/^do \$\$/gm)||[]).length;
  assert.equal(doCount,1,'كتلة DO واحدة فقط');
  assert.ok(M56.includes('updated_by = ' + String.fromCharCode(39) + 'correction-0056' + String.fromCharCode(39)),'EMPAA');
  assert.ok(M56.includes('where t.carried <> exists'),'الصفوف المتغيّرة فقط');
  assert.ok(fs.existsSync(path.join(HERE,'new discussion github','updated-html-files','benamor-sales-system','supabase-pos-lcr-rederive-carried.sql')),'المرآة في updated-html-files');
});
