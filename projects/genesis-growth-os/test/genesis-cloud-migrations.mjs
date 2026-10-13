// Wrangler 真实本地迁移账本：旧库增量、重复执行与已有记录保护。绝不使用 --remote。
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,cp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
const root=process.cwd(),dir=await mkdtemp(resolve(tmpdir(),'genesis-cloud-migrations-')),config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
const cli=resolve(root,'node_modules/wrangler/bin/wrangler.js'),file=resolve(dir,'wrangler.jsonc'),persist=resolve(dir,'state');
config.main=resolve(root,'worker/index.js');config.assets.directory=resolve(root,'public');config.env.test.assets.directory=resolve(root,'.genesis-cloud-assets');
const run=args=>execFileSync(process.execPath,[cli,...args,'--config',file,'--env','test'],{cwd:root,encoding:'utf8',env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'},input:'y\n',stdio:['pipe','pipe','pipe']});
const query=sql=>JSON.parse(run(['d1','execute','genesis-ai-test','--local','--persist-to',persist,'--command',sql,'--json']));
try{
 const old=resolve(dir,'old');await mkdir(old);for(const name of ['0001_genesis.sql','0002_genesis_connector.sql','0003_genesis_private_memory.sql'])await cp(resolve(root,'migrations',name),resolve(old,name));
 config.env.test.d1_databases[0].migrations_dir=old;await writeFile(file,JSON.stringify(config));
 run(['d1','migrations','apply','genesis-ai-test','--local','--persist-to',persist]);
 query("INSERT INTO genesis_projects(id,name,created_at,updated_at) VALUES('baseline','非个人升级验收','2026-10-13','2026-10-13');");
 const before=query("SELECT * FROM genesis_projects WHERE id='baseline'")[0].results;
 config.env.test.d1_databases[0].migrations_dir=resolve(root,'migrations');await writeFile(file,JSON.stringify(config));
 run(['d1','migrations','apply','genesis-ai-test','--local','--persist-to',persist]);
 assert.deepEqual(query("SELECT * FROM genesis_projects WHERE id='baseline'")[0].results,before);
 assert.equal(query('SELECT COUNT(*) n FROM d1_migrations')[0].results[0].n,8);
 assert.equal(query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name LIKE 'genesis_%'")[0].results[0].n,15);
 assert.equal(query('SELECT COUNT(*) n FROM genesis_owner_auth')[0].results[0].n,0);
 assert.equal(query('SELECT COUNT(*) n FROM genesis_quest_runs')[0].results[0].n,0);assert.equal(query('SELECT COUNT(*) n FROM genesis_skills')[0].results[0].n,0);
 run(['d1','migrations','apply','genesis-ai-test','--local','--persist-to',persist]);
 assert.equal(query('SELECT COUNT(*) n FROM d1_migrations')[0].results[0].n,8);assert.deepEqual(query("SELECT * FROM genesis_projects WHERE id='baseline'")[0].results,before);
 console.log('Wrangler 本地 D1：0001–0003旧库增量升级到0008、15张Genesis表、重复无变化、原记录保留、没有自动初始化密码或个人数据。');
}finally{assert.ok(dir.startsWith(resolve(tmpdir(),'genesis-cloud-migrations-')));await rm(dir,{recursive:true,force:true});}
