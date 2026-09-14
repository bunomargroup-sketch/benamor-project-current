/* ═══════════════════════════════════════════════════════════════════
   اختبارات تعديل/حذف المصاريف الذرّية فوق سلسلة migrations
   تغطي معايير القبول الحاسمة:
     ٥) حذف المصروف يعيد رصيد الخزينة بالضبط ولا يترك حركة يتيمة
     ٦) تعديل 100→250 ينقص 150 إضافية بالضبط
     + صلاحيات: المدير الكل، المنشئ نفس اليوم فقط، غيره مرفوض
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
const LOC='aaaaaaaa-1111-1111-1111-111111111111', ACC='aaaaaaaa-2222-2222-2222-222222222222', ACC2='aaaaaaaa-3333-3333-3333-333333333333';
async function q(sql,p){ return (await db.query(sql,p||[])).rows; }
async function one(sql,p){ return (await q(sql,p))[0]; }
async function accBalance(id){ return Number((await one(`select balance from public.pos_finance_account_balances where id=$1`,[id])).balance); }
async function asUser(email,role){
  await db.exec(`create or replace function auth.jwt() returns jsonb language sql stable as $$ select '${JSON.stringify({email})}'::jsonb $$;`);
  if(role) await db.exec(`insert into public.pos_user_roles(identifier,role,active) values ('${email.split('@')[0]}','${role}',true) on conflict do nothing;`);
}
async function callUpdate(id,patch){
  try{ const r=await one(`select public.pos_update_expense($1::uuid,$2::jsonb) as row`,[id,patch]); return {ok:true,row:r.row}; }
  catch(e){ return {ok:false,msg:String(e.message||e)}; }
}
async function callDelete(id){
  try{ const r=await one(`select public.pos_delete_expense($1::uuid) as row`,[id]); return {ok:true,row:r.row}; }
  catch(e){ return {ok:false,msg:String(e.message||e)}; }
}

test.before(async ()=>{
  db=new PGlite({extensions:{pgcrypto}});
  await db.exec(fs.readFileSync(path.join(HERE,'local-shim.sql'),'utf8'));
  const files=fs.readdirSync(path.join(HERE,'migrations')).filter(f=>f.endsWith('.sql')).sort();
  for(const f of files) await db.exec(fs.readFileSync(path.join(HERE,'migrations',f),'utf8'));
  await db.exec(`
    insert into public.pos_locations(id,name,is_sales_location,location_type) values ('${LOC}','فرع الاختبار',true,'branch');
    insert into public.pos_user_roles(identifier,role,active) values ('admin','admin',true),('cash1','seller_11',true),('cash2','seller_sarraj',true);
    insert into auth.users(id,email) values ('bbbbbbbb-1111-1111-1111-111111111111','admin@bag.com'),('bbbbbbbb-2222-2222-2222-222222222222','cash1@bag.com'),('bbbbbbbb-3333-3333-3333-333333333333','cash2@bag.com');
    insert into public.pos_finance_accounts(id,name,account_type,opening_balance) values ('${ACC}','خزينة الاختبار','cash',1000),('${ACC2}','بنك الاختبار','bank',2000);
    insert into public.pos_expense_categories(id,name,active) values ('cccccccc-1111-1111-1111-111111111111','وقود',true);
  `);
  await asUser('admin@bag.com');
});
/* إنشاء مصروف مع حركته — يحاكي مسار الواجهة */
async function makeExpense(title,amount,by){
  await asUser(by+'@bag.com');
  const r=await one(`insert into public.pos_expenses(expense_date,location_id,account_id,category_id,title,amount,created_by)
    values (current_date,'${LOC}','${ACC}','cccccccc-1111-1111-1111-111111111111',$1,$2,$3) returning id,amount,account_id`,
    [title,amount,by]);
  await db.exec(`insert into public.pos_finance_movements(account_id,direction,movement_type,amount,movement_date,reference_table,reference_id,notes)
    values ('${ACC}','out','expense',${amount},current_date,'pos_expenses','${r.id}','${title}')`);
  return r;
}

