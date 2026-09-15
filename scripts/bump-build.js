#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   bump-build.js — ختم بصمة الإصدار قبل النشر (بلا أدوات بناء)

   الاستخدام من جذر المستودع:
     node scripts/bump-build.js            # بصمة بتاريخ+وقت الآن
     node scripts/bump-build.js 20260915-1015   # بصمة محددة

   ماذا يفعل:
     1) يحسب BUILD (YYYYMMDD-HHMM)
     2) app.js   : APP_BUILD = 'b<BUILD>'
     3) index.html: app.css?v=<BUILD> و app.js?v=<BUILD>
     4) sw.js    : BUILD و CACHE = 'benamor-pos-<BUILD>'
     5) ينسخ الملفات الأربعة إلى updated-html-files/benamor-sales-system/
     6) عارض الأسعار (ملف واحد): PC_BUILD='b<BUILD>' + ?v=<BUILD> على
        manifest/apple-touch-icon + CACHE='benamor-pricechecker-<BUILD>'
        في sw.js الخاص به
     7) ينسخ pricechecker/index.html + sw.js إلى updated-html-files/pricechecker/
   القاعدة: البصمة نفسها في الأمكنة كلها — كاش واحد، صفحة تشير
   للأصل الجديد، والـSW يطابق.
   ═══════════════════════════════════════════════════════════════════ */
const fs=require('fs'), path=require('path');
const APP='new discussion github/apps/pos/benamor-sales-system';
const OUT='new discussion github/updated-html-files/benamor-sales-system';

function stamp(text,from,to){ const rx=(from instanceof RegExp)?from:new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')); if(!rx.test(text)) throw new Error('لم أجد: '+from); return text.replace(rx,to); }

const BUILD=process.argv[2]||new Date(Date.now()-new Date().getTimezoneOffset()*60000+3*3600000 /* توقيت ليبيا UTC+3 */).toISOString().slice(0,16).replace(/[-:T]/g,m=>m==='T'?'-':'').replace('-','').replace(/(\d{8})(\d{4})/,'$1-$2');
if(!/^\d{8}-\d{4}$/.test(BUILD)){ console.error('صيغة البصمة يجب أن تكون YYYYMMDD-HHMM'); process.exit(1); }

const appPath=path.join(APP,'app.js');
let app=fs.readFileSync(appPath,'utf8');
app=stamp(app, /const APP_BUILD='[^']*';/, `const APP_BUILD='b${BUILD}';`);

const idxPath=path.join(APP,'index.html');
let idx=fs.readFileSync(idxPath,'utf8');
idx=idx.replace(/app\.css\?v=\d{8}-\d{4}/,`app.css?v=${BUILD}`).replace(/app\.js\?v=\d{8}-\d{4}/,`app.js?v=${BUILD}`);
if(!idx.includes(`?v=${BUILD}`)){ /* توافق مع الوسوم القديمة بلا بصمة */
  idx=stamp(idx,'href="app.css">',`href="app.css?v=${BUILD}">`).replace('<script src="app.js"></script>',`<script src="app.js?v=${BUILD}"></script>`);
}

const swPath=path.join(APP,'sw.js');
let sw=fs.readFileSync(swPath,'utf8');
sw=stamp(sw,/const BUILD='\d{8}-\d{4}';/,`const BUILD='${BUILD}';`);

fs.writeFileSync(appPath,app);
fs.writeFileSync(idxPath,idx);
fs.writeFileSync(swPath,sw);
fs.mkdirSync(OUT,{recursive:true});
['app.js','index.html','sw.js','app.css'].forEach(f=>fs.copyFileSync(path.join(APP,f),path.join(OUT,f)));
console.log('✓ البصمة الجديدة: '+BUILD);
console.log('  APP_BUILD=b'+BUILD+' · app.js?v='+BUILD+' · benamor-pos-'+BUILD);
console.log('✓ نُسخ app.js/index.html/sw.js/app.css إلى updated-html-files');

/* ── عارض الأسعار: بصمة مستقلة (PC_BUILD + ?v= + كاش SW) ── */
const PCAPP='new discussion github/apps/pricechecker';
const PCOUT='new discussion github/updated-html-files/pricechecker';
let pc=fs.readFileSync(path.join(PCAPP,'index.html'),'utf8');
pc=stamp(pc,/const PC_BUILD='[^']*';/,`const PC_BUILD='b${BUILD}';`);
pc=pc.replace(/manifest\.webmanifest\?v=\d{8}-\d{4}/,'manifest.webmanifest?v='+BUILD)
     .replace(/icons\/icon-192\.png\?v=\d{8}-\d{4}/,'icons/icon-192.png?v='+BUILD);
if(!pc.includes('manifest.webmanifest?v='+BUILD)) throw new Error('pricechecker: لم تُختم روابط الأصول');
let pcsw=fs.readFileSync(path.join(PCAPP,'sw.js'),'utf8');
pcsw=stamp(pcsw,/const CACHE='benamor-pricechecker[^']*';/,"const CACHE='benamor-pricechecker-"+BUILD+"';");
fs.writeFileSync(path.join(PCAPP,'index.html'),pc);
fs.writeFileSync(path.join(PCAPP,'sw.js'),pcsw);
fs.mkdirSync(PCOUT,{recursive:true});
fs.copyFileSync(path.join(PCAPP,'index.html'),path.join(PCOUT,'index.html'));
fs.copyFileSync(path.join(PCAPP,'sw.js'),path.join(PCOUT,'sw.js'));
console.log('✓ العارض: PC_BUILD=b'+BUILD+' · ?v='+BUILD+' · benamor-pricechecker-'+BUILD);
console.log('✓ نُسخ pricechecker/index.html + sw.js إلى updated-html-files/pricechecker');
