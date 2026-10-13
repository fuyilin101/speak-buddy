import { mergeActionStates } from './genesis-action-model.mjs';
/** 纯只读展示模型：不领取奖励、不评价技能、不修改传入对象。 */
const trusted = new Set(['user_stated', 'user_provided', 'verified']);
const domainNames = { product: '产品构建', ai_app: 'AI 应用开发', 'ai-product': 'AI 应用开发', ai: 'AI 应用开发', engineering: '工程实践', business: '商业探索', health: '身体管理', learning: '学习实践', growth: '综合成长' };
const arr = value => Array.isArray(value) ? value : [];
function parse(value, fallback) { try { return typeof value === 'string' ? JSON.parse(value) : value ?? fallback; } catch { return fallback; } }
function unique(rows) { return [...new Map(arr(rows).filter(x => x?.id).map(x => [x.id, x])).values()]; }
function textValue(value) { const data = parse(value, null); return typeof data === 'string' ? data : typeof data?.text === 'string' ? data.text : null; }
function identityItem(items, keys) {
  const item = items.find(x => keys.includes(x.profile_key) && trusted.has(x.confidence) && textValue(x.value_json));
  return item ? { text: textValue(item.value_json), source: '个人档案记录', confidence: item.confidence } : null;
}
function evidenceKey(item) {
  if (typeof item === 'string') return item.trim();
  if (!item || typeof item !== 'object') return null;
  // 只有有具体来源的引用才计数，note/描述不单独当作证据。
  return item.path ? `file:${item.path}:${item.commit || ''}` : item.commit ? `commit:${item.commit}` : item.url ? `url:${item.url}` : null;
}
export function buildCapabilities(snapshot) {
  const projects = unique(snapshot.projects), records = unique(snapshot.growthRecords), assets = unique(snapshot.assets);
  const projectDomains = new Map(projects.map(p => [p.id, p.domain || 'growth']));
  const groups = new Map();
  const group = domain => {
    // 历史领域命名不同，只在展示汇总中合并，不改写任何记录。
    domain = ['ai', 'ai_app', 'ai-product'].includes(domain) ? 'ai-product' : domain;
    if (!groups.has(domain)) groups.set(domain, { domain, title: domainNames[domain] || `项目领域：${domain}`, projects: 0, records: 0, assets: 0, evidence: new Set(), practiceHours: null });
    return groups.get(domain);
  };
  function references(target, row) {
    for (const evidence of arr(parse(row.evidence_json, []))) {
      const key = evidenceKey(evidence); if (key) target.evidence.add(key);
    }
  }
  for (const p of projects) { const g = group(p.domain || 'growth'); g.projects++; references(g, p); }
  for (const r of records) {
    const g = group(projectDomains.get(r.project_id) || 'unclassified'); g.records++; references(g, r);
    if (r.record_type === 'practice' && ['hours', 'hour', '小时'].includes(r.metric_unit) && r.metric_value != null && Number.isFinite(Number(r.metric_value)) && Number(r.metric_value) >= 0) g.practiceHours = (g.practiceHours ?? 0) + Number(r.metric_value);
  }
  for (const a of assets) { const g = group(projectDomains.get(a.project_id) || 'unclassified'); g.assets++; references(g, a); }
  return [...groups.values()].map(g => ({ ...g, title: g.domain === 'unclassified' ? '尚未关联领域' : g.title, evidence: g.evidence.size }));
}
export function buildGrowthHome({ snapshot = {}, profileItems = [], goals = [], forge = null, actionStates = {}, environment = 'cloud-test' } = {}) {
  const local = environment === 'local';
  const items = arr(profileItems);
  const identity = { name: identityItem(items, ['display_name', 'nickname', 'callsign']), stage: identityItem(items, ['current_stage', 'current_stage_name']), route: identityItem(items, ['growth_route']) };
  if (!identity.name && local && forge?.callsign) identity.name = { text: forge.callsign, source: '本地已保存昵称', confidence: 'user_stated' };
  const goal = arr(goals).find(g => g.status === 'active' && trusted.has(g.confidence));
  const training = forge && local ? {
    available: true, source: '本地计划与行动记录', cloudSynced: false,
    today: mergeActionStates(forge.today, actionStates),
    actionTracking: {writable:true, source:'本地行动状态', stateOnly:true},
  } : {available:false, source:'行动计划尚未接入', cloudSynced:false, today:null,
    actionTracking:{writable:false, source:'尚未接入', stateOnly:true}};
  return {
    source: local ? '本地 Genesis 仓库（SQLite）' : 'Genesis Cloud（D1 测试环境）', environment, readonly: true,
    identity, goal: goal ? { title: goal.title, description: goal.description, source: '已保存的个人目标', confidence: goal.confidence } : null,
    training, capabilities: buildCapabilities(snapshot),
    recent: unique(snapshot.growthRecords).sort((a,b) => String(b.recorded_at || b.created_at).localeCompare(String(a.recorded_at || a.created_at))).slice(0,3).map(r => ({ id:r.id, title:r.title, content:r.content, at:r.recorded_at || r.created_at })),
    projects: unique(snapshot.projects).filter(p => p.status === 'active').slice(0,4).map(p => ({ id:p.id, name:p.name, domain:p.domain })),
    assets: unique(snapshot.assets).sort((a,b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0,6).map(a => ({ id:a.id, title:a.title, content:a.content })),
  };
}
