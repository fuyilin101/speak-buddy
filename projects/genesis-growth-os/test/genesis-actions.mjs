import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const viewSource = await readFile(new URL('../public/genesis-action-view.mjs', import.meta.url), 'utf8');
const source = await readFile(new URL('../public/genesis-actions.js', import.meta.url), 'utf8');

function harness(fetcher) {
  const elements = new Map(), timers = new Map(), classes = new Set();
  let listener, updates = 0, timerId = 0;
  const button = { disabled:false, dataset:{actionId:'q1',actionStatus:'completed'}, focus() {} };
  const card = { dataset:{actionCard:'q1'}, classList:{add(...names){names.forEach(n=>classes.add(n));},remove(...names){names.forEach(n=>classes.delete(n));}} };
  const element = id => {
    if (!elements.has(id)) elements.set(id,{textContent:'',dataset:{},style:{},disabled:false,hidden:false,setAttribute(){},
      addEventListener(type,fn){if(id==='growthQuestList'&&type==='click')listener=fn;},
      set innerHTML(html){this.html=html;if(id==='growthQuestList'){button.disabled=/<button[^>]*\sdisabled/.test(html);button.dataset.actionStatus=html.includes('data-action-status="not_started"')?'not_started':'completed';}},
    });
    return elements.get(id);
  };
  const home = {training:{available:true,actionTracking:{writable:true},today:{date:'2026-10-12',done:0,total:1,pct:0,quests:[{id:'q1',title:'验证过的行动',category:'project',minutes:20,done:false,status:'not_started'}]}}};
  const context = {document:{getElementById:element,querySelectorAll:selector=>selector==='[data-action-id]'?[button]:selector==='[data-action-card]'?[card]:[]},
    fetch:fetcher,crypto:{randomUUID:()=>'test-request-key-422'},AbortController,setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},
  };
  vm.createContext(context);
  vm.runInContext('(function(){'+viewSource.replace(/\bexport /g,'')+';globalThis.actionView={renderActionCards,showActionFeedback};})();',context);
  vm.runInContext('(function(){const {renderActionCards,showActionFeedback}=actionView;'+source.replace(/^import .+;$/mg,'').replace(/\bexport /g,'')+'\nglobalThis.actions={renderActions,bindActionEvents,setActionReading};})();',context);
  context.actions.bindActionEvents(()=>home,today=>{updates++;home.training.today=today;context.actions.renderActions(home.training);});
  context.actions.renderActions(home.training);
  return {home,button,classes,timers,element,context,get updates(){return updates;},click:()=>listener({target:{closest:()=>button}})};
}
const saved = {success:true,deduplicated:false,action:{date:'2026-10-12',quest_id:'q1',completed:true,status:'completed'},today:{date:'2026-10-12',done:1,total:1,pct:100,quests:[{id:'q1',title:'验证过的行动',done:true,status:'completed',manual:true}]}};
let release;
const pending = harness((_url, options)=>{assert.equal(options.method,'POST');assert.equal(JSON.parse(options.body).quest_id,'q1');return new Promise(resolve=>{release=resolve;});});
const request = pending.click();
assert.equal(pending.updates,0,'未确认响应之前不能更新完成状态');
assert.equal(pending.classes.size,0,'保存未确认不能触发成功动画');
assert.equal(pending.button.disabled,true);assert.equal(pending.element('refreshGenesis').disabled,true);
await pending.click();assert.equal(pending.updates,0,'保存期间重复点击不能更新');
release(new Response(JSON.stringify(saved)));await request;
assert.equal(pending.updates,1);assert.equal(pending.home.training.today.done,1);
assert.equal(pending.classes.has('is-celebrating'),true);
assert.match(pending.element('growthActionFeedback').textContent,/行动记录完成/);
assert.equal(pending.button.disabled,false);assert.equal(pending.element('refreshGenesis').disabled,false);

