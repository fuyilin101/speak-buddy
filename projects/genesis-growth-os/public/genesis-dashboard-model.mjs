import {skillForest} from './genesis-skill-model.mjs';
/** 只读裁剪与排序；不把使命完成或资产数量转换成能力评价。 */
const recent=rows=>[...new Map(rows.map(row=>[row.id,row])).values()].sort((a,b)=>{
 const at=row=>Date.parse(row.updated_at||row.created_at)||0;
 return at(b)-at(a)||String(a.id).localeCompare(String(b.id));
});
export function questPreview(home) {
 if(!home.questBuilder?.available || !home.training.available)return {available:false,quests:[],done:null,total:null,state:'当前环境尚未接入每日使命'};
 const today=home.training.today;
 if(!today || !Array.isArray(today.quests) || !Number.isInteger(today.done) || !Number.isInteger(today.total) || today.done<0 || today.total<today.done)throw Error('今日使命摘要不完整。');
 const time=at=>/^([01]\d|2[0-3]):[0-5]\d$/.test(at||'')?Number(at.slice(0,2))*60+Number(at.slice(3)):Infinity;
 const quests=[...today.quests].sort((a,b)=>time(a.at)-time(b.at)).slice(0,3);
 if(quests.some(q=>typeof q.title!=='string'||!['pending','not_started','in_progress','completed','paused'].includes(q.status)))throw Error('使命状态数据无效。');
 return {available:true,quests,done:today.done,total:today.total,state:!today.total?today.paused?'今日使命已暂停':'尚无今日使命':today.done===today.total?'今日使命已完成':today.inProgress?'正在专注行动':'等待下一步行动'};
}
export function skillPreview(value) {
 const forest=skillForest(value.skills);
 return recent(forest.roots).slice(0,3);
}
export function outcomePreview(vault) {
 if(!Array.isArray(vault.projects)||!Array.isArray(vault.assets))throw Error('最近成果数据不完整。');
 return {projects:recent(vault.projects).slice(0,3),assets:recent(vault.assets).slice(0,3)};
}
