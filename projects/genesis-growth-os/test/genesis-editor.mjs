// 真正的本地 Express/SQLite 验证人工编辑、并发、幂等、私有来源保护与无损项目合并。
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import net from 'node:net';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url),Database=require('better-sqlite3');
const dir=await mkdtemp(resolve(tmpdir(),'genesis-editor-test-')),dbPath=resolve(dir,'test.sqlite');
const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),DB_PATH:dbPath,APP_PASSWORD:'isolated-editor-test',SESSION_SECRET:'isolated-session-editor',GENESIS_AGENT_TOKEN:'isolated-agent-token',DISABLE_REMINDERS:'1',GENESIS_ENABLE_QUEST_BUILDER:'1',GENESIS_ENABLE_LOCAL_EDITING:'1'},stdio:'ignore'});
const base='http://127.0.0.1:'+port;let db,cookie='';
async function api(path,{method='GET',body,key=randomUUID(),auth=true,origin,agent=false}={}){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(auth?{Cookie:cookie}:{}),...(agent?{Authorization:'Bearer isolated-agent-token'}:{}),...(method==='GET'?{}:{'Idempotency-Key':key}),...(origin?{Origin:origin}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};}
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/healthz')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'isolated-editor-test'})});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];db=new Database(dbPath);
 const time=new Date().toISOString();for(const [id,name] of [['canonical','Genesis AI'],['duplicate','Genesis MVP'],['other','英语项目']])db.prepare("INSERT INTO genesis_projects(id,name,created_at,updated_at,source_ref) VALUES(?,?,?,?,?)").run(id,name,time,time,'test:'+id);
 db.prepare("INSERT INTO genesis_assets(id,title,content,project_id,evidence_json,source_ref,created_at,updated_at) VALUES('asset','工程知识','实际保存内容','duplicate','[{\"path\":\"server.js\"}]','asset:original',?,?)").run(time,time);
 db.prepare("INSERT INTO genesis_growth_records(id,title,content,project_id,details_json,recorded_at,created_at,updated_at) VALUES('record','开发记录','实际测试内容','duplicate','{\"unknown_detail\":\"保留字段\"}',?,?,?)").run(time,time,time);
 const originalAsset=db.prepare('SELECT * FROM genesis_assets').get(),schema=JSON.stringify(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all());
 assert.equal((await api('/api/genesis/editor',{auth:false})).status,401);
 const body={expected_updated_at:time,title:'修改后的工程知识',content:'可以复用的经验',project_id:'duplicate',asset_type:'knowledge',tags:['SQLite']};
 assert.equal((await api('/api/genesis/editor/assets/asset',{method:'PATCH',body,origin:'https://evil.invalid'})).status,403);
 for(const patch of [{title:''},{content:'x'.repeat(20001)},{project_id:'absent'},{asset_type:''},{tags:['x'.repeat(2001)]},{unexpected:true}])assert.equal((await api('/api/genesis/editor/assets/asset',{method:'PATCH',body:{...body,...patch}})).status,400);
 const key=randomUUID(),saved=await api('/api/genesis/editor/assets/asset',{method:'PATCH',body,key});assert.equal(saved.status,200);assert.equal(saved.body.record.visibility,'private');assert.equal(saved.body.record.source_ref,originalAsset.source_ref);assert.equal(saved.body.record.evidence_json,originalAsset.evidence_json);
 assert.equal((await api('/api/genesis/editor/assets/asset',{method:'PATCH',body,key})).body.deduplicated,true);
 assert.equal((await api('/api/genesis/editor/assets/asset',{method:'PATCH',body:{...body,title:'不同内容'},key})).status,409);
 assert.equal((await api('/api/genesis/editor/assets/asset',{method:'PATCH',body})).status,409);
 const recordEdit={expected_updated_at:time,title:'复盘',content:'复盘内容',project_id:'duplicate',details:{completed_work:['验证编辑'],problems:[],solutions:[],learned:['并发保护'],reusable_assets:[],next_steps:[]}};
 const record=await api('/api/genesis/editor/growth-records/record',{method:'PATCH',body:recordEdit});assert.equal(record.status,200);assert.equal(JSON.parse(record.body.record.details_json).unknown_detail,'保留字段');
 let profile=(await api('/api/genesis/editor')).body.profile;const profileBody={display_name:'本地测试角色',current_stage:'学习实践',growth_route:'创造路线',versions:Object.fromEntries(Object.entries(profile).map(([k,v])=>[k,v.updated_at]))};
 assert.equal((await api('/api/genesis/editor/profile',{method:'PATCH',body:profileBody})).status,200);assert.equal((await api('/api/genesis/home')).body.identity.name.text,'本地测试角色');assert.equal((await api('/api/genesis/editor/profile',{method:'PATCH',body:profileBody})).status,409);
 const projectBody={expected_updated_at:time,name:'Genesis AI',description:'人工编辑描述',status:'active',domain:'ai-product',progress:25,next_steps:['下一步验证']};
 const project=(await api('/api/genesis/editor/projects/canonical',{method:'PATCH',body:projectBody})).body.record;assert.equal(project.progress,25);
 const merge={canonical_id:'canonical',duplicate_ids:['duplicate'],versions:{canonical:project.updated_at,duplicate:time}},mergeKey=randomUUID();
 const merged=await api('/api/genesis/editor/merge-projects',{method:'POST',body:merge,key:mergeKey});assert.equal(merged.status,200);assert.equal((await api('/api/genesis/editor/merge-projects',{method:'POST',body:merge,key:mergeKey})).body.deduplicated,true);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM genesis_projects').get().n,3,'项目原始条目不能删除');assert.equal((await api('/api/genesis/dashboard')).body.projects.length,2);
 assert.equal(db.prepare('SELECT project_id FROM genesis_assets').get().project_id,'canonical');assert.equal(db.prepare('SELECT project_id FROM genesis_growth_records').get().project_id,'canonical');assert.equal((await api('/api/genesis/projects/duplicate')).body.project.id,'canonical');
 const agent=await api('/api/genesis/agent/projects',{method:'POST',agent:true,body:{source_ref:'test:duplicate',name:'不能覆盖人工名称',description:'自动覆盖测试',evidence:[],next_steps:[]}});assert.equal(agent.status,200);assert.equal(agent.body.manual_preserved,true);assert.equal(agent.body.project.id,'canonical');assert.equal(agent.body.project.name,'Genesis AI');
 const state=()=>JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(t=>[t.name,db.prepare(`SELECT * FROM "${t.name}" ORDER BY rowid`).all()]));const before=state();for(let i=0;i<100;i++)await Promise.all(['/api/genesis/home','/api/genesis/editor','/api/genesis/dashboard','/api/genesis/quests'].map(path=>api(path)));assert.equal(state(),before,'100 次刷新不写任何表');assert.equal(JSON.stringify(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all()),schema,'本轮不新增数据库表');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM genesis_assets').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM genesis_growth_records').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM genesis_quest_runs').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM weeks').get().n,0);
 const history=JSON.parse(db.prepare("SELECT value FROM settings WHERE key='genesis_manual_edit_history'").get().value);assert.equal(history['assets:asset'][0].before.content,originalAsset.content);
 console.log('人工编辑：认证、跨站、长度、关联校验、版本冲突、幂等、私有来源/证据保留、角色更新、无损合并、审计及100次只读刷新通过。');
}finally{if(db)db.close();child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));await rm(dir,{recursive:true,force:true});}
