// PWA 安全边界：只缓存公共文件，鉴权与隐私 API 保持联网，安装不改业务数据。
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,mkdtemp,rm,access} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import worker from '../worker/index.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url),Database=require('better-sqlite3');
const source=await readFile(resolve(root,'public/sw.js'),'utf8'),bootstrap=await readFile(resolve(root,'public/genesis-pwa.js'),'utf8');
const manifest=JSON.parse(await readFile(resolve(root,'public/manifest.json'),'utf8'));
assert.equal(manifest.name,'Genesis AI');assert.equal(manifest.short_name,'Genesis');assert.equal(manifest.display,'standalone');assert.equal(manifest.id,'/');assert.equal(manifest.start_url,'/');assert.equal(manifest.scope,'/');assert.equal(manifest.theme_color,'#0c0d0f');assert.equal(manifest.background_color,'#0c0d0f');
for(const [path,size] of [['icon-192.png',192],['icon-512.png',512],['apple-touch-icon.png',180]]){const png=await readFile(resolve(root,'public',path));assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);assert.equal(png[25],2,'安装图标使用不透明背景');}
for(const file of ['growth.html','index.html','login.html','setup.html']){const html=await readFile(resolve(root,'public',file),'utf8');assert.match(html,/rel="manifest" href="\/manifest.json"/);assert.match(html,/name="apple-mobile-web-app-capable" content="yes"/);assert.match(html,/apple-touch-icon/);assert.match(html,/genesis-pwa\.js\?v=1/);}
assert.equal(await readFile(resolve(root,'public/growth.html'),'utf8'),await readFile(resolve(root,'public/index.html'),'utf8'));
const mime=path=>path.endsWith('.html')?'text/html':path.endsWith('.json')?'application/json':path.endsWith('.js')||path.endsWith('.mjs')?'application/javascript':path.endsWith('.css')?'text/css':path.endsWith('.svg')?'image/svg+xml':path.endsWith('.woff2')?'font/woff2':'image/png';
function harness(fetcher){
 const events={},stores=new Map(),removed=[],calls=[];let claimed=0,skipped=0;
 const store=name=>{if(!stores.has(name))stores.set(name,new Map());const rows=stores.get(name);return {match:async key=>rows.get(typeof key==='string'?key:key.url)?.clone(),put:async(key,value)=>{rows.set(typeof key==='string'?key:key.url,value.clone());}};};
 const caches={open:async name=>store(name),keys:async()=>[...stores.keys()],delete:async name=>{removed.push(name);return stores.delete(name);},match:async(key,options)=>store(options.cacheName).match(key)};
 const self={location:{origin:'https://genesis.test'},skipWaiting:async()=>{skipped++;},clients:{claim:async()=>{claimed++;}},addEventListener(name,callback){events[name]=callback;}};
 const context=vm.createContext({self,caches,URL,Response,fetch:async(input,options)=>{calls.push([typeof input==='string'?input:input.url,options]);return fetcher(input,options);}});
 vm.runInContext(source+'\nglobalThis.pwa={CACHE,STATIC_URLS,cacheable};',context);
 const path=input=>new URL(typeof input==='string'?input:input.url,'https://genesis.test').pathname;
 async function lifecycle(name){let pending;events[name]({waitUntil(value){pending=value;}});return pending;}
 function fetchEvent(url,options={}){let response;events.fetch({request:{url:new URL(url,'https://genesis.test').href,method:options.method||'GET',mode:options.mode||'same-origin',headers:new Headers(options.headers)},respondWith(value){response=value;}});return response;}
 return {events,stores,removed,calls,path,lifecycle,fetchEvent,pwa:context.pwa,get claimed(){return claimed;},get skipped(){return skipped;}};
}
let offline=false,override=null;
const h=harness(async input=>{if(offline)throw Error('offline');const path=h.path(input);return override?override(path):new Response('public:'+path,{headers:{'Content-Type':mime(path)}});});
await h.lifecycle('install');assert.equal(h.skipped,1);assert.equal(h.calls.length,h.pwa.STATIC_URLS.length);
for(const [path,options] of h.calls){assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.ok(!path.startsWith('/api/'));await access(resolve(root,'public',path.slice(1)));}
assert.deepEqual([...h.pwa.STATIC_URLS.filter(path=>path.endsWith('.html'))],['/offline.html']);
h.stores.set('forge-v233',new Map([['/old-private',new Response('old')]]));h.stores.set('genesis-pwa-v0',new Map());h.stores.set('another-app-cache',new Map());await h.lifecycle('activate');assert.equal(h.claimed,1);assert.deepEqual(h.removed.sort(),['forge-v233','genesis-pwa-v0']);assert.ok(h.stores.has('another-app-cache'));
const before=h.stores.get(h.pwa.CACHE).size;
for(const path of ['/api/genesis/home','/api/genesis/quests','/api/genesis/skills','/api/genesis/dashboard','/api/login','/api/logout','/private-note.json','/uploads/person.png','/genesis-home.js?token=secret','https://other.test/icon-192.png'])assert.equal(h.fetchEvent(path),undefined);
assert.equal(h.fetchEvent('/genesis-home.js',{method:'POST'}),undefined);assert.equal(h.fetchEvent('/genesis-home.js',{headers:{Authorization:'Bearer private'}}),undefined);assert.equal(h.fetchEvent('/icon-192.png',{headers:{Range:'bytes=0-10'}}),undefined);
override=()=>new Response('login',{status:302,headers:{Location:'/login.html','Content-Type':'text/html'}});assert.equal((await h.fetchEvent('/',{mode:'navigate'})).status,302);assert.equal(h.stores.get(h.pwa.CACHE).size,before);
for(const headers of [{'Cache-Control':'private'},{'Cache-Control':'no-store'},{'Set-Cookie':'private=session'},{Vary:'Cookie'},{Vary:'Authorization'},{'Content-Type':'text/html'}]){override=()=>new Response('MUST NOT CACHE',{headers:{'Content-Type':'application/javascript',...headers}});await h.fetchEvent('/genesis-home.js');assert.equal(await h.stores.get(h.pwa.CACHE).get('/genesis-home.js').clone().text(),'public:/genesis-home.js');}
override=null;offline=true;
assert.equal(await (await h.fetchEvent('/genesis-home.js?v=9')).text(),'public:/genesis-home.js');assert.equal(await (await h.fetchEvent('/',{mode:'navigate'})).text(),'public:/offline.html');
h.stores.get(h.pwa.CACHE).delete('/offline.html');const fallback=await (await h.fetchEvent('/index.html',{mode:'navigate'})).text();assert.match(fallback,/未确认/);assert.ok(!fallback.includes('old-private'));
const bad=harness(async input=>new Response('not a script',{status:404,headers:{'Content-Type':mime(new URL(input,'https://genesis.test').pathname)}}));await assert.rejects(bad.lifecycle('install'),/准备失败/);assert.equal(bad.skipped,0);
// 缓存空间不可用时仍返回在线静态文件，不能把存储失败误报为网络失败。
const noCacheHandlers={};vm.runInNewContext(source,{URL,Response,self:{location:{origin:'https://genesis.test'},addEventListener(name,callback){noCacheHandlers[name]=callback;}},caches:{open:async()=>{throw Error('cache blocked');},match:async()=>{throw Error('cache blocked');}},fetch:async()=>new Response('online script',{headers:{'Content-Type':'application/javascript'}})});
let noCacheResponse;noCacheHandlers.fetch({request:{url:'https://genesis.test/genesis-pwa.js',method:'GET',mode:'same-origin',headers:new Headers()},respondWith(value){noCacheResponse=value;}});assert.equal(await (await noCacheResponse).text(),'online script');

