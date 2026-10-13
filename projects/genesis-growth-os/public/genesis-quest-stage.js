/** 原任务画布的窄适配层：画布只提供交互，完成必须经由已认证行动接口确认。 */
import { completeAction } from './genesis-actions.js';
let mounted=false,current=null;
const words={'THE FIRE':'行动之火','QUENCH':'冷却','FINISHED':'已完成','THE DAY\'S WORK':'今日使命','THE DAY\'S WORK — TAP A PIECE TO PUT IT IN THE FIRE':'点击使命放入火中，再敲击铁砧记录完成','NOTHING ON THE RACK':'尚未安排使命','THE ANVIL IS EMPTY':'选择一项使命开始','THE DAY IS CLEARED':'今日使命完成','HEATING…':'准备中…'};
const translate=text=>words[text]||text.replace(/^FINISHED · /,'已完成 · ').replace(/ STRIKE LEFT| STRIKES LEFT/g,' 次敲击').replace(/ LEFT · STRIKE NOW FOR 2/g,' 次敲击').replace(/ BLOWS| BLOW/g,' 次敲击').replace(/NOW · /g,'此刻 · ').replace(/SOON · /g,'稍后 · ').replace(/WAITING/g,'待开始');
export function syncQuestStage(training){current=training;const host=document.getElementById('genesisQuestStage');if(!host||!window.ForgeStage)return;
 if(!mounted){window.ForgeStage.mount(host,{stateOnly:true,accessibleLabel:'每日使命：点击使命加热，敲击铁砧记录完成',translate,muted:()=>true,blocked:()=>!current?.actionTracking?.writable||window.matchMedia('(prefers-reduced-motion: reduce)').matches,complete:id=>completeAction(id,'completed')});mounted=true;}
 const quests=(training.today?.quests||[]).filter(q=>!q.paused&&q.planStatus!=='paused').sort((a,b)=>(a.at||'99:99').localeCompare(b.at||'99:99'));
 window.ForgeStage.sync(quests.map(q=>({id:q.id,title:q.title,done:q.done,minutes:0})),{snap:true});window.ForgeStage.setProgress(training.today?.done||0,training.today?.total||0);window.ForgeStage.setStreak(0);syncQuestStageVisibility();
}
export function syncQuestStageVisibility(){if(!mounted)return;if(document.body.dataset.growthRoute==='quests'&&!document.hidden)window.ForgeStage.start();else window.ForgeStage.stop();}
document.addEventListener('visibilitychange',syncQuestStageVisibility);
