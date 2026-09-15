/* ═══════════════════════════════════════════════════════════════════
   اختبار تنقيح الموردين (0049) — محاكاة توقيع الإنتاج بالضبط:
   175 مورداً (85 اسماً مكرراً ×2 + 5 جدد)، 4445 منتجاً بمورد،
   مجموعة واحدة مقسّمة 687/1، ومجموعات كاملة على نسخة واحدة
   ═══════════════════════════════════════════════════════════════════ */
const test=require('node:test'), assert=require('node:assert');
const fs=require('fs'), path=require('path');
let PGlite,pgcrypto;
try{
  PGlite=require('@electric-sql/pglite').PGlite;
  pgcrypto=require('@electric-sql/pglite/contrib/pgcrypto').pgcrypto;
}catch(e){ console.error('⚠ شغّل npm install أولاً'); process.exit(1); }
const HERE=path.join(__dirname,'..','supabase');
let db;
async function q(sql,p){ return (await db.query(sql,p||[])).rows; }
async function one(sql,p){ return (await q(sql,p))[0]; }

test.before(async ()=>{
  db=new PGlite({extensions:{pgcrypto}});
  await db.exec(fs.readFileSync(path.join(HERE,'local-shim.sql'),'utf8'));
  for(const f of fs.readdirSync(path.join(HERE,'migrations')).filter(f=>f.endsWith('.sql')&&f!=='0049_suppliers_dedup.sql').sort())
    await db.exec(fs.readFileSync(path.join(HERE,'migrations',f),'utf8'));
  /* 0049 يُشغَّل يدوياً في كل اختبار — لا يمكن بذر بيانات مكررة وفهرسه الفريد منشأ */
});

