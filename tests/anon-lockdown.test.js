/* ═══════════════════════════════════════════════════════════════════
   اختبارات المهمة «ب» — 0053: إقفال anon النهائي
   • السلسلة 0001..0052 ⇒ anon يملك القائمة البيضاء من 0039
     (pos_locations كامل · pos_products أعمدة · pos_stock كامل)
   • محاكاة انحراف الإنتاج: منح Supabase الافتراضية + منحة عمود
     code_hash على app_users + EXECUTE على login_app_user
   • 0053 ⇒ صفر وصول لـanon على pos_ (جدولاً وأعمدةً وسياساتٍ وviews)
     مع بقاء إدراج طلبات الموقع وقراءة منتجاته وسياساتها
   • الحارس: يعمل مستقلاً، ويفشل صراحةً عند وصول مُتسرّب
   • التكرار آمن (تشغيله مرتين)
   ═══════════════════════════════════════════════════════════════════ */
const test=require('node:test'), assert=require('node:assert');
const fs=require('fs'), path=require('path');
const HERE=path.join(__dirname,'..');
const DIR=path.join(HERE,'supabase/migrations');
const M53=fs.readFileSync(path.join(DIR,'0053_anon_lockdown.sql'),'utf8');

let PGlite,pgcrypto;
try{
  PGlite=require('@electric-sql/pglite').PGlite;
  pgcrypto=require('@electric-sql/pglite/contrib/pgcrypto').pgcrypto;
}catch(e){ console.error('⚠ شغّل npm install'); process.exit(1); }

async function buildDB(upto){ /* السلسلة حتى قبل 0053 */
  const db=new PGlite({extensions:{pgcrypto}});
  await db.exec(fs.readFileSync(path.join(HERE,'supabase/local-shim.sql'),'utf8'));
  for(const f of fs.readdirSync(DIR).filter(f=>f.endsWith('.sql')).sort()){
    if(f>='0053') break;
    await db.exec(fs.readFileSync(path.join(DIR,f),'utf8'));
  }
  return db;
}
async function run53(db){ /* كتلة DO وحدها (بلا SELECT العرض) */
  const only=M53.slice(0,M53.indexOf('-- ═══════════════════════════════════════════════════════════════════\n-- ناتج الحارس'));
  await db.exec(only);
}
const zero=async(db,sql)=>Number((await db.query(sql)).rows[0].n);

test('(ب-١) قبل 0053: anon يقرأ pos_stock/pos_products/pos_locations (القائمة البيضاء) — وبعدها: ممنوع كله', async ()=>{
  const db=await buildDB();
  /* محاكاة ما يملكه anon على الإنتاج الآن (0039 منحته إياه) */
  await db.exec(`set role 'anon'`);
  let ok=0;
  (await db.query(`select count(*) n from public.pos_stock`)).rows[0]; /* يمرّ — منح وسياسة 0039 */
  ok=1; assert.ok(ok,'pos_stock مقروء لـanon قبل 0053');
  await db.query(`select code, retail_price from public.pos_products limit 1`);
  await db.query(`select id from public.pos_locations limit 1`);
  await db.exec(`reset role`);

  await run53(db);

  await db.exec(`set role 'anon'`);
  for(const t of ['pos_stock','pos_products','pos_locations','pos_sales','pos_finance_accounts','app_users','product_costs','staff_roles','carts','cart_items']){
    let denied=false;
    try{ await db.query(`select count(*) from public.${t}`); }
    catch(e){ denied=/permission denied/i.test(String(e.message)); }
    assert.ok(denied,'anon ممنوع من '+t);
  }
  let deniedFn=false;
  try{ await db.query(`select public.login_app_user('x','y')`); }
  catch(e){ deniedFn=/permission denied/i.test(String(e.message)); }
  assert.ok(deniedFn,'login_app_user مقفلة أمام anon');
  deniedFn=false;
  try{ await db.query(`select public.next_pos_invoice_number()`); }
  catch(e){ deniedFn=/permission denied/i.test(String(e.message)); }
  assert.ok(deniedFn,'next_pos_invoice_number مقفلة أمام anon');
  await db.exec(`reset role`);
  await db.close();
});