for (const [name,fetcher] of [
  ['network',async()=>{throw Error('网络不可用');}],
  ['browser offline',async()=>{throw new TypeError('Failed to fetch');}],
  ['unauthorized',async()=>new Response(JSON.stringify({error:'请先登录'}),{status:401})],
  ['malformed JSON',async()=>new Response('not json')],
  ['missing confirmation',async()=>new Response(JSON.stringify({success:true}))],
  ['wrong action',async()=>new Response(JSON.stringify({...saved,action:{date:'2026-10-12',quest_id:'other',status:'completed',completed:true}}))],
  ['wrong day',async()=>new Response(JSON.stringify({...saved,today:{...saved.today,date:'2026-10-11'}}))],
]) {
  const h=harness(fetcher);await h.click();
  assert.equal(h.updates,0,name);assert.equal(h.home.training.today.done,0,name);assert.equal(h.classes.size,0,name);
  assert.equal(h.element('growthActionFeedback').dataset.state,'failed',name);
  assert.equal(h.button.disabled,false,name);assert.equal(h.element('refreshGenesis').disabled,false,name);
}
const timeout = harness((_url,{signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new DOMException('timeout','AbortError')));}));
const timeoutRequest=timeout.click();
[...timeout.timers.values()].find(t=>t.ms===20000).fn();await timeoutRequest;
assert.equal(timeout.updates,0);assert.match(timeout.element('growthActionFeedback').textContent,/请求超时/);
assert.equal(timeout.button.disabled,false);assert.equal(timeout.element('refreshGenesis').disabled,false);
assert.equal(timeout.timers.size,0);
const reading=harness(async()=>{throw Error('不应发出请求');});reading.context.actions.setActionReading(true);await reading.click();assert.equal(reading.updates,0);
const cloud=harness(async()=>{throw Error('云端未接入任务不应写入');});cloud.home.training.actionTracking.writable=false;cloud.context.actions.renderActions(cloud.home.training);await cloud.click();assert.equal(cloud.updates,0);
console.log('行动卡片客户端：确认后更新与反馈、保存互斥、读取互斥、网络/认证/无效响应/超时失败不伪成功、云端禁用写入通过。');

const replay=harness(async()=>new Response(JSON.stringify({...saved,deduplicated:true})));await replay.click();assert.equal(replay.updates,1);assert.equal(replay.classes.size,0);assert.match(replay.element('growthActionFeedback').textContent,/无需重复/);

// 使命时间轴只改变呈现顺序，不推断完成，不修改原计划或发起请求。
let readOnlyRequests=0;
const presentation=harness(async()=>{readOnlyRequests++;throw Error('展示不能请求保存');});
presentation.home.training.today={date:'2026-10-12',done:0,total:4,inProgress:1,pct:0,quests:[
 {id:'late',title:'晚间创造',at:'20:00',minutes:30,status:'not_started'},
 {id:'unknown',title:'<script>unsafe</script>',at:null,minutes:null,status:'not_started'},
 {id:'early',title:'早间学习',at:'08:00',minutes:20,status:'in_progress'},
 {id:'same',title:'同时间行动',at:'08:00',minutes:5,status:'not_started'},
]};
const beforePresentation=JSON.stringify(presentation.home);
for(let n=0;n<100;n++)presentation.context.actions.renderActions(presentation.home.training);
const cards=presentation.element('growthQuestList').html;
assert.ok(cards.indexOf('data-action-card="early"')<cards.indexOf('data-action-card="same"'));
assert.ok(cards.indexOf('data-action-card="same"')<cards.indexOf('data-action-card="late"'));
assert.ok(cards.indexOf('data-action-card="late"')<cards.indexOf('data-action-card="unknown"'));
assert.ok(!cards.includes('<script>unsafe</script>'));assert.ok(cards.includes('&lt;script&gt;'));
assert.match(presentation.element('growthQuestRemaining').textContent,/55 分钟.*部分时长未记录/);
assert.match(presentation.element('growthQuestFocus').textContent,/进行中的使命：早间学习/);
assert.equal(JSON.stringify(presentation.home),beforePresentation);
assert.equal(readOnlyRequests,0);assert.equal(presentation.classes.size,0);assert.equal(presentation.timers.size,0);
presentation.home.training.today=null;presentation.home.training.available=false;
presentation.context.actions.renderActions(presentation.home.training);
assert.equal(presentation.element('growthQuestDate').textContent,'等待今日计划');
assert.equal(presentation.element('growthQuestRemaining').textContent,'尚无使命计划');
assert.match(presentation.element('growthQuestList').html,/不创建示例使命/);
assert.equal(readOnlyRequests,0);
console.log('每日使命：时间排序、同时间稳定顺序、未知时长提示、空状态、转义与100次纯渲染通过。');

const managed=harness(async(url,options)=>{assert.equal(url,'/api/genesis/quests/q1/state');assert.ok(options.headers['Idempotency-Key']);assert.deepEqual(JSON.parse(options.body),{date:'2026-10-12',action:'complete',revision:2,run_revision:0});return new Response(JSON.stringify(saved));});
Object.assign(managed.home.training.today.quests[0],{managed:true,revision:2,runRevision:0});await managed.click();assert.equal(managed.updates,1);
const paused=harness(async()=>{throw Error('暂停不能发起保存');});paused.home.training.today.quests[0].paused=true;await paused.click();assert.equal(paused.updates,0);
console.log('自主使命客户端：独立状态路由、版本与请求标识、暂停禁写通过。');
