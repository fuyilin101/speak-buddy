/** 只读角色展示：中性形象，不向绘图组件提供游戏进度或升阶回调。 */
import { actionDimensions } from './genesis-action-model.mjs';
const $ = id => document.getElementById(id);
let mounted = false;
export function renderCharacterActions(home) {
  const {identity, training} = home;
  $('growthName').textContent = identity.name?.text || '尚未设置昵称';
  $('growthStage').textContent = identity.stage?.text || identity.route?.text || '尚未确认当前阶段';
  const sources = [...new Set([identity.name?.source, identity.stage?.source, identity.route?.source].filter(Boolean))];
  $('growthIdentitySource').textContent = sources.length ? `来源：${sources.join(' / ')}` : '来源：尚无已确认的角色资料';
  const today = training.today;
  $('growthActionState').textContent = !today?.total ? '等待读取行动计划' : today.done === today.total ? '今日计划已完成' : today.inProgress ? '专注行动中' : today.done ? '继续下一步行动' : '准备开始今日行动';
  $('growthRoleDone').textContent = today?.total ? `${today.done} / ${today.total}` : '尚无计划';
  $('growthRoleActive').textContent = today?.total ? `${today.inProgress} 项` : '尚无记录';
  $('growthTrainingStatus').textContent = training.available ? (training.cloudSynced?'云端行动记录':'本地行动记录') : '行动计划尚未接入';
  $('growthAttrSource').textContent = '今日计划的完成比例';
  const rows = actionDimensions(today);
  $('growthAttributes').replaceChildren();
  if (!rows.length) {
    const empty = document.createElement('p'); empty.className='genesis-empty'; empty.textContent='尚无行动计划，不预设各维度状态。'; $('growthAttributes').append(empty);
  } else {
    const grid=document.createElement('div');grid.className='growth-attrs';
    for (const row of rows) {
      const card=document.createElement('div');card.className='growth-attr';
      const title=document.createElement('span');title.textContent=row.name;
      const value=document.createElement('strong');value.textContent=row.total?`${row.completed} / ${row.total}`:'尚无计划';
      const track=document.createElement('div');track.className='growth-dimension-track';track.setAttribute('aria-hidden','true');
      const fill=document.createElement('div');fill.style.width=`${row.pct || 0}%`;track.append(fill);
      const note=document.createElement('small');note.textContent=row.total?'已完成 / 今日计划':'今天未安排此类行动';
      card.append(title,value,track,note);grid.append(card);
    }
    $('growthAttributes').append(grid);
  }
  if (!mounted && window.Effigy) {
    window.Effigy.mount($('growthCharacterFigure'), {interactive:false, accessibleLabel:'我的角色 · 中性展示形象'});
    window.Effigy.sync([], null);
    mounted=true;
  }
  syncCharacterVisibility();
}
export function syncCharacterVisibility() {
  if (!mounted) return;
  const show = ['home','character'].includes(document.body.dataset.growthRoute);
  if (show) window.Effigy.start(); else window.Effigy.stop();
}
