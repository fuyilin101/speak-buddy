/** 显式用户操作入口：保存确认之前不更新状态、不触发完成反馈。 */
import { renderActionCards, showActionFeedback } from './genesis-action-view.mjs';
const $ = id => document.getElementById(id);
let saving = false, reading = false, homeReader, todayWriter, retry = null;
export function setActionReading(value) {
  reading = value;
  if (value) document.querySelectorAll('[data-action-id]').forEach(b => { b.disabled = true; });
}
export function renderActions(training) { renderActionCards(training, saving || reading); }
export function bindActionEvents(getHome, updateToday) {
  homeReader=getHome;todayWriter=updateToday;
  $('growthQuestList').addEventListener('click', async event => {
    const button=event.target.closest('[data-action-id]');
    if(button&&!button.disabled) return completeAction(button.dataset.actionId,button.dataset.actionStatus);
  });
}
export async function completeAction(questId,status) {
    const getHome=homeReader,updateToday=todayWriter,home=getHome?.();
    const button={disabled:false,dataset:{actionId:questId,actionStatus:status}};
    if (!button || button.disabled || saving || reading || !home?.training?.actionTracking?.writable) return;
    const quest = home.training.today.quests.find(q => q.id === button.dataset.actionId);
    if (!quest || quest.forgeDone || quest.paused || quest.planStatus === 'paused' || !['not_started','in_progress','completed'].includes(status)) return;
    saving = true;
    const wasDisabled = $('refreshGenesis').disabled;
    $('refreshGenesis').disabled = true;
    document.querySelectorAll('[data-action-id]').forEach(b => { b.disabled = true; });
    $('growthActionFeedback').textContent = '正在保存行动状态…';
    $('growthActionFeedback').dataset.state = 'saving';
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const managed = quest.managed;
      const expected = managed && status === 'not_started' ? 'pending' : status;
      const endpoint = managed ? '/api/genesis/quests/'+quest.id+'/state' : '/api/genesis/action-status';
      const payload = managed ? {date:home.training.today.date,action:({not_started:'cancel',pending:'cancel',in_progress:'start',completed:'complete'})[status],revision:quest.revision,run_revision:quest.runRevision} : {date:home.training.today.date,quest_id:quest.id,status};
      const fingerprint=JSON.stringify([endpoint,payload]);if(retry?.fingerprint!==fingerprint)retry={fingerprint,key:crypto.randomUUID()};
      const response = await fetch(endpoint, { method:'POST', signal:controller.signal,
        headers:{'Content-Type':'application/json',...(managed?{'Idempotency-Key':retry.key}: {})}, body:JSON.stringify(payload) });
      const data = await response.json().catch(() => { throw Error('无法确认服务器保存结果。'); });
      if (!response.ok) throw Error(data.error || `行动保存失败（${response.status}）`);
      if (data.success !== true || typeof data.deduplicated !== 'boolean' || data.action?.date !== home.training.today.date || data.action?.quest_id !== quest.id || data.action?.status !== expected || data.today?.date !== home.training.today.date || !Array.isArray(data.today.quests) || !data.today.quests.some(q => q.id === quest.id && q.status === expected && q.done === (status === 'completed'))) throw Error('保存结果不完整，无法确认行动状态。');
      saving = false;
      retry=null;
      updateToday(data.today);
      showActionFeedback(quest.id, status, data.deduplicated);
      return true;
    } catch (error) {
      saving = false;
      renderActions(getHome().training);
      const message = error.name === 'AbortError' ? '请求超时，尚无法确认是否已保存。' : error.name === 'TypeError' ? '网络连接中断，尚无法确认是否已保存。' : error.message;
      $('growthActionFeedback').textContent = `保存失败：${message} 尚未确认完成，请联网后刷新检查再重试。`;
      $('growthActionFeedback').dataset.state = 'failed';
      return false;
    } finally { clearTimeout(timeout); saving = false; $('refreshGenesis').disabled = wasDisabled; }
}
