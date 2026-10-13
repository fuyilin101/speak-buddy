/** D1 写入使用内部版本闸门；业务、审计和幂等记录在同一个 batch 中提交。
 * 不在 Worker 内启动迁移，不使用进程内锁。版本闸门不是用户成长数值。 */
export class ApiError extends Error {
  constructor(message,status=400){super(message);this.status=status;}
}
export const fail=(message,status=400)=>{throw new ApiError(message,status);};
export const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
const PRIMARY={genesis_projects:['id'],genesis_growth_records:['id'],genesis_assets:['id'],genesis_profile_items:['id'],genesis_goals:['id'],genesis_decisions:['id'],genesis_quests:['id'],genesis_quest_runs:['quest_id','date'],genesis_skills:['id'],genesis_skill_links:['id'],genesis_project_aliases:['alias_id'],genesis_edit_history:['id'],genesis_ingest_keys:['idempotency_key']};
const safeName=name=>/^[a-z][a-z0-9_]*$/.test(name);
const keyOf=(table,row)=>JSON.stringify(PRIMARY[table].map(key=>row[key]));
export class Store {
  constructor(db){this.db=db;this.cache=new Map();this.writes=new Map();this.removals=new Map();this.extra=[];}
  async all(table){
    if(!PRIMARY[table])fail('未知资料类型。');
    if(!this.cache.has(table)){const {results}=await this.db.prepare('SELECT * FROM '+table).all();this.cache.set(table,new Map((results||[]).map(row=>[keyOf(table,row),row])));}
    return [...this.cache.get(table).values()];
  }
  async find(table,id){await this.all(table);return PRIMARY[table].length===1?this.cache.get(table).get(JSON.stringify([id]))||null:[...this.cache.get(table).values()].find(row=>row[PRIMARY[table][0]]===id)||null;}
  put(table,row){
    if(!PRIMARY[table]||Object.keys(row).some(key=>!safeName(key))||PRIMARY[table].some(key=>row[key]==null))fail('保存结构无效。');
    const copy={...row},key=keyOf(table,copy);if(!this.writes.has(table))this.writes.set(table,new Map());this.writes.get(table).set(key,copy);this.cache.get(table)?.set(key,copy);if(table==='genesis_project_aliases')this.aliasMap=null;return copy;
  }
  remove(table,row){const pk=PRIMARY[table];if(!pk||pk.length!==1)fail('不支持删除这类历史资料。');if(!this.removals.has(table))this.removals.set(table,new Set());this.removals.get(table).add(row[pk[0]]);this.cache.get(table)?.delete(keyOf(table,row));this.writes.get(table)?.delete(keyOf(table,row));}
  sql(sql,...values){this.extra.push(this.db.prepare(sql).bind(...values));}
  statements(){
    const out=[];
    for(const [table,ids] of this.removals)out.push(this.db.prepare(`DELETE FROM ${table} WHERE ${PRIMARY[table][0]} IN (SELECT value FROM json_each(?))`).bind(JSON.stringify([...ids])));
    for(const [table,records] of this.writes){
      // 同结构记录按字节拆分；所有分组仍属于一个原子 batch。
      const groups=new Map();for(const row of records.values()){const cols=Object.keys(row).sort(),group=cols.join(',');if(!groups.has(group))groups.set(group,[]);groups.get(group).push(row);}
      for(const [group,rows] of groups){const cols=group.split(','),pk=PRIMARY[table],updates=cols.filter(c=>!pk.includes(c));
        const sql=`INSERT INTO ${table} (${cols.join(',')}) SELECT ${cols.map(c=>`json_extract(value,'$.${c}')`).join(',')} FROM json_each(?) WHERE 1 ON CONFLICT(${pk.join(',')}) ${updates.length?'DO UPDATE SET '+updates.map(c=>`${c}=excluded.${c}`).join(','):'DO NOTHING'}`;
        let chunk=[],bytes=0;for(const row of rows){const size=new TextEncoder().encode(JSON.stringify(row)).length;if(size>500000)fail('单条资料过大，请缩小内容。',413);if(chunk.length&&(bytes+size>500000||chunk.length>=100)){out.push(this.db.prepare(sql).bind(JSON.stringify(chunk)));chunk=[];bytes=0;}chunk.push(row);bytes+=size;}if(chunk.length)out.push(this.db.prepare(sql).bind(JSON.stringify(chunk)));
      }
    }
    return [...out,...this.extra];
  }
}
async function replay(db,key,operation,hash){
  const previous=await db.prepare('SELECT operation,request_hash,response_json FROM genesis_ingest_keys WHERE idempotency_key=?').bind(key).first();
  if(!previous)return null;if(previous.operation!==operation||previous.request_hash!==hash)fail('同一请求标识不能用于不同操作或内容。',409);
  const value=JSON.parse(previous.response_json);return {...value,deduplicated:true,...(Object.hasOwn(value,'created')?{created:false}:{})};
}
export async function mutate(db,{key,operation,hash,resourceType='manual'},work){
  if(typeof key!=='string'||key.length<16||key.length>200||!/^[\w:.-]+$/.test(key))fail('缺少有效的保存请求标识。');
  for(let attempt=0;attempt<5;attempt++){
    const clock=await db.prepare('SELECT revision FROM genesis_cloud_write_state WHERE id=1').first();
    if(!Number.isSafeInteger(clock?.revision))fail('云端迁移尚未完成，请联系维护者。',503);
    const previous=await replay(db,key,operation,hash);if(previous)return previous;
    const store=new Store(db),value=await work(store),response={success:true,deduplicated:false,...value};
    store.put('genesis_ingest_keys',{idempotency_key:key,operation,request_hash:hash,resource_type:resourceType,resource_id:value.record?.id||value.skill?.id||value.quest?.id||value.project?.id||value.asset?.id||value.action?.quest_id||'profile',response_json:JSON.stringify(response),created_at:new Date().toISOString()});
    const statements=store.statements();if(statements.length>40)fail('本次操作内容过多，请分成较小批次。',413);
    // CHECK(revision >= 0) 使比较失败成为 SQL 错误，从而回滚整个 batch。
    const guard=db.prepare('UPDATE genesis_cloud_write_state SET revision=CASE WHEN revision=? THEN revision+1 ELSE -1 END WHERE id=1').bind(clock.revision);
    try {await db.batch([guard,...statements]);return response;}
    catch(error){
      // 另一个请求已经提交时重新读取；显式实体版本仍由 work 校验并返回 409。
      const latest=await db.prepare('SELECT revision FROM genesis_cloud_write_state WHERE id=1').first();
      if(latest?.revision!==clock.revision)continue;
      throw error;
    }
  }
  fail('资料正在被另一设备修改，请刷新后重试。',409);
}
async function aliasesOf(store){if(!store.aliasMap)store.aliasMap=new Map((await store.all('genesis_project_aliases')).map(row=>[row.alias_id,row.canonical_id]));return store.aliasMap;}
export async function projectId(store,id){
  if(!id)return null;const aliases=await aliasesOf(store),seen=new Set();
  while(aliases.has(id)){if(seen.has(id))fail('项目关联异常，请联系维护者。',409);seen.add(id);id=aliases.get(id);}return id;
}
export async function visibleProjects(store){const aliases=await aliasesOf(store);return (await store.all('genesis_projects')).filter(row=>!aliases.has(row.id));}
export function audit(store,kind,id,before,at){store.put('genesis_edit_history',{id:crypto.randomUUID(),resource_type:kind,resource_id:id,before_json:JSON.stringify(before),source_type:'manual_edit',visibility:'private',created_at:at});}