test('(ب-٢) محاكاة انحراف الإنتاج: منح افتراضية + منحة عمود code_hash ⇒ 0053 يسحبها كلها', async ()=>{
  const db=await buildDB();
  /* ما يفعله Supabase افتراضياً عند إنشاء الجداول + منحة العمود اليدوية */
  await db.exec(`
    grant select, insert, update, delete on public.app_users to anon;
    grant select (code_hash) on public.app_users to anon;
    grant all on public.product_costs to anon;
    grant all on public.staff_roles to anon;
    grant select, insert, update, delete on public.carts to anon;
    grant select, insert, update, delete on public.cart_items to anon;
    grant execute on function public.login_app_user(text,text) to anon;
    grant execute on function public.next_pos_invoice_number() to public;
    grant select, update on public.web_orders to anon;
    grant update, delete on public.web_order_items to anon;
    grant insert, update, delete on public.web_products to anon;
    create policy "rogue anon" on public.pos_customers for select to anon using (true);
  `);
  await run53(db); /* لا يفشل — يسحب كل ما سبق */
  assert.equal(await zero(db,`select count(*) n from information_schema.role_table_grants where grantee='anon' and table_schema='public' and table_name like 'pos\\_%'`),0,'صفر منح جدول');
  assert.equal(await zero(db,`select count(*) n from information_schema.column_privileges where grantee='anon' and table_schema='public' and table_name like 'pos\\_%'`),0,'صفر منح أعمدة');
  assert.equal(await zero(db,`select count(*) n from pg_policies where schemaname='public' and tablename like 'pos\\_%' and 'anon'=any(roles)`),0,'صفر سياسات');
  const w=(await db.query(`select
      (select count(*) from information_schema.role_table_grants where grantee='anon' and table_name='web_orders') n_wo,
      (select count(*) from information_schema.role_table_grants where grantee='anon' and table_name='web_orders' and privilege_type='INSERT') wo_ins,
      (select count(*) from information_schema.role_table_grants where grantee='anon' and table_name='web_order_items' and privilege_type='INSERT') woi_ins,
      (select count(*) from information_schema.column_privileges where grantee='anon' and table_schema='public' and table_name='web_products' and privilege_type='SELECT') wp_cols,
      (select count(*) from information_schema.role_table_grants where grantee='anon' and table_schema='public' and table_name='web_products') wp_tbl,
      (select count(*) from information_schema.column_privileges where grantee='anon' and table_schema='public' and table_name='web_products' and column_name='cost') wp_cost`)).rows[0];
  assert.equal(Number(w.n_wo),1,'web_orders: منحة واحدة فقط');
  assert.ok(Number(w.wo_ins)===1&&Number(w.woi_ins)===1,'INSERT محفوظ للطلبات وبنودها');
  assert.ok(Number(w.wp_cols)===15,'أعمدة الكتالوج العام الـ15 فقط');
  assert.equal(Number(w.wp_tbl),0,'لا منح على مستوى جدول web_products');
  assert.equal(Number(w.wp_cost),0,'عمود cost غير مكشوف للعامة');
  const fn=(await db.query(`select has_function_privilege('anon','public.login_app_user(text,text)','EXECUTE') login_open, has_function_privilege('anon','public.next_pos_invoice_number()','EXECUTE') inv_open`)).rows[0];
  assert.equal(fn.login_open,false); assert.equal(fn.inv_open,false);
  await db.close();
});

