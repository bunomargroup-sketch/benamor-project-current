#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   compare-schemas.js — مقارنة مخطّطين واستخراج الفروق
   الاستخدام:
     node supabase/compare-schemas.js <مخطّط-أ> <مخطّط-ب>
   حيث كل ملف إما:
     • JSON  (نتيجة local-verify.js: schema-local.json)
     • CSV   (تنزيل Supabase SQL Editor من extract-live-schema.sql)
   المخرجات: الكائنات الناقصة/الزائدة في كل جهة + الكائنات المختلفة التعريف،
   مع تطبيع المسافات (يختلف تنسيق النص بين إصدارات Postgres بلا معنى).
   ═══════════════════════════════════════════════════════════════════ */
const fs=require('fs');

function parseCSV(text){
  const rows=[]; let row=[], field='', inQ=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(inQ){
      if(c==='"'){ if(text[i+1]==='"'){field+='"';i++;} else inQ=false; }
      else field+=c;
    }else{
      if(c==='"') inQ=true;
      else if(c===','){ row.push(field); field=''; }
      else if(c==='\n'){ row.push(field); rows.push(row); row=[]; field=''; }
      else if(c==='\r'){}
      else field+=c;
    }
  }
  if(field!==''||row.length){ row.push(field); rows.push(row); }
  const hdr=rows.shift();
  const idx={}; (hdr||[]).forEach((h,i)=>idx[h.trim()]=i);
  const g=k=>idx[k]!==undefined?idx[k]:null;
  const ki=g('kind'),ni=g('name'),di=g('definition');
  if(ki===null||ni===null) throw new Error('CSV بلا أعمدة kind/name — تأكد أنه ناتج extract-live-schema.sql');
  return rows.filter(r=>r.length>1).map(r=>({kind:r[ki],name:r[ni],definition:di!==null?(r[di]||''):''}));
}
function load(p){
  const t=fs.readFileSync(p,'utf8').trim();
  if(t.startsWith('[')) return JSON.parse(t);
  if(t.startsWith('{')) return JSON.parse(t).rows||JSON.parse(t);
  return parseCSV(t);
}
const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
/* إزالة ضجيج PG18: يُدرج قيود NOT NULL ضمن pg_constraint (الإنتاج 15/17 لا يفعل)
   — ليست انحرافاً حقيقياً بل فرق إصدار */
const normDef=s=>norm(s).replace(/NOT NULL [a-zA-Z_0-9]+;? ?/g,'').replace(/;\s*;+/g,';').replace(/;\s*"/g,'"').replace(/;\s*$/,'').replace(/"\s*,\s*"(\w+)":\s*"\s*"/g,'",\"$1\":\"\"');

const A=load(process.argv[2]), B=load(process.argv[3]);
if(!A.length||!B.length){ console.error('ملف فارغ أو غير صالح'); process.exit(2); }
const key=o=>o.kind+'|'+o.name;
const mapA=new Map(A.map(o=>[key(o),o])), mapB=new Map(B.map(o=>[key(o),o]));
const all=new Set([...mapA.keys(),...mapB.keys()]);
let onlyA=[],onlyB=[],diff=[];
for(const k of [...all].sort()){
  const a=mapA.get(k), b=mapB.get(k);
  if(a&&!b) onlyA.push(k);
  else if(!a&&b) onlyB.push(k);
  else if(normDef(a.definition)!==normDef(b.definition)) diff.push(k);
}
const label=process.argv[2].includes('live')?'الأول (الحي)':'الأول';
console.log(`═══ مقارنة المخطّطين ═══`);
console.log(`الأول: ${A.length} كائناً — الثاني: ${B.length} كائناً`);
console.log(`\n── فقط في ${label} (${onlyA.length}):`); onlyA.forEach(k=>console.log('  +',k));
console.log(`\n── فقط في الثاني (${onlyB.length}):`); onlyB.forEach(k=>console.log('  +',k));
console.log(`\n── موجودة في الاثنين بتعريف مختلف (${diff.length}):`);
diff.forEach(k=>{
  console.log('  ≠',k);
  const a=normDef(mapA.get(k).definition), b=normDef(mapB.get(k).definition);
  // أظهر أول اختلاف موجز
  let i=0; while(i<Math.min(a.length,b.length)&&a[i]===b[i]) i++;
  console.log('     الأول: …'+a.slice(Math.max(0,i-40),i+120).trim());
  console.log('     الثاني: …'+b.slice(Math.max(0,i-40),i+120).trim());
});
const clean=!onlyA.length&&!onlyB.length&&!diff.length;
console.log(clean?'\n✅ مطابقة كاملة (بعد تطبيع المسافات)':'\n⚠ فروق تحتاج مراجعة — الكائنات المعاد بناؤها (0037/pos_import_staging) متوقَّعة هنا');
process.exit(clean?0:1);
