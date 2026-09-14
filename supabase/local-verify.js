#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   local-verify.js — تحقق محلي فعلي من سلسلة migrations
   يشغّل 0001..00NN بالترتيب على PostgreSQL حقيقي (PGlite/WASM)
   فوق shim يحاكي بيئة Supabase، ثم يستخرج المخطّط الناتج
   (بنفس استعلام extract-live-schema.sql) إلى schema-local.json.

   الاستخدام:
     npm install                (مرة واحدة)
     node supabase/local-verify.js
   المخرجات:
     ✓ لكل ملف أو ✗ مع رسالة الخطأ والتوقف — والخروج برمز 1 عند أي فشل
   ═══════════════════════════════════════════════════════════════════ */
const fs=require('fs'), path=require('path');
let PGlite, pgcrypto;
try{
  PGlite=require('@electric-sql/pglite').PGlite;
  pgcrypto=require('@electric-sql/pglite/contrib/pgcrypto').pgcrypto;
}catch(e){
  console.error('⚠ شغّل أولاً: npm install  (يحتاج @electric-sql/pglite)');
  process.exit(1);
}
(async()=>{
  const here=__dirname;
  const db=new PGlite({extensions:{pgcrypto}});
  console.log('── Shim بيئة Supabase المحلية');
  await db.exec(fs.readFileSync(path.join(here,'local-shim.sql'),'utf8'));
  console.log('✓ shim (أدوار + auth + extensions/pgcrypto)');

  const dir=path.join(here,'migrations');
  const files=fs.readdirSync(dir).filter(f=>f.endsWith('.sql')).sort();
  console.log(`── تشغيل ${files.length} ملف migrations بالترتيب`);
  const t0=Date.now();
  for(const f of files){
    const sql=fs.readFileSync(path.join(dir,f),'utf8');
    try{ await db.exec(sql); console.log(' ✓',f); }
    catch(e){
      console.error(' ✗',f);
      console.error('   الخطأ:',String(e.message||e).slice(0,400));
      process.exit(1);
    }
  }
  console.log(`── اكتملت السلسلة في ${((Date.now()-t0)/1000).toFixed(1)} ثانية`);

  const ex=fs.readFileSync(path.join(here,'extract-live-schema.sql'),'utf8');
  const r=await db.query(ex);
  const out=r.rows.map(x=>({kind:x.kind,name:x.name,definition:x.definition}));
  const outPath=path.join(here,'schema-local.json');
  fs.writeFileSync(outPath, JSON.stringify(out,null,1));
  const byKind={}; out.forEach(o=>byKind[o.kind]=(byKind[o.kind]||0)+1);
  console.log('── المخطّط الناتج:',JSON.stringify(byKind),'→',outPath);
})().catch(e=>{console.error('FATAL:',e);process.exit(1)});
