import {questPreview,skillPreview,outcomePreview} from './genesis-dashboard-model.mjs';
import {skillStatuses} from './genesis-skill-model.mjs';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const empty=text=>'<p class="dashboard-empty">'+esc(text)+'</p>';
const listEmpty=text=>'<li class="dashboard-empty">'+esc(text)+'</li>';
const questStates={pending:'待开始',not_started:'待开始',in_progress:'进行中',completed:'已完成',paused:'已暂停'};
let assets=[];
const shown={home:false,skills:false,vault:false};
export function dashboardLoading(section) {
 const ids={home:['dashboardRoleFeedback','dashboardQuestFeedback'],skills:['dashboardSkillFeedback'],vault:['dashboardOutcomeFeedback']};
 for(const id of ids[section]){$(id).textContent='正在读取…';$(id).dataset.state='loading';}
}
export function dashboardFeedback(section,result) {
 const ids={home:['dashboardRoleFeedback','dashboardQuestFeedback'],skills:['dashboardSkillFeedback'],vault:['dashboardOutcomeFeedback']};
 for(const id of ids[section]) {
  const node=$(id);node.dataset.state=result.error?'failed':result.unavailable?'unavailable':'ready';
  node.replaceChildren();
  if(result.error){const message=document.createElement('span');message.textContent='读取失败：'+result.error+(shown[section]?' 已显示的内容为上次读取结果。':'');node.append(message);const retry=document.createElement('button');retry.type='button';retry.dataset.dashboardRetry=section;retry.textContent='重试';node.append(retry);}
  else if(result.unavailable)node.textContent='当前环境尚未启用技能树。';
 }
 if(result.error&&!shown[section]) {
  if(section==='home'){$('growthName').textContent='角色资料暂时无法读取';$('growthIdentitySource').textContent='角色来源暂时无法读取';$('dashboardRoleRoute').textContent='成长路线暂时无法读取';$('growthGoal').innerHTML=empty('当前目标暂时无法读取。');$('dashboardQuestState').textContent='今日使命读取失败';$('dashboardQuestList').innerHTML=listEmpty('重试后查看今天的使命。');}
  if(section==='skills')$('dashboardSkillList').innerHTML=listEmpty('成长路线暂时无法读取。');
  if(section==='vault')for(const id of ['dashboardProjectList','dashboardAssetList'])$(id).innerHTML=listEmpty('最近成果暂时无法读取。');
 }
}
export function renderDashboardHome(home) {
 const preview=questPreview(home);
 $('dashboardRoleRoute').textContent=home.identity.route?.text||'尚未填写成长路线';
 $('growthGoal').innerHTML=home.goal?'<h3>'+esc(home.goal.title)+'</h3><p>'+esc(home.goal.description||'尚未填写目标描述。')+'</p><span class="growth-source">来源：'+esc(home.goal.source)+'</span>':empty('尚未确认当前目标。');
 $('dashboardQuestDone').textContent=preview.available?(preview.total?preview.done+' / '+preview.total:'尚无使命'):'尚未接入';
 $('dashboardQuestState').textContent=preview.state;
 $('dashboardQuestList').innerHTML=preview.quests.length?preview.quests.map(q=>'<li><a href="#quests" class="dashboard-row"><span class="dashboard-row-marker" data-status="'+q.status+'" aria-hidden="true">'+(q.status==='completed'?'✓':'·')+'</span><span class="dashboard-row-copy"><strong>'+esc(q.title)+'</strong><small>'+esc(q.at||'自由安排')+(Number.isFinite(q.minutes)?' · '+q.minutes+' 分钟':'')+'</small></span><span class="dashboard-status">'+questStates[q.status]+'</span></a></li>').join(''):listEmpty(preview.available?'为今天安排一项属于自己的成长使命。':'每日使命目前仅在已启用的本地环境提供。');
 shown.home=true;
}
export function renderDashboardSkills(value) {
 const roots=skillPreview(value);
 $('dashboardSkillList').innerHTML=roots.length?roots.map(skill=>'<li><a href="#skills" class="dashboard-row"><span class="dashboard-branch-mark" aria-hidden="true">◇</span><span class="dashboard-row-copy"><strong>'+esc(skill.name)+'</strong><small>'+esc(skill.category||'未分类')+'</small></span><span class="dashboard-status">'+skillStatuses[skill.status]+'</span></a></li>').join(''):listEmpty('尚未建立成长路线。到技能树创建你的第一个方向。');
 shown.skills=true;
}
export function renderDashboardOutcomes(vault) {
 const result=outcomePreview(vault);assets=vault.assets;
 $('dashboardProjectList').innerHTML=result.projects.length?result.projects.map(p=>'<li><button type="button" data-growth-project="'+esc(p.id)+'" class="dashboard-outcome"><span class="dashboard-outcome-mark" aria-hidden="true">◈</span><span><strong>'+esc(p.name)+'</strong><small>'+esc(window.genesisLabel(p.status))+' · '+esc(window.genesisFormatDate(p.updated_at||p.created_at))+'</small></span><span aria-hidden="true">↗</span></button></li>').join(''):listEmpty('还没有项目成果。你的实践会在这里留下记录。');
 $('dashboardAssetList').innerHTML=result.assets.length?result.assets.map(a=>'<li><button type="button" data-dashboard-asset="'+esc(a.id)+'" class="dashboard-outcome"><span class="dashboard-outcome-mark" aria-hidden="true">◇</span><span><strong>'+esc(a.title)+'</strong><small>'+esc(window.genesisFormatDate(a.updated_at||a.created_at))+'</small></span><span aria-hidden="true">↗</span></button></li>').join(''):listEmpty('还没有沉淀资产。可复用的方法与经验将在这里出现。');
 shown.vault=true;
}
export function bindDashboard(onRetry) {
 document.addEventListener('click',event=>{
  const retry=event.target.closest('[data-dashboard-retry]');if(retry){onRetry(retry.dataset.dashboardRetry);return;}
  const button=event.target.closest('[data-dashboard-asset]');if(!button)return;
  const asset=assets.find(a=>a.id===button.dataset.dashboardAsset);if(!asset)return;
  $('dashboardAssetTitle').textContent=asset.title;$('dashboardAssetContent').textContent=asset.content||'尚未填写资产内容。';$('dashboardAssetDate').textContent='更新时间：'+window.genesisFormatDate(asset.updated_at||asset.created_at);
  $('dashboardAssetDetail').showModal();
 });
 $('dashboardAssetClose').addEventListener('click',()=>$('dashboardAssetDetail').close());
 $('dashboardAssetVault').addEventListener('click',()=>$('dashboardAssetDetail').close());
}
