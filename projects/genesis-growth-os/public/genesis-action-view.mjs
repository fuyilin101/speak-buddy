/** 仅负责行动卡片与进度的视觉，不读取存储、不发起请求。 */
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const types = { discipline:['执行','◎','#ddb471'], study:['学习','◇','#a6a7ed'], training:['身体','△','#88bcaa'], protein:['健康','◈','#dbaa84'], cooking:['生活','◈','#dbaa84'], project:['创造','✦','#e2a26a'] };
const labels = { pending:'待开始', not_started:'待开始', in_progress:'进行中', completed:'已完成', paused:'暂停' };
export function renderActionCards(training, locked = false) {
  const today = training.today;
  // 排序仅影响展示；没有有效时间的使命保留原顺序并放在最后。
  const scheduledMinutes = at => /^([01]\d|2[0-3]):[0-5]\d$/.test(at || '') ? Number(at.slice(0,2))*60 + Number(at.slice(3)) : Infinity;
  const quests = [...(today?.quests || [])].sort((a,b) => scheduledMinutes(a.at) - scheduledMinutes(b.at));
  const ongoing = quests.filter(q => q.status === 'in_progress');
  const remaining = quests.filter(q => !q.done && !q.paused);
  const allClear = today?.total > 0 && today.done === today.total;
  const knownMinutes = remaining.reduce((n,q) => n + (Number.isFinite(q.minutes) && q.minutes >= 0 ? q.minutes : 0),0);
  const unknownMinutes = remaining.some(q => !Number.isFinite(q.minutes) || q.minutes < 0);
  $('growthQuestDate').textContent = today?.date || '等待今日计划';
  $('growthQuestHeadline').textContent = !quests.length ? '给下一版本的自己，留一步行动。' : allClear ? today.paused ? '今日有效使命已完成，另有暂停安排。' : '今天的使命，已经留下行动记录。' : ongoing.length ? '专注此刻，完成眼前的使命。' : '从一项使命开始，塑造下一版本的自己。';
  $('growthQuestRemaining').textContent = !quests.length ? '尚无使命计划' : !remaining.length ? allClear ? '今日使命已全部记录完成' : '当前使命均已暂停' : '剩余预计投入 ' + knownMinutes + ' 分钟' + (unknownMinutes ? ' · 部分时长未记录' : '');
  $('growthQuestFocus').textContent = !quests.length ? '按自己的目标安排使命，系统不自动生成使命。' : ongoing.length ? '进行中的使命：' + ongoing.map(q=>q.title).join('、') : remaining.length ? '下一项待开始：' + remaining[0].title : allClear ? '真实行动已被记住，复盘与资产沉淀由后续流程完成。' : '暂停不代表完成。可以在使命计划中恢复。';
  $('growthQuestCount').textContent = quests.length ? `${today.done} / ${today.total}` : '尚无使命';
  $('growthQuestSource').textContent = training.available ? (training.cloudSynced?'来源：Genesis Cloud 使命与执行记录 · 已保存到 D1':'来源：Genesis 使命与执行记录 · 未同步云端') : '当前环境尚未接入行动计划';
  $('growthActionAll').hidden = quests.length <= 3;
  $('growthActionProgress').hidden = !quests.length;
  $('growthActionProgressLabel').textContent = quests.length ? `${today.done} 项完成 / ${today.total} 项使命` : '尚无使命';
  $('growthActionPercent').textContent = `${today?.pct || 0}%`;
  $('growthActionFill').style.width = `${today?.pct || 0}%`;
  $('growthActionBar').setAttribute('aria-valuenow', String(today?.done || 0));
  $('growthActionBar').setAttribute('aria-valuemax', String(today?.total || 1));
  $('growthActionBar').setAttribute('aria-valuetext', `${today?.done || 0} / ${today?.total || 0} 项行动完成`);
  $('growthActionSummary').textContent = quests.length && allClear ? '今日使命完成，你今天完成了自己的成长承诺。'+(today.paused?'（另有 '+today.paused+' 项暂停，未计作完成）':'') : `${today?.inProgress || 0} 项进行中 · 完成后留下真实行动记录`;
  $('growthQuestList').innerHTML = quests.length ? quests.map((quest, index) => {
    const status = quest.status || (quest.done ? 'completed' : 'not_started');
    const [label, icon, color] = types[quest.category] || ['日常','◉','#a7acb8'];
    const disabled = !training.actionTracking?.writable || quest.forgeDone || quest.paused || quest.planStatus === 'paused' || locked;
    const button = (target, text) => `<button type="button" class="growth-action-button" data-action-id="${esc(quest.id)}" data-action-status="${target}" ${disabled ? 'disabled' : ''} aria-label="${text}：${esc(quest.title)}">${text}</button>`;
    const controls = quest.planStatus==='paused' && !quest.paused ? '<span class="growth-action-existing">计划已暂停 · 保留当日完成记录</span>' : quest.paused ? '<span class="growth-action-existing">已暂停 · 不计入今日进度</span>' : quest.forgeDone ? '<span class="growth-action-existing">历史完成记录 · 只读</span>' : status === 'completed' ? button('not_started','撤销完成') : status === 'in_progress' ? button('completed','完成使命') + button('not_started','回到待开始') : button('in_progress','开始使命') + button('completed','完成使命');
    return `<article class="growth-action-card ${status === 'completed' ? 'is-done' : status === 'in_progress' ? 'is-in-progress' : status === 'paused' ? 'is-paused' : ''}" style="--action-accent:${color}" role="listitem" data-action-card="${esc(quest.id)}">
      <div class="quest-timeline-anchor" aria-hidden="true"><span>${String(index+1).padStart(2,'0')}</span><time class="quest-timeline-time">${esc(quest.at || '自由')}</time></div>
      <div class="growth-action-symbol" aria-hidden="true">${status === 'completed' ? '✓' : status === 'in_progress' ? '◌' : icon}</div>
      <div class="growth-action-main"><div class="growth-action-kicker"><span class="quest-card-number">使命 ${String(index+1).padStart(2,'0')}</span><span class="growth-action-type">${esc(label)}</span><span class="growth-action-time">${esc(quest.at || '自由安排')}</span></div><h3>${esc(quest.title)}</h3>
      ${quest.description?'<p class="quest-description">'+esc(quest.description)+'</p>':''}<div class="growth-action-meta"><span>${Number.isFinite(quest.minutes) && quest.minutes >= 0 ? `预计 ${quest.minutes} 分钟` : '预计时长未记录'}</span><span class="growth-action-status">${labels[status]}</span></div>
      <div class="quest-state-path" aria-label="使命状态：${labels[status]}">${(status==='paused'?['paused']:['not_started','in_progress','completed']).map(step => '<span class="' + (step === (status==='pending'?'not_started':status) ? 'is-current' : '') + '">' + labels[step] + '</span>').join('<i aria-hidden="true">→</i>')}</div>
      ${quest.goalTitle?'<small>目标：'+esc(quest.goalTitle)+'</small>':''}<small>${esc(quest.actionSource || '尚未记录')}${quest.manual ? ' · 自我报告' : ''}</small></div>
      <div class="growth-action-controls">${controls}${training.questBuilder?.available ? quest.managed ? '<details class="quest-card-menu"><summary aria-label="管理使命：'+esc(quest.title)+'">···</summary><div class="quest-plan-menu" data-plan-id="'+esc(quest.id)+'"><button data-plan-command="edit">编辑</button><button data-plan-command="time">调整时间</button><button data-plan-command="type">修改类型</button><button data-plan-command="pause">'+(quest.planStatus==='paused'?'恢复使命':'暂停')+'</button><button data-plan-command="history">查看历史</button><button data-plan-command="delete">删除</button></div></details>' : '<button type="button" class="quest-edit-button" data-quest-transfer="'+esc(quest.id)+'">转为可编辑使命</button>' : ''}</div><span class="growth-action-flash" aria-hidden="true">✦</span></article>`;
  }).join('') : `<p class="genesis-empty">${training.available ? '今天尚未安排使命。' : '当前环境尚未接入使命计划，不创建示例使命。'}</p>`;
}
export function showActionFeedback(questId, status, deduplicated) {
  $('growthActionFeedback').textContent = deduplicated ? '行动状态已保存，无需重复记录。' : status === 'completed' ? '行动记录完成 · 这项成长使命已记下。' : status === 'in_progress' ? '行动已开始，专注眼前这一步。' : '已撤销行动状态，回到待开始。';
  $('growthActionFeedback').dataset.state = 'success';
  const card = [...document.querySelectorAll('[data-action-card]')].find(e => e.dataset.actionCard === questId);
  if (card && !deduplicated) {
    const animation = status === 'completed' ? 'is-celebrating' : status === 'in_progress' ? 'is-starting' : 'is-reverted';
    card.classList.add(animation);
    setTimeout(() => card.classList.remove(animation), 900);
  }
  const restored = [...document.querySelectorAll('[data-action-id]')].find(e => e.dataset.actionId === questId);
  restored?.focus({ preventScroll:true });
}
