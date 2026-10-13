// 只读展示与连接几何，业务写入规则由原技能API测试继续覆盖。
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {skillForest} from '../public/genesis-skill-model.mjs';
import {growthTreeMarkup,connectionPath} from '../public/genesis-growth-tree.mjs';
const skills=[{id:'root',name:'AI能力',parent_id:null,status:'practicing'},{id:'agent',name:'Agent开发',parent_id:'root',status:'learning'},{id:'mcp',name:'MCP',parent_id:'agent',status:'not_started'},{id:'tools',name:'Tool Calling',parent_id:'agent',status:'mastered'}];
const links=[{id:'project-link',skill_id:'agent',target_type:'project',target_title:'真实项目',target_id:'project'},{id:'asset-link',skill_id:'mcp',target_type:'asset',target_title:'实践资产',target_id:'asset'},{id:'goal-link',skill_id:'root',target_type:'goal',target_title:'长期方向',target_id:'goal'}];
const original=JSON.stringify({skills,links}),forest=skillForest(skills),folded=new Set(['agent']);
for(let i=0;i<100;i++){
 const html=growthTreeMarkup(forest,links,folded,'mcp');assert.match(html,/data-growth-parent="root"/);assert.match(html,/data-growth-parent="agent"/);assert.match(html,/data-skill-toggle="agent" aria-expanded="false"/);assert.match(html,/data-selected="true"/);assert.match(html,/data-growth-result="project-link"/);assert.match(html,/data-growth-result="asset-link"/);assert.match(html,/1 条关联/);assert.match(html,/实践中/);assert.match(html,/已掌握/);assert.ok(!/XP|Lv\.|系统认证|经验值/.test(html));
}assert.equal(JSON.stringify({skills,links}),original);assert.deepEqual([...folded],['agent']);
const hostile=skillForest([{id:'safe',name:'<script>alert(1)</script>',category:'<img src=x>',parent_id:null,status:'learning'}]);const safe=growthTreeMarkup(hostile,[{id:'x',skill_id:'safe',target_type:'asset',target_title:'<img onerror=x>',target_id:'x'}]);assert.ok(!safe.includes('<script>'));assert.ok(!safe.includes('<img'));assert.match(safe,/&lt;script&gt;/);
const missing=growthTreeMarkup(forest,[{...links[0],missing:true}]);assert.ok(!missing.includes('data-growth-result="project-link"'));
const many=growthTreeMarkup(forest,Array.from({length:5},(_,i)=>({...links[0],id:'p'+i})));assert.equal((many.match(/data-growth-result=/g)||[]).length,3);assert.match(many,/查看全部 5 项成果/);
assert.equal(connectionPath({x:10,y:20},{x:50,y:80}),'M 10 20 C 10 48.8, 50 51.2, 50 80');assert.equal(connectionPath({x:NaN,y:0},{x:0,y:1}),'');
const big=Array.from({length:1000},(_,i)=>({id:'node-'+i,name:'可读节点 '+i,parent_id:i?'node-'+Math.floor((i-1)/3):null,status:'not_started'}));const large=growthTreeMarkup(skillForest(big),[]);assert.equal((large.match(/class="skill-node growth-node"/g)||[]).length,1000);
const source=await readFile('public/genesis-growth-tree.mjs','utf8');assert.ok(!/\bfetch\s*\(|localStorage|indexedDB|Game\.render|POST|PATCH/.test(source));
const css=await readFile('public/css/14-genesis-growth-tree.css','utf8');assert.match(css,/prefers-reduced-motion/);assert.match(css,/@media\(max-width:700px\)/);assert.match(css,/min-height:44px/);
const html=await readFile('public/growth.html','utf8');assert.match(html,/查看成长之树/);assert.equal(html,await readFile('public/index.html','utf8'));
console.log('成长之树：100次纯渲染不改节点/状态/关联、父子结构与折叠、成果引用、转义/失效关联、1000节点、有限连接几何、无写入及移动/减少动画边界通过。');