/* ── المعيار ٥ (الحاسم): حذف ⇒ رصيد يعود بالضبط + صفر حركات يتيمة ── */
test('٥: حذف مصروف يعيد رصيد الخزينة بالضبط ولا يترك حركة يتيمة', async ()=>{
  const before=await accBalance(ACC);
  const x=await makeExpense('مصروف اختبار الحذف',100,'cash1');
  assert.equal(await accBalance(ACC),before-100,'الرصيد نقص 100 بعد الإضافة');
  /* الحذف بمحاولة الكاشير أولاً — مرفوض */
  const denied=await callDelete(x.id);
  assert.ok(!denied.ok&&/ADMIN_ONLY/.test(denied.msg),'غير المدير لا يحذف: '+denied.msg);
  await asUser('admin@bag.com');
  const del=await callDelete(x.id);
  assert.ok(del.ok,'حذف المدير: '+del.msg);
  assert.equal(await accBalance(ACC),before,'⚠ الرصيد عاد بالضبط إلى قيمته الأولى');
  const orphans=await one(`select count(*)::int n from public.pos_finance_movements where reference_table='pos_expenses' and reference_id=$1`,[x.id]);
  assert.equal(orphans.n,0,'لا حركة يتيمة');
  const gone=await one(`select count(*)::int n from public.pos_expenses where id=$1`,[x.id]);
  assert.equal(gone.n,0,'الصف حُذف');
});

/* ── المعيار ٦: تعديل 100→250 ⇒ نقص إضافي 150 بالضبط ── */
test('٦: تعديل المبلغ 100→250 ينقص 150 إضافية لا أكثر ولا أقل', async ()=>{
  const before=await accBalance(ACC);
  const x=await makeExpense('مصروف اختبار التعديل',100,'cash1');
  assert.equal(await accBalance(ACC),before-100);
  /* المنشئ يعدّل مصروفه في نفس اليوم ⇒ مسموح */
  const up=await callUpdate(x.id,{title:'مصروف اختبار التعديل',amount:250,account_id:ACC,expense_date:new Date().toISOString().slice(0,10)});
  assert.ok(up.ok,'تعديل المنشئ نفس اليوم: '+up.msg);
  assert.equal(Number(up.row.amount),250);
  assert.equal(await accBalance(ACC),before-250,'النقص الإجمالي 250 = 100 الأولى + 150 الإضافية بالضبط');
  /* حركة واحدة فقط مطابقة للقيم الجديدة */
  const mvs=await q(`select account_id,amount,movement_date from public.pos_finance_movements where reference_table='pos_expenses' and reference_id=$1`,[x.id]);
  assert.equal(mvs.length,1,'حركة واحدة (لا قديمة ولا يتيمة)');
  assert.equal(Number(mvs[0].amount),250);
  /* تغيير الحساب: الحركة تنتقل للبنك */
  const up2=await callUpdate(x.id,{title:'مصروف اختبار التعديل',amount:250,account_id:ACC2,expense_date:new Date().toISOString().slice(0,10)});
  assert.ok(up2.ok,up2.msg);
  assert.equal(await accBalance(ACC),before,'الخزينة رجعت كاملة بعد نقل المصروف للبنك');
  assert.equal(await accBalance(ACC2),2000-250,'البنك تحمّل المبلغ');
  await asUser('admin@bag.com'); await callDelete(x.id);
  assert.equal(await accBalance(ACC2),2000,'تنظيف: عاد كل شيء');
});

/* ── صلاحيات التعديل ── */
test('صلاحيات: منشئ غير المدير يعدّل مصروفه اليوم فقط — لا مصروف غيره ولا أمس', async ()=>{
  const mine=await makeExpense('مصروفي اليوم',50,'cash1');
  const other=await makeExpense('مصروف زميلي',60,'cash2');
  await asUser('cash1@bag.com'); /* العودة لجلسة cash1 قبل فحوص الرفض */
  const yesterday=`(now() - interval '1 day')`;
  await db.exec(`update public.pos_expenses set created_at=${yesterday} where id='${mine.id}'`);
  /* تعديل مصروف زميله ⇒ مرفوض */
  const a=await callUpdate(other.id,{title:'x',amount:70,account_id:ACC});
  assert.ok(!a.ok&&/EDIT_NOT_ALLOWED/.test(a.msg),a.msg);
  /* مصروفه لكن أمس ⇒ مرفوض (العبرة بوقت التسجيل) */
  const b=await callUpdate(mine.id,{title:'x',amount:80,account_id:ACC});
  assert.ok(!b.ok&&/EDIT_NOT_ALLOWED/.test(b.msg),b.msg);
  /* المدير يعدّل الاثنين */
  await asUser('admin@bag.com');
  const c=await callUpdate(other.id,{title:'عدّل المدير',amount:70,account_id:ACC});
  assert.ok(c.ok,c.msg);
  /* created_by فارغ (قديم مجهول) ⇒ المدير فقط */
  await db.exec(`update public.pos_expenses set created_by=null, created_at=now() where id='${mine.id}'`);
  await asUser('cash1@bag.com');
  const d=await callUpdate(mine.id,{title:'x',amount:80,account_id:ACC});
  assert.ok(!d.ok&&/EDIT_NOT_ALLOWED/.test(d.msg),'مجهول المنشئ لا يعدّله غير المدير');
  await asUser('admin@bag.com');
  const e=await callUpdate(mine.id,{title:'المدير يعدّل المجهول',amount:80,account_id:ACC});
  assert.ok(e.ok,e.msg);
  await callDelete(mine.id); await callDelete(other.id);
});