// 浏览器引导：注册/独立窗口/安装事件可验证，不把模拟事件当作手机实机安装。
function bootstrapHarness({standalone=false,ios=false,reject=false}={}) {
 const listeners={},buttons={},status={textContent:''},button={hidden:true,disabled:false,addEventListener(name,callback){buttons[name]=callback;}},registrations=[];
 const context=vm.createContext({document:{getElementById:id=>id==='genesisInstall'?button:status},window:{isSecureContext:true,matchMedia:()=>({matches:standalone,addEventListener(){}}),addEventListener(name,callback){listeners[name]=callback;}},navigator:{standalone:ios,serviceWorker:{register:async(...args)=>{registrations.push(args);if(reject)throw Error('registration failed');return {};}}},console:{warn(){}}});
 vm.runInContext(bootstrap,context);return {listeners,buttons,button,status,registrations};
}
const guide=bootstrapHarness();assert.equal(guide.button.hidden,true);assert.equal(guide.registrations.length,0);guide.listeners.load();await new Promise(setImmediate);assert.equal(guide.registrations[0][0],'/sw.js');assert.equal(guide.registrations[0][1].updateViaCache,'none');
let prompts=0;guide.listeners.beforeinstallprompt({preventDefault(){},async prompt(){prompts++;},userChoice:Promise.resolve({outcome:'accepted'})});assert.equal(prompts,0);assert.equal(guide.button.hidden,false);await guide.buttons.click();assert.equal(prompts,1);assert.match(guide.status.textContent,/接受安装请求/);assert.ok(!guide.status.textContent.includes('已安装'));guide.listeners.appinstalled();assert.match(guide.status.textContent,/已安装/);
for(const options of [{standalone:true},{ios:true}]){const state=bootstrapHarness(options);assert.equal(state.button.hidden,true);assert.match(state.status.textContent,/独立应用窗口/);}
const failed=bootstrapHarness({reject:true});failed.listeners.load();await new Promise(setImmediate);assert.match(failed.status.textContent,/网页仍可正常使用/);

