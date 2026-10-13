// 驾驶舱保护：仅聚合已有事实，三路读取失败隔离，不写入数据库或调用行动完成。
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import net from 'node:net';
import vm from 'node:vm';
import {questPreview,skillPreview,outcomePreview} from '../public/genesis-dashboard-model.mjs';
import {skillStatuses} from '../public/genesis-skill-model.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url),Database=require('better-sqlite3');
const q=(id,at,status='not_started')=>({id,title:'测试使命 '+id,at,status,minutes:20});
const home={readonly:true,identity:{name:null,route:null},goal:null,capabilities:[],questBuilder:{available:true},training:{available:true,today:{quests:[q('late','21:00'),q('free',null),q('morning','08:00','completed'),q('noon','12:00','in_progress')],done:1,total:4,inProgress:1}},recent:[],projects:[],assets:[]};
const skills={available:true,skills:[{id:'root',name:'工程',parent_id:null,status:'learning',updated_at:'2026-10-11'},{id:'child',name:'接口',parent_id:'root',status:'practicing',updated_at:'2026-10-14'},{id:'body',name:'身体',parent_id:null,status:'not_started',updated_at:'2026-10-12'},{id:'product',name:'产品',parent_id:null,status:'mastered',updated_at:'2026-10-13'},{id:'life',name:'生活',parent_id:null,status:'practicing',updated_at:'2026-10-10'}],links:[],options:{goal:[],quest:[],project:[],asset:[]}};
const vault={projects:[{id:'p1',name:'旧项目',status:'active',updated_at:'2026-10-01'},{id:'p2',name:'最新项目',status:'completed',updated_at:'2026-10-12'}],assets:[{id:'a1',title:'旧资产',content:'内容',updated_at:'2026-10-01'},{id:'a2',title:'最新资产',content:'完整内容',updated_at:'2026-10-13'}],growthRecords:[],summary:{}};
const original=JSON.stringify({home,skills,vault});
assert.deepEqual(questPreview(home).quests.map(q=>q.id),['morning','noon','late']);assert.equal(questPreview(home).done,1);
assert.equal(questPreview({...home,questBuilder:{available:false}}).available,false,'不读取旧计划作为首页使命');
assert.equal(questPreview({...home,training:{available:true,today:{quests:[],done:0,total:0,inProgress:0}}}).state,'尚无今日使命');
assert.deepEqual(skillPreview(skills).map(s=>[s.id,s.status]),[['product','mastered'],['body','not_started'],['root','learning']]);
assert.deepEqual(outcomePreview(vault).projects.map(p=>p.id),['p2','p1']);assert.deepEqual(outcomePreview(vault).assets.map(a=>a.id),['a2','a1']);
assert.throws(()=>skillPreview({...skills,skills:[{...skills.skills[0],parent_id:'root'}]}),/循环/);
assert.equal(JSON.stringify({home,skills,vault}),original);
const cloudSource=await readFile(resolve(root,'public/genesis-cloud.js'),'utf8');
const {readCockpit,readCockpitSection}=await import('data:text/javascript;base64,'+Buffer.from(cloudSource).toString('base64'));
const actualFetch=globalThis.fetch;globalThis.location={href:''};
const fixture=path=>path.endsWith('/home')?home:path.endsWith('/skills')?skills:vault;
try {
 for(const failing of ['home','skills','dashboard']) {
  const calls=[];globalThis.fetch=async(path,options)=>{calls.push(path);assert.equal(options.method,'GET');return path.endsWith('/'+failing)?new Response(JSON.stringify({error:'模拟单区域失败'}),{status:503}):new Response(JSON.stringify(fixture(path)));};
  const results=await readCockpit();assert.equal(calls.length,3);
  for(const [section,result] of Object.entries(results))assert.equal(Boolean(result.error),(section==='vault'?'dashboard':section)===failing,'失败不得传播到其他区域');
 }
 let release;const delivered=[];
 globalThis.fetch=async(path)=>path.endsWith('/home')?await new Promise(resolve=>{release=()=>resolve(new Response(JSON.stringify(home)));}):new Response(JSON.stringify(fixture(path)));
 const delayed=readCockpit(section=>{delivered.push(section);});await new Promise(setImmediate);assert.deepEqual(delivered.sort(),['skills','vault'],'慢接口不能阻塞已完成区域');release();await delayed;
 globalThis.fetch=async()=>new Response('{}');assert.match((await readCockpitSection('home')).error,/不完整/);
 globalThis.fetch=async()=>{throw new TypeError('offline');};assert.match((await readCockpitSection('skills')).error,/网络/);
 globalThis.fetch=async()=>new Response('{bad');assert.match((await readCockpitSection('vault')).error,/无法解析/);
 globalThis.fetch=async()=>new Response(JSON.stringify({error:'未启用'}),{status:404});assert.equal((await readCockpitSection('skills')).unavailable,true);
 globalThis.fetch=async()=>new Response('Not Found',{status:404});assert.equal((await readCockpitSection('skills')).unavailable,true);
 globalThis.fetch=async()=>new Response('{}',{status:401});assert.match((await readCockpitSection('home')).error,/登录/);assert.equal(globalThis.location.href,'/login.html');
} finally {globalThis.fetch=actualFetch;delete globalThis.location;}

