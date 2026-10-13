// 真实 HTTP + SQLite：用户自定义路线、循环保护、四类关联与旧数据隔离。
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import net from 'node:net';
import {skillForest,descendantIds} from '../public/genesis-skill-model.mjs';
const require=createRequire(import.meta.url),Database=require('better-sqlite3');
const {migrateSkills}=require('../genesis-skills.cjs');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dir=await mkdtemp(resolve(tmpdir(),'genesis-skills-test-')),dbPath=resolve(dir,'test.sqlite');
const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(()=>resolve(value));});});
const base='http://127.0.0.1:'+port,at='2026-10-13T00:00:00.000Z';let child,cookie='',db;
async function start() {
 child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),DB_PATH:dbPath,APP_PASSWORD:'skill-test-password',SESSION_SECRET:'skill-test-session',DISABLE_REMINDERS:'1',GENESIS_ENABLE_QUEST_BUILDER:'1',GENESIS_ENABLE_SKILL_TREE:'1'},stdio:'ignore'});
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/healthz')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,'本地服务必须启动');
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'skill-test-password'})});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
}
async function stop(){if(!child)return;child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));child=null;}
async function api(path,{method='GET',body,key=randomUUID(),auth=true,origin}={}){
 const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(auth?{Cookie:cookie}:{}),...(method!=='GET'&&key?{'Idempotency-Key':key}:{}),...(origin?{Origin:origin}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 return {status:response.status,body:await response.json()};
}
const oldSnapshot=()=>JSON.stringify(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT IN ('genesis_skills','genesis_skill_links','genesis_ingest_keys') ORDER BY name").all().map(table=>[table.name,table.sql,db.prepare('SELECT * FROM "'+table.name+'" ORDER BY rowid').all()]));
const fullSnapshot=()=>JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(table=>[table.name,db.prepare('SELECT * FROM "'+table.name+'" ORDER BY rowid').all()]));
try {
 await start();db=new Database(dbPath);
 const backups=(await readdir(resolve(dir,'backups'))).filter(name=>name.startsWith('genesis-before-skills-')&&name.endsWith('.sqlite'));assert.equal(backups.length,1);
 const backup=new Database(resolve(dir,'backups',backups[0]),{readonly:true});assert.equal(backup.prepare("SELECT name FROM sqlite_master WHERE name='genesis_skills'").get(),undefined);assert.ok(backup.prepare("SELECT name FROM sqlite_master WHERE name='genesis_quests'").get());backup.close();
 assert.deepEqual((await api('/api/genesis/skills')).body.skills,[],'读取不生成初始技能');
 db.prepare('INSERT INTO genesis_goals(id,title,description,created_at,updated_at) VALUES(?,?,?,?,?)').run('goal','测试成长方向','只在隔离测试库使用',at,at);
 db.prepare('INSERT INTO genesis_projects(id,name,description,created_at,updated_at) VALUES(?,?,?,?,?)').run('project','测试项目','项目内容',at,at);
 db.prepare('INSERT INTO genesis_projects(id,name,created_at,updated_at) VALUES(?,?,?,?)').run('alias','项目旧别名',at,at);
 db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('genesis_project_aliases',JSON.stringify({alias:'project'}));
 db.prepare('INSERT INTO genesis_assets(id,title,content,created_at,updated_at) VALUES(?,?,?,?,?)').run('asset','测试资产','可复用方法',at,at);
 db.prepare('INSERT INTO genesis_quests(id,title,type,repeat,starts_on,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('quest','测试使命','study','daily','2026-10-13',at,at);
 db.prepare('INSERT INTO genesis_quests(id,title,type,repeat,starts_on,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('deleted','已删除使命','study','daily','2026-10-13','deleted',at,at);
 const old=oldSnapshot();
 const value={name:'AI 应用开发',description:'成长路线说明',category:'技术',parent_id:null,status:'not_started'};
 assert.equal((await api('/api/genesis/skills',{auth:false})).status,401);
 assert.equal((await api('/api/genesis/skills',{method:'POST',body:value,auth:false})).status,401);
 const cross=await api('/api/genesis/skills',{method:'POST',body:value,origin:'https://evil.invalid'});assert.equal(cross.status,403);assert.match(cross.body.error,/跨站/);
 assert.equal((await api('/api/genesis/skills',{method:'POST',body:value,key:null})).status,400);
 for(const patch of [{name:''},{name:'x'.repeat(161)},{description:'x'.repeat(2001)},{category:'x'.repeat(61)},{status:'verified'},{parent_id:'missing'},{parent_id:3},{visibility:'public'},{revision:1},{xp:30}])assert.equal((await api('/api/genesis/skills',{method:'POST',body:{...value,...patch}})).status,400);
 for(const body of [null,[],{name:4}])assert.equal((await api('/api/genesis/skills',{method:'POST',body})).status,400);
 const key=randomUUID(),created=await api('/api/genesis/skills',{method:'POST',body:value,key});assert.equal(created.status,200);let a=created.body.skill;
 assert.equal(a.source_type,'manual_skill');assert.equal(a.visibility,'private');assert.equal(a.revision,1);
 assert.equal((await api('/api/genesis/skills',{method:'POST',body:value,key})).body.deduplicated,true);
 assert.equal((await api('/api/genesis/skills',{method:'POST',body:{...value,name:'不同内容'},key})).status,409);
 const b=(await api('/api/genesis/skills',{method:'POST',body:{...value,name:'Agent 开发',parent_id:a.id,status:'learning'}})).body.skill;
 const c=(await api('/api/genesis/skills',{method:'POST',body:{...value,name:'MCP',parent_id:b.id}})).body.skill;
 assert.equal(db.prepare('SELECT COUNT(*) n FROM genesis_skills').get().n,3);
 for(const parent_id of [a.id,c.id,'missing'])assert.equal((await api('/api/genesis/skills/'+a.id,{method:'PATCH',body:{parent_id,revision:a.revision}})).status,400,'自己、后代和缺失父节点均拒绝');
 assert.equal(db.prepare('SELECT parent_id FROM genesis_skills WHERE id=?').get(a.id).parent_id,null);
 const edited=await api('/api/genesis/skills/'+c.id,{method:'PATCH',body:{name:'MCP 实践',description:'更新学习方向',category:'实践',parent_id:a.id,status:'practicing',revision:c.revision}});assert.equal(edited.status,200);assert.equal(edited.body.skill.revision,2);
 assert.equal((await api('/api/genesis/skills/'+c.id,{method:'PATCH',body:{status:'mastered',revision:1}})).status,409);
 assert.equal((await api('/api/genesis/skills/missing',{method:'PATCH',body:{revision:1}})).status,404);
 const detached=await api('/api/genesis/skills/'+c.id,{method:'PATCH',body:{parent_id:null,status:'mastered',revision:2}});assert.equal(detached.status,200);assert.equal(detached.body.skill.parent_id,null);assert.equal(detached.body.skill.status,'mastered');
 const options=(await api('/api/genesis/skills')).body.options;assert.equal(options.project.length,1);assert.equal(options.quest.length,1);assert.ok(options.goal.some(row=>row.id==='goal'));assert.ok(options.asset.some(row=>row.id==='asset'));
 const linked=[];
 for(const type of ['goal','quest','project','asset']) {
  const body={target_type:type,target_id:type==='project'?'alias':type,revision:a.revision},key=randomUUID();
  const result=await api('/api/genesis/skills/'+a.id+'/links',{method:'POST',body,key});assert.equal(result.status,200);a=result.body.skill;linked.push(result.body.link);
  assert.equal(result.body.link.target_id,type);assert.equal(a.status,'not_started','关联不能自动改变状态');
  assert.equal((await api('/api/genesis/skills/'+a.id+'/links',{method:'POST',body,key})).body.deduplicated,true);
  const duplicate=await api('/api/genesis/skills/'+a.id+'/links',{method:'POST',body:{...body,revision:a.revision}});assert.equal(duplicate.body.deduplicated,true);assert.equal(duplicate.body.skill.revision,a.revision);
  const reference=await api('/api/genesis/skills/reference/'+type+'/'+type);assert.equal(reference.status,200);assert.ok(reference.body.record.title);
 }
 assert.equal(db.prepare('SELECT COUNT(*) n FROM genesis_skill_links').get().n,4);
 assert.throws(()=>db.prepare('INSERT INTO genesis_skill_links VALUES(?,?,?,?,?)').run(randomUUID(),a.id,'asset','asset',at),/UNIQUE/);
 for(const [type,id] of [['goal','missing'],['quest','deleted'],['evidence','asset'],['__proto__','goal']])assert.equal((await api('/api/genesis/skills/'+a.id+'/links',{method:'POST',body:{target_type:type,target_id:id,revision:a.revision}})).status,400);
 assert.equal((await api('/api/genesis/skills/'+a.id+'/links',{method:'POST',body:{target_type:'asset',target_id:'asset',revision:1}})).status,409);
 assert.equal((await api('/api/genesis/skills/reference/goal/missing')).status,404);assert.equal((await api('/api/genesis/skills/reference/invalid/goal')).status,400);
 assert.equal(oldSnapshot(),old,'关联不能改写旧表、存档、目标、使命、项目或资产');
 const unlinkBody={revision:a.revision},unlinkKey=randomUUID(),path='/api/genesis/skills/'+a.id+'/links/'+linked[0].id;
 const unlinked=await api(path,{method:'DELETE',body:unlinkBody,key:unlinkKey});assert.equal(unlinked.status,200);a=unlinked.body.skill;
 assert.equal((await api(path,{method:'DELETE',body:unlinkBody,key:unlinkKey})).body.deduplicated,true);
 assert.equal((await api(path,{method:'DELETE',body:{revision:a.revision}})).body.deduplicated,true);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM genesis_skill_links').get().n,3);assert.equal(oldSnapshot(),old);
 const beforeReads=fullSnapshot();for(let i=0;i<100;i++){assert.equal((await api('/api/genesis/skills')).status,200);assert.equal((await api('/api/genesis/home')).status,200);}assert.equal(fullSnapshot(),beforeReads,'100 次读取不能写入');
 const schema=await readFile(resolve(root,'migrations/local/0006_genesis_skills.sql'),'utf8');db.exec(schema);db.exec(schema);assert.equal(await migrateSkills(db),null);assert.equal(fullSnapshot(),beforeReads);
 await stop();await start();assert.equal(fullSnapshot(),beforeReads,'重启保持节点与关联');assert.equal((await readdir(resolve(dir,'backups'))).filter(name=>name.startsWith('genesis-before-skills-')&&name.endsWith('.sqlite')).length,1);
 const forest=skillForest((await api('/api/genesis/skills')).body.skills);assert.deepEqual([...descendantIds(forest,a.id)].sort(),[a.id,b.id].sort());
 assert.throws(()=>skillForest([{...a,parent_id:b.id},{...b,parent_id:a.id}]),/循环/);assert.throws(()=>skillForest([{...a,parent_id:'missing'}]),/不存在/);assert.throws(()=>skillForest([a,a]),/不完整/);
 const untouched=new Database(resolve(dir,'backup-failure.sqlite'));untouched.exec('CREATE TABLE original(value TEXT); INSERT INTO original VALUES(\'保留内容\')');
 untouched.backup=async()=>{throw Error('备份失败测试');};await assert.rejects(migrateSkills(untouched),/备份失败/);assert.equal(untouched.prepare("SELECT name FROM sqlite_master WHERE name='genesis_skills'").get(),undefined);assert.equal(untouched.prepare('SELECT value FROM original').get().value,'保留内容');untouched.close();
 console.log('Skill Tree：真实创建/编辑/状态/重设父节点、循环检测、四类关联/解除、唯一约束/幂等/并发保护、认证/跨站/校验、100次只读、重启保持、备份失败保护与重复迁移、旧数据隔离通过。');
} finally {db?.close();await stop();await rm(dir,{recursive:true,force:true});}