test('تنقيح توقيع الإنتاج: 175 ⇒ 90، 4445 منتجاً ثابتة، يتامى 0، الفهرس يمنع التكرار', async ()=>{
  /* بناء البيانات: 85 مجموعة مكررة + 5 موردين جدد = 175 */
  await db.exec(`
    -- 84 مجموعة عادية (القديمة عليها المنتجات والجديدة فارغة) + مجموعة دار الخزف = 85
    insert into public.pos_suppliers(id,name,phone,created_at)
    select gen_random_uuid(), 'مورد مكرر رقم '||g, '091'||g, timestamp '2026-06-27 17:46:00'
    from generate_series(1,84) g;
    insert into public.pos_suppliers(id,name,phone,created_at)
    select gen_random_uuid(), ' مورد مكرر رقم '||g||' ', '092'||g, timestamp '2026-09-10 11:45:00'
    from generate_series(1,84) g;  -- أسماء مطابقة بعد التطبيع (مسافات مختلفة)
    -- 5 جدد لا تكرار فيهم
    insert into public.pos_suppliers(id,name,created_at)
    select gen_random_uuid(), 'مورد جديد '||g, timestamp '2026-09-10 11:45:00'
    from generate_series(1,5) g;
  `);
  /* المجموعة المقسّمة: دار الخزف — القديمة 687 منتجاً والجديدة 1 */
  await db.exec(`
    insert into public.pos_suppliers(id,name,created_at) values
      (gen_random_uuid(),'دار الخزف للمواد الصحية (11 يونيو)', timestamp '2026-06-27 17:46:00'),
      (gen_random_uuid(),'دار الخزف للمواد الصحية (11 يونيو) ', timestamp '2026-09-10 11:45:00');
  `);
  /* المنتجات: 4445 بمورد.
     84 مجموعة × كمية متفاوتة على النسخة القديمة (مجموعها X)
     + مجموعة دار الخزف: 687 قديمة + 1 جديدة
     + منتجات للموردين الجدد
     بحيث الإجمالي = 4445 بالضبط */
  /* خطة التوزيع: 84 مجموعة: 40 منتجاً لكل واحدة = 3360؛ الجدد 5 × 79 = 395؛ دار الخزف 688 ⇒ 3360+395+688 = 4443… نضبطها: */
  await db.exec(`
    do $do$
    declare v_old uuid; v_new uuid; v_koz old_uuid; begin
    null;
    end $do$;
  `).catch(()=>{}); /* placeholder — نبني بالـ SQL المباشر أدناه */
  await db.exec(`
    create temp table _s as select name,id,created_at,
      row_number() over (partition by lower(btrim(name)) order by created_at) rn,
      count(*) over (partition by lower(btrim(name))>0) as dummy from public.pos_suppliers where false;
  `).catch(()=>{});
  /* ننفّذ التوزيع بسكربت مباشر */
  const counts=await one(`select
    (select count(*) from public.pos_suppliers) as suppliers,
    (select count(*) from (select 1 from public.pos_suppliers group by lower(btrim(name)) having count(*)>1) x) as groups`);
  assert.equal(Number(counts.suppliers),175,'175 مورداً');
  assert.equal(Number(counts.groups),85,'85 مجموعة مكررة (دار الخزف ضمنها)');

  /* 84 مجموعة عادية (غير دار الخزف): القديمة عليها 40 منتجاً = 3360
     دار الخزف: القديمة 687 والجديدة 1
     الموردون الجدد 5: 79 منتجاً لكل = 395
     المجموع = 3360+688+395 = 4443 — نحتاج 2 إضافية: نجعل أول مجموعتين 41 بدل 40 */
  await db.exec(`
    insert into public.pos_products(code,name,retail_price,purchase_price,supplier_id,active)
    select 'P-'||g||'-'||i, 'منتج '||g||'-'||i, 10, 5, s.id, true
    from generate_series(1,84) g
    join lateral (select id from public.pos_suppliers
                  where lower(btrim(name))=lower(btrim('مورد مكرر رقم '||g))
                  order by created_at asc limit 1) s on true,
         generate_series(1, case when g<=2 then 41 else 40 end) i;
  `);
  await db.exec(`
    insert into public.pos_products(code,name,retail_price,purchase_price,supplier_id,active)
    select 'KOZ-O-'||i, 'خزف قديم '||i, 10, 5, s.id, true
    from generate_series(1,687) i
    join lateral (select id from public.pos_suppliers
                  where lower(btrim(name))=lower(btrim('دار الخزف للمواد الصحية (11 يونيو)'))
                  order by created_at asc limit 1) s on true;
    insert into public.pos_products(code,name,retail_price,purchase_price,supplier_id,active)
    select 'KOZ-N-1', 'خزف جديد واحد', 10, 5, s.id, true
    from lateral (select id from public.pos_suppliers
                  where lower(btrim(name))=lower(btrim('دار الخزف للمواد الصحية (11 يونيو)'))
                  order by created_at desc limit 1) s;
    insert into public.pos_products(code,name,retail_price,purchase_price,supplier_id,active)
    select 'NEW-'||g||'-'||i, 'منتج جديد '||g||'-'||i, 10, 5, s.id, true
    from generate_series(1,5) g
    join lateral (select id from public.pos_suppliers where name='مورد جديد '||g) s on true,
         generate_series(1,79) i;
  `);
  const pre=await one(`select
    (select count(*) from public.pos_products where supplier_id is not null) as with_supplier,
    (select count(*) from public.pos_products) as all_products`);
  assert.equal(Number(pre.with_supplier),4445,'4445 منتجاً بمورد (فعلي: '+pre.with_supplier+')');
  assert.equal(Number(pre.all_products),4445,'لا منتجات يتيمة قبل');

  /* ═══ تشغيل الـmigration 0049 ═══ */
  await db.exec(fs.readFileSync(path.join(HERE,'migrations','0049_suppliers_dedup.sql'),'utf8'));

  const post=await one(`select
    (select count(*) from public.pos_suppliers) as suppliers,
    (select count(*) from public.pos_products where supplier_id is not null) as with_supplier,
    (select count(*) from public.pos_products p where p.supplier_id is not null and not exists (select 1 from public.pos_suppliers s where s.id=p.supplier_id)) as orphans,
    (select count(*) from (select 1 from public.pos_suppliers group by lower(btrim(name)) having count(*)>1) x) as dups`);
  assert.equal(Number(post.suppliers),90,'175 − 85 = 90');
  assert.equal(Number(post.with_supplier),4445,'4445 لم تتغير');
  assert.equal(Number(post.orphans),0,'يتامى 0');
  assert.equal(Number(post.dups),0,'لا تكرار متبقٍّ');

  /* منتج دار الخزف الوحيد على النسخة الجديدة انتقل إلى القديمة الباقية */
  const koz=await one(`select count(*) as n from public.pos_products p
    join public.pos_suppliers s on s.id=p.supplier_id
    where p.code='KOZ-N-1' and lower(btrim(s.name))=lower('دار الخزف للمواد الصحية (11 يونيو)')`);
  assert.equal(Number(koz.n),1,'منتج المجموعة المقسّمة انتقل للباقية');
  const kozTotal=await one(`select count(*) as n from public.pos_products p
    join public.pos_suppliers s on s.id=p.supplier_id
    where lower(btrim(s.name))=lower('دار الخزف للمواد الصحية (11 يونيو)')`);
  assert.equal(Number(kozTotal.n),688,'687+1=688 على المورد الباقي');

  /* الفهرس الفريد يرفض التكرار بأي تطبيع */
  let rejected=false;
  try{ await db.exec(`insert into public.pos_suppliers(name) values ('  دار الخزف للمواد الصحية (11 يونيو)')`); }
  catch(e){ rejected=/pos_suppliers_name_norm_uidx|duplicate key/i.test(String(e.message)); }
  assert.ok(rejected,'الفهرس الفريد يرفض الاسم المكرر');
});

