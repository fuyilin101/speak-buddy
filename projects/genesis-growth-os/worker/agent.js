/** 沿用 Connector 的来源与响应契约；人工修改项目不会被 Agent 覆盖。 */
import {fail,projectId} from './store.js';
export async function saveAgent(store,operation,body){
 const at=new Date().toISOString();
 if(operation==='genesis_save_project'){
  const existing=(await store.all('genesis_projects')).find(row=>row.source_ref===body.source_ref),id=existing?await projectId(store,existing.id):'project-'+crypto.randomUUID(),current=existing?await store.find('genesis_projects',id):null;
  if(current?.source_type==='manual_edit')return {operation,created:false,deduplicated:true,manual_preserved:true,project:current};
  const values={name:body.name.trim(),description:String(body.description||''),status:body.status||'active',domain:String(body.domain||'growth'),progress:Math.round(Number(body.progress||0)),target_date:body.target_date||null,repo_path:body.repo_path||null,git_commit:body.git_commit||null,evidence_json:body.evidence==null?null:JSON.stringify(body.evidence),next_steps_json:body.next_steps==null?null:JSON.stringify(body.next_steps),source_type:body.source_type||'agent_generated',confidence:body.confidence||'agent_generated',visibility:body.visibility||'private',updated_at:at};
  const project=store.put('genesis_projects',current?{...current,...values}:{id,...values,source_ref:body.source_ref,created_at:at});return {operation,created:!existing,deduplicated:Boolean(existing),project};
 }
 const id=await projectId(store,body.project_id||null);if(id&&!await store.find('genesis_projects',id))fail('关联项目不存在。');
 const growth=operation==='genesis_add_growth',table=growth?'genesis_growth_records':'genesis_assets',previous=(await store.all(table)).find(row=>row.source_ref===body.source_ref);
 if(previous)return {operation,created:false,deduplicated:true,[growth?'record':'asset']:previous};
 const common={id:(growth?'record-':'asset-')+crypto.randomUUID(),project_id:id,title:body.title.trim(),content:String(body.content||''),source_ref:body.source_ref,evidence_json:body.evidence==null?null:JSON.stringify(body.evidence),source_type:body.source_type||'agent_generated',confidence:body.confidence||'agent_generated',visibility:body.visibility||'private',created_at:at,updated_at:at};
 const value=growth?{...common,record_type:String(body.record_type||'reflection'),metric_value:body.metric_value==null||body.metric_value===''?null:Number(body.metric_value),metric_unit:body.metric_unit||null,details_json:body.details==null?null:JSON.stringify(body.details),recorded_at:body.recorded_at||at}:{...common,asset_type:String(body.asset_type||'playbook'),tags_json:body.tags==null?null:JSON.stringify(body.tags)};
 return {operation,created:true,deduplicated:false,[growth?'record':'asset']:store.put(table,value)};
}
