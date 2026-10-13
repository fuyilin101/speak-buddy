/** Genesis 使命定义与每日状态独立存储，不调用原编辑器或游戏计算。 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const TYPES={study:['Mind','study'],training:['Body','training'],project:['Craft','project'],life:['Vitality','cooking']};
const DIMENSIONS={body:'training',learning:'study',creation:'project',life:'life'};
const dimensionOf=q=>q.dimension||Object.keys(DIMENSIONS).find(d=>DIMENSIONS[d]===q.type)||null;
const publicState=s=>s==='not_started'?'pending':s;
const dateInShanghai=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const fail=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
const canonical=o=>JSON.stringify(o,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
function dateValid(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;}
function due(q,date){if(date<q.starts_on)return false;if(q.repeat==='once')return q.scheduled_date===date;if(q.repeat==='daily')return true;return JSON.parse(q.weekdays_json).includes(new Date(date+'T12:00:00Z').getUTCDay());}
function shape(q){return {...q,weekdays:JSON.parse(q.weekdays_json)};}
async function migrateQuests(db){
 const exists=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='genesis_quests'").get();
 const changes=fs.readFileSync(path.join(__dirname,'migrations/local/0005_genesis_quest_history.sql'),'utf8').split(';').map(s=>s.replace(/--[^\n]*/g,'').trim()).filter(Boolean);
 const missing=changes.filter(sql=>{const m=sql.match(/^ALTER TABLE (\w+) ADD COLUMN (\w+)/);return m&&!db.prepare('PRAGMA table_info('+m[1]+')').all().some(c=>c.name===m[2]);});
 if(exists&&!missing.length)return null;
 let backup=null;
 if(db.name&&db.name!==':memory:'){
  const directory=path.join(path.dirname(path.resolve(db.name)),'backups');fs.mkdirSync(directory,{recursive:true});
  backup=path.join(directory,'genesis-before-quest-history-'+Date.now()+'-'+crypto.randomUUID()+'.sqlite');await db.backup(backup);
 }
 db.transaction(()=>{
  db.exec(fs.readFileSync(path.join(__dirname,'migrations/local/0004_genesis_quests.sql'),'utf8'));
  for(const sql of changes){const m=sql.match(/^ALTER TABLE (\w+) ADD COLUMN (\w+)/);if(!m||!db.prepare('PRAGMA table_info('+m[1]+')').all().some(c=>c.name===m[2]))db.exec(sql);}
 })();return backup;
}
async function registerQuests({app,db,todayDate=dateInShanghai}){
 await migrateQuests(db);
 const rows=()=>db.prepare('SELECT * FROM genesis_quests ORDER BY sort_order,created_at,id').all();
 const find=id=>db.prepare('SELECT * FROM genesis_quests WHERE id=?').get(id);
 const options=()=>({goals:db.prepare("SELECT id,title,confidence FROM genesis_goals WHERE status='active' ORDER BY priority DESC,updated_at DESC").all(),projects:require('./genesis-editor.cjs').visibleProjects(db,db.prepare("SELECT id,name FROM genesis_projects WHERE status='active' ORDER BY updated_at DESC").all())});
 function today(){
  const goalNames=new Map(db.prepare('SELECT id,title FROM genesis_goals').all().map(g=>[g.id,g.title]));
  const date=todayDate(),plans=rows(),quests=[];
  const runs=new Map(db.prepare('SELECT * FROM genesis_quest_runs WHERE date=?').all(date).map(r=>[r.quest_id,r]));
  for(const q of plans){
   const run=runs.get(q.id);if(q.status==='deleted'||(!due(q,date)&&!run))continue;
   // 首次执行后始终显示保存的快照；编辑计划不能改写此前行动。
   const content=run?JSON.parse(run.snapshot_json):q;
   const paused=q.status==='paused'&&run?.status!=='completed',status=paused?'paused':publicState(run?.status||'not_started');
   const [attr,category]=TYPES[content.type];
   quests.push({id:q.id,title:content.title,description:content.description||'',dimension:dimensionOf(content),at:content.time,minutes:content.duration,attr,category,type:content.type,
    status,done:status==='completed',paused,planStatus:q.status,forgeDone:false,manual:Boolean(run)&&run.source_type!=='legacy_transfer',managed:true,revision:q.revision,runRevision:run?.revision||0,
    sortOrder:q.sort_order,goal_id:content.goal_id,goalTitle:run?(content.goal_title||null):goalNames.get(content.goal_id)||null,project_id:content.project_id,
    actionSource:run?.source_type==='legacy_transfer'?'已保存的历史行动':run?'手动行动记录':'自主使命计划',
    actionUpdatedAt:run?.updated_at||null,actionRef:{date,quest_id:q.id},reflection:{available:false,state:'reserved'}});
  }
  const active=quests.filter(q=>!q.paused),done=active.filter(q=>q.done).length;
  return {date,quests,total:active.length,done,inProgress:active.filter(q=>q.status==='in_progress').length,paused:quests.length-active.length,
   pct:active.length?Math.round(done/active.length*100):0,minutesLeft:active.filter(q=>!q.done).reduce((n,q)=>n+(q.minutes||0),0)};
 }
 function validate(body,current=null){
  if(!body||typeof body!=='object'||Array.isArray(body))fail('使命参数格式无效。');
  const allowed=['title','description','dimension','type','time','duration','repeat','scheduled_date','weekdays','goal_id','project_id','revision','status'];
  if(Object.keys(body).some(k=>!allowed.includes(k)))fail('包含不支持的使命字段。');
  const merged=current?{...shape(current),...body}:{description:'',weekdays:[],...body};
  const dimension=own(body,'dimension')?body.dimension:own(body,'type')?dimensionOf(body):dimensionOf(merged);
  if(!own(DIMENSIONS,dimension))fail('请选择身体、学习、创造或生活维度。');
  if(own(body,'type')&&own(body,'dimension')&&DIMENSIONS[dimension]!==body.type)fail('使命类型与行动维度不一致。');
  merged.dimension=dimension;merged.type=DIMENSIONS[dimension];
  if(typeof merged.description!=='string'||merged.description.length>2000)fail('使命描述最多2000个字符。');
  if(typeof merged.title!=='string'||!merged.title.trim()||merged.title.length>160)fail('使命名称应为1至160个字符。');
  if(!own(TYPES,merged.type)||!['once','daily','weekly'].includes(merged.repeat))fail('使命类型或重复周期无效。');
  if(merged.time!=null&&merged.time!==''&&(typeof merged.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(merged.time)))fail('请选择有效时间。');
  if(merged.duration!=null&&(!Number.isInteger(merged.duration)||merged.duration<1||merged.duration>600))fail('预计时长应为1至600分钟，或留空。');
  if(!Array.isArray(merged.weekdays)||merged.weekdays.some(d=>!Number.isInteger(d)||d<0||d>6)||new Set(merged.weekdays).size!==merged.weekdays.length)fail('每周重复日期无效。');
  if(merged.repeat==='weekly'&&!merged.weekdays.length)fail('每周重复需选择至少一天。');
  if(merged.repeat==='once'&&(!dateValid(merged.scheduled_date)||((!current || merged.scheduled_date!==current.scheduled_date || current.repeat!=='once') && merged.scheduled_date<todayDate())))fail('一次性使命请选择今天或未来日期。');
  for(const [key,table] of [['goal_id','genesis_goals'],['project_id','genesis_projects']]){
   const id=merged[key];if(id!=null&&(typeof id!=='string'||id.length>200||!db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id)))fail('关联的目标或项目不存在。');
  }
  if(own(body,'status')&&!['active','paused','deleted'].includes(body.status))fail('计划状态无效。');
  if(current&&(!Number.isInteger(body.revision)||body.revision!==current.revision))fail('使命已被修改，请刷新后重试。',409);
  return {title:merged.title.trim(),description:merged.description.trim(),dimension:merged.dimension,type:merged.type,time:merged.time||null,duration:merged.duration??null,repeat:merged.repeat,
   scheduled_date:merged.repeat==='once'?merged.scheduled_date:null,weekdays_json:JSON.stringify(merged.repeat==='weekly'?[...merged.weekdays].sort():[]),
   goal_id:merged.goal_id||null,project_id:merged.project_id||null,status:current?(body.status||current.status):'active'};
 }
 function mutate(req,res,fn){
  try{
   if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))fail('使命请求应为对象。');
   const key=req.get('Idempotency-Key');if(typeof key!=='string'||!/^[\w-]{16,128}$/.test(key))fail('缺少有效的请求标识，请重试。');
   const operation='quest:'+req.method+':'+req.path,hash=crypto.createHash('sha256').update(canonical(req.body)).digest('hex');
   const response=db.transaction(()=>{
    const previous=db.prepare('SELECT * FROM genesis_ingest_keys WHERE idempotency_key=?').get(key);
    if(previous){if(previous.operation!==operation||previous.request_hash!==hash)fail('同一请求标识不能用于不同操作。',409);return {...JSON.parse(previous.response_json),deduplicated:true};}
    const result={success:true,deduplicated:false,...fn()};
    db.prepare('INSERT INTO genesis_ingest_keys(idempotency_key,operation,request_hash,resource_type,resource_id,response_json,created_at) VALUES(?,?,?,?,?,?,?)').run(key,operation,hash,'quest',result.quest?.id||result.action?.quest_id||'order',JSON.stringify(result),new Date().toISOString());
    return result;
   })();res.set('Cache-Control','no-store').json(response);
  }catch(e){res.status(e.status||500).json({error:e.status?e.message:'使命保存失败，请刷新确认后重试。'});}
 }
 app.get('/api/genesis/quests',(_req,res)=>{try{const plans=rows().map(shape);res.set('Cache-Control','no-store').json({available:true,plans,active:plans.filter(q=>q.status==='active'),today:today(),...options()});}catch{res.status(500).json({error:'使命计划读取失败。'});}});
 app.get('/api/genesis/quest-runs',(req,res)=>{
  try{
   const {from,to,quest_id,status,limit='20',offset='0'}=req.query;
   if(Object.keys(req.query).some(k=>!['from','to','quest_id','status','limit','offset'].includes(k)))fail('历史查询参数无效。');
   if((from&&!dateValid(from))||(to&&!dateValid(to))||(from&&to&&from>to))fail('请选择有效日期范围。');
   if(quest_id&&(typeof quest_id!=='string'||quest_id.length>200))fail('使命筛选无效。');
   if(status&&!['pending','in_progress','completed'].includes(status))fail('历史状态筛选无效。');
   if(typeof limit!=='string'||typeof offset!=='string'||!/^\d+$/.test(limit)||!/^\d+$/.test(offset)||Number(limit)<1||Number(limit)>100||Number(offset)>1000000)fail('分页参数无效。');
   const conditions=[],args=[];for(const [value,sql] of [[from,'date>=?'],[to,'date<=?'],[quest_id,'quest_id=?'],[status==='pending'?'not_started':status,'status=?']])if(value){conditions.push(sql);args.push(value);}
   const where=conditions.length?' WHERE '+conditions.join(' AND '):'';
   const total=db.prepare('SELECT COUNT(*) n FROM genesis_quest_runs'+where).get(...args).n;
   const runs=db.prepare('SELECT * FROM genesis_quest_runs'+where+' ORDER BY date DESC,quest_id LIMIT ? OFFSET ?').all(...args,Number(limit),Number(offset)).map(r=>({...r,status:publicState(r.status),snapshot:JSON.parse(r.snapshot_json),snapshot_json:undefined}));
   res.set('Cache-Control','no-store').json({runs,total,limit:Number(limit),offset:Number(offset)});
  }catch(e){res.status(e.status||500).json({error:e.status?e.message:'历史使命读取失败。'});}
 });
 app.post('/api/genesis/quests',(req,res)=>mutate(req,res,()=>{
  if(rows().length>=1000)fail('使命计划已达容量上限。',409);
  const fields=validate(req.body),now=new Date().toISOString(),date=todayDate(),id=crypto.randomUUID();
  const record={id,...fields,starts_on:date,sort_order:rows().reduce((n,q)=>Math.max(n,q.sort_order+1),0),legacy_source_id:null,revision:1,source_type:'manual_quest',confidence:'user_stated',visibility:'private',created_at:now,updated_at:now};
  const keys=Object.keys(record);db.prepare(`INSERT INTO genesis_quests(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>record[k]));
  return {quest:shape(record),today:today()};
 }));
 app.post('/api/genesis/quests/reorder',(req,res)=>mutate(req,res,()=>{
  const {ids,revisions}=req.body||{},active=rows().filter(q=>q.status!=='deleted');
  if(Object.keys(req.body||{}).some(k=>!['ids','revisions'].includes(k))||!Array.isArray(ids)||ids.length!==active.length||new Set(ids).size!==ids.length||!revisions||typeof revisions!=='object')fail('排序参数无效，请刷新。');
  for(const q of active)if(!ids.includes(q.id)||revisions[q.id]!==q.revision)fail('计划已更新，请刷新后排序。',409);
  const now=new Date().toISOString();ids.forEach((id,index)=>{const q=find(id);if(q.sort_order!==index)db.prepare('UPDATE genesis_quests SET sort_order=?,revision=revision+1,updated_at=? WHERE id=?').run(index,now,id);});
  return {today:today()};
 }));
 app.patch('/api/genesis/quests/:id',(req,res)=>mutate(req,res,()=>{
  const current=find(req.params.id);if(!current)fail('使命不存在。',404);
  const fields=validate(req.body,current),changed=Object.keys(fields).some(k=>fields[k]!==current[k]);
  if(changed){const keys=Object.keys(fields);db.prepare(`UPDATE genesis_quests SET ${keys.map(k=>k+'=?').join(',')},revision=revision+1,updated_at=? WHERE id=?`).run(...keys.map(k=>fields[k]),new Date().toISOString(),current.id);}
  return {quest:shape(find(current.id)),today:today()};
 }));
 app.post('/api/genesis/quests/:id/state',(req,res)=>mutate(req,res,()=>{
  const q=find(req.params.id),body=req.body||{};if(!q)fail('使命不存在。',404);
  const actions={start:'in_progress',complete:'completed',cancel:'not_started'};
  if(Object.keys(body).some(k=>!['date','action','status','revision','run_revision'].includes(k))||body.date!==todayDate())fail('只能记录当天使命的有效状态。');
  if(body.action!=null&&(!own(actions,body.action)||body.status!=null))fail('请选择开始、完成或撤销操作。');
  const state=body.action?actions[body.action]:body.status==='pending'?'not_started':body.status;
  if(!['not_started','in_progress','completed'].includes(state))fail('使命状态无效。');
  const previous=db.prepare('SELECT * FROM genesis_quest_runs WHERE quest_id=? AND date=?').get(q.id,body.date);
  if(q.status!=='active'||(!due(q,body.date)&&!previous))fail('该使命未启用或不属于今天。',409);
  if(body.revision!==q.revision||body.run_revision!==(previous?.revision||0))fail('使命状态已更新，请刷新后重试。',409);
  const now=new Date().toISOString(),deduplicated=previous?.status===state||(!previous&&state==='not_started');
  if(!deduplicated){
   const snapshot={title:q.title,description:q.description,dimension:q.dimension,type:q.type,time:q.time,duration:q.duration,repeat:q.repeat,weekdays:JSON.parse(q.weekdays_json),scheduled_date:q.scheduled_date,goal_id:q.goal_id,project_id:q.project_id,version:q.revision,
    goal_title:q.goal_id?db.prepare('SELECT title FROM genesis_goals WHERE id=?').get(q.goal_id)?.title||null:null,
    project_name:q.project_id?db.prepare('SELECT name FROM genesis_projects WHERE id=?').get(q.project_id)?.name||null:null};
   db.prepare(`INSERT INTO genesis_quest_runs(quest_id,date,status,snapshot_json,completed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(quest_id,date) DO UPDATE SET status=excluded.status,completed_at=excluded.completed_at,revision=genesis_quest_runs.revision+1,updated_at=excluded.updated_at`).run(q.id,body.date,state,JSON.stringify(snapshot),state==='completed'?now:null,now,now);
  }
  return {deduplicated,action:{date:body.date,quest_id:q.id,status:publicState(state)},today:today()};
 }));
 return {today,plans:()=>rows().map(shape)};
}
module.exports={registerQuests,migrateQuests,dateValid,due,dateInShanghai};
