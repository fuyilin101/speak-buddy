import {bindQuestHistory,openQuestHistory,setHistoryPlans} from './genesis-quest-history.js';
/** 自主使命编辑器：请求只来自用户操作；失败保留输入，不自动重试。 */
const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let data=null,editing=null,busy=false,retry=null,refreshHome,homeGetter,pendingDelete=null;
const names={study:'学习',training:'身体',project:'创造',life:'生活'};
const repeatNames={once:'一次',daily:'每天',weekly:'每周'};
const statusNames={active:'启用',paused:'暂停',deleted:'已删除'};
function report(message,failed=false){$('questBuilderFeedback').textContent=message;$('questBuilderFeedback').dataset.state=failed?'failed':'success';}
async function request(url,{method='GET',body,key}={}){
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),20000);
 try{
  const response=await fetch(url,{method,signal:abort.signal,headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const value=await response.json().catch(()=>{throw Error('服务器结果无法解析，尚未确认保存。');});
  if(!response.ok)throw Error(value.error||`使命请求失败（${response.status}）。`);
  return value;
 }catch(e){throw Error(e.name==='AbortError'?'请求超时，请刷新确认后手动重试。':e.name==='TypeError'?'网络连接中断，尚未确认保存。':e.message);}finally{clearTimeout(timer);}
}
export async function refreshQuestBuilder(home){
 if(!home.questBuilder?.available){data=null;$('questBuilder').hidden=true;$('questQuickCreate').hidden=true;return;}
 const loaded=await request('/api/genesis/quests');
 if(loaded.available!==true||!Array.isArray(loaded.plans)||!Array.isArray(loaded.goals)||!Array.isArray(loaded.projects))throw Error('使命计划读取结果不完整。');
 data=loaded;setHistoryPlans(data.plans);$('questBuilder').hidden=false;$('questQuickCreate').hidden=false;renderPlans();
}
function renderPlans(){
 const filter=$('questPlanFilter').value;
 const plans=data.plans.filter(q=>filter==='all'||q.status===filter).sort((a,b)=>(a.time||'99:99').localeCompare(b.time||'99:99'));
 $('questPlanList').innerHTML=plans.length?plans.map(q=>`<article class="quest-plan-row" data-plan-id="${esc(q.id)}"><div><h3>${esc(q.title)}</h3><p>${esc(q.description||'尚未填写使命描述')}</p><p>${names[q.type]} · ${esc(q.time||'自由安排')} · ${q.duration==null?'时长未记录':q.duration+' 分钟'} · ${repeatNames[q.repeat]} · ${statusNames[q.status]}</p></div><div class="quest-plan-buttons"><button data-plan-command="history">历史</button>${q.status==='deleted'?'<button data-plan-command="restore">恢复</button>':'<details><summary aria-label="管理使命规则：'+esc(q.title)+'">···</summary><div class="quest-plan-menu"><button data-plan-command="edit">编辑规则</button><button data-plan-command="pause">'+(q.status==='paused'?'恢复使命':'暂停')+'</button><button data-plan-command="delete">删除</button></div></details>'}</div></article>`).join(''):'<p class="genesis-empty">此分类下暂无使命计划。</p>';
}
export function renderQuestPlanOrder(){if(data)renderPlans();}
function openEditor(quest=null,field=null){
 editing=quest;retry=null;document.querySelectorAll('details[open]').forEach(menu=>{menu.open=false;});
 const today=homeGetter().training.today.date;
 $('questEditorTitle').textContent=quest?'编辑使命':'创建使命';
 const source=quest||{};
 $('questForm').reset();
 $('questTitleInput').value=source.title||$('questQuickTitle').value.trim();
 $('questDescriptionInput').value=source.description||'';
 $('questTypeInput').value=source.dimension||'learning';
 $('questTimeInput').value=source.time||source.at||'';
 $('questDurationInput').value=source.duration??source.minutes??'';
 $('questRepeatInput').value=source.repeat||'once';
 $('questDateInput').value=source.scheduled_date||today;$('questDateInput').min=quest?.scheduled_date&&quest.scheduled_date<today?quest.scheduled_date:today;
 $('questGoalInput').innerHTML='<option value="">暂不关联</option>'+data.goals.map(g=>`<option value="${esc(g.id)}">${esc(g.title)}</option>`).join('');
 $('questProjectInput').innerHTML='<option value="">暂不关联</option>'+data.projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
 if(source.goal_id&&!data.goals.some(g=>g.id===source.goal_id))$('questGoalInput').insertAdjacentHTML('beforeend','<option value="'+esc(source.goal_id)+'">已保存的关联目标（当前未启用）</option>');
 if(source.project_id&&!data.projects.some(p=>p.id===source.project_id))$('questProjectInput').insertAdjacentHTML('beforeend','<option value="'+esc(source.project_id)+'">已保存的关联项目（当前未启用）</option>');
 $('questGoalInput').value=source.goal_id||'';$('questProjectInput').value=source.project_id||'';
 document.querySelectorAll('[name="questWeekday"]').forEach(input=>{input.checked=(source.weekdays||[]).includes(Number(input.value));});
 updateSchedule();$('questEditorError').textContent='';$('questEditor').showModal();
 $(field==='time'?'questTimeInput':field==='type'?'questTypeInput':'questTitleInput').focus();
}
function updateSchedule(){const repeat=$('questRepeatInput').value;$('questDateField').hidden=repeat!=='once';$('questWeekdays').hidden=repeat!=='weekly';$('questDateInput').required=repeat==='once';}
async function mutate(url,method,body){
 if(busy)return false;busy=true;
 const fingerprint=JSON.stringify([url,method,body]);if(retry?.fingerprint!==fingerprint)retry={fingerprint,key:crypto.randomUUID()};
 const controls=[...document.querySelectorAll('#questBuilder button,#questQuickCreate button,#questEditor button,#questDelete button,#growthQuestList button,#refreshGenesis')];
 const disabled=controls.map(b=>b.disabled);controls.forEach(b=>{b.disabled=true;});
 try{
  const result=await request(url,{method,body,key:retry.key});
  if(result.success!==true||typeof result.deduplicated!=='boolean'||!Array.isArray(result.today?.quests))throw Error('服务器未确认使命保存结果。');
  retry=null;await refreshHome();report(result.deduplicated?'已保存，无需重复操作。':'使命计划已保存。');return true;
 }catch(e){report(e.message+' 未自动重试，请检查后手动重试。',true);$('questEditorError').textContent=e.message;return false;}
 finally{busy=false;controls.forEach((b,i)=>{if(b.isConnected)b.disabled=disabled[i];});}
}
export function bindQuestBuilder(getHome,refresh){
 homeGetter=getHome;refreshHome=refresh;bindQuestHistory();
 $('questPlanFilter').addEventListener('change',renderPlans);
 $('questCreate').addEventListener('click',()=>{if(!busy&&data)openEditor();});
 $('questEditorCancel').addEventListener('click',()=>{if(!busy)$('questEditor').close();});
 $('questEditor').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
 $('questRepeatInput').addEventListener('change',updateSchedule);
 $('questDeleteCancel').addEventListener('click',()=>{if(!busy)$('questDelete').close();});
 $('questDelete').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
 $('questDeleteConfirm').addEventListener('click',async()=>{if(!pendingDelete||busy)return;const q=pendingDelete;if(await mutate('/api/genesis/quests/'+q.id,'PATCH',{revision:q.revision,status:'deleted'})){$('questDelete').close();pendingDelete=null;}});
 $('questForm').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!$('questForm').reportValidity())return;
  const body={title:$('questTitleInput').value.trim(),description:$('questDescriptionInput').value.trim(),dimension:$('questTypeInput').value,time:$('questTimeInput').value||null,
   duration:$('questDurationInput').value===''?null:Number($('questDurationInput').value),repeat:$('questRepeatInput').value,
   scheduled_date:$('questDateInput').value,weekdays:[...document.querySelectorAll('[name="questWeekday"]:checked')].map(i=>Number(i.value)),
   goal_id:$('questGoalInput').value||null,project_id:$('questProjectInput').value||null,...(editing?{revision:editing.revision}:{})};
  if(await mutate('/api/genesis/quests'+(editing?'/'+editing.id:''),editing?'PATCH':'POST',body)){$('questEditor').close();$('questQuickTitle').value='';}
 });
 const handlePlanClick = async event=>{
  const button=event.target.closest('[data-plan-command]'),row=button?.closest('[data-plan-id]');if(!row||busy)return;
  const q=data.plans.find(q=>q.id===row.dataset.planId),command=button.dataset.planCommand;if(!q)return;
  if(['edit','time','type'].includes(command)){openEditor(q,command);return;}
  if(command==='history'){openQuestHistory(q.id);return;}
  if(command==='delete'){pendingDelete=q;$('questDeleteName').textContent=q.title;$('questDelete').showModal();return;}
  const status=command==='delete'?'deleted':command==='restore'?'active':q.status==='paused'?'active':'paused';
  await mutate('/api/genesis/quests/'+q.id,'PATCH',{revision:q.revision,status});
 };
 $('questPlanList').addEventListener('click',handlePlanClick);
 $('growthQuestList').addEventListener('click',handlePlanClick);
}
