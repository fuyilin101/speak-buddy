/** 历史只读：筛选请求不创建执行记录，不从当前定义补造旧内容。 */
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dimensions={body:'身体',learning:'学习',creation:'创造',life:'生活'};
const states={pending:'待开始',in_progress:'进行中',completed:'已完成'};
let offset=0,total=0,requestId=0,controller;
export function setHistoryPlans(plans){
 const selected=$('questHistoryQuest').value;
 $('questHistoryQuest').innerHTML='<option value="">全部使命</option>'+plans.map(q=>`<option value="${esc(q.id)}">${esc(q.title)}${q.status==='deleted'?'（已删除）':''}</option>`).join('');
 $('questHistoryQuest').value=selected;
}
async function load(){
 controller?.abort();controller=new AbortController();const activeController=controller,id=++requestId,timer=setTimeout(()=>activeController.abort(),20000);
 const query=new URLSearchParams({limit:'20',offset:String(offset)});
 for(const [key,input] of [['quest_id','questHistoryQuest'],['status','questHistoryStatus'],['from','questHistoryFrom'],['to','questHistoryTo']])if($(input).value)query.set(key,$(input).value);
 $('questHistoryFeedback').textContent='正在读取执行历史…';$('questHistoryList').innerHTML='';
 $('questHistoryPrevious').disabled=true;$('questHistoryNext').disabled=true;
 try{
  const response=await fetch('/api/genesis/quest-runs?'+query,{signal:activeController.signal});const data=await response.json();
  if(!response.ok)throw Error(data.error||'历史记录读取失败。');if(!Array.isArray(data.runs)||!Number.isInteger(data.total))throw Error('历史记录响应不完整。');if(id!==requestId)return;
  total=data.total;
  $('questHistoryList').innerHTML=data.runs.map(run=>{const s=run.snapshot||{};return `<article class="quest-history-card"><div class="quest-history-meta"><time>${esc(run.date)}</time><span>${esc(states[run.status]||'未知状态')}</span></div><h3>${esc(s.title||'历史使命')}</h3><p>${esc(s.description||'当时未记录描述')}</p><p>${esc(dimensions[s.dimension]||'当时未记录维度')} · ${esc(s.time||'未安排时间')} · ${s.duration==null?'预计投入未记录':esc(s.duration)+' 分钟'}</p><details><summary>${s.version==null?'历史保存快照（旧记录）':'首次执行快照'}</summary><dl><dt>重复周期</dt><dd>${esc(({daily:'每天',weekly:'每周',once:'一次'})[s.repeat]||'未记录')}</dd><dt>关联目标</dt><dd>${esc(s.goal_title||s.goal_id||'未关联')}</dd><dt>关联项目</dt><dd>${esc(s.project_name||s.project_id||'未关联')}</dd><dt>定义版本</dt><dd>${esc(s.version??s.revision??'未记录')}</dd><dt>完成时间</dt><dd>${esc(run.completed_at?new Date(run.completed_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'未记录')}</dd><dt>来源</dt><dd>${esc(run.source_type==='legacy_transfer'?'历史导入':run.source_type==='manual_action'?'用户主动执行':run.source_type)}</dd></dl></details></article>`;}).join('')||'<p class="genesis-empty">此范围内暂无执行记录。未执行的计划不会自动生成历史。</p>';
  $('questHistoryFeedback').textContent='历史读取成功 · 只读';$('questHistoryCount').textContent=total?`${offset+1}–${Math.min(offset+20,total)} / ${total} 条`:'0 条记录';
  $('questHistoryPrevious').disabled=offset===0;$('questHistoryNext').disabled=offset+20>=total;
 }catch(e){if(id===requestId)$('questHistoryFeedback').textContent=e.name==='AbortError'?'读取超时，请重新查询。':'读取失败：'+e.message;}
 finally{clearTimeout(timer);}
}
export function openQuestHistory(questId=''){offset=0;$('questHistoryQuest').value=questId;for(const input of ['questHistoryStatus','questHistoryFrom','questHistoryTo'])$(input).value='';$('questHistory').showModal();load();}
export function bindQuestHistory(){
 $('questHistoryOpen').addEventListener('click',()=>openQuestHistory());
 const close=()=>{requestId++;controller?.abort();};
 $('questHistoryClose').addEventListener('click',()=>{$('questHistory').close();close();});$('questHistory').addEventListener('cancel',close);
 $('questHistoryFilter').addEventListener('submit',event=>{event.preventDefault();offset=0;load();});
 $('questHistoryPrevious').addEventListener('click',()=>{offset=Math.max(0,offset-20);load();});
 $('questHistoryNext').addEventListener('click',()=>{if(offset+20<total){offset+=20;load();}});
}
