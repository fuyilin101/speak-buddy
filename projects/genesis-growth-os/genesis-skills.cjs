/** 用户自定义成长路线。读取不写入；状态不依赖使命完成或关联数量。 */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {resolveProject, visibleProjects} = require('./genesis-editor.cjs');
const STATES = ['not_started','learning','practicing','mastered'];
const TARGETS = {goal:'genesis_goals',quest:'genesis_quests',project:'genesis_projects',asset:'genesis_assets'};
const own = (object,key) => Object.prototype.hasOwnProperty.call(object,key);
const fail = (message,status=400) => {throw Object.assign(new Error(message),{status});};
const canonical = object => JSON.stringify(object,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
async function migrateSkills(db) {
 const has = table => Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
 if(has('genesis_skills') && has('genesis_skill_links')) return null;
 let backup = null;
 if(db.name && db.name!==':memory:') {
  const directory=path.join(path.dirname(path.resolve(db.name)),'backups');fs.mkdirSync(directory,{recursive:true});
  backup=path.join(directory,'genesis-before-skills-'+Date.now()+'-'+crypto.randomUUID()+'.sqlite');
  await db.backup(backup);
 }
 db.transaction(()=>db.exec(fs.readFileSync(path.join(__dirname,'migrations/local/0006_genesis_skills.sql'),'utf8')))();
 return backup;
}
async function registerSkills({app,db}) {
 await migrateSkills(db);
 const exists = table => Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
 const find = id => db.prepare('SELECT * FROM genesis_skills WHERE id=?').get(id);
 const skills = () => db.prepare('SELECT * FROM genesis_skills ORDER BY created_at,id').all();
 function reference(type,id) {
  if(!own(TARGETS,type) || typeof id!=='string' || !id || id.length>200) fail('关联类型或记录 ID 无效。');
  if(!exists(TARGETS[type])) return null;
  const resolved=type==='project'?resolveProject(db,id):id;
  const row=db.prepare('SELECT * FROM '+TARGETS[type]+' WHERE id=?').get(resolved);
  if(!row) return null;
  return {id:row.id,title:row.title||row.name,description:row.description||row.content||'',status:row.status||null,
   ...(type==='quest'?{time:row.time,duration:row.duration,repeat:row.repeat}:{}),visibility:'private'};
 }
 function options() {
  const select=(type,sql)=>exists(TARGETS[type])?db.prepare(sql).all():[];
  return {
   goal:select('goal',"SELECT id,title FROM genesis_goals WHERE status='active' ORDER BY priority DESC,updated_at DESC"),
   quest:select('quest',"SELECT id,title FROM genesis_quests WHERE status!='deleted' ORDER BY time,created_at"),
   project:visibleProjects(db,select('project','SELECT id,name AS title FROM genesis_projects ORDER BY updated_at DESC')),
   asset:select('asset','SELECT id,title FROM genesis_assets ORDER BY updated_at DESC')
  };
 }
 function links() {
  return db.prepare('SELECT * FROM genesis_skill_links ORDER BY created_at,id').all().map(link=>{
   const target=reference(link.target_type,link.target_id);
   return {...link,target_title:target?.title||'关联记录已不存在',target_status:target?.status||null,missing:!target};
  });
 }
 function fields(body,allowed) {
  if(!body || typeof body!=='object' || Array.isArray(body)) fail('请提交有效的技能参数。');
  if(Object.keys(body).some(key=>!allowed.includes(key))) fail('包含不支持的技能字段。');
 }
 function version(body,current) {
  if(!Number.isInteger(body.revision) || body.revision!==current.revision) fail('技能已被修改，请刷新后重试。',409);
 }
 function validate(body,current=null) {
  fields(body,['name','description','category','parent_id','status',...(current?['revision']:[])]);
  const value={description:'',category:'',parent_id:null,status:'not_started',...current,...body};
  for(const [key,max,label,required] of [['name',160,'技能名称',true],['description',2000,'描述',false],['category',60,'分类',false]]) {
   if(typeof value[key]!=='string' || value[key].length>max || (required&&!value[key].trim())) fail(label+'格式无效或长度超限。');
   value[key]=value[key].trim();
  }
  if(!STATES.includes(value.status)) fail('请选择有效的技能状态。');
  if(value.parent_id!==null) {
   if(typeof value.parent_id!=='string' || !value.parent_id || value.parent_id.length>200) fail('父节点无效。');
   let parent=find(value.parent_id);if(!parent) fail('父节点不存在。');
   const seen=new Set();
   while(parent) {
    if(parent.id===current?.id || seen.has(parent.id)) fail('父节点不能指向自己或形成循环。');
    seen.add(parent.id);parent=parent.parent_id?find(parent.parent_id):null;
   }
  }
  if(current) version(body,current);
  return Object.fromEntries(['name','description','category','parent_id','status'].map(key=>[key,value[key]]));
 }
 function mutate(req,res,work) {
  try {
   fields(req.body,Object.keys(req.body||{}));
   const key=req.get('Idempotency-Key');
   if(typeof key!=='string' || !/^[\w-]{16,128}$/.test(key)) fail('缺少有效的保存请求标识。');
   const operation='skill:'+req.method+':'+req.path,hash=crypto.createHash('sha256').update(canonical(req.body)).digest('hex');
   const result=db.transaction(()=>{
    const previous=db.prepare('SELECT * FROM genesis_ingest_keys WHERE idempotency_key=?').get(key);
    if(previous) {
     if(previous.operation!==operation || previous.request_hash!==hash) fail('同一请求标识不能用于不同内容。',409);
     return {...JSON.parse(previous.response_json),deduplicated:true};
    }
    const value={success:true,deduplicated:false,...work()};
    db.prepare('INSERT INTO genesis_ingest_keys VALUES(?,?,?,?,?,?,?)').run(key,operation,hash,'skill',value.skill.id,JSON.stringify(value),new Date().toISOString());
    return value;
   })();
   res.set('Cache-Control','no-store').json(result);
  } catch(error) {res.status(error.status||500).json({error:error.status?error.message:'技能保存失败，尚未确认成功，请刷新检查。'});}
 }
 app.get('/api/genesis/skills',(_req,res)=>{
  try {res.set('Cache-Control','no-store').json({available:true,skills:skills(),links:links(),options:options()});}
  catch {res.status(500).json({error:'成长路线读取失败，请重试。'});}
 });
 app.get('/api/genesis/skills/reference/:type/:id',(req,res)=>{
  try {const record=reference(req.params.type,req.params.id);if(!record) fail('关联记录不存在。',404);res.set('Cache-Control','no-store').json({record});}
  catch(error) {res.status(error.status||500).json({error:error.status?error.message:'关联内容读取失败。'});}
 });
 app.post('/api/genesis/skills',(req,res)=>mutate(req,res,()=>{
  if(skills().length>=1000) fail('技能节点数量已达上限。',409);
  const value=validate(req.body),at=new Date().toISOString();
  const skill={id:crypto.randomUUID(),...value,revision:1,source_type:'manual_skill',visibility:'private',created_at:at,updated_at:at};
  const keys=Object.keys(skill);db.prepare('INSERT INTO genesis_skills('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(key=>skill[key]));
  return {skill};
 }));
 app.patch('/api/genesis/skills/:id',(req,res)=>mutate(req,res,()=>{
  const current=find(req.params.id);if(!current) fail('技能节点不存在。',404);
  const value=validate(req.body,current),keys=Object.keys(value);
  if(keys.some(key=>value[key]!==current[key])) db.prepare('UPDATE genesis_skills SET '+keys.map(key=>key+'=?').join(',')+',revision=revision+1,updated_at=? WHERE id=?').run(...keys.map(key=>value[key]),new Date().toISOString(),current.id);
  return {skill:find(current.id)};
 }));
 app.post('/api/genesis/skills/:id/links',(req,res)=>mutate(req,res,()=>{
  const current=find(req.params.id);if(!current) fail('技能节点不存在。',404);
  fields(req.body,['target_type','target_id','revision']);version(req.body,current);
  const type=req.body.target_type,target=reference(type,req.body.target_id);if(!target) fail('关联记录不存在。');
  if(type==='quest' && target.status==='deleted') fail('不能新关联已删除的使命。');
  const existing=db.prepare('SELECT * FROM genesis_skill_links WHERE skill_id=? AND target_type=? AND target_id=?').get(current.id,type,target.id);
  if(existing) return {skill:current,link:existing,deduplicated:true};
  const link={id:crypto.randomUUID(),skill_id:current.id,target_type:type,target_id:target.id,created_at:new Date().toISOString()};
  db.prepare('INSERT INTO genesis_skill_links VALUES(?,?,?,?,?)').run(link.id,link.skill_id,type,target.id,link.created_at);
  db.prepare('UPDATE genesis_skills SET revision=revision+1,updated_at=? WHERE id=?').run(link.created_at,current.id);
  return {skill:find(current.id),link};
 }));
 app.delete('/api/genesis/skills/:id/links/:linkId',(req,res)=>mutate(req,res,()=>{
  const current=find(req.params.id);if(!current) fail('技能节点不存在。',404);
  fields(req.body,['revision']);version(req.body,current);
  const link=db.prepare('SELECT * FROM genesis_skill_links WHERE id=? AND skill_id=?').get(req.params.linkId,current.id);
  if(!link) return {skill:current,deduplicated:true};
  db.prepare('DELETE FROM genesis_skill_links WHERE id=? AND skill_id=?').run(link.id,current.id);
  db.prepare('UPDATE genesis_skills SET revision=revision+1,updated_at=? WHERE id=?').run(new Date().toISOString(),current.id);
  return {skill:find(current.id),removed_link_id:link.id};
 }));
 return {available:true};
}
module.exports={migrateSkills,registerSkills};
