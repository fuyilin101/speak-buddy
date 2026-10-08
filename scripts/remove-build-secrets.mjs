import { rmSync } from "node:fs";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

rmSync("dist/anime_english_mvp/.dev.vars", { force: true });
const match=readFileSync('.dev.vars','utf8').match(/^AI_GATEWAY_TOKEN\s*=\s*['"]?([^\r\n'"]+)/m);
const secret=match?.[1].trim();
if(!secret)throw new Error('Cannot verify assets without local secret');
function verify(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())verify(path);else{if(/^(\.dev\.vars|\.env)/.test(entry.name)||readFileSync(path).includes(Buffer.from(secret)))throw new Error('Sensitive asset detected; deployment stopped');}}}
verify('dist/client');
console.log('Client assets verified: no local secrets or environment files');
