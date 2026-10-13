import {skillForest,descendantIds,skillStatuses,skillTargets} from './genesis-skill-model.mjs';
import {GrowthTree} from './genesis-growth-tree.mjs';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let data=null,forest=null,selected=null,editing=null,reading=false,busy=false,retry=null,referenceRequest=0;
let onSkillsChanged=()=>{};
const collapsed=new Set();
let growthTree=null;
export function syncGrowthTreeVisibility(){growthTree?.enter();}
function report(message,failed=false) {$('skillFeedback').textContent=message;$('skillFeedback').dataset.state=failed?'failed':'ready';}
async function request(url,{method='GET',body,key}={}) {
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 try {
  const response=await fetch(url,{method,cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const value=await response.json().catch(()=>{throw Error('服务器结果无法解析，请刷新确认。');});
  if(!response.ok) throw Error(value.error||'技能请求失败，请重试。');return value;
 } catch(error) {throw Error(error.name==='AbortError'?'请求超时，尚未确认结果，请刷新检查。':error.name==='TypeError'?'网络连接中断，尚未确认结果，请刷新检查。':error.message);}
 finally {clearTimeout(timer);}
}
function render() {
 if(!data) return;
 growthTree.setData(forest,data.links);
 $('skillExpandAll').disabled=!data.skills.length;$('skillCollapseAll').disabled=!data.skills.length;
 if($('skillDetail').open && selected) renderDetail();
}
async function refreshData(snapshot=null) {
 reading=true;$('skillCreate').disabled=true;
 try {
  const value=snapshot||await request('/api/genesis/skills');
  if(value.available!==true || !Array.isArray(value.links) || !value.options || Object.keys(skillTargets).some(type=>!Array.isArray(value.options[type]))) throw Error('成长路线响应不完整。');
  const tree=skillForest(value.skills);
  if(value.links.some(link=>!tree.byId.has(link.skill_id)||!Object.hasOwn(skillTargets,link.target_type))) throw Error('技能关联数据无效。');
  data=value;forest=tree;render();onSkillsChanged(value);return true;
 } catch(error) {
  report((data?'保留上次展示；':'')+'读取失败：'+error.message,true);
  if(!data) $('skillTreeNodes').innerHTML='<p class="genesis-empty">成长路线读取失败，请点击刷新状态后重试。</p>';
  return false;
 } finally {reading=false;$('skillCreate').disabled=!data;}
}
export async function refreshSkills(home,snapshot=null) {
 if(snapshot?.error){report((data?'保留上次展示；':'')+'读取失败：'+snapshot.error,true);if(!data){$('skillTreeNodes').innerHTML='<p class="genesis-empty">成长路线暂时无法读取，请重试。</p>';$('skillCreate').hidden=true;}return false;}
 const available=snapshot?snapshot.value?.available===true:home?.skillTree?.available===true;
 $('skillCreate').hidden=!available;
 $('skillExpandAll').hidden=!available;$('skillCollapseAll').hidden=!available;
 if(!available) {data=null;forest=null;$('skillTreeNodes').innerHTML='<div class="skill-empty"><h2>当前环境尚未启用技能树</h2><p>请确认当前服务已完成技能树迁移。</p></div>';report('');return true;}
 report('正在读取成长路线…');const success=await refreshData(snapshot?.value);if(success)report('');return success;
}
function renderDetail() {
 const skill=forest.byId.get(selected);if(!skill)return;
 $('skillDetailTitle').textContent=skill.name;$('skillDetailDescription').textContent=skill.description||'尚未填写学习方向。';
 $('skillDetailCategory').textContent=skill.category||'未分类';$('skillDetailStatus').textContent=skillStatuses[skill.status];
 const parent=forest.byId.get(skill.parent_id);$('skillDetailParent').textContent=parent?.name||'根节点';
 $('skillDetailLinks').innerHTML=Object.entries(skillTargets).map(([type,label])=>{
  const rows=data.links.filter(link=>link.skill_id===selected&&link.target_type===type);
  return '<section class="skill-link-group"><h3>关联'+label+'</h3>'+(rows.length?'<ul>'+rows.map(link=>'<li><button data-skill-reference="'+esc(link.id)+'" '+(link.missing?'disabled':'')+'>'+esc(link.target_title)+(link.target_status==='deleted'?'（已删除）':'')+'</button><button class="skill-unlink" data-skill-unlink="'+esc(link.id)+'" aria-label="解除关联：'+esc(link.target_title)+'">解除</button></li>').join('')+'</ul>':'<p>尚未关联'+label+'。</p>')+'</section>';
 }).join('');
}
function openDetail(id) {
 if(!forest?.byId.has(id) || reading || busy)return;
 selected=id;growthTree.select(id);renderDetail();$('skillDetailFeedback').textContent='';if(!$('skillDetail').open){if(window.matchMedia('(max-width:700px)').matches)$('skillDetail').showModal();else $('skillDetail').show();}
}
async function openReference(link) {
 if(!link||link.missing||busy||reading)return;
 const id=++referenceRequest;$('skillDetail').close();
 if(link.target_type==='project') {location.hash='vault';await window.loadGenesisProjectDetail(link.target_id);return;}
 const asset=link.target_type==='asset';
 const title=$(asset?'dashboardAssetTitle':'skillReferenceTitle'),content=$(asset?'dashboardAssetContent':'skillReferenceText'),dialog=$(asset?'dashboardAssetDetail':'skillReference');
 title.textContent=link.target_title;content.textContent='正在读取关联内容…';if(asset)$('dashboardAssetDate').textContent='来自本技能的关联资产 · 只读';if(!dialog.open)dialog.showModal();
 try {const value=await request('/api/genesis/skills/reference/'+link.target_type+'/'+encodeURIComponent(link.target_id));if(id!==referenceRequest)return;
  if(!value.record||typeof value.record.title!=='string')throw Error('关联内容响应不完整。');title.textContent=value.record.title;content.textContent=value.record.description||'尚未填写说明。';
 }catch(error){if(id===referenceRequest)content.textContent='读取失败：'+error.message;}
}
function openEditor(skill=null,parentId=null) {
 if(!data || reading || busy)return;editing=skill;retry=null;$('skillDetail').close();$('skillForm').reset();
 $('skillEditorTitle').textContent=skill?'编辑技能':'创建技能';$('skillName').value=skill?.name||'';$('skillDescription').value=skill?.description||'';$('skillCategory').value=skill?.category||'';$('skillStatus').value=skill?.status||'not_started';
 const excluded=skill?descendantIds(forest,skill.id):new Set();
 $('skillParent').innerHTML='<option value="">根节点</option>'+data.skills.filter(node=>!excluded.has(node.id)).map(node=>{
  const parent=forest.byId.get(node.parent_id);return '<option value="'+esc(node.id)+'">'+esc((parent?parent.name+' / ':'')+node.name)+'</option>';
 }).join('');
 $('skillParent').value=skill?.parent_id||parentId||'';$('skillEditorError').textContent='';$('skillEditor').showModal();$('skillName').focus();
}
function updateLinkOptions() {
 const type=$('skillLinkType').value,used=new Set(data.links.filter(link=>link.skill_id===selected&&link.target_type===type).map(link=>link.target_id));
 const options=data.options[type].filter(target=>!used.has(target.id));
 $('skillLinkTarget').innerHTML='<option value="">'+(options.length?'选择已有'+skillTargets[type]:'暂无可关联的'+skillTargets[type])+'</option>'+options.map(target=>'<option value="'+esc(target.id)+'">'+esc(target.title)+'</option>').join('');
 $('skillLinkSave').disabled=!options.length;
}
async function mutate(url,method,body) {
 if(busy || reading)return null;busy=true;
 const fingerprint=JSON.stringify([url,method,body]);if(retry?.fingerprint!==fingerprint)retry={fingerprint,key:crypto.randomUUID()};
 const buttons=[...document.querySelectorAll('#growthSkills button,#skillDetail button,#skillEditor button,#skillLinkEditor button')],disabled=buttons.map(button=>button.disabled);buttons.forEach(button=>{button.disabled=true;});
 try {
  const result=await request(url,{method,body,key:retry.key});
  if(result.success!==true || typeof result.deduplicated!=='boolean' || typeof result.skill?.id!=='string' || !Number.isInteger(result.skill.revision)) throw Error('服务器未确认保存结果，请刷新检查。');
  retry=null;
  if(await refreshData())report(result.deduplicated?'已经保存，无需重复操作。':'成长路线已保存。');
  else report('修改已保存，但列表刷新失败，请刷新查看。',true);
  return result;
 } catch(error) {
  const message='保存失败：'+error.message+' 未自动重试。';report(message,true);$('skillEditorError').textContent=message;$('skillLinkError').textContent=message;$('skillDetailFeedback').textContent=message;return null;
 } finally {busy=false;buttons.forEach((button,index)=>{if(button.isConnected)button.disabled=disabled[index];});}
}
export function bindSkills(onChange=()=>{}) {
 onSkillsChanged=onChange;
 growthTree=new GrowthTree($('skillTreeNodes'),{collapsed,onSelect:openDetail,onResult:id=>openReference(data?.links.find(link=>link.id===id))});
 $('skillCreate').addEventListener('click',()=>openEditor());
 $('skillExpandAll').addEventListener('click',()=>growthTree.expandAll(true));
 $('skillCollapseAll').addEventListener('click',()=>growthTree.expandAll(false));
 $('skillTreeNodes').addEventListener('click',event=>{
  if(event.target.closest('[data-growth-create]'))openEditor();
 });
 $('skillDetailEdit').addEventListener('click',()=>openEditor(forest?.byId.get(selected)));
 $('skillDetailChild').addEventListener('click',()=>openEditor(null,selected));
 $('skillDetailClose').addEventListener('click',()=>{if(!busy)$('skillDetail').close();});
 $('skillDetail').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 $('skillDetail').addEventListener('keydown',event=>{if(event.key==='Escape'&&!busy){event.preventDefault();$('skillDetail').close();}});
 $('skillEditorCancel').addEventListener('click',()=>{if(!busy)$('skillEditor').close();});
 $('skillEditor').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 $('skillForm').addEventListener('submit',async event=>{
  event.preventDefault();if(busy || reading || !$('skillForm').reportValidity())return;
  const body={name:$('skillName').value.trim(),description:$('skillDescription').value.trim(),category:$('skillCategory').value.trim(),parent_id:$('skillParent').value||null,status:$('skillStatus').value,...(editing?{revision:editing.revision}:{})};
  const result=await mutate('/api/genesis/skills'+(editing?'/'+editing.id:''),editing?'PATCH':'POST',body);
  if(result){$('skillEditor').close();openDetail(result.skill.id);}
 });
 $('skillDetailConnect').addEventListener('click',()=>{if(busy || reading)return;$('skillDetail').close();$('skillLinkForm').reset();retry=null;$('skillLinkError').textContent='';updateLinkOptions();$('skillLinkEditor').showModal();});
 $('skillLinkType').addEventListener('change',updateLinkOptions);
 $('skillLinkCancel').addEventListener('click',()=>{if(!busy){$('skillLinkEditor').close();openDetail(selected);}});
 $('skillLinkEditor').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 $('skillLinkForm').addEventListener('submit',async event=>{
  event.preventDefault();if(busy || reading || !$('skillLinkForm').reportValidity())return;
  const result=await mutate('/api/genesis/skills/'+selected+'/links','POST',{target_type:$('skillLinkType').value,target_id:$('skillLinkTarget').value,revision:forest.byId.get(selected).revision});
  if(result){$('skillLinkEditor').close();openDetail(selected);}
 });
 $('skillDetailLinks').addEventListener('click',async event=>{
  const remove=event.target.closest('[data-skill-unlink]');if(remove){await mutate('/api/genesis/skills/'+selected+'/links/'+remove.dataset.skillUnlink,'DELETE',{revision:forest.byId.get(selected).revision});return;}
  const button=event.target.closest('[data-skill-reference]');if(!button || button.disabled || busy)return;
  await openReference(data.links.find(link=>link.id===button.dataset.skillReference));
 });
 $('skillReferenceClose').addEventListener('click',()=>{referenceRequest++;$('skillReference').close();});$('skillReference').addEventListener('cancel',()=>referenceRequest++);
}
