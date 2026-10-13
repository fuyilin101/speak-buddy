// 本地人工编辑与项目合并。复用现有表；原始来源、证据和修改前内容保留在私有审计记录中。
const crypto = require('node:crypto');
const ALIASES = 'genesis_project_aliases', AUDIT = 'genesis_manual_edit_history';
function readSetting(db,key,fallback={}) {try{return JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value||'null')||fallback;}catch{return fallback;}}
function aliases(db){const raw=readSetting(db,ALIASES),out=Object.create(null);for(const [k,v] of Object.entries(raw))if(typeof v==='string'&&k!==v)out[k]=v;return out;}
function resolveProject(db,id){const map=aliases(db),seen=new Set();while(map[id]&&!seen.has(id)){seen.add(id);id=map[id];}return id;}
function visibleProjects(db,rows){const map=aliases(db);return rows.filter(p=>!map[p.id]);}
function registerEditor({app,db}) {
 const tables={projects:'genesis_projects','growth-records':'genesis_growth_records',assets:'genesis_assets'};
 const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
 const stamp=old=>new Date(Math.max(Date.now(),Date.parse(old||'')+1||0)).toISOString();
 const put=(key,value)=>db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));
 function audit(kind,id,before,at){const all=readSetting(db,AUDIT);const key=kind+':'+id;all[key]=[...(all[key]||[]),{at,source_type:'manual_edit',before}].slice(-40);put(AUDIT,all);}
 function text(value,max,name,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail(name+'格式不正确或长度超限。');return value.trim();}
 function list(value,name){if(!Array.isArray(value)||value.length>50)fail(name+'必须是最多 50 项的列表。');return value.map(x=>text(x,2000,name,true));}
 function fields(body,allowed){for(const key of Object.keys(body))if(!allowed.includes(key))fail('不支持的编辑字段：'+key);}
 function mutate(req,res,operation,work){try{
  const b=req.body;if(!b||typeof b!=='object'||Array.isArray(b))fail('请提交有效的编辑内容。');
  const key=req.get('Idempotency-Key');if(!key||!/^[-\w]{16,128}$/.test(key))fail('缺少有效的保存请求标识。');
  const hash=crypto.createHash('sha256').update(JSON.stringify(b)).digest('hex');
  const result=db.transaction(()=>{
   const prior=db.prepare('SELECT * FROM genesis_ingest_keys WHERE idempotency_key=?').get(key);
   if(prior){if(prior.operation!==operation||prior.request_hash!==hash)fail('请求标识已被不同内容使用，请刷新后重试。',409);return {...JSON.parse(prior.response_json),deduplicated:true};}
   const value=work(b),response={success:true,deduplicated:false,...value};
   db.prepare('INSERT INTO genesis_ingest_keys VALUES(?,?,?,?,?,?,?)').run(key,operation,hash,'manual_edit',value.record?.id||value.project?.id||'profile',JSON.stringify(response),new Date().toISOString());return response;
  })();res.json(result);
 }catch(e){res.status(e.status||500).json({error:e.status?e.message:'保存暂时失败，未确认成功，请重试。'});}}
 function profile(){const all=db.prepare('SELECT * FROM genesis_profile_items ORDER BY updated_at DESC').all();const groups={display_name:['display_name','nickname','callsign'],current_stage:['current_stage','current_stage_name'],growth_route:['growth_route']};return Object.fromEntries(Object.entries(groups).map(([key,keys])=>{const r=all.find(r=>keys.includes(r.profile_key)&&['user_stated','user_provided','verified'].includes(r.confidence));let value='';try{const v=JSON.parse(r?.value_json||'null');value=typeof v==='string'?v:v?.text||'';}catch{}return [key,{value,updated_at:r?.updated_at||null,id:r?.id||null}];}));}
 app.get('/api/genesis/editor',(req,res)=>{try{res.set('Cache-Control','no-store').json({available:true,projects:visibleProjects(db,db.prepare('SELECT * FROM genesis_projects ORDER BY updated_at DESC').all()),records:db.prepare('SELECT * FROM genesis_growth_records ORDER BY recorded_at DESC').all(),assets:db.prepare('SELECT * FROM genesis_assets ORDER BY updated_at DESC').all(),profile:profile()});}catch{res.status(500).json({error:'编辑资料暂时无法读取。'});}});
 app.patch('/api/genesis/editor/profile',(req,res)=>mutate(req,res,'manual:profile',b=>{
  fields(b,['display_name','current_stage','growth_route','versions']);const current=profile();if(!b.versions||typeof b.versions!=='object')fail('缺少资料版本。');
  for(const key of ['display_name','current_stage','growth_route']){const value=text(b[key],key==='display_name'?80:160,'角色资料',key==='display_name');if(b.versions[key]!==current[key].updated_at)fail('角色资料已变化，请刷新后编辑。',409);if(!value&&!current[key].id)continue;
   const row=current[key].id?db.prepare('SELECT * FROM genesis_profile_items WHERE id=?').get(current[key].id):null,id=row?.id||'profile-'+crypto.randomUUID(),at=stamp(row?.updated_at);audit('profile',id,row,at);
   if(row)db.prepare("UPDATE genesis_profile_items SET value_json=?,source_type='manual_edit',confidence='user_stated',visibility='private',updated_at=? WHERE id=?").run(JSON.stringify(value),at,id);
   else db.prepare("INSERT INTO genesis_profile_items(id,profile_key,value_json,source_type,confidence,visibility,created_at,updated_at) VALUES(?,?,?,'manual_edit','user_stated','private',?,?)").run(id,key,JSON.stringify(value),at,at);
  }return {profile:profile()};
 }));
 app.patch('/api/genesis/editor/:kind/:id',(req,res)=>mutate(req,res,'manual:'+req.params.kind+':'+req.params.id,b=>{
  const kind=req.params.kind,table=Object.hasOwn(tables,kind)?tables[kind]:null;if(!table)fail('此类资料不支持编辑。',404);
  const id=kind==='projects'?resolveProject(db,req.params.id):req.params.id;
  const row=db.prepare('SELECT * FROM '+table+' WHERE id=?').get(id);if(!row)fail('记录不存在。',404);
  if(b.expected_updated_at!==row.updated_at)fail('记录已被修改，请刷新后重试。',409);
  const values={};
  if(kind==='projects'){
   fields(b,['expected_updated_at','name','description','status','domain','progress','next_steps']);
   values.name=text(b.name,160,'项目名称',true);values.description=text(b.description,2000,'项目描述');values.domain=text(b.domain,60,'项目领域',true);
   if(!['active','paused','completed','archived'].includes(b.status))fail('项目状态无效。');values.status=b.status;
   if(!Number.isInteger(b.progress)||b.progress<0||b.progress>100)fail('项目进度必须是 0 到 100 的整数。');values.progress=b.progress;values.next_steps_json=JSON.stringify(list(b.next_steps,'下一步'));
  }else{
   fields(b,['expected_updated_at','title','content','project_id',...(kind==='assets'?['asset_type','tags']:['details'])]);
   values.title=text(b.title,200,'标题',true);text(b.content,20000,'内容');values.content=b.content;
   if(b.project_id!==null&&typeof b.project_id!=='string')fail('关联项目无效。');values.project_id=b.project_id?resolveProject(db,b.project_id):null;
   if(values.project_id&&!db.prepare('SELECT id FROM genesis_projects WHERE id=?').get(values.project_id))fail('关联项目不存在。');
   if(kind==='assets'){values.asset_type=text(b.asset_type,60,'资产类型',true);values.tags_json=JSON.stringify(list(b.tags,'标签'));}
   else{if(!b.details||typeof b.details!=='object'||Array.isArray(b.details))fail('复盘结构无效。');let prior={};try{prior=JSON.parse(row.details_json||'{}');}catch{}const detailKeys=['completed_work','problems','solutions','learned','reusable_assets','next_steps'];fields(b.details,detailKeys);for(const key of detailKeys)if(key in b.details)prior[key]=list(b.details[key],key);values.details_json=JSON.stringify(prior);}
  }
  const at=stamp(row.updated_at);audit(kind,id,row,at);Object.assign(values,{source_type:'manual_edit',confidence:'user_stated',visibility:'private',updated_at:at});
  db.prepare('UPDATE '+table+' SET '+Object.keys(values).map(k=>k+'=?').join(',')+' WHERE id=?').run(...Object.values(values),id);
  return {record:db.prepare('SELECT * FROM '+table+' WHERE id=?').get(id)};
 }));
 app.post('/api/genesis/editor/merge-projects',(req,res)=>mutate(req,res,'manual:merge-projects',b=>{
  fields(b,['canonical_id','duplicate_ids','versions']);if(typeof b.canonical_id!=='string'||!Array.isArray(b.duplicate_ids)||!b.duplicate_ids.length||b.duplicate_ids.length>20||new Set(b.duplicate_ids).size!==b.duplicate_ids.length||b.duplicate_ids.includes(b.canonical_id)||!b.versions)fail('项目合并参数无效。');
  const ids=[b.canonical_id,...b.duplicate_ids],rows=ids.map(id=>db.prepare('SELECT * FROM genesis_projects WHERE id=?').get(id));
  if(rows.some(r=>!r)||ids.some((id,i)=>b.versions[id]!==rows[i].updated_at))fail('项目版本已变化，请重新读取。',409);
  const canonical=rows[0],at=stamp(canonical.updated_at),map=aliases(db);if(ids.some(id=>map[id]))fail('项目已合并，请刷新后重试。',409);
  for(const row of rows)audit('merge-projects',row.id,row,at);
  const evidence=[...new Map(rows.flatMap(r=>{try{return JSON.parse(r.evidence_json||'[]');}catch{return [];}}).map(e=>[JSON.stringify(e),e])).values()];
  const next=[...new Set(rows.flatMap(r=>{try{return JSON.parse(r.next_steps_json||'[]');}catch{return [];}}))];
  for(const id of b.duplicate_ids){map[id]=canonical.id;for(const table of ['genesis_growth_records','genesis_assets','genesis_quests']){if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))db.prepare('UPDATE '+table+' SET project_id=? WHERE project_id=?').run(canonical.id,id);}}
  put(ALIASES,map);db.prepare("UPDATE genesis_projects SET evidence_json=?,next_steps_json=?,source_type='manual_edit',updated_at=? WHERE id=?").run(JSON.stringify(evidence),JSON.stringify(next),at,canonical.id);
  return {project:db.prepare('SELECT * FROM genesis_projects WHERE id=?').get(canonical.id),merged_ids:b.duplicate_ids};
 }));
 return {profile};
}
module.exports={registerEditor,aliases,resolveProject,visibleProjects};