test('(ب-٣) موقع الويب يواصل العمل: طلب تجريبي يُحفظ بجلسة anon، والمنتجات النشطة تُقرأ', async ()=>{
  const db=await buildDB();
  await db.exec(`insert into public.web_products(code, name, active) values ('WP1','دش نشط',true),('WP2','صنف موقوف',false)`);
  await run53(db);
  await db.exec(`set role 'anon'`);
  /* الموقع يولّد المعرّف على العميل (crypto.randomUUID) ويرسل Prefer: return=minimal — لا RETURNING */
  const ins=await db.query(`insert into public.web_orders(id, order_number, customer_name, customer_phone, status) values ('11111111-1111-1111-1111-111111111111','BO-12345678','زبون تجريبي','0911000000','جديد')`);
  assert.equal(ins.affectedRows,1,'الطلب يُحفظ بجلسة anon (INSERT بقي)');
  const items=await db.query(`insert into public.web_order_items(order_id, product_code, product_name, quantity) values ('11111111-1111-1111-1111-111111111111','WP1','دش نشط',1)`);
  assert.equal(items.affectedRows,1,'بند الطلب يُحفظ');
  let blocked=false;
  try{ await db.query(`insert into public.web_orders(customer_name, customer_phone, status) values ('x','0','مؤكد')`); }
  catch(e){ blocked=/row-level security/i.test(String(e.message)); }
  assert.ok(blocked,'السياسة ما زالت تحرس: لا إدراج إلا بحالة «جديد»');
  const rows=await db.query(`select code, name from public.web_products`);
  assert.deepEqual(rows.rows.map(x=>x.code),['WP1'],'المنتجات النشطة فقط مقروءة للعامة');
  let costDenied=false;
  try{ await db.query(`select cost from public.web_products`); }
  catch(e){ costDenied=/permission denied/i.test(String(e.message)); }
  assert.ok(costDenied,'عمود cost محجوب عن anon (منح أعمدة فقط)');
  let denied=false;
  try{ await db.query(`select count(*) from public.web_orders`); }
  catch(e){ denied=/permission denied/i.test(String(e.message)); }
  assert.ok(denied,'anon لا يقرأ الطلبات (SELECT سُحب، INSERT فقط)');
  await db.exec(`reset role`);
  await db.close();
});

test('(ب-٤) الحارس: مستقل قابل للنسخ، يفشل صراحةً عند وصول متسرّب، والتكرار آمن', async ()=>{
  const db=await buildDB();
  const s=M53.indexOf('-- [GUARD-START]'), e=M53.indexOf('-- [GUARD-END]');
  assert.ok(s>0&&e>s,'علامتا الحارس موجودتان في الملف');
  const guard='do $$\n'+M53.slice(M53.indexOf('\n',s),e).trim()+'\n$$;';
  await run53(db);
  await db.exec(guard); /* يعمل مستقلاً بعد التطبيق ✓ */
  await run53(db); /* التكرار آمن ✓ */
  /* وصول متسرّب ⇒ الحارس يفشل بالاسم */
  await db.exec(`grant select on public.pos_stock to anon`);
  let failed=false;
  try{ await db.exec(guard); }
  catch(err){ failed=/ANON_STILL_ON_POS_TABLES/.test(String(err.message)); }
  assert.ok(failed,'الحارس رفض الوصول المتسرّب بالاسم الصريح');
  await db.exec(`revoke select on public.pos_stock from anon`);
  await db.exec(guard); /* نظّفنا ⇒ يمرّ */
  /* سياسة متسرّبة ⇒ يفشل أيضاً */
  await db.exec(`create policy "sneak" on public.pos_suppliers for select to anon using (true)`);
  failed=false;
  try{ await db.exec(guard); }
  catch(err){ failed=/ANON_STILL_ON_POS_TABLES/.test(String(err.message)); }
  assert.ok(failed,'الحارس رفض السياسة المتسرّبة');
  await db.exec(`drop policy "sneak" on public.pos_suppliers`);
  await db.exec(guard);
  await db.close();
});

test('(ب-٥) authenticated لم يتأثر: الموظف يقرأ pos_products وينادي الدوال', async ()=>{
  const db=await buildDB();
  /* محاكاة منح Supabase الافتراضية للموظفين (على الإنتاج موجودة) */
  await db.exec(`grant select on public.pos_products to authenticated`);
  await run53(db);
  await db.exec(`set role 'authenticated'`);
  const rows=await db.query(`select count(*) n from public.pos_products`);
  assert.ok(Number(rows.rows[0].n)>=0,'authenticated يقرأ pos_products (سياسة pos_auth_all من 0039)');
  const fn=(await db.query(`select has_function_privilege('authenticated','public.login_app_user(text,text)','EXECUTE') login_ok, has_function_privilege('authenticated','public.next_pos_invoice_number()','EXECUTE') inv_ok`)).rows[0];
  assert.equal(fn.login_ok,true,'login_app_user متاحة للموظفين');
  assert.equal(fn.inv_ok,true,'next_pos_invoice_number متاحة للموظفين');
  await db.exec(`reset role`);
  await db.close();
});