test('قاعدة نظيفة بلا تكرار: الـmigration يعمل بلا حذف وينشئ الفهرس (توافق السلاسل)', async ()=>{
  const db2=new PGlite({extensions:{pgcrypto}});
  await db2.exec(fs.readFileSync(path.join(HERE,'local-shim.sql'),'utf8'));
  for(const f of fs.readdirSync(path.join(HERE,'migrations')).filter(f=>f.endsWith('.sql')).sort())
    await db2.exec(fs.readFileSync(path.join(HERE,'migrations',f),'utf8'));
  /* قاعدة فارغة من الموردين: لا مجموعات، لا حذف، فهرس يُنشأ */
  const r=await db2.query(`select count(*)::int n from public.pos_suppliers`);
  assert.equal(r.rows[0].n,0,'لا موردين');
  let idx=false;
  try{ await db2.exec(`insert into public.pos_suppliers(name) values ('أ'); insert into public.pos_suppliers(name) values ('أ')`); }
  catch(e){ idx=/pos_suppliers_name_norm_uidx|duplicate/i.test(String(e.message)); }
  assert.ok(idx,'الفهرس موجود ويعمل على قاعدة نظيفة');
});

test('فشل صريح إذا اختلّت ثوابت اللقطة (توقيع إنتاج بأرقام منحرفة)', async ()=>{
  const db3=new PGlite({extensions:{pgcrypto}});
  await db3.exec(fs.readFileSync(path.join(HERE,'local-shim.sql'),'utf8'));
  for(const f of fs.readdirSync(path.join(HERE,'migrations')).filter(f=>f.endsWith('.sql')&&f!=='0049_suppliers_dedup.sql').sort())
    await db3.exec(fs.readFileSync(path.join(HERE,'migrations',f),'utf8'));
  /* 175 مورداً لكن مجموعات ليست 85 */
  await db3.exec(`
    insert into public.pos_suppliers(id,name,created_at)
    select gen_random_uuid(),'مورّد '||g, now() from generate_series(1,175) g;`);
  let failed=false,msg='';
  try{ await db3.exec(fs.readFileSync(path.join(HERE,'migrations','0049_suppliers_dedup.sql'),'utf8')); }
  catch(e){ failed=true; msg=String(e.message); }
  assert.ok(failed,'يفشل صراحةً');
  assert.ok(/SNAPSHOT_DRIFT/.test(msg),'برسالة انحراف اللقطة: '+msg.slice(0,120));
  /* والفشل ألغى كل شيء: أفرج عن الجلسة الملغاة ثم تحقق */
  await db3.exec('rollback;').catch(()=>{});
  const r=await db3.query(`select count(*)::int n from public.pos_suppliers`);
  assert.equal(r.rows[0].n,175,'المعاملة أُلغيت بالكامل');
});
