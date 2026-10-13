/* Genesis PWA：仅缓存明确列出的公共文件；成长页面和所有 API 始终走网络。 */
const CACHE='genesis-pwa-v3';
const STATIC_URLS=[
 '/offline.html','/manifest.json','/icon-192.png','/icon-512.png','/apple-touch-icon.png','/favicon.png','/genesis-icon.svg',
 '/genesis-pwa.js','/login.js','/genesis-home.js','/genesis-home-model.mjs','/genesis-cloud.js','/genesis-dashboard.js','/genesis-dashboard-model.mjs',
 '/genesis-action-model.mjs','/genesis-action-view.mjs','/genesis-actions.js','/genesis-character.js','/effigy.js','/forge-stage.js','/genesis-quest-stage.js',
 '/genesis-quest-builder.js','/genesis-quest-history.js','/genesis-editor.js','/genesis-skills.js','/genesis-skill-model.mjs','/genesis-growth-tree.mjs','/genesis-vault.js',
 '/css/01-tokens.css','/css/02-base.css','/css/03-components.css','/css/07-genesis.css','/css/08-growth-home.css','/css/09-genesis-actions.css',
 '/css/10-genesis-fusion.css','/css/11-genesis-workshop.css','/css/12-genesis-skills.css','/css/13-genesis-dashboard.css','/css/14-genesis-growth-tree.css',
 '/fonts/outfit-400.woff2','/fonts/outfit-700.woff2','/fonts/outfit-900.woff2','/fonts/inter-400.woff2','/fonts/inter-500.woff2',
 '/fonts/inter-600.woff2','/fonts/inter-700.woff2','/fonts/inter-800.woff2','/fonts/inter-900.woff2'
];
const PUBLIC=new Set(STATIC_URLS);
const OFFLINE_HTML='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Genesis AI · 暂时离线</title><body style="background:#0c0d0f;color:#eeeae3;font-family:system-ui;padding:24px"><h1>Genesis AI · 暂时离线</h1><p>请联网后重新打开。未确认的行动操作不会显示为完成。</p><a href="/" style="color:#e4ae67">重新连接</a></body>';
function cacheable(response,path) {
 if(!response.ok||response.status!==200||response.redirected||['opaque','opaqueredirect','error'].includes(response.type))return false;
 if(/(?:no-store|private)/i.test(response.headers.get('Cache-Control')||'')||response.headers.has('Set-Cookie'))return false;
 if(/(?:cookie|authorization|\*)/i.test(response.headers.get('Vary')||''))return false;
 const type=(response.headers.get('Content-Type')||'').split(';')[0].trim();
 return path.endsWith('.html')?type==='text/html':path.endsWith('.json')?['application/json','application/manifest+json'].includes(type):/\.m?js$/.test(path)?['application/javascript','text/javascript'].includes(type):path.endsWith('.css')?type==='text/css':path.endsWith('.woff2')?['font/woff2','application/font-woff2'].includes(type):path.endsWith('.svg')?type==='image/svg+xml':type==='image/png';
}
function publicPath(request,url) {
 if(!PUBLIC.has(url.pathname)||request.headers?.get('Authorization')||request.headers?.get('Range'))return false;
 return [...url.searchParams].every(([key,value])=>key==='v'&&/^[\w.-]{1,40}$/.test(value));
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 await Promise.all(STATIC_URLS.map(async path=>{
  const response=await fetch(path,{credentials:'omit',cache:'reload',redirect:'error'});
  if(!cacheable(response,path))throw Error('公共资源准备失败');
  await cache.put(path,response);
 }));
 await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 // 只淘汰已知静态缓存；不触及 Cookie、localStorage、IndexedDB 或业务数据库。
 const keys=await caches.keys();
 await Promise.all(keys.filter(key=>key!==CACHE&&(/^genesis-pwa-v\d+$/.test(key)||/^forge-v\d+$/.test(key))).map(key=>caches.delete(key)));
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
 if(request.mode==='navigate') {
  // 在线始终尊重登录跳转；离线只显示不含个人信息的公共说明。
  event.respondWith(fetch(request).catch(async()=>{
   try {const offline=await caches.match('/offline.html',{cacheName:CACHE});if(offline)return offline;}catch{}
   return new Response(OFFLINE_HTML,{headers:{'Content-Type':'text/html; charset=utf-8'}});
  }));
  return;
 }
 if(!publicPath(request,url))return;
 event.respondWith((async()=>{
  let cache,hit;try{cache=await caches.open(CACHE);hit=await cache.match(url.pathname);}catch{}
  try {
   const response=await fetch(request);
   if(cache&&cacheable(response,url.pathname))try{await cache.put(url.pathname,response.clone());}catch{}
   return response;
  } catch {return hit||new Response('公共资源暂时不可用',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});}
 })());
});
// 沿用已有通知能力；PWA 不主动订阅推送或申请权限。
self.addEventListener('push',event=>{
 let data={};try{data=event.data?event.data.json():{};}catch{}
 event.waitUntil(self.registration.showNotification(data.title||'Genesis AI',{body:data.body||'',icon:'/icon-192.png',badge:'/icon-192.png',tag:data.tag||'forge',data:{url:data.url||'/'}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();const url=event.notification.data?.url||'/';
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{
  for(const window of windows)if('focus' in window)return window.focus();
  if(self.clients.openWindow)return self.clients.openWindow(url);
 }));
});
