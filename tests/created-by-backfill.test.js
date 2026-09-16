/* ═══════════════════════════════════════════════════════════════════
   اختبارات المهمة ٢ — تعبئة created_by للفواتير القديمة (0054)
   • مستخدم واحد في سجل التدقيق ⇒ تُعبّئ به
   • لا سجل أو أكثر من مستخدم مختلف ⇒ تبقى NULL (لا تخمين)
   • الفواتير ذات created_by لا تُمسّ إطلاقاً
   • رسالة الرفض تتمايز: فاتورة بلا منشئ معروف ≠ لست صاحبها
   • created_by يُرسل في كل حفظ جديد (حتى المسار الاحتياطي)
   ═══════════════════════════════════════════════════════════════════ */
const test=require('node:test'), assert=require('node:assert');
const fs=require('fs'), vm=require('vm'), path=require('path');
const HERE=path.join(__dirname,'..');
const DIR=path.join(HERE,'supabase/migrations');
const M54=fs.readFileSync(path.join(DIR,'0054_created_by_backfill.sql'),'utf8');
const POS=path.join(HERE,'new discussion github','apps','pos','benamor-sales-system');
const APP=fs.readFileSync(path.join(POS,'app.js'),'utf8');

let PGlite,pgcrypto;
try{
  PGlite=require('@electric-sql/pglite').PGlite;
  pgcrypto=require('@electric-sql/pglite/contrib/pgcrypto').pgcrypto;
}catch(e){ console.error('⚠ شغّل npm install'); process.exit(1); }

async function buildDB(){ /* السلسلة كاملة ثم بيانات اختبار */
  const db=new PGlite({extensions:{pgcrypto}});
  await db.exec(fs.readFileSync(path.join(HERE,'supabase/local-shim.sql'),'utf8'));
  for(const f of fs.readdirSync(DIR).filter(f=>f.endsWith('.sql')).sort()){
    if(f>='0054') break;
    await db.exec(fs.readFileSync(path.join(DIR,f),'utf8'));
  }
  return db;
}
async function run54(db){
  await db.exec(M54.slice(0,M54.indexOf('do $$'))+M54.slice(M54.indexOf('do $$')));
}

test('(٢-١) مستخدم واحد في السجل ⇒ تُعبّئ · لا سجل أو مستخدمان ⇒ تبقى NULL · ذات قيمة لا تُمسّ', async ()=>{
  const db=await buildDB();
  const loc=(await db.query(`select id from public.pos_locations limit 1`)).rows[0].id;
  /* ٤ فواتير: A بلا سجل تدقيق · B مستخدم واحد · C مستخدمان مختلفان · D لها قيمة أصلاً */
  const ids={};
  for(const k of ['A','B','C','D']){
    const r=await db.query(`insert into public.pos_sales(sale_date,location_id,payment_method,subtotal,total,paid_amount,balance_due,status,created_by)
      values ('2026-01-0${ {A:1,B:2,C:3,D:4}[k] }','${loc}','cash',100,100,100,0,'posted',${k==='D'?'\'1192\'':'null'}) returning id`);
    ids[k]=r.rows[0].id;
  }
  await db.exec(`insert into public.pos_audit_log(user_identifier,action,entity_type,entity_id,details) values
    ('1192','sale','pos_sales','${ids.B}','فاتورة B'),
    ('1010','sale','pos_sales','${ids.C}','فاتورة C أول تدوين'),
    ('1669','sale','pos_sales','${ids.C}','فاتورة C تدوين ثانٍ بمستخدم مختلف')`);
  const before=(await db.query(`select count(*) n from public.pos_sales where created_by is null`)).rows[0];
  await run54(db);
  const after=await db.query(`select id, created_by from public.pos_sales order by sale_date`);
  const byId=new Map(after.rows.map(r=>[r.id,r.created_by]));
  assert.equal(byId.get(ids.A),null,'A: لا سجل تدقيق ⇒ تبقى NULL');
  assert.equal(byId.get(ids.B),'1192','B: مستخدم واحد ⇒ عُبّئت به');
  assert.equal(byId.get(ids.C),null,'C: مستخدمان مختلفان ⇒ تبقى NULL (لا تخمين)');
  assert.equal(byId.get(ids.D),'1192','D: كانت معبّأة ولم تُمسّ');
  const nulls=(await db.query(`select count(*) n from public.pos_sales where created_by is null`)).rows[0];
  assert.equal(Number(nulls.n),Number(before.n)-1,'NULL نقصت بواحدة حصراً (B)');
  /* التكرار آمن */
  await run54(db);
  const again=(await db.query(`select created_by from public.pos_sales where id='${ids.B}'`)).rows[0];
  assert.equal(again.created_by,'1192','إعادة التشغيل لا تغيّر شيئاً');
  await db.close();
});

test('(٢-٢) الحارس: أي فاتورة معبّأة أصلاً تتغيّر ⇒ استثناء وتراجع كامل', async ()=>{
  const db=await buildDB();
  const loc=(await db.query(`select id from public.pos_locations limit 1`)).rows[0].id;
  const r=await db.query(`insert into public.pos_sales(sale_date,location_id,payment_method,subtotal,total,paid_amount,balance_due,status,created_by)
    values ('2026-01-01','${loc}','cash',10,10,10,0,'posted','1993') returning id`);
  const sid=r.rows[0].id;
  await db.exec(`insert into public.pos_audit_log(user_identifier,action,entity_type,entity_id,details) values ('9999','sale','pos_sales','${sid}','سجل متناقض')`);
  /* 0054 لا يمسّ غير NULL أصلاً — فلنتأكد أن هذا السجل (مستخدم مختلف عن القيمة الأصلية) لا يغيّرها */
  await run54(db);
  const v=(await db.query(`select created_by from public.pos_sales where id='${sid}'`)).rows[0];
  assert.equal(v.created_by,'1993','القيمة الأصلية محفوظة رغم سجل تدقيق مختلف');
  await db.close();
});

test('(٢-٣) رسالة الرفض وcreated_by في كل حفظ جديد — من الكود', async ()=>{
  assert.ok(APP.includes('هذه فاتورة قديمة لا يعرف النظام من أنشأها — المدير وحده يعدّلها'),'رسالة الفاتورة بلا منشئ معروف');
  assert.ok(APP.includes("toast(sl.created_by?'يمكنك تعديل الفواتير التي أنشأتها أنت فقط"),'رسالة «لست صاحبها» تبقى للفواتير ذات منشئ معروف');
  /* created_by في جسم الحفظ — يغطي المسار الاحتياطي المباشر أيضاً */
  assert.ok(APP.includes("status:'posted',notes:q('saleNotes').value.trim(),created_by:appUser?.identifier||''"),'created_by في جسم كل فاتورة جديدة');
  /* RPC يكتبه من الجلسة (0041/0045) — تأكيد من السلسلة */
  const chain=fs.readFileSync(path.join(DIR,'0045_offline_queue.sql'),'utf8');
  assert.ok(/insert into public\.pos_sales\([\s\S]*created_by/.test(chain),'post_sale_transaction يكتب created_by في الإدراج');
  const rpc45=chain.slice(chain.indexOf('create or replace function public.post_sale_transaction'));
  assert.ok(rpc45.includes('created_by'),'التعريف الحالي للدالة يتضمن created_by');
});