// 实际展示函数：转义、100 次重复渲染、不调用 fetch 或行动写入函数。
const source=await readFile(resolve(root,'public/genesis-dashboard.js'),'utf8'),nodes=new Map();
const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:'',dataset:{},children:[],replaceChildren(){this.children=[];},append(...items){this.children.push(...items);},addEventListener(){}});return nodes.get(id);};
const context=vm.createContext({document:{getElementById:node,createElement:()=>({dataset:{}})},window:{genesisLabel:v=>v,genesisFormatDate:v=>v||'待确认'},questPreview,skillPreview,outcomePreview,skillStatuses,fetch:()=>{throw Error('摘要渲染禁止请求');}});
vm.runInContext(source.replace(/^import .*;$/mg,'').replace(/\bexport /g,'')+'\nglobalThis.display={renderDashboardHome,renderDashboardSkills,renderDashboardOutcomes,dashboardFeedback};',context);
context.display.dashboardFeedback('home',{error:'首次读取失败'});assert.match(node('growthIdentitySource').textContent,/暂时无法读取/);assert.equal(node('dashboardSkillList').innerHTML,'','角色失败不能改写技能区域');
const malicious={...home,training:{...home.training,today:{...home.training.today,quests:[{...q('x','08:00'),title:'<script>alert(1)</script>'}]}}};
context.display.renderDashboardHome(malicious);assert.match(node('dashboardQuestList').innerHTML,/&lt;script&gt;/);assert.ok(!/data-action-id|完成使命|progressbar/.test(node('dashboardQuestList').innerHTML));
for(let i=0;i<100;i++){context.display.renderDashboardHome(home);context.display.renderDashboardSkills(skills);context.display.renderDashboardOutcomes(vault);}assert.equal(JSON.stringify({home,skills,vault}),original);
const savedHtml=node('dashboardSkillList').innerHTML;context.display.dashboardFeedback('skills',{error:'断网'});assert.equal(node('dashboardSkillList').innerHTML,savedHtml);assert.equal(node('dashboardSkillFeedback').children[1].dataset.dashboardRetry,'skills');

// 真实本地三接口链路与全库快照对比。
const dir=await mkdtemp(resolve(tmpdir(),'genesis-dashboard-test-')),dbPath=resolve(dir,'test.sqlite');
const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});});
const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),DB_PATH:dbPath,APP_PASSWORD:'dashboard-test-password',SESSION_SECRET:'dashboard-test-session',DISABLE_REMINDERS:'1',GENESIS_ENABLE_QUEST_BUILDER:'1',GENESIS_ENABLE_SKILL_TREE:'1'},stdio:'ignore'});
let db;
try {
 const base='http://127.0.0.1:'+port;let ready=false;for(let i=0;i<100;i++){try{if((await actualFetch(base+'/healthz')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
 const login=await actualFetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'dashboard-test-password'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
 db=new Database(dbPath);const at='2026-10-13T00:00:00.000Z';
 db.prepare('INSERT INTO genesis_profile_items(id,profile_key,value_json,confidence,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('name','display_name',JSON.stringify('隔离测试角色'),'user_stated',at,at);
 db.prepare('INSERT INTO genesis_goals(id,title,created_at,updated_at) VALUES(?,?,?,?)').run('goal','隔离测试目标',at,at);
 db.prepare('INSERT INTO genesis_projects(id,name,created_at,updated_at) VALUES(?,?,?,?)').run('project','真实接口验收项目',at,at);
 db.prepare('INSERT INTO genesis_assets(id,title,content,created_at,updated_at) VALUES(?,?,?,?,?)').run('asset','真实接口验收资产','保存已有经验',at,at);
 db.prepare('INSERT INTO genesis_skills(id,name,status,created_at,updated_at) VALUES(?,?,?,?,?)').run('skill','手动路线','learning',at,at);
 db.prepare('INSERT INTO genesis_quests(id,title,type,repeat,starts_on,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('quest','真实接口验收使命','study','daily','2026-10-13',at,at);
 const snapshot=()=>JSON.stringify(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all().map(t=>[t.name,t.sql,db.prepare('SELECT * FROM "'+t.name+'" ORDER BY rowid').all()]));
 const before=snapshot();let reads=0;
 globalThis.fetch=(path,options)=>{assert.equal(options.method,'GET');reads++;return actualFetch(base+path,{...options,headers:{Cookie:cookie}});};
 for(let i=0;i<100;i++){const result=await readCockpit();assert.ok(Object.values(result).every(value=>!value.error));assert.equal(result.home.value.identity.name.text,'隔离测试角色');assert.equal(skillPreview(result.skills.value)[0].status,'learning');assert.equal(outcomePreview(result.vault.value).assets[0].id,'asset');assert.equal(questPreview(result.home.value).total,1);}
 assert.equal(reads,300);assert.equal(snapshot(),before,'100次首页读取不能改变任何表结构或业务记录');
 console.log('Dashboard 2.0：真实三接口100次只读、失败与慢请求隔离、单区域重试、空状态、手动技能标签、时间排序/最多3项、转义与纯渲染通过。');
} finally {globalThis.fetch=actualFetch;db?.close();child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));assert.ok(dir.startsWith(resolve(tmpdir(),'genesis-dashboard-test-')));await rm(dir,{recursive:true,force:true});}
