import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
import vm from 'node:vm';
import { buildGrowthHome } from '../public/genesis-home-model.mjs';
import worker from '../worker/index.js';
const require = createRequire(import.meta.url), Database = require('better-sqlite3');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.crypto ??= webcrypto;
const empty = buildGrowthHome();
assert.equal(empty.identity.name, null);
assert.equal(empty.training.profile, undefined);
assert.equal(empty.training.today, null);
assert.equal(empty.training.streak, undefined);
assert.deepEqual(empty.capabilities, []);
const snapshot = {
  projects: [{ id:'p',name:'测试项目',status:'active',domain:'ai',evidence_json:'[{"path":"server.js","commit":"abc"}]' }],
  growthRecords: [{id:'r',project_id:'p',record_type:'reflection',metric_value:60,metric_unit:'minutes',evidence_json:'[{"note":"待确认"}]'}, {id:'r2',project_id:'p',record_type:'practice',metric_value:2,metric_unit:'hours',evidence_json:'[{"path":"server.js","commit":"abc"}]'}],
  assets:[{id:'a',project_id:'p',evidence_json:'[{"url":"https://example.test/source"}]'}],
};
const input = {snapshot,profileItems:[{profile_key:'current_stage',value_json:'"未经确认的阶段"',confidence:'inference'}]};
const before = JSON.stringify(input), out = buildGrowthHome(input);
assert.equal(JSON.stringify(input), before);
assert.equal(out.identity.stage,null);
assert.deepEqual(out.capabilities.map(c=>[c.projects,c.records,c.assets,c.evidence,c.practiceHours]),[[1,2,1,2,2]]);
const noHours = buildGrowthHome({snapshot:{...snapshot,growthRecords:snapshot.growthRecords.slice(0,1)}});
assert.equal(noHours.capabilities[0].practiceHours,null);
// 真实浏览器读取模块的网络/认证边界，不能伪称读取成功。
const {readGrowthHome}=await import('data:text/javascript;base64,'+Buffer.from(await readFile(resolve(root,'public/genesis-cloud.js'),'utf8')).toString('base64'));
const actualFetch=globalThis.fetch;
globalThis.location={href:''};
try {
  globalThis.fetch=async (_path,options)=>{assert.equal(options.method,'GET');return new Response(JSON.stringify(_path.endsWith('/home')?empty:{projects:[]}));};
  assert.equal((await readGrowthHome()).home.readonly,true);
  globalThis.fetch=async ()=>new Response('拒绝',{status:401});
  await assert.rejects(readGrowthHome(),/请先登录/);assert.equal(globalThis.location.href,'/login.html');
  globalThis.fetch=async ()=>{throw Error('网络不可用');};await assert.rejects(readGrowthHome(),/网络不可用/);
  globalThis.fetch=async ()=>new Response('不是 JSON');await assert.rejects(readGrowthHome(),/无法解析/);
  globalThis.fetch=async ()=>new Response('{}');await assert.rejects(readGrowthHome(),/结构不完整/);
} finally {globalThis.fetch=actualFetch;delete globalThis.location;}
const aliases=buildGrowthHome({snapshot:{projects:[...snapshot.projects,{id:'p2',domain:'ai_app'}]}});
assert.equal(aliases.capabilities.length,1);assert.equal(aliases.capabilities[0].projects,2);
const db = new Database(':memory:');
for(const migration of ['0001_genesis.sql','0002_genesis_connector.sql','0003_genesis_private_memory.sql']) db.exec(await readFile(resolve(root,'migrations',migration),'utf8'));
db.prepare("INSERT INTO genesis_projects(id,name,domain,created_at,updated_at) VALUES('p','测试项目','ai',?,?)").run('2026-01-01','2026-01-01');
db.prepare("INSERT INTO genesis_growth_records(id,project_id,title,recorded_at,created_at) VALUES('r','p','真实数据库查询测试',?,?)").run('2026-01-01','2026-01-01');
const sqlSnapshot = database => JSON.stringify(database.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all().map(t=>[t.name,t.sql,database.prepare(`SELECT * FROM "${t.name.replaceAll('"','""')}" ORDER BY rowid`).all()]));
const workerBefore=sqlSnapshot(db);
const env={GENESIS_ENVIRONMENT:'test',GENESIS_AGENT_TOKEN:'test-agent-token',GENESIS_VIEW_PASSWORD:'test-view-password',DB:{prepare(sql){
  assert.match(sql.trim(),/^SELECT\b/i,'首页查询不能执行写入 SQL');
  const stmt=db.prepare(sql);let args=[];
  return {bind(...values){args=values;return this;},async first(){return stmt.get(...args);},async all(){return {results:stmt.all(...args)};}};
}}};
for(let i=0;i<100;i++) {
  const response=await worker.fetch(new Request('https://genesis.test/api/genesis/home',{headers:{Authorization:'Bearer test-agent-token'}}),env);
  assert.equal(response.status,200);
  const home=await response.json();assert.equal(home.readonly,true);assert.equal(home.training.available,false);assert.equal(home.capabilities[0].records,1);
}
assert.equal(sqlSnapshot(db),workerBefore);db.close();
const html=await readFile(resolve(root,'public/growth.html'),'utf8');
assert.ok(!/src=["'][^"']*(?:game|modules|app|extras|sw)\.js/.test(html));
const sw=await readFile(resolve(root,'public/sw.js'),'utf8');
const handlers={},cached=[];
let offline=false;
vm.runInNewContext(sw,{URL,Response,self:{location:{origin:'https://genesis.test'},addEventListener(name,callback){handlers[name]=callback;}},fetch:async()=>{if(offline)throw Error('offline');return new Response('Genesis AI 行动首页');},caches:{open:async()=>({match:async()=>null,put:async(key)=>cached.push(key)}),match:async()=>undefined}});
for(const path of ['/','/growth.html','/index.html']) {
  let response;handlers.fetch({request:{method:'GET',url:'https://genesis.test'+path,mode:'navigate'},respondWith(value){response=value;}});
  assert.equal(await (await response).text(),'Genesis AI 行动首页');
}
offline=true;
let offlineResponse;handlers.fetch({request:{method:'GET',url:'https://genesis.test/index.html',mode:'navigate'},respondWith(value){offlineResponse=value;}});
const offlineHtml=await (await offlineResponse).text();assert.match(offlineHtml,/Genesis AI/);assert.match(offlineHtml,/未确认/);assert.ok(!offlineHtml.includes('不应回退'));
assert.deepEqual(cached,[],'融合首页不能缓存私人状态或旧页面');
for(const path of ['/api/genesis/home','/api/genesis/skills','/api/genesis/dashboard','/api/login']) {
  let response;handlers.fetch({request:{method:'GET',url:'https://genesis.test'+path,mode:'navigate'},respondWith(value){response=value;}});assert.equal(response,undefined);
}
assert.ok(!/The Forge|\bXP\b|等级|奖励|Boss|徽章/i.test(html),'系统界面不得出现游戏机制文案');
const homeJs=await readFile(resolve(root,'public/genesis-home.js'),'utf8');
assert.ok(!/Game\.render|localStorage\.setItem|serviceWorker\.register/.test(homeJs));
const actionsJs=await readFile(resolve(root,'public/genesis-actions.js'),'utf8');
assert.ok(!/Game\.render|Game\.claim|localStorage\.setItem/.test(actionsJs));
assert.match(actionsJs,/data-action-id/);assert.match(actionsJs,/data.success !== true/);
const port=await new Promise((done,fail)=>{const server=net.createServer();server.on('error',fail);server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(()=>done(value));});});
const dir=await mkdtemp(resolve(tmpdir(),'genesis-home-test-')),dbPath=resolve(dir,'test.sqlite');
const base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),DB_PATH:dbPath,PUBLIC_ORIGIN:'https://growth-proxy.test',APP_PASSWORD:'readonly-home-test-password',SESSION_SECRET:'readonly-home-test-session',DISABLE_REMINDERS:'1'},stdio:'ignore'});
let localDb;
try {
  let healthy=false;
  for(let i=0;i<80;i++){try{if((await fetch(base+'/healthz')).ok){healthy=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.equal(healthy,true,'测试服务器启动失败');
  assert.equal((await fetch(base+'/api/genesis/home',{redirect:'manual'})).status,401);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'readonly-home-test-password'})});
  assert.equal(login.status,200);const headers={Cookie:login.headers.get('set-cookie').split(';')[0]};
  localDb=new Database(dbPath);
  // 安排数据：故意放入全部完成的任务，确保 GET 不会触发每日/每周奖励。
  const summary=require('../dashboard-summary.js'),Forge=require('../public/modules.js'),now=new Date();
  const day=now.getDay(),weekKey=summary.localIso(summary.startOfWeek(now));
  const quests=Array.from({length:3},(_,i)=>({id:`q${i}`,title:`只读任务${i}`,attr:'Mind',category:'study',scheduleType:'weekly',repeatDays:[day],estMinutes:30}));
  const checks=Object.fromEntries(quests.map(q=>[Forge.questCheckId(q,day),true]));
  quests.push({id:'manual-action',title:'可手动记录的真实测试任务',attr:'Craft',category:'project',scheduleType:'weekly',repeatDays:[day],estMinutes:30});
  localDb.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run('app_settings',JSON.stringify({version:3,taskModelVersion:4,quests,callsign:'测试角色'}));
  localDb.prepare('INSERT OR REPLACE INTO weeks(week_key,data) VALUES(?,?)').run(weekKey,JSON.stringify({checks,fields:{}}));
  const savedBefore=sqlSnapshot(localDb);

  for(let i=0;i<100;i++) {
    const page=await fetch(base+'/',{headers});assert.equal(page.status,200);assert.match(await page.text(),/genesis-home\.js/);
    const res=await fetch(base+'/api/genesis/home',{headers});assert.equal(res.status,200);const home=await res.json();
    assert.equal(home.readonly,true);assert.equal(home.training.today,null);assert.equal(home.training.available,false);assert.equal(home.training.cloudSynced,false);
    assert.equal(home.training.profile,undefined);assert.equal(home.training.actionTracking.writable,false);
    assert.equal((await fetch(base+'/api/genesis/dashboard',{headers})).status,200);
  }
  assert.equal(sqlSnapshot(localDb),savedBefore,'刷新导致数据库、任务、奖励或存档变化');
  // 显式手动写入只影响独立的行动状态，不影响原成长/奖励数据。
  const protectedSnapshot=()=>JSON.stringify(JSON.parse(sqlSnapshot(localDb)).map(([table,sql,rows])=>[table,sql,table==='settings'?rows.filter(row=>row.key!=='genesis_action_states'):rows]));
  const protectedBefore=protectedSnapshot();
  const postAction=(body,extra={})=>fetch(base+'/api/genesis/action-status',{method:'POST',headers:{...headers,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
  const date=summary.localIso(now),action={date,quest_id:'manual-action',completed:true};
  assert.equal((await fetch(base+'/api/genesis/action-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action)})).status,401);
  assert.equal((await postAction(action,{Origin:'https://evil.test'})).status,403);
  assert.equal((await postAction({...action,completed:'true'})).status,400);
  assert.equal((await postAction({...action,quest_id:'missing'})).status,400);
  assert.equal((await postAction({...action,date:'2020-01-01'})).status,400);
  assert.equal((await postAction({...action,quest_id:'q0'})).status,409);
  const success=await postAction(action,{Origin:'https://growth-proxy.test'});assert.equal(success.status,200);const saved=await success.json();
  assert.equal(saved.success,true);assert.equal(saved.today.done,4);assert.equal(saved.action.confidence,'user_stated');assert.equal(saved.action.visibility,'private');
  assert.equal(protectedSnapshot(),protectedBefore);
  const afterSave=sqlSnapshot(localDb);
  const duplicate=await (await postAction(action)).json();assert.equal(duplicate.deduplicated,true);assert.equal(duplicate.action.updated_at,saved.action.updated_at);
  for(let i=0;i<100;i++) {
    const home=await (await fetch(base+'/api/genesis/home',{headers})).json();
    assert.equal(home.training.today,null);assert.equal(home.training.profile,undefined);
    assert.equal(home.training.actionTracking.stateOnly,true);
  }
  assert.equal(sqlSnapshot(localDb),afterSave);
  const undo=await (await postAction({...action,completed:false})).json();assert.equal(undo.success,true);assert.equal(undo.today.done,3);
  assert.equal(protectedSnapshot(),protectedBefore);
  // 撤销后再完成，以及重复新状态请求不新增成长记录、资产或多余行动条目。
  const restart=await (await postAction({date,quest_id:'manual-action',status:'in_progress'})).json();
  assert.equal(restart.today.inProgress,1);assert.equal(restart.today.done,3);
  assert.equal(restart.action.status,'in_progress');
  const startedSnapshot=sqlSnapshot(localDb);
  assert.equal((await (await postAction({date,quest_id:'manual-action',status:'in_progress'})).json()).deduplicated,true);
  assert.equal(sqlSnapshot(localDb),startedSnapshot);
  const completeAgain=await (await postAction({date,quest_id:'manual-action',status:'completed'})).json();
  assert.equal(completeAgain.today.done,4);assert.equal(completeAgain.action.status,'completed');
  const repeatSnapshot=sqlSnapshot(localDb);
  for(let i=0;i<5;i++) assert.equal((await (await postAction({date,quest_id:'manual-action',status:'completed'})).json()).deduplicated,true);
  assert.equal(sqlSnapshot(localDb),repeatSnapshot);assert.equal(protectedSnapshot(),protectedBefore);
  const states=JSON.parse(localDb.prepare("SELECT value FROM settings WHERE key='genesis_action_states'").get().value);
  assert.equal(Object.keys(states).length,1);
  assert.equal((await postAction({date,quest_id:'manual-action',status:'distilled'})).status,400);
  assert.equal((await postAction({date,quest_id:'manual-action',status:'in_progress',completed:true})).status,400);
  // 原训练随后完成时，手动撤销不能遮盖原完成状态。
  checks[Forge.questCheckId(quests.at(-1),day)]=true;
  localDb.prepare('UPDATE weeks SET data=? WHERE week_key=?').run(JSON.stringify({checks,fields:{}}),weekKey);
  const forgeCompletedBefore=sqlSnapshot(localDb);
  const mergedHome=await (await fetch(base+'/api/genesis/home',{headers})).json();
  assert.equal(mergedHome.training.today,null,'旧计划不再进入 Genesis 首页');
  assert.equal((await postAction({...action,completed:false})).status,409);
  assert.equal(sqlSnapshot(localDb),forgeCompletedBefore);
  const alias=await fetch(base+'/index.html',{headers});const aliasHtml=await alias.text();assert.match(aliasHtml,/genesis-home\.js/);assert.ok(!aliasHtml.includes('game.js'));
  assert.equal((await fetch(base+'/internal/legacy',{headers})).status,404);
  const encodedAlias=await (await fetch(base+'/index%2Ehtml',{headers})).text();assert.ok(!encodedAlias.includes('game.js'));
  assert.match(await readFile(resolve(root,'legacy/forge.html'),'utf8'),/game\.js/);
  console.log('成长首页通过：空状态、可信来源、证据去重、明确时长、输入不变；Worker 与 Express 各 100 次读取；自动读取不改变所有表/任务/XP/存档；手动完成、撤销、去重、认证与跨站防护通过；统一入口与旧维护入口默认关闭通过。');
} finally {
  localDb?.close();if(child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}
  // 仅清理此测试创建且已校验的系统临时目录。
  assert.ok(dir.startsWith(resolve(tmpdir(),'genesis-home-test-')));await rm(dir,{recursive:true,force:true});
}
