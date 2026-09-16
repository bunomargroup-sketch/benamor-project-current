/* ═══════════════════════════════════════════════════════════════════
   اختبار استعلام فحص التركيب — supabase/verify-0049-0052.sql (نسخة v2)
   • يعمل على قاعدة كاملة 0001..0052 مع بيانات مزروعة قبل 0050
     (كما في الإنتاج: تعبئة 0050 ترى منتجات ومخزوناً حقيقيين)
   • يثبت أن فحص anon يكشف فعلاً منحاً متسرّباً — وأن الاسم القديم
     (pos_transfer_dismissals، غير الموجود) كان يمرّ ✅ دون فحص أصلاً
   • يثبت أن فحص الدالة الجديد يكشف منح execute لـ anon
   ═══════════════════════════════════════════════════════════════════ */
const test=require('node:test'), assert=require('node:assert');
const fs=require('fs'), path=require('path');
const HERE=path.join(__dirname,'..');

let PGlite,pgcrypto;
try{
  PGlite=require('@electric-sql/pglite').PGlite;
  pgcrypto=require('@electric-sql/pglite/contrib/pgcrypto').pgcrypto;
}catch(e){ console.error('⚠ شغّل npm install'); process.exit(1); }
let db;
const SQL_FILE=path.join(HERE,'supabase/verify-0049-0052.sql');

test.before(async ()=>{
  db=new PGlite({extensions:{pgcrypto}});
  await db.exec(fs.readFileSync(path.join(HERE,'supabase/local-shim.sql'),'utf8'));
  const dir=path.join(HERE,'supabase/migrations');
  const files=fs.readdirSync(dir).filter(f=>f.endsWith('.sql')).sort();
  /* السلسلة حتى 0049، ثم البيانات، ثم 0050+ (كما تُطبَّق على الإنتاج) */
  for(const f of files){ if(f>='0050') break;
    await db.exec(fs.readFileSync(path.join(dir,f),'utf8')); }
  await db.exec(`
    insert into public.pos_suppliers(name) values ('مورد فحص أ'),('مورد فحص ب'),('مورد فحص ج');
    insert into public.pos_products(code,name,category,supplier_id) values
      ('T-VQ-A1','خلاط فحص ١','فحص خلاطات',(select id from public.pos_suppliers where name='مورد فحص أ')),
      ('T-VQ-A2','خلاط فحص ٢','فحص خلاطات',(select id from public.pos_suppliers where name='مورد فحص ب')),
      ('T-VQ-B1','حوض فحص ١','فحص أحواض',null),
      ('T-VQ-B2','حوض فحص ٢','فحص أحواض',(select id from public.pos_suppliers where name='مورد فحص ج')),
      ('T-VQ-B3','حوض فحص ٣','فحص أحواض',null);
    insert into public.pos_stock(location_id, product_code, qty)
    select l.id, v.code, v.qty
    from (values
      ('فرع السراج','T-VQ-A1',3),('فرع السراج','T-VQ-A2',4),('فرع السراج','T-VQ-B1',-1),
      ('فرع 11 يونيو','T-VQ-A1',5),('فرع 11 يونيو','T-VQ-A2',-2),
      ('مخزن جنزور','T-VQ-A1',10),('مخزن جنزور','T-VQ-B2',7)
    ) as v(loc,code,qty)
    join public.pos_locations l on l.name=v.loc;
  `);
  for(const f of files){ if(f<'0050') continue;
    await db.exec(fs.readFileSync(path.join(dir,f),'utf8')); }
  /* طلبان: مفتوح ومحلول — لفحص العدّ والتقسيم */
  await db.exec(`
    insert into public.pos_stock_requests(product_code,location_id,qty_here,resolved)
    select 'T-VQ-A1', id, 0, false from public.pos_locations where name='فرع السراج';
    insert into public.pos_stock_requests(product_code,location_id,qty_here,resolved,resolved_at,resolved_by)
    select 'T-VQ-A2', id, 0, true, now(), 'admin' from public.pos_locations where name='فرع 11 يونيو';
  `);
});

test.after(async ()=>{ if(db) await db.close(); });

async function runVerify(){
  const r=await db.query(fs.readFileSync(SQL_FILE,'utf8'));
  return r.rows; /* مرتّبة بـ ord ١..١٦ */
}
const F=r=>r['الفحص'], V=r=>r['الفعلي'], S=r=>r['الحالة'];