/* ── التريغر: created_by يُعبّأ من الجلسة وإن لم يرسله العميل ── */
test('تريغر created_by: يُعبّأ من جلسة الدخول تلقائياً', async ()=>{
  await asUser('cash2@bag.com');
  const r=await one(`insert into public.pos_expenses(expense_date,account_id,title,amount) values (current_date,'${ACC}','بدون إرسال منشئ',10) returning created_by`);
  assert.equal(r.created_by,'cash2','التريغر عبّأه من الجلسة');
  await asUser('admin@bag.com');
  await db.exec(`delete from public.pos_finance_movements where reference_table='pos_expenses'; delete from public.pos_expenses;`);
});

/* ── التعبئة التاريخية من سجل التدقيق ── */
test('التعبئة التاريخية: من pos_audit_log فقط وبلا تخمين', async ()=>{
  /* صف قديم بلا منشئ + قيد تدقيق مطابق */
  const old=await one(`insert into public.pos_expenses(expense_date,account_id,title,amount,created_at) values ('2026-01-05','${ACC}','قديم معلوم',20, now()-interval '200 days') returning id`);
  await db.exec(`update public.pos_expenses set created_by=null where id='${old.id}'`); /* صف ما قبل التريغر */
  await db.exec(`insert into public.pos_audit_log(user_identifier,action,entity_type,entity_id,details,created_at)
    values ('cash1','expense','pos_expenses','${old.id}','قديم', now()-interval '200 days')`);
  /* صف قديم بلا منشئ وبلا قيد */
  const unk=await one(`insert into public.pos_expenses(expense_date,account_id,title,amount,created_at) values ('2026-01-05','${ACC}','قديم مجهول',30, now()-interval '200 days') returning id`);
  await db.exec(`update public.pos_expenses set created_by=null where id='${unk.id}'`); /* صف ما قبل التريغر */
  /* إعادة تشغيل منطق التعبئة (نفس جملة الـmigration) */
  await db.exec(`update public.pos_expenses e set created_by=(select a.user_identifier from public.pos_audit_log a where a.entity_type='pos_expenses' and a.entity_id=e.id::text and coalesce(a.user_identifier,'')<>'' order by a.created_at asc limit 1) where e.created_by is null;`);
  const known=await one(`select created_by from public.pos_expenses where id='${old.id}'`);
  const unknown=await one(`select created_by from public.pos_expenses where id='${unk.id}'`);
  assert.equal(known.created_by,'cash1','عُرف منشئه من التدقيق');
  assert.equal(unknown.created_by,null,'المجهول بقي فارغاً — لا تخمين');
});

/* ── رفض القيم غير الصالحة ── */
test('رفض التعديل بمبلغ غير موجب', async ()=>{
  const x=await makeExpense('رفض',10,'cash1');
  await asUser('admin@bag.com');
  const r=await callUpdate(x.id,{title:'x',amount:0,account_id:ACC});
  assert.ok(!r.ok&&/AMOUNT_MUST_BE_POSITIVE/.test(r.msg),r.msg);
  const r2=await callUpdate(x.id,{title:'',amount:10,account_id:ACC});
  assert.ok(!r2.ok&&/TITLE_REQUIRED/.test(r2.msg),r2.msg);
  await callDelete(x.id);
});
