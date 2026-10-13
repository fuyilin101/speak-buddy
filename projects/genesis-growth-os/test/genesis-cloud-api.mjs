// 完整 Worker 在真实本地 D1 上运行；验收数据明确为非个人，不连接远程账号。
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {dateInShanghai} from '../worker/domain.js';
const bundle=await build({entryPoints:['worker/index.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-11',d1Databases:['DB'],bindings:{GENESIS_ENVIRONMENT:'test',GENESIS_ENABLE_CLOUD_MANAGEMENT:'1',GENESIS_VIEW_PASSWORD:'local-cloud-owner',GENESIS_AGENT_TOKEN:'local-cloud-agent'},serviceBindings:{ASSETS:()=>new Response('public static')}}));
let cookie;
try {
 const db=await mf.getD1Database('DB');
 for(const file of ['0001_genesis.sql','0002_genesis_connector.sql','0003_genesis_private_memory.sql','0004_genesis_quests.sql','0005_genesis_quest_history.sql','0006_genesis_skills.sql','0007_genesis_editing_support.sql'])for(const statement of (await readFile(new URL('../migrations/'+file,import.meta.url),'utf8')).replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
 const base='https://genesis.test',date=dateInShanghai();
 async function api(path,method='GET',body,options={}){
  const key=options.key||crypto.randomUUID(),headers={'Content-Type':'application/json','Idempotency-Key':key,...(options.agent?{Authorization:'Bearer '+options.agent}:options.auth===false?{}:{Cookie:cookie}),...(options.origin?{Origin:options.origin}:{})};
  const response=await mf.dispatchFetch(base+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();return {status:response.status,body:value,key};
 }
 const login=await mf.dispatchFetch(base+'/api/login',{method:'POST',body:JSON.stringify({password:'local-cloud-owner'})});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await api('/api/genesis/health')).status,200);
 for(const path of ['/api/genesis/quests','/api/genesis/quest-runs','/api/genesis/skills','/api/genesis/editor']){assert.equal((await api(path, 'GET',null,{auth:false})).status,401);assert.equal((await api(path,'GET',null,{agent:'local-cloud-agent'})).status,401);}
 assert.equal((await api('/api/genesis/skills','POST',{name:'拒绝跨域'},{origin:'https://evil.invalid'})).status,403);
 assert.equal((await api('/api/genesis/quests','POST',{title:'invalid'})).status,400);
 const projectBody={name:'云迁移非个人验收项目',description:'本地D1测试夹具',status:'active',domain:'product',progress:0};
 const projectResult=await api('/api/genesis/projects','POST',projectBody);assert.equal(projectResult.status,201);let project=projectResult.body.project;
 assert.equal((await api('/api/genesis/projects','POST',projectBody,{key:projectResult.key})).body.deduplicated,true);
 assert.equal((await api('/api/genesis/projects','POST',{...projectBody,name:'不同内容'},{key:projectResult.key})).status,409);
 const duplicate=(await api('/api/genesis/projects','POST',{...projectBody,name:'待合并验收项目'})).body.project;
 const growth=(await api('/api/genesis/growth-records','POST',{title:'验收记录',project_id:duplicate.id,content:'仅用于SQL与接口验证'})).body.record;
 const assetResult=await api('/api/genesis/agent/assets','POST',{source_ref:'local-cloud:test:asset',project_id:duplicate.id,title:'非个人验收方法',content:'通过测试确认事务回滚。'},{agent:'local-cloud-agent'});assert.equal(assetResult.status,201);const asset=assetResult.body.asset;
 assert.equal((await api('/api/genesis/agent/assets','POST',{source_ref:'local-cloud:test:asset',project_id:duplicate.id,title:'非个人验收方法',content:'通过测试确认事务回滚。'},{agent:'local-cloud-agent',key:assetResult.key})).body.deduplicated,true);
 const at=new Date().toISOString();await db.prepare("INSERT INTO genesis_goals(id,title,created_at,updated_at) VALUES('fixture-goal','非个人验收目标',?,?)").bind(at,at).run();
 const body={title:'验收每日使命',description:'首次执行内容',dimension:'learning',time:'20:00',duration:30,repeat:'daily',weekdays:[],goal_id:'fixture-goal',project_id:duplicate.id};
 const key=crypto.randomUUID(),created=await Promise.all(Array.from({length:6},()=>api('/api/genesis/quests','POST',body,{key})));assert.equal(new Set(created.map(r=>r.body.quest.id)).size,1);assert.equal(created.filter(r=>!r.body.deduplicated).length,1);let quest=created[0].body.quest;
 const state=(action,q,r)=>({date,action,revision:q.revision,run_revision:r});
 const start=await api('/api/genesis/quests/'+quest.id+'/state','POST',state('start',quest,0));assert.equal(start.status,200);
 const snapshot=(await api('/api/genesis/quest-runs')).body.runs[0].snapshot;
 let runs=(await api('/api/genesis/quest-runs')).body.runs;
 const completeKey=crypto.randomUUID();const done=await Promise.all(Array.from({length:4},()=>api('/api/genesis/quests/'+quest.id+'/state','POST',state('complete',quest,runs[0].revision),{key:completeKey})));assert.ok(done.every(r=>r.status===200));
 runs=(await api('/api/genesis/quest-runs')).body.runs;assert.equal(runs.length,1);assert.equal(runs[0].status,'completed');assert.ok(runs[0].completed_at);
 quest=(await api('/api/genesis/quests/'+quest.id,'PATCH',{title:'更新后的使命',duration:60,revision:quest.revision})).body.quest;
 assert.equal((await api('/api/genesis/quests')).body.today.quests[0].title,'验收每日使命');
 assert.equal((await api('/api/genesis/quests/'+quest.id+'/state','POST',state('cancel',quest,runs[0].revision))).status,200);
 runs=(await api('/api/genesis/quest-runs')).body.runs;assert.equal(runs[0].completed_at,null);assert.deepEqual(runs[0].snapshot,snapshot);
 assert.equal((await api('/api/genesis/quests/'+quest.id+'/state','POST',state('complete',quest,runs[0].revision))).status,200);
 assert.equal((await api('/api/genesis/quests/'+quest.id+'/state','POST',{...state('complete',quest,3),date:'2020-01-01'})).status,400);
 let root=(await api('/api/genesis/skills','POST',{name:'验收路线',status:'learning'})).body.skill;
 let child=(await api('/api/genesis/skills','POST',{name:'验收子节点',parent_id:root.id,status:'practicing'})).body.skill;
 assert.equal((await api('/api/genesis/skills/'+root.id,'PATCH',{parent_id:child.id,revision:root.revision})).status,400);
 for(const [target_type,target_id] of [['goal','fixture-goal'],['quest',quest.id],['project',duplicate.id],['asset',asset.id]]){const linked=await api('/api/genesis/skills/'+child.id+'/links','POST',{target_type,target_id,revision:child.revision});assert.equal(linked.status,200);child=linked.body.skill;assert.equal((await api('/api/genesis/skills/reference/'+target_type+'/'+target_id)).status,200);}
 let skills=(await api('/api/genesis/skills')).body;assert.equal(skills.links.length,4);
 const assetLink=skills.links.find(l=>l.target_type==='asset');child=(await api('/api/genesis/skills/'+child.id+'/links/'+assetLink.id,'DELETE',{revision:child.revision})).body.skill;
 const a=(await api('/api/genesis/skills','POST',{name:'并发分支A'})).body.skill,b=(await api('/api/genesis/skills','POST',{name:'并发分支B'})).body.skill;
 const cycles=await Promise.all([api('/api/genesis/skills/'+a.id,'PATCH',{parent_id:b.id,revision:a.revision}),api('/api/genesis/skills/'+b.id,'PATCH',{parent_id:a.id,revision:b.revision})]);assert.equal(cycles.filter(r=>r.status===200).length,1);assert.equal(cycles.filter(r=>r.status===400).length,1);
 const profile=(await api('/api/genesis/editor')).body.profile;
 const edited=await api('/api/genesis/editor/profile','PATCH',{display_name:'非个人验收角色',current_stage:'测试阶段',growth_route:'接口验收',versions:Object.fromEntries(Object.entries(profile).map(([k,v])=>[k,v.updated_at]))});assert.equal(edited.status,200);assert.equal((await api('/api/genesis/home')).body.identity.name.text,'非个人验收角色');
 const editedAsset=await api('/api/genesis/editor/assets/'+asset.id,'PATCH',{expected_updated_at:asset.updated_at,title:asset.title,content:'人工修改的验收内容',asset_type:asset.asset_type,tags:[],project_id:duplicate.id});assert.equal(editedAsset.status,200);assert.equal(editedAsset.body.record.source_ref,asset.source_ref);
 const merged=await api('/api/genesis/editor/merge-projects','POST',{canonical_id:project.id,duplicate_ids:[duplicate.id],versions:{[project.id]:project.updated_at,[duplicate.id]:duplicate.updated_at}});assert.equal(merged.status,200);project=merged.body.project;
 const detail=(await api('/api/genesis/projects/'+duplicate.id)).body;assert.equal(detail.project.id,project.id);assert.equal(detail.growthRecords[0].id,growth.id);assert.equal(detail.assets[0].id,asset.id);
 assert.equal((await api('/api/genesis/projects')).body.length,1);assert.equal((await api('/api/genesis/skills')).body.links.find(l=>l.target_type==='project').target_id,project.id);
 assert.deepEqual((await api('/api/genesis/quest-runs')).body.runs[0].snapshot,snapshot);
 const agentProject=await api('/api/genesis/agent/projects','POST',{source_ref:'local-cloud:test:project',name:'Agent验收项目',description:'实际运行验证'},{agent:'local-cloud-agent'});assert.equal(agentProject.status,201);
 const p=agentProject.body.project,editedP=(await api('/api/genesis/editor/projects/'+p.id,'PATCH',{expected_updated_at:p.updated_at,name:'人工保留项目',description:'人工内容',status:'active',domain:'product',progress:0,next_steps:[]})).body.record;
 const preserved=await api('/api/genesis/agent/projects','POST',{source_ref:'local-cloud:test:project',name:'不能覆盖',description:'不能覆盖'},{agent:'local-cloud-agent'});assert.equal(preserved.body.manual_preserved,true);assert.equal(preserved.body.project.name,editedP.name);
 assert.equal((await api('/api/genesis/agent/projects','POST',{source_ref:'blocked',name:'网页不能Agent写入'})).status,401);
 assert.equal((await api('/api/genesis/quests/'+quest.id,'PATCH',{status:'paused',revision:(await api('/api/genesis/quests')).body.plans[0].revision})).status,200);
 quest=(await api('/api/genesis/quests')).body.plans[0];assert.equal((await api('/api/genesis/quests/'+quest.id+'/state','POST',state('start',quest,4))).status,409);
 quest=(await api('/api/genesis/quests/'+quest.id,'PATCH',{status:'deleted',revision:quest.revision})).body.quest;assert.equal((await api('/api/genesis/quests')).body.today.quests.length,0);assert.equal((await api('/api/genesis/quest-runs')).body.runs.length,1);
 await api('/api/genesis/quests/'+quest.id,'PATCH',{status:'active',revision:quest.revision});
 const tables=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'genesis_%' ORDER BY name").all()).results.map(r=>r.name);
 const snapshotDb=async()=>JSON.stringify(await Promise.all(tables.map(async table=>[table,(await db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()).results])));
 const before=await snapshotDb();for(let i=0;i<100;i++)assert.equal((await api('/api/genesis/home')).status,200);for(const path of ['/api/genesis/quests','/api/genesis/quest-runs','/api/genesis/skills','/api/genesis/editor','/api/genesis/dashboard'])assert.equal((await api(path)).status,200);assert.equal(await snapshotDb(),before);
 console.log('完整 Worker + 真实本地 D1：认证隔离、使命并发创建/执行/撤销/历史快照/暂停删除、技能循环及四类关联、编辑审计、项目合并、Agent人工保护、100次首页刷新全库不变通过。');
} finally {await mf.dispose();}
