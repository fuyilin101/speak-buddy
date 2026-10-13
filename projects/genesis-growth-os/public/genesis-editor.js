/** 编辑只由用户点击触发；失败保留输入和请求键，不自动重试或显示虚假成功。 */
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const parse=(v,fallback)=>{try{return JSON.parse(v)||fallback;}catch{return fallback;}};
let data=null,editing=null,busy=false,retry=null,refreshHome;
const specs={projects:[['name','项目名称','text'],['description','项目描述','area'],['status','状态','status'],['domain','领域','text'],['progress','项目进度（%）','number'],['next_steps','下一步（每行一项）','area']],assets:[['title','资产标题','text'],['asset_type','资产类型','assettype'],['content','资产内容','area'],['tags','标签（每行一项）','area'],['project_id','关联项目','project']], 'growth-records':[['title','成长记录标题','text'],['content','记录内容','area'],['project_id','关联项目','project'],['completed_work','实际完成（每行一项）','area'],['problems','遇到的问题（每行一项）','area'],['solutions','解决方案（每行一项）','area'],['learned','学到的知识（每行一项）','area'],['reusable_assets','可复用经验（每行一项）','area'],['next_steps','下一步（每行一项）','area']],profile:[['display_name','昵称','text'],['current_stage','当前阶段','text'],['growth_route','成长路线','text']]};
const metadataLabels={manual_edit:'用户编辑',codex_agent:'Codex 同步',user_provided:'用户提供',repo_verified:'仓库核实',legacy:'历史记录',initial_memory:'初始记忆',user_stated:'用户自述',verified:'来源标记为已核实',agent_generated:'Agent 整理',pending_confirmation:'待确认',personal_playbook:'个人方法清单'};
const label=value=>metadataLabels[value]||window.genesisLabel(value);
const titles={projects:'项目档案',assets:'可复用资产','growth-records':'成长记录',profile:'我的角色'};
function rows(kind){return kind==='projects'?data.projects:kind==='assets'?data.assets:data.records;}
function report(message,failed=false){$('genesisEditorFeedback').textContent=message;$('genesisEditorFeedback').dataset.state=failed?'failed':'success';}
async function request(path,options={}){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);try{const r=await fetch(path,{...options,signal:controller.signal,cache:'no-store'});const value=await r.json().catch(()=>{throw Error('无法解析服务器结果，尚未确认保存。');});if(!r.ok)throw Error(value.error||'请求失败（'+r.status+'）。');return value;}catch(e){throw Error(e.name==='AbortError'?'请求超时，尚未确认保存，请刷新检查。':e.name==='TypeError'?'网络暂时不可用，尚未确认保存。':e.message);}finally{clearTimeout(timer);}}
function assetCard(a){return `<article class="vault-module-card"><div class="vault-card-symbol" aria-hidden="true">◇</div><div><p class="growth-eyebrow">${esc(label(a.asset_type))}</p><h3>${esc(a.title)}</h3><p class="vault-preview">${esc(a.content)}</p><small>更新时间：${esc(window.genesisFormatDate(a.updated_at))}</small></div><div class="vault-card-actions"><button data-vault-view="assets" data-record-id="${esc(a.id)}">查看</button><button data-vault-edit="assets" data-record-id="${esc(a.id)}">编辑</button></div></article>`;}
export async function refreshEditor(home){
 const available=home.editor?.available===true;window.genesisLocalEditing=available;document.querySelectorAll('[data-local-editor]').forEach(el=>{el.hidden=!available;});
 if(!available){data=null;return;}
 const loaded=await request('/api/genesis/editor');if(!loaded.available||!Array.isArray(loaded.assets)||!Array.isArray(loaded.projects)||!Array.isArray(loaded.records)||!loaded.profile)throw Error('编辑资料读取不完整。');data=loaded;
 $('growthVaultAssets').className='vault-module-grid';$('growthVaultAssets').innerHTML=data.assets.length?data.assets.map(assetCard).join(''):'<p class="genesis-empty">还没有可复用资产。</p>';
 $('genesisProjectList').innerHTML=data.projects.map(p=>`<article class="vault-project-row"><button class="genesis-project genesis-project-button" data-genesis-project-id="${esc(p.id)}"><span class="genesis-project-name">${esc(p.name)}</span><span class="genesis-project-meta">${esc(window.genesisLabel(p.domain))} · ${esc(window.genesisLabel(p.status))} · ${p.progress}% · 查看详情</span></button><button aria-label="编辑项目：${esc(p.name)}" data-vault-edit="projects" data-record-id="${esc(p.id)}">编辑</button></article>`).join('')||'<p class="genesis-empty">尚无项目。</p>';
 $('genesisRecordList').innerHTML=data.records.map(r=>`<article class="vault-record-row"><h3>${esc(r.title)}</h3><p class="vault-preview">${esc(r.content)}</p><div class="vault-card-actions"><button data-vault-view="growth-records" data-record-id="${esc(r.id)}">查看</button><button data-vault-edit="growth-records" data-record-id="${esc(r.id)}">编辑</button></div></article>`).join('')||'<p class="genesis-empty">尚无成长记录。</p>';
 $('genesisSettingsIdentity').innerHTML=['display_name','current_stage','growth_route'].map((key,i)=>`<div><span>${['昵称','当前阶段','成长路线'][i]}</span><strong>${esc(data.profile[key].value||'尚未设置')}</strong></div>`).join('');
}
function open(kind,id,readonly=false){if(!data||busy)return;const record=kind==='profile'?data.profile:rows(kind).find(r=>r.id===id);if(!record)return;editing={kind,id,record};retry=null;$('genesisEditTitle').textContent=(readonly?'查看':'编辑')+titles[kind];
 const details=parse(record.details_json,{});
 $('genesisEditFields').innerHTML=specs[kind].map(([key,label,type])=>{
  let value=kind==='profile'?record[key].value:key==='next_steps'&&kind==='projects'?parse(record.next_steps_json,[]).join('\n'):key==='tags'?parse(record.tags_json,[]).join('\n'):kind==='growth-records'&&key in details?(Array.isArray(details[key])?details[key].map(x=>typeof x==='string'?x:JSON.stringify(x)).join('\n'):String(details[key]||'')):record[key]??'';
  const attributes=`name="${key}" ${readonly?'disabled':''}`;
  const options=type==='status'?[['active','进行中'],['paused','已暂停'],['completed','已完成'],['archived','已归档']]:type==='project'?[['','暂不关联'],...data.projects.map(p=>[p.id,p.name])]:type==='assettype'?[['playbook','方法清单'],['knowledge','知识'],['code','代码'],['experience','经验'],['template','模板']]:null;
  if(options&&!options.some(([k])=>k===value))options.push([value,label(value)]);
  const input=options?`<select ${attributes}>${options.map(([v,n])=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(n)}</option>`).join('')}</select>`:type==='area'?`<textarea ${attributes} rows="${key==='content'?8:3}" maxlength="20000">${esc(value)}</textarea>`:`<input ${attributes} type="${type}" value="${esc(value)}" ${type==='number'?'min="0" max="100" step="1"':'maxlength="2000"'} ${['name','title','display_name','domain'].includes(key)?'required':''}>`;
  return `<label>${label}${input}</label>`;
 }).join('');
 $('genesisEditProvenance').textContent=kind==='profile'?'资料默认私有，只保存你明确填写的内容。':`来源：${label(record.source_type||'待确认')} · 可信状态：${label(record.confidence||'待确认')} · 原始来源与证据保留。`;
 $('genesisEditEvidence').textContent=kind==='profile'?'':JSON.stringify(parse(record.evidence_json,[]),null,2);$('genesisEditEvidence').hidden=!$('genesisEditEvidence').textContent||$('genesisEditEvidence').textContent==='[]';
 $('genesisEditError').textContent='';$('genesisEditSave').hidden=readonly;$('genesisEditSwitch').hidden=!readonly;$('genesisEditSwitch').textContent='编辑'+titles[kind];$('genesisEditDialog').showModal();
}
export function bindEditor(refresh){refreshHome=refresh;
 document.addEventListener('click',event=>{const button=event.target.closest('[data-vault-edit],[data-vault-view],[data-edit-profile]');if(!button)return;if(button.hasAttribute('data-edit-profile'))open('profile');else open(button.dataset.vaultEdit||button.dataset.vaultView,button.dataset.recordId,!!button.dataset.vaultView);});
 $('genesisEditCancel').addEventListener('click',()=>{if(!busy)$('genesisEditDialog').close();});$('genesisEditDialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
 $('genesisEditSwitch').addEventListener('click',()=>{$('genesisEditDialog').close();open(editing.kind,editing.id);});
 $('genesisEditForm').addEventListener('submit',async e=>{e.preventDefault();if(busy||!editing||!$('genesisEditForm').reportValidity())return;
  const {kind,id,record}=editing,form=new FormData($('genesisEditForm')),body={};const lines=key=>String(form.get(key)||'').split('\n').map(s=>s.trim()).filter(Boolean);
  if(kind==='profile'){for(const [key] of specs.profile)body[key]=form.get(key);body.versions=Object.fromEntries(Object.entries(record).map(([k,v])=>[k,v.updated_at]));}
  else{body.expected_updated_at=record.updated_at;for(const [key] of specs[kind]){if(kind==='growth-records'&&!['title','content','project_id'].includes(key))continue;body[key]=key==='progress'?Number(form.get(key)):['tags','next_steps'].includes(key)?lines(key):key==='project_id'?form.get(key)||null:form.get(key);}
   if(kind==='growth-records')body.details=Object.fromEntries(specs[kind].slice(3).map(([key])=>[key,lines(key)]));}
  const path='/api/genesis/editor/'+(kind==='profile'?'profile':kind+'/'+id),fingerprint=JSON.stringify([path,body]);if(retry?.fingerprint!==fingerprint)retry={fingerprint,key:crypto.randomUUID()};busy=true;$('genesisEditSave').disabled=true;
  try{const result=await request(path,{method:'PATCH',headers:{'Content-Type':'application/json','Idempotency-Key':retry.key},body:JSON.stringify(body)});if(result.success!==true||typeof result.deduplicated!=='boolean'||(kind==='profile'?!result.profile:result.record?.id!==id))throw Error('服务器结果不完整，尚未确认保存。');retry=null;$('genesisEditDialog').close();await refreshHome();if(kind==='projects')await window.loadGenesisProjectDetail(id);else $('genesisProjectDetail').hidden=true;report('修改已保存，原始来源与证据仍然保留。');}
  catch(error){$('genesisEditError').textContent=error.message+' 未自动重试，输入仍然保留。';report(error.message,true);}finally{busy=false;$('genesisEditSave').disabled=false;}
 });
}
