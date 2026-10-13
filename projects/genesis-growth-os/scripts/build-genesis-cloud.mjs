/** 复用只读成长首页与既有 Genesis 资产库；不打包旧游戏的奖励入口。 */
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'), output=resolve(root,'.genesis-cloud-assets');
await mkdir(output,{recursive:true});
// 清理旧构建入口，避免意外继续使用 Phase 3 页面。
for(const obsolete of ['cloud.js','vault.js']) await rm(resolve(output,obsolete),{force:true});
await cp(resolve(root,'public/css'),resolve(output,'css'),{recursive:true});
// 统一视觉复用本地字体；云端静态包也必须具备相同字体，不能回退外部 CDN。
await cp(resolve(root,'public/fonts'),resolve(output,'fonts'),{recursive:true});
for(const file of ['manifest.json','sw.js','offline.html','genesis-pwa.js','genesis-icon.svg','icon-192.png','icon-512.png','apple-touch-icon.png','favicon.png','login.html','login.js','genesis-home.js','genesis-home-model.mjs','genesis-dashboard.js','genesis-dashboard-model.mjs','genesis-action-model.mjs','genesis-action-view.mjs','genesis-actions.js','genesis-quest-builder.js','genesis-quest-history.js','genesis-editor.js','genesis-skills.js','genesis-skill-model.mjs','genesis-quest-stage.js','forge-stage.js','genesis-character.js','effigy.js','genesis-cloud.js']) await cp(resolve(root,'public',file),resolve(output,file));
await cp(resolve(root,'public/genesis-vault.js'),resolve(output,'genesis-vault.js'));
await cp(resolve(root,'public/growth.html'),resolve(output,'index.html'));
for(const file of ['setup.html','setup.js'])await cp(resolve(root,'public',file),resolve(output,file));
await cp(resolve(root,'public/genesis-growth-tree.mjs'),resolve(output,'genesis-growth-tree.mjs'));
console.log('已生成只读成长首页，保留既有资产库详情；未打包 Game.render。');
