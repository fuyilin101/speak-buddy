// 在真实本地 D1 上验证：并发去重、版本冲突和失败回滚，不触及用户数据库。
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile} from 'node:fs/promises';
import {mutate,fail,audit} from '../worker/store.js';
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("local D1");}}',compatibilityDate:'2026-10-11',d1Databases:['DB']}));
try {
 const db=await mf.getD1Database('DB');
 for(const file of ['migrations/0001_genesis.sql','migrations/0002_genesis_connector.sql','migrations/0003_genesis_private_memory.sql','test/fixtures/genesis-cloud-support.sql']){
  const sql=await readFile(new URL('../'+file,import.meta.url),'utf8');
  for(const statement of sql.replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
 }
 const at=new Date().toISOString(),request={key:'local-d1-concurrent-key',operation:'test:create',hash:'same'};
 const create=s=>{const project={id:crypto.randomUUID(),name:'非个人原子验收',created_at:at,updated_at:at};s.put('genesis_projects',project);return {project};};
 const results=await Promise.all(Array.from({length:8},()=>mutate(db,request,create)));
 assert.equal(new Set(results.map(r=>r.project.id)).size,1);assert.equal(results.filter(r=>!r.deduplicated).length,1);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM genesis_projects').first()).n,1);
 const before=(await db.prepare('SELECT revision FROM genesis_cloud_write_state WHERE id=1').first()).revision;
 await assert.rejects(mutate(db,{key:'local-d1-rollback-key',operation:'test:rollback',hash:'bad'},s=>{s.put('genesis_projects',{id:'invalid',name:'bad',progress:200,created_at:at,updated_at:at});audit(s,'test','invalid',null,at);return {};}));
 assert.equal((await db.prepare('SELECT revision FROM genesis_cloud_write_state WHERE id=1').first()).revision,before);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM genesis_edit_history').first()).n,0);
 assert.equal(await db.prepare("SELECT * FROM genesis_ingest_keys WHERE idempotency_key='local-d1-rollback-key'").first(),null);
 await assert.rejects(mutate(db,{...request,hash:'changed'},create),e=>e.status===409);
 const id=results[0].project.id;
 const update=s=>s.find('genesis_projects',id).then(row=>{if(row.updated_at!==at)fail('版本冲突',409);s.put('genesis_projects',{...row,updated_at:'2026-10-13T20:00:00.000Z'});return {project:{id}};});
 const changes=await Promise.allSettled([mutate(db,{key:'local-d1-update-first',operation:'test:update',hash:'one'},update),mutate(db,{key:'local-d1-update-second',operation:'test:update',hash:'two'},update)]);
 assert.equal(changes.filter(r=>r.status==='fulfilled').length,1);assert.equal(changes.find(r=>r.status==='rejected').reason.status,409);
 console.log('真实本地 D1：8个并发相同请求只创建1条；冲突409；CHECK失败完整回滚业务、审计、账本和内部版本。');
} finally {await mf.dispose();}