test('(فحص) الاستعلام يعمل ويعيد ١٦ صفاً بقيم البيانات المحلية الصحيحة', async ()=>{
  const rows=await runVerify();
  assert.equal(rows.length,16,'١٦ فحصاً (١٥ الأصلية + فحص الدالة الجديد)');
  /* 0049 */
  assert.match(F(rows[0]),/0049.*الموردين/);
  assert.equal(V(rows[0]),'3','عدد الموردين المحلي 3 — 🔴 لأن المتوقع إنتاج 90 (سلوك مقصود محلياً)');
  assert.equal(S(rows[0]),'🔴 راجع');
  assert.equal(V(rows[1]),'3','منتجات بمورد: A1+A2+B2 (و B1/B3 بلا مورد)');
  assert.equal(S(rows[1]),'🔴 راجع');
  assert.equal(V(rows[2]),'0'); assert.equal(S(rows[2]),'✅');
  assert.equal(V(rows[3]),'موجود'); assert.equal(S(rows[3]),'✅');
  /* 0050 */
  assert.equal(V(rows[4]),'6','قواعد الأقسام = ٢ تصنيفات × ٣ مواقع');
  assert.equal(S(rows[4]),'🔴 راجع');
  assert.equal(V(rows[5]),'0 فجوة'); assert.equal(S(rows[5]),'✅');
  const carried=V(rows[6]);
  assert.ok(carried.includes('مخزن جنزور: 2')&&carried.includes('فرع السراج: 1')&&carried.includes('فرع 11 يونيو: 1'),
    'carried: خلاطات في الثلاثة + أحواض في جنزور فقط ⇒ '+carried);
  assert.equal(S(rows[6]),'ℹ️');
  /* 0051 */
  assert.equal(V(rows[7]),'كلاهما موجود'); assert.equal(S(rows[7]),'✅');
  assert.equal(V(rows[8]),'Africa/Tripoli'); assert.equal(S(rows[8]),'✅');
  assert.equal(V(rows[9]),'موجود'); assert.equal(S(rows[9]),'✅');
  /* الأمان */
  assert.equal(V(rows[10]),'لا شيء'); assert.equal(S(rows[10]),'✅');
  assert.equal(S(rows[11]),'ℹ️');
  assert.equal(V(rows[12]),'لا شيء','الدالة محجوبة عن anon (0051 سحبها)'); assert.equal(S(rows[12]),'✅');
  /* STABLE */
  assert.ok(V(rows[13]).includes('STABLE')); assert.equal(S(rows[13]),'ℹ️');
  /* خطّ الأساس */
  assert.equal(V(rows[14]),'2 صفاً · 2 منتجاً','سالبان: A2@11 يونيو و B1@السراج');
  assert.equal(S(rows[14]),'ℹ️');
  assert.equal(V(rows[15]),'2 طلباً · مفتوحة: 1'); assert.equal(S(rows[15]),'ℹ️');
});

test('(فحص) بقعة الإصلاح: الاسم القديم مرّ بلا فحص — المصحّح يكشف التسرّب', async ()=>{
  await db.exec('grant select on public.pos_suggestion_dismissals to anon');
  /* النسخة الأصلية بالاسم غير الموجود: ترجع «لا شيء» كذباً — هذا هو الخطأ */
  const orig=await db.query(`
    select coalesce((select string_agg(distinct table_name || ' → ' || privilege_type, ' · ')
                       from information_schema.role_table_grants
                      where grantee = 'anon' and table_schema = 'public'
                        and table_name in ('pos_location_category_rules',
                                           'pos_stock_requests',
                                           'pos_transfer_dismissals')),
                    'لا شيء') as v`);
  assert.equal(orig.rows[0].v,'لا شيء','الاسم غير الموجود ⇒ فحص أعمى يمرّ ✅ خطأً');
  /* النسخة المصحّحة تكشف المنح */
  let rows=await runVerify();
  assert.match(V(rows[10]),/pos_suggestion_dismissals/,'الاسم الصحيح يكشف التسرّب: '+V(rows[10]));
  assert.equal(S(rows[10]),'🔴 راجع');
  /* الإصلاح يعيد الحالة */
  await db.exec('revoke select on public.pos_suggestion_dismissals from anon');
  rows=await runVerify();
  assert.equal(V(rows[10]),'لا شيء'); assert.equal(S(rows[10]),'✅');
});

test('(فحص) فحص الدالة الجديد يكشف منح execute لـ anon', async ()=>{
  await db.exec('grant execute on function public.pos_record_stock_request(text,uuid,numeric,jsonb,text) to anon');
  let rows=await runVerify();
  assert.match(V(rows[12]),/pos_record_stock_request/,'يكشف: '+V(rows[12]));
  assert.equal(S(rows[12]),'🔴 راجع');
  await db.exec('revoke execute on function public.pos_record_stock_request(text,uuid,numeric,jsonb,text) from anon');
  rows=await runVerify();
  assert.equal(V(rows[12]),'لا شيء'); assert.equal(S(rows[12]),'✅');
});