// Cloudflare 静态打包与公共文件头；不访问远程账号或 D1。
execFileSync(process.execPath,['scripts/build-genesis-cloud.mjs'],{cwd:root,stdio:'ignore'});
for(const path of h.pwa.STATIC_URLS)await access(resolve(root,'.genesis-cloud-assets',path.slice(1)));
const staticEnv={ASSETS:{fetch:async request=>{const path=new URL(request.url).pathname;return new Response(await readFile(resolve(root,'.genesis-cloud-assets',path.slice(1))),{headers:{'Content-Type':mime(path)}});}},DB:{prepare(){throw Error('PWA 静态资源不能查询数据库');}}};
for(const path of ['/manifest.json','/sw.js','/offline.html','/icon-192.png','/icon-512.png','/apple-touch-icon.png','/genesis-pwa.js']){const response=await worker.fetch(new Request('https://genesis.test'+path),staticEnv);assert.equal(response.status,200);if(path==='/sw.js')assert.match(response.headers.get('Cache-Control'),/no-store/);if(path==='/offline.html')assert.match(response.headers.get('Cache-Control'),/public/);if(path==='/manifest.json')assert.match(response.headers.get('Cache-Control'),/no-cache/);}

// 本地 HTTP：刷新沿用现有会话；预缓存省略凭据；全库不变。
const dir=await mkdtemp(resolve(tmpdir(),'genesis-pwa-test-')),dbPath=resolve(dir,'test.sqlite');
const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const base='http://127.0.0.1:'+port,child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),DB_PATH:dbPath,APP_PASSWORD:'pwa-test-password',SESSION_SECRET:'pwa-test-session',DISABLE_REMINDERS:'1'},stdio:'ignore'});let db;
try {
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/healthz')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'pwa-test-password'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];db=new Database(dbPath);
 const snapshot=()=>JSON.stringify(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all().map(t=>[t.name,t.sql,db.prepare('SELECT * FROM "'+t.name+'" ORDER BY rowid').all()])),before=snapshot();
 const local=harness(async(input,options)=>fetch(base+new URL(typeof input==='string'?input:input.url,'https://genesis.test').pathname,{...options,...(typeof input==='string'?{}:{headers:input.headers})}));await local.lifecycle('install');
 for(let i=0;i<10;i++){const response=await local.fetchEvent('/',{mode:'navigate',headers:{Cookie:cookie}});assert.equal(response.status,200);assert.match(await response.text(),/genesis-pwa.js/);assert.equal(local.stores.get(local.pwa.CACHE).has('/'),false);}
 assert.equal((await local.fetchEvent('/',{mode:'navigate'})).redirected,true,'退出登录后仍尊重服务器登录跳转');
 assert.equal(snapshot(),before);assert.equal((await fetch(base+'/sw.js')).headers.get('Cache-Control'),'no-store, must-revalidate');
 console.log('Genesis PWA：Manifest/图标/Apple接入、独立窗口和安装事件引导、公共预缓存/离线静态回退、API/隐私/未知资源拒绝缓存、旧静态缓存淘汰、云端静态打包与响应头、本地刷新登录保持及全库不变通过。Android/iOS实机安装仍待手机验证。');
}finally{db?.close();child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));assert.ok(dir.startsWith(resolve(tmpdir(),'genesis-pwa-test-')));await rm(dir,{recursive:true,force:true});}
