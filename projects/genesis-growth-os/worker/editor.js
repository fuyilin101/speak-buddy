/** 人工编辑保留原始来源、证据与修改前快照；项目合并保留旧 ID 和历史执行。 */
import {Store,fail,projectId,visibleProjects,audit} from './store.js';
import {fields,text,list,parse,stamp} from './domain.js';
const TABLES={projects:'genesis_projects','growth-records':'genesis_growth_records',assets:'genesis_assets'};
export async function profile(store){
 const rows=(await store.all('genesis_profile_items')).sort((a,b)=>b.updated_at.localeCompare(a.updated_at)),groups={display_name:['display_name','nickname','callsign'],current_stage:['current_stage','current_stage_name'],growth_route:['growth_route']};
 return Object.fromEntries(Object.entries(groups).map(([key,keys])=>{const row=rows.find(r=>keys.includes(r.profile_key)&&['user_stated','user_provided','verified'].includes(r.confidence)),value=parse(row?.value_json,null);return [key,{value:typeof value==='string'?value:value?.text||'',updated_at:row?.updated_at||null,id:row?.id||null}];}));
}
export async function readEditor(db){const store=new Store(db);return {available:true,projects:(await visibleProjects(store)).sort((a,b)=>b.updated_at.localeCompare(a.updated_at)),records:(await store.all('genesis_growth_records')).sort((a,b)=>b.recorded_at.localeCompare(a.recorded_at)),assets:(await store.all('genesis_assets')).sort((a,b)=>b.updated_at.localeCompare(a.updated_at)),profile:await profile(store)};}
export async function writeEditor(store,path,method,body){
 if(path==='/api/genesis/editor/profile'&&method==='PATCH'){
  fields(body,['display_name','current_stage','growth_route','versions']);const current=await profile(store);if(!body.versions||typeof body.versions!=='object'||Array.isArray(body.versions))fail('缺少角色资料版本。');
  for(const key of ['display_name','current_stage','growth_route']){
   const value=text(body[key],key==='display_name'?80:160,'角色资料',key==='display_name');if(body.versions[key]!==current[key].updated_at)fail('角色资料已变化，请刷新后编辑。',409);if(!value&&!current[key].id)continue;
   const old=current[key].id?await store.find('genesis_profile_items',current[key].id):null,id=old?.id||'profile-'+crypto.randomUUID(),at=stamp(old?.updated_at);audit(store,'profile',id,old,at);
   store.put('genesis_profile_items',old?{...old,value_json:JSON.stringify(value),source_type:'manual_edit',confidence:'user_stated',visibility:'private',updated_at:at}:{id,profile_key:key,value_json:JSON.stringify(value),source_type:'manual_edit',source_ref:null,confidence:'user_stated',visibility:'private',created_at:at,updated_at:at});
  }return {profile:await profile(store)};
 }
 if(path==='/api/genesis/editor/merge-projects'&&method==='POST')return mergeProjects(store,body);
 const match=path.match(/^\/api\/genesis\/editor\/([^/]+)\/([^/]+)$/);if(!match||method!=='PATCH'||!Object.hasOwn(TABLES,match[1]))fail('此类资料不支持编辑。',404);
 const kind=match[1],table=TABLES[kind],id=kind==='projects'?await projectId(store,decodeURIComponent(match[2])):decodeURIComponent(match[2]),row=await store.find(table,id);if(!row)fail('记录不存在。',404);
 if(body.expected_updated_at!==row.updated_at)fail('记录已被修改，请刷新后重试。',409);
 const values={};
 if(kind==='projects'){
  fields(body,['expected_updated_at','name','description','status','domain','progress','next_steps']);values.name=text(body.name,160,'项目名称',true);values.description=text(body.description,2000,'项目描述');values.domain=text(body.domain,60,'项目领域',true);
  if(!['active','paused','completed','archived'].includes(body.status))fail('项目状态无效。');values.status=body.status;if(!Number.isInteger(body.progress)||body.progress<0||body.progress>100)fail('项目进度必须是0到100的整数。');values.progress=body.progress;values.next_steps_json=JSON.stringify(list(body.next_steps,'下一步'));
 }else{
  fields(body,['expected_updated_at','title','content','project_id',...(kind==='assets'?['asset_type','tags']:['details'])]);values.title=text(body.title,200,'标题',true);text(body.content,20000,'内容');values.content=body.content;
  if(body.project_id!==null&&typeof body.project_id!=='string')fail('关联项目无效。');values.project_id=await projectId(store,body.project_id||null);if(values.project_id&&!await store.find('genesis_projects',values.project_id))fail('关联项目不存在。');
  if(kind==='assets'){values.asset_type=text(body.asset_type,60,'资产类型',true);values.tags_json=JSON.stringify(list(body.tags,'标签'));}
  else{const keys=['completed_work','problems','solutions','learned','reusable_assets','next_steps'];fields(body.details,keys);const prior=parse(row.details_json,{});for(const key of keys)if(key in body.details)prior[key]=list(body.details[key],key);values.details_json=JSON.stringify(prior);}
 }
 const at=stamp(row.updated_at);audit(store,kind,id,row,at);return {record:store.put(table,{...row,...values,source_type:'manual_edit',confidence:'user_stated',visibility:'private',updated_at:at})};
}
async function mergeProjects(store,body){
 fields(body,['canonical_id','duplicate_ids','versions']);const {canonical_id,duplicate_ids,versions}=body;
 if(typeof canonical_id!=='string'||!Array.isArray(duplicate_ids)||!duplicate_ids.length||duplicate_ids.length>20||duplicate_ids.some(id=>typeof id!=='string')||new Set(duplicate_ids).size!==duplicate_ids.length||duplicate_ids.includes(canonical_id)||!versions||typeof versions!=='object')fail('项目合并参数无效。');
 const rows=[];for(const id of [canonical_id,...duplicate_ids]){const row=await store.find('genesis_projects',id);if(!row||versions[id]!==row.updated_at||await projectId(store,id)!==id)fail('项目版本已变化或已合并，请刷新。',409);rows.push(row);}
 const main=rows[0],at=stamp(main.updated_at);for(const row of rows)audit(store,'merge-projects',row.id,row,at);
 const evidence=[...new Map(rows.flatMap(r=>parse(r.evidence_json,[])).map(value=>[JSON.stringify(value),value])).values()],next=[...new Set(rows.flatMap(r=>parse(r.next_steps_json,[])))];
 for(const id of duplicate_ids)store.put('genesis_project_aliases',{alias_id:id,canonical_id,source_type:'manual_merge',visibility:'private',created_at:at});
 store.sql('UPDATE genesis_growth_records SET project_id=? WHERE project_id IN (SELECT value FROM json_each(?))',canonical_id,JSON.stringify(duplicate_ids));
 store.sql('UPDATE genesis_assets SET project_id=? WHERE project_id IN (SELECT value FROM json_each(?))',canonical_id,JSON.stringify(duplicate_ids));
 store.sql('UPDATE genesis_quests SET project_id=?,revision=revision+1,updated_at=? WHERE project_id IN (SELECT value FROM json_each(?))',canonical_id,at,JSON.stringify(duplicate_ids));
 // Run 快照完全不改；技能链接改为主项目，合并后出现的相同关联只保留一条。
 const links=await store.all('genesis_skill_links'),seen=new Set(links.filter(l=>l.target_type==='project'&&l.target_id===canonical_id).map(l=>l.skill_id)),changedSkills=new Set();
 for(const link of links.filter(l=>l.target_type==='project'&&duplicate_ids.includes(l.target_id))){changedSkills.add(link.skill_id);if(seen.has(link.skill_id))store.remove('genesis_skill_links',link);else{seen.add(link.skill_id);store.put('genesis_skill_links',{...link,target_id:canonical_id});}}
 for(const id of changedSkills){const skill=await store.find('genesis_skills',id);if(skill)store.put('genesis_skills',{...skill,revision:skill.revision+1,updated_at:stamp(skill.updated_at)});}
 return {project:store.put('genesis_projects',{...main,evidence_json:JSON.stringify(evidence),next_steps_json:JSON.stringify(next),source_type:'manual_edit',updated_at:at}),merged_ids:duplicate_ids};
}
export async function createBrowserRecord(store,path,body){
 const at=new Date().toISOString();
 if(path==='/api/genesis/projects'){
  fields(body,['name','description','status','domain','progress','target_date']);const name=text(body.name,160,'项目名称',true),description=text(body.description??'',4000,'项目描述'),domain=text(body.domain??'growth',80,'项目领域'),status=body.status||'active',progress=Number(body.progress??0);
  if(!['active','paused','completed','archived'].includes(status)||!Number.isFinite(progress)||progress<0||progress>100||body.target_date&&Number.isNaN(Date.parse(body.target_date)))fail('项目状态、进度或日期无效。');
  return {project:store.put('genesis_projects',{id:'project-'+crypto.randomUUID(),name,description,status,domain,progress:Math.round(progress),target_date:body.target_date||null,source_ref:null,repo_path:null,git_commit:null,evidence_json:null,next_steps_json:null,source_type:'manual_edit',confidence:'user_stated',visibility:'private',created_at:at,updated_at:at})};
 }
 fields(body,['title','content','project_id','record_type','metric_value','metric_unit','recorded_at']);const title=text(body.title,200,'记录标题',true),content=text(body.content??'',24000,'记录内容'),record_type=text(body.record_type??'reflection',80,'记录类型'),metric_unit=body.metric_unit==null?null:text(body.metric_unit,40,'单位'),metric_value=body.metric_value==null||body.metric_value===''?null:Number(body.metric_value);
 if(metric_value!==null&&!Number.isFinite(metric_value)||body.recorded_at&&Number.isNaN(Date.parse(body.recorded_at)))fail('记录指标或日期无效。');if(body.project_id!=null&&(typeof body.project_id!=='string'||body.project_id.length>200))fail('关联项目无效。');const id=await projectId(store,body.project_id||null);if(id&&!await store.find('genesis_projects',id))fail('关联项目不存在。');
 return {record:store.put('genesis_growth_records',{id:'record-'+crypto.randomUUID(),project_id:id,record_type,title,content,metric_value,metric_unit,recorded_at:body.recorded_at||at,created_at:at,source_ref:null,evidence_json:null,details_json:null,source_type:'manual_edit',confidence:'user_stated',visibility:'private',updated_at:at})};
}
