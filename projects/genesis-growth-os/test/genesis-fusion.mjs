import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {mergeActionStates,actionDimensions,actionKey} from '../public/genesis-action-model.mjs';
const require=createRequire(import.meta.url), summary=require('../dashboard-summary.js'), engine=require('../public/modules.js');
const now=new Date(),date=summary.localIso(now),day=now.getDay();
const settings={version:3,taskModelVersion:4,quests:[{id:'q',title:'学习与实践',attr:'Mind',category:'study',scheduleType:'weekly',repeatDays:[day],estMinutes:20}]};
const previousMethods={};
for(const name of ['weekXp','bossDamage','weekScore']){previousMethods[name]=engine[name];engine[name]=()=>{throw Error('行动摘要不得调用游戏计算：'+name);};}
let agenda;
try {agenda=summary.buildActionSummary({settings,now}).today;}finally{Object.assign(engine,previousMethods);}
assert.equal(agenda.total,1);assert.equal('xp' in agenda.quests[0],false);
const legacy={date,quest_id:'q',completed:true,updated_at:'2026-01-01',visibility:'private'};
const key=actionKey(date,'q'),input={today:agenda,states:{[key]:legacy}},before=JSON.stringify(input);
let merged=mergeActionStates(input.today,input.states);
assert.equal(merged.quests[0].status,'completed');assert.equal(merged.done,1);assert.equal(merged.quests[0].reflection.available,false);
assert.equal(JSON.stringify(input),before,'旧记录不得被读取时回写');
const progressing={...legacy,status:'in_progress',completed:false};
merged=mergeActionStates(agenda,{[key]:progressing});assert.equal(merged.inProgress,1);assert.equal(merged.done,0);
assert.equal(actionDimensions(merged).find(a=>a.key==='Mind').inProgress,1);
assert.equal(actionDimensions(merged).find(a=>a.key==='Body').pct,null);
const historical=mergeActionStates({...agenda,quests:agenda.quests.map(q=>({...q,done:true}))},{[key]:progressing});
assert.equal(historical.done,1);assert.equal(historical.quests[0].manual,false);
// 原绘图能力保留，中性模式不携带进度或历史装饰数据。
const character=await readFile(new URL('../public/genesis-character.js',import.meta.url),'utf8');
assert.match(character,/interactive:false/);assert.match(character,/sync\(\[\], null\)/);
assert.ok(!/Game\.|\.level\b|\.xp\b|onTierUp/.test(character));
const html=await readFile(new URL('../public/growth.html',import.meta.url),'utf8');
assert.ok(!/The Forge|\bXP\b|等级|奖励|Boss|徽章/i.test(html));
console.log('融合边界：行动摘要不调用游戏计算、历史布尔状态兼容、三状态与维度纯读取、历史完成优先、沉淀预留、中性角色与文案隔离通过。');
