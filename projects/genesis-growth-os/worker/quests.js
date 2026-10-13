/** 独立 Genesis 使命；读取只汇总，执行必须由用户提交当天版本。 */
import {Store,fail,projectId,visibleProjects} from './store.js';
import {DIMENSIONS,TYPES,dimensionOf,publicState,dateInShanghai,dateValid,due,fields,parse} from './domain.js';
const own=(o,k)=>Object.hasOwn(o,k);
const shape=row=>({...row,weekdays:parse(row.weekdays_json,[])});
export async function questToday(store,date=dateInShanghai()){
 const plans=await store.all('genesis_quests'),runs=new Map((await store.all('genesis_quest_runs')).filter(r=>r.date===date).map(r=>[r.quest_id,r]));
 const goals=new Map((await store.all('genesis_goals')).map(g=>[g.id,g.title])),quests=[];
 for(const q of plans){const run=runs.get(q.id);if(q.status==='deleted'||(!due(q,date)&&!run))continue;
  const content=run?parse(run.snapshot_json,{}):q,paused=q.status==='paused'&&run?.status!=='completed',status=paused?'paused':publicState(run?.status||'not_started');
  const [attr,category]=TYPES[content.type]||TYPES.study;
  quests.push({id:q.id,title:content.title,description:content.description||'',dimension:dimensionOf(content),at:content.time,minutes:content.duration,attr,category,type:content.type,status,done:status==='completed',paused,planStatus:q.status,forgeDone:false,manual:Boolean(run)&&run.source_type!=='legacy_transfer',managed:true,revision:q.revision,runRevision:run?.revision||0,sortOrder:q.sort_order,goal_id:content.goal_id,goalTitle:run?(content.goal_title||null):goals.get(content.goal_id)||null,project_id:content.project_id,actionSource:run?.source_type==='legacy_transfer'?'已保存的历史行动':run?'手动行动记录':'自主使命计划',actionUpdatedAt:run?.updated_at||null,actionRef:{date,quest_id:q.id},reflection:{available:false,state:'reserved'}});
 }
 quests.sort((a,b)=>(a.at||'99:99').localeCompare(b.at||'99:99')||a.sortOrder-b.sortOrder||a.id.localeCompare(b.id));
 const active=quests.filter(q=>!q.paused),done=active.filter(q=>q.done).length;
 return {date,quests,total:active.length,done,inProgress:active.filter(q=>q.status==='in_progress').length,paused:quests.length-active.length,pct:active.length?Math.round(done/active.length*100):0,minutesLeft:active.filter(q=>!q.done).reduce((n,q)=>n+(q.minutes||0),0)};
}
async function options(store){return {goals:(await store.all('genesis_goals')).filter(g=>g.status==='active').sort((a,b)=>b.priority-a.priority||b.updated_at.localeCompare(a.updated_at)).map(({id,title,confidence})=>({id,title,confidence})),projects:(await visibleProjects(store)).filter(p=>p.status==='active').map(({id,name})=>({id,name}))};}
async function validate(store,body,current=null,date=dateInShanghai()){
 fields(body,['title','description','dimension','type','time','duration','repeat','scheduled_date','weekdays','goal_id','project_id','revision','status']);
 const value=current?{...shape(current),...body}:{description:'',weekdays:[],...body};
 const dimension=own(body,'dimension')?body.dimension:own(body,'type')?dimensionOf(body):dimensionOf(value);
 if(!own(DIMENSIONS,dimension)||own(body,'type')&&own(body,'dimension')&&DIMENSIONS[dimension]!==body.type)fail('请选择有效且一致的行动维度。');
 value.dimension=dimension;value.type=DIMENSIONS[dimension];
 if(typeof value.title!=='string'||!value.title.trim()||value.title.length>160)fail('使命名称应为1至160个字符。');
 if(typeof value.description!=='string'||value.description.length>2000)fail('使命描述最多2000个字符。');
 if(!['once','daily','weekly'].includes(value.repeat))fail('重复周期无效。');
 if(value.time!=null&&value.time!==''&&(typeof value.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)))fail('请选择有效时间。');
 if(value.duration!=null&&(!Number.isInteger(value.duration)||value.duration<1||value.duration>600))fail('预计时长应为1至600分钟。');
 if(!Array.isArray(value.weekdays)||value.weekdays.some(d=>!Number.isInteger(d)||d<0||d>6)||new Set(value.weekdays).size!==value.weekdays.length)fail('每周重复日期无效。');
 if(value.repeat==='weekly'&&!value.weekdays.length)fail('每周重复需至少选择一天。');
 if(value.repeat==='once'&&(!dateValid(value.scheduled_date)||((!current||value.scheduled_date!==current.scheduled_date||current.repeat!=='once')&&value.scheduled_date<date)))fail('一次性使命请选择今天或未来日期。');
 for(const [key,table] of [['goal_id','genesis_goals'],['project_id','genesis_projects']]){if(value[key]!=null&&(typeof value[key]!=='string'||value[key].length>200))fail('关联资料无效。');if(key==='project_id')value[key]=await projectId(store,value[key]);if(value[key]&&!await store.find(table,value[key]))fail('关联的目标或项目不存在。');}
 if(own(body,'status')&&!['active','paused','deleted'].includes(body.status))fail('计划状态无效。');
 if(current&&(!Number.isInteger(body.revision)||body.revision!==current.revision))fail('使命已被修改，请刷新后重试。',409);
 return {title:value.title.trim(),description:value.description.trim(),dimension:value.dimension,type:value.type,time:value.time||null,duration:value.duration??null,repeat:value.repeat,scheduled_date:value.repeat==='once'?value.scheduled_date:null,weekdays_json:JSON.stringify(value.repeat==='weekly'?[...value.weekdays].sort():[]),goal_id:value.goal_id||null,project_id:value.project_id||null,status:current?(body.status||current.status):'active'};
}
export async function readQuests(db){const store=new Store(db),plans=(await store.all('genesis_quests')).sort((a,b)=>a.sort_order-b.sort_order||a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id)).map(shape);return {available:true,plans,active:plans.filter(q=>q.status==='active'),today:await questToday(store),...await options(store)};}
export async function readRuns(db,params){
 const query=Object.fromEntries(params);fields(query,['from','to','quest_id','status','limit','offset']);const {from,to,quest_id,status,limit='20',offset='0'}=query;
 if((from&&!dateValid(from))||(to&&!dateValid(to))||(from&&to&&from>to))fail('请选择有效日期范围。');
 if(quest_id&&quest_id.length>200||status&&!['pending','in_progress','completed'].includes(status)||!/^\d+$/.test(limit)||!/^\d+$/.test(offset)||Number(limit)<1||Number(limit)>100||Number(offset)>1000000)fail('历史筛选或分页参数无效。');
 const conditions=[],args=[];for(const [value,condition] of [[from,'date>=?'],[to,'date<=?'],[quest_id,'quest_id=?'],[status==='pending'?'not_started':status,'status=?']])if(value){conditions.push(condition);args.push(value);}
 const where=conditions.length?' WHERE '+conditions.join(' AND '):'',total=(await db.prepare('SELECT COUNT(*) n FROM genesis_quest_runs'+where).bind(...args).first()).n;
 const {results}=await db.prepare('SELECT * FROM genesis_quest_runs'+where+' ORDER BY date DESC,quest_id LIMIT ? OFFSET ?').bind(...args,Number(limit),Number(offset)).all();
 return {runs:results.map(({snapshot_json,...row})=>({...row,status:publicState(row.status),snapshot:parse(snapshot_json,{})})),total,limit:Number(limit),offset:Number(offset)};
}
export async function writeQuest(store,path,method,body){
 const date=dateInShanghai(),at=new Date().toISOString();
 if(path==='/api/genesis/quests'&&method==='POST'){
  const rows=await store.all('genesis_quests');if(rows.length>=1000)fail('使命计划已达容量上限。',409);
  const quest=store.put('genesis_quests',{id:crypto.randomUUID(),...await validate(store,body),starts_on:date,sort_order:rows.reduce((n,q)=>Math.max(n,q.sort_order+1),0),legacy_source_id:null,revision:1,source_type:'manual_quest',confidence:'user_stated',visibility:'private',created_at:at,updated_at:at});return {quest:shape(quest),today:await questToday(store)};
 }
 if(path==='/api/genesis/quests/reorder'&&method==='POST'){
  fields(body,['ids','revisions']);const active=(await store.all('genesis_quests')).filter(q=>q.status!=='deleted'),{ids,revisions}=body;
  if(!Array.isArray(ids)||ids.length!==active.length||new Set(ids).size!==ids.length||!revisions||typeof revisions!=='object')fail('排序参数无效。');
  for(const q of active){if(!ids.includes(q.id)||revisions[q.id]!==q.revision)fail('计划已更新，请刷新后排序。',409);const order=ids.indexOf(q.id);if(q.sort_order!==order)store.put('genesis_quests',{...q,sort_order:order,revision:q.revision+1,updated_at:at});}return {today:await questToday(store)};
 }
 const match=path.match(/^\/api\/genesis\/quests\/([^/]+)(\/state)?$/);if(!match)fail('使命接口不存在。',404);
 const id=decodeURIComponent(match[1]),q=await store.find('genesis_quests',id);if(!q)fail('使命不存在。',404);
 if(!match[2]&&method==='PATCH'){const values=await validate(store,body,q);const changed=Object.keys(values).some(key=>values[key]!==q[key]);const quest=changed?store.put('genesis_quests',{...q,...values,revision:q.revision+1,updated_at:at}):q;return {quest:shape(quest),today:await questToday(store)};}
 if(match[2]&&method==='POST'){
  fields(body,['date','action','status','revision','run_revision']);if(body.date!==date)fail('只能记录当天使命的状态。');
  const actions={start:'in_progress',complete:'completed',cancel:'not_started'};if(body.action!=null&&(!own(actions,body.action)||body.status!=null))fail('请选择开始、完成或撤销。');
  const status=body.action?actions[body.action]:body.status==='pending'?'not_started':body.status;if(!['not_started','in_progress','completed'].includes(status))fail('使命状态无效。');
  const previous=(await store.all('genesis_quest_runs')).find(r=>r.quest_id===id&&r.date===date);
  if(q.status!=='active'||(!due(q,date)&&!previous))fail('该使命未启用或不属于今天。',409);
  if(body.revision!==q.revision||body.run_revision!==(previous?.revision||0))fail('使命状态已更新，请刷新后重试。',409);
  const deduplicated=previous?.status===status||(!previous&&status==='not_started');
  if(!deduplicated){const snapshot={title:q.title,description:q.description,dimension:q.dimension,type:q.type,time:q.time,duration:q.duration,repeat:q.repeat,weekdays:parse(q.weekdays_json,[]),scheduled_date:q.scheduled_date,goal_id:q.goal_id,project_id:q.project_id,version:q.revision,goal_title:q.goal_id?(await store.find('genesis_goals',q.goal_id))?.title||null:null,project_name:q.project_id?(await store.find('genesis_projects',q.project_id))?.name||null:null};
   store.put('genesis_quest_runs',previous?{...previous,status,completed_at:status==='completed'?at:null,revision:previous.revision+1,updated_at:at}:{quest_id:id,date,status,snapshot_json:JSON.stringify(snapshot),completed_at:status==='completed'?at:null,source_type:'manual_action',confidence:'user_stated',visibility:'private',revision:1,created_at:at,updated_at:at});
  }return {deduplicated,action:{date,quest_id:id,status:publicState(status)},today:await questToday(store)};
 }
 fail('不支持此使命操作。',405);
}
