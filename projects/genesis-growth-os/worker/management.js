/** 单用户网页管理入口与 Agent 写入严格分开；可用状态不作为授权凭据。 */
import {Store,fail,mutate,canonical,digest} from './store.js';
import {readQuests,readRuns,writeQuest} from './quests.js';
import {readSkills,reference,writeSkill} from './skills.js';
import {readEditor,writeEditor,createBrowserRecord} from './editor.js';
export function managedPath(path,method){return ['/api/genesis/quests','/api/genesis/quest-runs','/api/genesis/skills','/api/genesis/editor'].some(prefix=>path===prefix||path.startsWith(prefix+'/'))||method==='POST'&&['/api/genesis/projects','/api/genesis/growth-records'].includes(path);}
export async function managedRead(db,path,params){
 if(path==='/api/genesis/quests')return readQuests(db);
 if(path==='/api/genesis/quest-runs')return readRuns(db,params);
 if(path==='/api/genesis/skills')return readSkills(db);
 if(path==='/api/genesis/editor')return readEditor(db);
 const match=path.match(/^\/api\/genesis\/skills\/reference\/([^/]+)\/([^/]+)$/);if(match){const record=await reference(new Store(db),match[1],decodeURIComponent(match[2]));if(!record)fail('关联记录不存在。',404);return {record};}
 fail('管理接口不存在。',404);
}
export async function managedWrite(db,path,method,body,key){
 const operation='web:'+method+':'+path,hash=await digest(canonical(body));
 return mutate(db,{key,operation,hash},store=>{
  if(path.startsWith('/api/genesis/quests'))return writeQuest(store,path,method,body);
  if(path.startsWith('/api/genesis/skills'))return writeSkill(store,path,method,body);
  if(path.startsWith('/api/genesis/editor'))return writeEditor(store,path,method,body);
  if(method==='POST'&&['/api/genesis/projects','/api/genesis/growth-records'].includes(path))return createBrowserRecord(store,path,body);
  fail('不支持此管理操作。',405);
 });
}
