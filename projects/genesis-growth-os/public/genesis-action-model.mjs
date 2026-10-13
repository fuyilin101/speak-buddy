/** 独立行动状态模型：纯读取，不改变历史任务、积分或记录。 */
export const ACTION_STATES = Object.freeze(['not_started', 'in_progress', 'completed']);
export const actionKey = (date, questId) => JSON.stringify([date, questId]);
export function savedActionStatus(action) {
  if (ACTION_STATES.includes(action?.status)) return action.status;
  return typeof action?.completed === 'boolean' ? action.completed ? 'completed' : 'not_started' : null;
}
export function mergeActionStates(today, states = {}) {
  if (!today) return null;
  const quests = (today.quests || []).map(quest => {
    const saved = states[actionKey(today.date, quest.id)];
    const valid = saved?.date === today.date && saved?.quest_id === quest.id && savedActionStatus(saved);
    const manual = !quest.done && Boolean(valid);
    const status = quest.done ? 'completed' : manual ? savedActionStatus(saved) : 'not_started';
    // 只输出行动字段，避免把旧经济体系的字段带入展示模型。
    return {
      id: quest.id, title: quest.title, attr: quest.attr, category: quest.category,
      minutes: quest.minutes, at: quest.at, color: quest.color,
      status, done: status === 'completed', forgeDone: Boolean(quest.done), manual,
      actionSource: manual ? '手动行动记录' : quest.done ? '历史行动记录' : '尚未记录',
      actionUpdatedAt: manual ? saved.updated_at : null,
      // Phase 4.3 的引用锚点，仅预留，不创建复盘或资产。
      actionRef: { date: today.date, quest_id: quest.id },
      reflection: { available: false, state: 'reserved' },
    };
  });
  const done = quests.filter(q => q.done).length;
  const inProgress = quests.filter(q => q.status === 'in_progress').length;
  const minutesLeft = quests.filter(q => !q.done).reduce((sum, q) => sum + (Number.isFinite(q.minutes) ? q.minutes : 0), 0);
  return { date: today.date, quests, done, inProgress, total: quests.length, minutesLeft,
    pct: quests.length ? Math.round(done / quests.length * 100) : 0 };
}
export function actionDimensions(today) {
  if(today?.quests?.some(q=>q.dimension)){
    return Object.entries({body:'身体',learning:'学习',creation:'创造',life:'生活'}).map(([key,name])=>{
      const rows=today.quests.filter(q=>q.dimension===key&&!q.paused),completed=rows.filter(q=>q.done).length;
      return {key,name,total:rows.length,completed,inProgress:rows.filter(q=>q.status==='in_progress').length,pct:rows.length?Math.round(completed/rows.length*100):null};
    });
  }
  const names = { Body:'身体', Mind:'学习', Craft:'创造', Discipline:'执行', Vitality:'健康' };
  if (!today?.quests?.length) return [];
  return Object.entries(names).map(([key, name]) => {
    const rows = today.quests.filter(q => q.attr === key && !q.paused);
    const completed = rows.filter(q => q.done).length;
    return { key, name, total: rows.length, completed,
      inProgress: rows.filter(q => q.status === 'in_progress').length,
      pct: rows.length ? Math.round(completed / rows.length * 100) : null };
  });
}
