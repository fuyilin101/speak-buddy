import {bindEditor,refreshEditor} from './genesis-editor.js';
import {bindSkills,refreshSkills,syncGrowthTreeVisibility} from './genesis-skills.js';
import {syncQuestStage,syncQuestStageVisibility} from './genesis-quest-stage.js';
import {bindQuestBuilder,refreshQuestBuilder,renderQuestPlanOrder} from './genesis-quest-builder.js';
import {renderCharacterActions, syncCharacterVisibility} from './genesis-character.js';
import { renderActions, bindActionEvents, setActionReading } from './genesis-actions.js';
import { readCockpit,readCockpitSection } from './genesis-cloud.js';
import {bindDashboard,dashboardLoading,dashboardFeedback,renderDashboardHome,renderDashboardSkills,renderDashboardOutcomes} from './genesis-dashboard.js';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const empty = message => `<p class="genesis-empty">${esc(message)}</p>`;
const set = (id, value) => { $(id).textContent = String(value); };
let currentHome = null, refreshing = false, homeRevision=0;
const sections={},retrying=new Set(),supportLoaded={},supportPending={};
function renderHome(home) {
  currentHome = home;
  const { identity, training } = home;
  renderCharacterActions(home);
  renderActions(training);
  set('growthRecordSource', `来源：${home.source} · 已保存的成长记录`);
  $('growthRecent').innerHTML = home.recent.length ? home.recent.map(r => `<article class="growth-recent"><h3>${esc(r.title)}</h3><p>${esc(r.content || '已保存结构化复盘，详情可在资产库查看。')}</p><time>${esc(window.genesisFormatDate(r.at))}</time></article>`).join('') : empty('还没有成长记录。完成一次真实行动后，可让 Agent 整理复盘。');
  $('growthCapabilities').innerHTML = home.capabilities.length ? home.capabilities.map(c => `<article class="growth-capability"><h3>${esc(c.title)}</h3><div class="growth-metrics">${[[c.projects,'关联项目'],[c.records,'成长记录'],[c.assets,'可复用资产'],[c.evidence,'证据引用']].map(([n,label]) => `<div><strong>${n}</strong><span>${label}</span></div>`).join('')}</div><p class="growth-practice">实践时长：${c.practiceHours === null ? '尚未记录' : `${Number(c.practiceHours.toFixed(2))} 小时`} · 引用数不代表独立核验通过数</p></article>`).join('') : empty('尚无可关联的成果与证据，不预设能力评级。');
  set('growthProjectSource', `来源：${home.source}`);
  $('growthProjects').innerHTML = home.projects.length ? home.projects.map(p => `<button type="button" data-growth-project="${esc(p.id)}">${esc(p.name)}<small>查看项目与成长证据 →</small></button>`).join('') : empty('还没有进行中的项目。已归档项目可在资产库查看。');
  $('growthSources').innerHTML = '<p>资产来源：'+esc(home.source)+'</p><p>行动来源：'+esc(training.source)+'；'+(training.available?(training.cloudSynced?'记录保存在云端 D1，电脑与手机使用同一份资料':'仅保存主动操作的状态，未同步云端'):'尚未接入当前环境')+'。</p><p>行动记录与成长复盘分别保存。当前页面不会自动生成复盘、资产或能力证据。</p><p>Agent 连接沿用现有 Connector，认证信息只在服务端管理。</p>';
}
function readIndicator() {
 const failed=Object.values(sections).filter(result=>result.error).length;
 const loading=refreshing||retrying.size;
 set('growthReadState',loading?'正在读取各区域…':failed?'部分区域读取失败，可在对应卡片重试。':`${currentHome?.source||'Genesis 成长档案'} · 读取完成`);
 $('growthReadState').dataset.state=loading?'loading':failed?'failed':'ready';$('refreshGenesis').disabled=Boolean(loading);
}
async function acceptResult(section,result) {
 let received=result;
  try {
  if(result.value) {
   if(section==='home'){renderDashboardHome(result.value);renderHome(result.value);homeRevision++;syncQuestStage(result.value.training);}
   if(section==='vault'){renderDashboardOutcomes(result.value);window.renderGenesisDashboard(result.value);set('genesisSyncState',currentHome?.source||'Genesis 成长资产');$('growthVaultAssets').innerHTML=result.value.assets.length?result.value.assets.map(a=>`<article class="growth-recent"><h3>${esc(a.title)}</h3><p>${esc(a.content)}</p></article>`).join(''):empty('还没有可复用资产。');}
   if(section==='skills'){renderDashboardSkills(result.value);if(!await refreshSkills(currentHome,result))throw Error('技能树数据不完整，请重试。');}
  } else if(section==='skills') {
   await refreshSkills(currentHome,result);
   if(result.unavailable)$('dashboardSkillList').innerHTML='<li class="dashboard-empty">当前环境尚未启用技能树。</li>';
  }
 } catch(error){received={value:null,error:error.message,unavailable:false};}
 sections[section]=received;dashboardFeedback(section,received);readIndicator();
 if(section==='vault'&&received.error)set('genesisSyncState','资产读取失败，可重试');
 if(section==='home'&&received.error&&!currentHome)for(const id of ['growthQuestList','growthRecent','growthCapabilities','growthProjects'])$(id).innerHTML=empty('此区域暂时无法读取，请重试。');
}
// 管理页按进入的页面加载，首页不会额外请求使命管理或编辑接口。
async function hydrateRoute() {
 if(!currentHome)return;
 const route=document.body.dataset.growthRoute,type=route==='quests'?'quests':['character','settings','vault'].includes(route)?'editor':null;
 if(!type||supportLoaded[type]===homeRevision||supportPending[type])return;
 const epoch=homeRevision;supportPending[type]=true;
 try {if(type==='quests')await refreshQuestBuilder(currentHome);else await refreshEditor(currentHome);supportLoaded[type]=epoch;}
 catch(error){set(type==='quests'?'questBuilderFeedback':'genesisEditorFeedback','读取失败：'+error.message);}
 finally {supportPending[type]=false;}
}
export async function refreshGrowth() {
 if(refreshing||retrying.size)return;refreshing=true;setActionReading(true);readIndicator();
 for(const section of ['home','skills','vault'])dashboardLoading(section);
 try {await readCockpit(acceptResult);}
 finally {refreshing=false;setActionReading(false);if(currentHome){renderActions(currentHome.training);renderQuestPlanOrder();}readIndicator();await hydrateRoute();}
}
async function retrySection(section) {
 if(refreshing||retrying.has(section))return;retrying.add(section);dashboardLoading(section);readIndicator();
 try{await acceptResult(section,await readCockpitSection(section));}
 finally {retrying.delete(section);readIndicator();await hydrateRoute();}
}
function navigate() {
  const requested=location.hash.slice(1), route=['home','character','quests','skills','vault','settings'].includes(requested)?requested:'home';
  document.body.dataset.growthRoute=route;
  $('growthHome').hidden=['vault','settings','skills'].includes(route); $('growthVault').hidden=route!=='vault'; $('growthSettings').hidden=route!=='settings'; $('growthSkills').hidden=route!=='skills';
  $('genesisPwaSettings').hidden=route!=='settings';
  const titles={home:'成长驾驶舱',character:'我的角色',quests:'每日使命',skills:'我的成长之树',vault:'成长资产库',settings:'数据来源与设置'};
  set('growthPageTitle',titles[route]); set('growthPageSubtitle',route==='home'?'看见方向，从今天的一步行动开始。':route==='skills'?'定义未来方向，连接真实行动与实践。':route==='vault'?'保存成果、复盘与可以再次使用的经验。':route==='quests'?'Genesis Quest · 每天完成属于自己的成长使命。':'看见自己的状态，找到下一步行动。');
  document.querySelectorAll('[data-growth-nav]').forEach(link=>{if(link.dataset.growthNav===route)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  syncCharacterVisibility();syncQuestStageVisibility();syncGrowthTreeVisibility();
  // 页面从统一标题开始，避免进入使命或角色时把全局导航和标题滚出视野。
  window.scrollTo({top:0,left:0,behavior:'instant'});
  hydrateRoute();
}
window.initGenesisDetailInteractions();
document.addEventListener('click',event=>{
  const project=event.target.closest('[data-growth-project]');
  if(project){ location.hash='vault'; navigate(); window.loadGenesisProjectDetail(project.dataset.growthProject); }
});
bindActionEvents(()=>document.body.dataset.growthRoute==='quests'?currentHome:null,today=>{currentHome.training.today=today;renderActions(currentHome.training);renderQuestPlanOrder();renderCharacterActions(currentHome);renderDashboardHome(currentHome);syncQuestStage(currentHome.training);});
bindQuestBuilder(()=>currentHome,refreshGrowth);
bindEditor(refreshGrowth);
bindSkills(value=>{renderDashboardSkills(value);sections.skills={value,error:null,unavailable:false};dashboardFeedback('skills',sections.skills);readIndicator();});
bindDashboard(retrySection);
$('refreshGenesis').addEventListener('click',refreshGrowth);
$('logoutGenesis').addEventListener('click',async()=>{
  // 仅在用户明确点击退出时改变认证会话；不修改任何成长记录。
  try {
    const response=currentHome?.environment==='local'?await fetch('/api/logout',{method:'GET'}):await fetch('/api/logout',{method:'POST'});
    if(!response.ok)throw Error('退出失败，请重试。'); location.href='/login.html';
  } catch(error){set('growthReadState',error.message);}
});
window.addEventListener('hashchange',navigate); navigate(); refreshGrowth();
