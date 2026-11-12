// Guarda a "casca" do app para abrir rápido e mesmo sem sinal. Dados sempre vêm do servidor.
const CACHE="sc-v2";
const LIB="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";
const SHELL=["/","/index.html","/app.css?v=2","/app.js?v=2","/logo.svg","/manifest.webmanifest","/icon-192.png","/icon-512.png","/apple-touch-icon.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll([...SHELL,LIB])).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=="GET")return;
  if(e.request.url===LIB){e.respondWith(caches.match(LIB).then(r=>r||fetch(e.request)));return}
  if(u.origin!==location.origin)return;
  // rede primeiro (pega versões novas), cache se estiver sem sinal
  e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(CACHE).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match("/index.html"))));
});
