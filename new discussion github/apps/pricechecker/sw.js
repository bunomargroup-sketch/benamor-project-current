const CACHE='benamor-pricechecker-v1';
const CORE=['./','./index.html','./admin.html','./admin-shop.html','./shop/','./shop/index.html','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE).catch(()=>{})))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const req=e.request; if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(req.mode==='navigate'||req.headers.get('accept')?.includes('text/html')){
    e.respondWith(fetch(req).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy));return r}).catch(()=>caches.match(req).then(r=>r||caches.match('./index.html')))); return;
  }
  if(url.origin===location.origin){
    e.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy));return r}).catch(()=>cached)));
  }
});
