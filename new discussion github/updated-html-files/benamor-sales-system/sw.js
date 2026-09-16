/* ═══════════════════════════════════════════════════════════════════
   Benamor POS — Service Worker
   البصمة تُحدَّث تلقائياً بسكربت النشر scripts/bump-build.js — لا تدوياً
   ═══════════════════════════════════════════════════════════════════
   الاستراتيجية:
   • index.html (التنقل) + app.js + app.css + manifest ⇒ NETWORK-FIRST:
     النسخة الجديدة تظهر من التحميل الأول بعد أي نشر، والكاش احتياط
     عند انقطاع الإنترنت فقط (بمطابقة تتجاهل ?v= كي لا يخوننا الإصدار).
   • الأيقونات/الصور/الخطوط المحلية ⇒ stale-while-revalidate (سرعة فتح).
   • sw.js نفسها: المتصفح يفحصها من الشبكة في كل تنقل (سلوكه الافتراضي)
     فلا تُدار من هنا أصلاً.
   • install: skipWaiting فوراً · activate: حذف كل كاش لا يساوي الإصدار
     الحالي + clients.claim + إبلاغ الصفحات «صدر تحديث» لتعرض شريط
     إعادة التحميل (بلا إعادة تحميل تلقائية — الفاتورة المفتوحة أغلى).
   ═══════════════════════════════════════════════════════════════════ */
const BUILD='20260916-1253'; /* يُستبدل بسكربت النشر */
const CACHE='benamor-pos-'+BUILD;
const CORE=['./','./index.html','./app.css','./app.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
const NETWORK_FIRST_PATHS=['/app.js','/app.css','/index.html','/manifest.webmanifest']; /* + كل طلب تنقل */

self.addEventListener('install',e=>{
  self.skipWaiting(); /* فعّل النسخة الجديدة فوراً — لا انتظار إغلاق التبويبات */
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE).catch(()=>{})));
});

self.addEventListener('activate',e=>{
  e.waitUntil((async()=>{
    /* كاش واحد فقط: الإصدار الحالي — كل ما عداه يُحذف */
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
    /* أبلغ كل الصفحات المفتوحة (حتى غير المسيطَر عليها) بصدور تحديث */
    const cs=await self.clients.matchAll({includeUncontrolled:true});
    cs.forEach(c=>{ try{ c.postMessage({type:'SW_UPDATED',build:BUILD}); }catch(err){} });
  })());
});

function isNetworkFirst(req,url){
  return req.mode==='navigate' || NETWORK_FIRST_PATHS.includes(url.pathname) || url.pathname==='/';
}
async function networkFirst(req){
  const cache=await caches.open(CACHE);
  try{
    const res=await fetch(req);
    if(res && res.ok) cache.put(req,res.clone()); /* حدّث الكاش للعمل دون اتصال */
    return res;
  }catch(err){
    /* الشبكة ساقطة ⇒ الكاش (تجاهل ?v= كي يخدم أي إصدار مخزّن) */
    const cached=await cache.match(req,{ignoreSearch:true});
    if(cached) return cached;
    if(req.mode==='navigate'){
      const idx=await cache.match('./index.html',{ignoreSearch:true});
      if(idx) return idx;
    }
    throw err;
  }
}
async function staleWhileRevalidate(req){
  const cache=await caches.open(CACHE);
  const cached=await cache.match(req,{ignoreSearch:true});
  const network=fetch(req).then(res=>{ if(res&&res.ok) cache.put(req,res.clone()); return res; }).catch(()=>cached);
  return cached||network;
}
self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);
  if(url.origin!==location.origin) return; /* خطوط جوجل وغيرها: المتصفح مباشرة */
  if(isNetworkFirst(req,url)){ e.respondWith(networkFirst(req)); return; }
  e.respondWith(staleWhileRevalidate(req));
});
