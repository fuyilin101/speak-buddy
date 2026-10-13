/** 用户定义的路线与关联；不根据关联数量改变技能状态。 */
import {Store,fail,projectId,visibleProjects} from './store.js';
import {fields,text,SKILL_STATES,stamp} from './domain.js';
const TARGETS={goal:'genesis_goals',quest:'genesis_quests',project:'genesis_projects',asset:'genesis_assets'};
export async function reference(store,type,id){
 if(!Object.hasOwn(TARGETS,type)||typeof id!=='string'||!id||id.length>200)fail('关联类型或记录ID无效。');
 const resolved=type==='project'?await projectId(store,id):id,row=await store.find(TARGETS[type],resolved);if(!row)return null;
 return {id:row.id,title:row.title||row.name,description:row.description||row.content||'',status:row.status||null,...(type==='quest'?{time:row.time,duration:row.duration,repeat:row.repeat}:{}),visibility:'private'};
}
export async function readSkills(db){
 const store=new Store(db),skills=(await store.all('genesis_skills')).sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id));
 const links=[];for(const link of await store.all('genesis_skill_links')){const target=await reference(store,link.target_type,link.target_id);links.push({...link,target_title:target?.title||'关联记录已不存在',target_status:target?.status||null,missing:!target});}
 const summary=rows=>rows.map(r=>({id:r.id,title:r.title||r.name}));
 return {available:true,skills,links,options:{goal:summary((await store.all('genesis_goals')).filter(r=>r.status==='active')),quest:summary((await store.all('genesis_quests')).filter(r=>r.status!=='deleted')),project:summary(await visibleProjects(store)),asset:summary(await store.all('genesis_assets'))}};
}
async function validate(store,body,current=null){
 fields(body,['name','description','category','parent_id','status',...(current?['revision']:[])]);const value={description:'',category:'',parent_id:null,status:'not_started',...current,...body};
 for(const [key,max,label,required] of [['name',160,'技能名称',true],['description',2000,'描述',false],['category',60,'分类',false]])value[key]=text(value[key],max,label,required);
 if(!SKILL_STATES.includes(value.status))fail('请选择有效的技能状态。');
 if(value.parent_id!==null){if(typeof value.parent_id!=='string'||!value.parent_id||value.parent_id.length>200)fail('父节点无效。');let parent=await store.find('genesis_skills',value.parent_id);if(!parent)fail('父节点不存在。');const seen=new Set();while(parent){if(parent.id===current?.id||seen.has(parent.id))fail('父节点不能指向自己或形成循环。');seen.add(parent.id);parent=parent.parent_id?await store.find('genesis_skills',parent.parent_id):null;}}
 if(current)version(body,current);return Object.fromEntries(['name','description','category','parent_id','status'].map(k=>[k,value[k]]));
}
function version(body,current){if(!Number.isInteger(body.revision)||body.revision!==current.revision)fail('技能已被修改，请刷新后重试。',409);}
export async function writeSkill(store,path,method,body){
 const at=new Date().toISOString();
 if(path==='/api/genesis/skills'&&method==='POST'){if((await store.all('genesis_skills')).length>=1000)fail('技能节点数量已达上限。',409);return {skill:store.put('genesis_skills',{id:crypto.randomUUID(),...await validate(store,body),revision:1,source_type:'manual_skill',visibility:'private',created_at:at,updated_at:at})};}
 const match=path.match(/^\/api\/genesis\/skills\/([^/]+)(?:\/links(?:\/([^/]+))?)?$/);if(!match)fail('技能接口不存在。',404);
 const id=decodeURIComponent(match[1]),current=await store.find('genesis_skills',id);if(!current)fail('技能节点不存在。',404);
 if(!path.includes('/links')&&method==='PATCH'){const value=await validate(store,body,current),changed=Object.keys(value).some(k=>value[k]!==current[k]);return {skill:changed?store.put('genesis_skills',{...current,...value,revision:current.revision+1,updated_at:stamp(current.updated_at)}):current};}
 if(path.endsWith('/links')&&method==='POST'){
  fields(body,['target_type','target_id','revision']);version(body,current);const target=await reference(store,body.target_type,body.target_id);if(!target)fail('关联记录不存在。');if(body.target_type==='quest'&&target.status==='deleted')fail('不能新关联已删除使命。');
  const previous=(await store.all('genesis_skill_links')).find(r=>r.skill_id===id&&r.target_type===body.target_type&&r.target_id===target.id);if(previous)return {skill:current,link:previous,deduplicated:true};
  const link=store.put('genesis_skill_links',{id:crypto.randomUUID(),skill_id:id,target_type:body.target_type,target_id:target.id,created_at:at});return {skill:store.put('genesis_skills',{...current,revision:current.revision+1,updated_at:stamp(current.updated_at)}),link};
 }
 if(match[2]&&method==='DELETE'){fields(body,['revision']);version(body,current);const link=(await store.all('genesis_skill_links')).find(r=>r.id===decodeURIComponent(match[2])&&r.skill_id===id);if(!link)return {skill:current,deduplicated:true};store.remove('genesis_skill_links',link);return {skill:store.put('genesis_skills',{...current,revision:current.revision+1,updated_at:stamp(current.updated_at)}),removed_link_id:link.id};}
 fail('不支持此技能操作。',405);
}
