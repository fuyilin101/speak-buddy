function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function genesisParseJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function genesisLabel(value) {
  return ({ active: '进行中', paused: '已暂停', completed: '已完成', archived: '已归档', growth: '成长', product: '产品', 'ai-product': 'AI 产品', ai_app: 'AI 应用', reflection: '复盘', project_review: '项目复盘', initial_memory: '初始记忆', playbook: '方法清单', personal_playbook: '个人方法清单', knowledge: '知识', code: '代码', experience: '经验', template: '模板', asset: '资产', review: '复盘', evidence: '证据', deduplication: '去重' })[value] || value;
}

function genesisList(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [String(value)];
}

function genesisFormatDate(value) {
  if (!value) return "待确认时间";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "待确认时间" : date.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

function genesisReviewFields(details, project) {
  const source = details && typeof details === "object" ? details : {};
  return [
    ["实际完成", source.completed_work || source.completed || []],
    ["遇到的问题", source.problems || []],
    ["解决方案", source.solutions || []],
    ["学到的知识", source.learned || source.learning || []],
    ["下一步", source.next_steps || genesisParseJson(project?.next_steps_json, []) || []],
  ];
}

function renderGenesisProjectDetail(detail) {
  const shell = document.getElementById("genesisProjectDetail");
  if (!shell || !detail?.project) return;
  const project = detail.project;
  const records = Array.isArray(detail.growthRecords) ? detail.growthRecords : [];
  const assets = Array.isArray(detail.assets) ? detail.assets : [];
  const timeline = Array.isArray(detail.timeline) ? detail.timeline : [];
  shell.hidden = false;
  document.getElementById('genesisDetailEdit')?.remove();
  if(window.genesisLocalEditing){const button=document.createElement('button');button.id='genesisDetailEdit';button.type='button';button.textContent='编辑项目';button.dataset.vaultEdit='projects';button.dataset.recordId=project.id;document.querySelector('.genesis-detail-head').append(button);}
  const title = document.getElementById("genesisDetailTitle");
  const summary = document.getElementById("genesisDetailSummary");
  if (title) title.textContent = project.name || "未命名项目";
  if (summary) summary.textContent = `${project.description || "暂无项目描述"} · ${genesisLabel(project.status || "active")} · ${Math.round(Number(project.progress || 0))}%`;
  const timelineEl = document.getElementById("genesisTimeline");
  if (timelineEl) timelineEl.innerHTML = timeline.length ? timeline.map((item) => {
    const entry = item.kind === "growth" ? item.record : item.asset;
    const type = item.kind === "growth" ? (entry?.record_type || "growth") : (entry?.asset_type || "asset");
    return `<article class="genesis-timeline-item"><span class="genesis-timeline-dot" aria-hidden="true"></span><div><div class="genesis-timeline-meta">${escapeHtml(genesisFormatDate(item.at))} · ${escapeHtml(genesisLabel(type))}</div><h5>${escapeHtml(item.title || "未命名记录")}</h5><p>${escapeHtml(entry?.content || "已保存结构化记录")}</p></div></article>`;
  }).join("") : `<p class="genesis-empty">暂无时间线记录。</p>`;
  const timelineCount = document.getElementById("genesisTimelineCount");
  if (timelineCount) timelineCount.textContent = `${timeline.length} 条`;
  const reviewsEl = document.getElementById("genesisReviews");
  const reviewRecords = records.filter((record) => record.details_json || record.content);
  if (reviewsEl) reviewsEl.innerHTML = reviewRecords.length ? reviewRecords.map((record) => {
    const details = genesisParseJson(record.details_json, {});
    const fields = genesisReviewFields(details, project).filter(([, value]) => genesisList(value).length);
    return `<article class="genesis-review-card"><div class="genesis-review-meta">${escapeHtml(genesisFormatDate(record.recorded_at))} · ${escapeHtml(genesisLabel(record.record_type || "project_review"))}</div><h5>${escapeHtml(record.title || "项目复盘")}</h5>${window.genesisLocalEditing?`<div class="vault-card-actions"><button data-vault-view="growth-records" data-record-id="${escapeHtml(record.id)}">查看</button><button data-vault-edit="growth-records" data-record-id="${escapeHtml(record.id)}">编辑</button></div>`:""}${record.content ? `<p>${escapeHtml(record.content)}</p>` : ""}${fields.map(([label, value]) => `<div class="genesis-review-field"><strong>${escapeHtml(label)}</strong><ul>${genesisList(value).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`).join("")}</article>`;
  }).join("") : `<p class="genesis-empty">暂无结构化复盘记录。</p>`;
  const assetsEl = document.getElementById("genesisAssets");
  if (assetsEl) assetsEl.innerHTML = assets.length ? assets.map((asset) => {
    const tags = genesisList(genesisParseJson(asset.tags_json, []));
    return `<article class="genesis-asset-card"><div class="genesis-review-meta">${escapeHtml(genesisLabel(asset.asset_type || "asset"))} · ${escapeHtml(genesisFormatDate(asset.created_at))}</div><h5>${escapeHtml(asset.title || "未命名资产")}</h5>${window.genesisLocalEditing?`<div class="vault-card-actions"><button data-vault-view="assets" data-record-id="${escapeHtml(asset.id)}">查看</button><button data-vault-edit="assets" data-record-id="${escapeHtml(asset.id)}">编辑</button></div>`:""}<p>${escapeHtml(asset.content || "")}</p>${tags.length ? `<div class="genesis-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}</article>`;
  }).join("") : `<p class="genesis-empty">暂无可复用资产。</p>`;
  const assetCount = document.getElementById("genesisAssetCount");
  if (assetCount) assetCount.textContent = `${assets.length} 项`;
}

async function loadGenesisProjectDetail(projectId) {
  const shell = document.getElementById("genesisProjectDetail");
  if (shell) { shell.hidden = false; shell.classList.add("is-loading"); }
  try {
    const response = await fetch(`/api/genesis/projects/${encodeURIComponent(projectId)}`);
    if (!response.ok) throw new Error(`Genesis project returned ${response.status}`);
    renderGenesisProjectDetail(await response.json());
    shell?.scrollIntoView({block:"start"});
  } catch (error) {
    console.warn("Genesis project detail unavailable", error);
    const summary = document.getElementById("genesisDetailSummary");
    if (summary) summary.textContent = "项目详情暂时无法加载，请稍后重试。";
  } finally {
    if (shell) shell.classList.remove("is-loading");
  }
}

function initGenesisDetailInteractions() {
  document.addEventListener("click", (event) => {
    const projectButton = event.target.closest("[data-genesis-project-id]");
    if (projectButton) loadGenesisProjectDetail(projectButton.dataset.genesisProjectId);
    if (event.target.closest("#genesisDetailClose")) {
      const shell = document.getElementById("genesisProjectDetail");
      if (shell) shell.hidden = true;
    }
  });
}

function renderGenesisDashboard(snapshot) {
  const summary = snapshot?.summary || {};
  const projects = Array.isArray(snapshot?.projects) ? snapshot.projects : [];
  const records = Array.isArray(snapshot?.growthRecords) ? snapshot.growthRecords : [];
  const projectCount = document.getElementById("genesisProjectCount");
  const recordCount = document.getElementById("genesisRecordCount");
  const progress = document.getElementById("genesisProgress");
  const sync = document.getElementById("genesisSyncState");
  if (projectCount) projectCount.textContent = String(summary.activeProjectCount ?? projects.filter((p) => p.status === "active").length);
  if (recordCount) recordCount.textContent = String(summary.recordCount ?? records.length);
  if (progress) progress.textContent = `${Math.round(Number(summary.averageProgress || 0))}%`;
  if (sync) sync.textContent = snapshot?.source === "local-fallback" ? "本地成长记录" : "Genesis 数据已同步";
  const projectList = document.getElementById("genesisProjectList");
  if (projectList) projectList.innerHTML = projects.length ? projects.slice(0, 4).map((project) => {
    const pct = Math.max(0, Math.min(100, Number(project.progress || 0)));
    return `<button type="button" class="genesis-project genesis-project-button" data-genesis-project-id="${escapeHtml(project.id)}"><span class="genesis-project-row"><span class="genesis-project-name">${escapeHtml(project.name)}</span><span class="genesis-progress" aria-label="${pct}%"><span style="width:${pct}%"></span></span></span><span class="genesis-project-meta">${escapeHtml(genesisLabel(project.domain || "growth"))} · ${escapeHtml(genesisLabel(project.status || "active"))} · 查看详情</span></button>`;
  }).join("") : `<p class="genesis-empty">还没有项目，先把一个想法写下来。</p>`;
  const recordList = document.getElementById("genesisRecordList");
  if (recordList) recordList.innerHTML = records.length ? records.slice(0, 4).map((record) => `<div class="genesis-record"><div class="genesis-record-row"><span class="genesis-record-title">${escapeHtml(record.title || "未命名记录")}</span><span class="genesis-record-meta">${escapeHtml(genesisLabel(record.record_type || "reflection"))}</span></div><div class="genesis-record-content">${escapeHtml(record.content || "暂无文字内容")}</div></div>`).join("") : `<p class="genesis-empty">每一次复盘，都会成为下一次行动的素材。</p>`;
}
