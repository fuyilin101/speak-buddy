import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const js=stripTypeScriptTypes(readFileSync('src/chatTransport.ts','utf8'),{mode:'transform'});
const {requestJson}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const originalFetch=globalThis.fetch;
test('translation sends the selected English text only to the translation endpoint',async()=>{
 let call;
 globalThis.fetch=async(path,init)=>{call={path,body:JSON.parse(init.body)};return Response.json({translation:'我喜欢猫。'},{headers:{'content-type':'application/json'}})};
 try{const data=await requestJson('/api/translate',{text:'I like cats.',setup:{englishLevel:'能说简单句'}});assert.equal(data.translation,'我喜欢猫。');assert.equal(call.path,'/api/translate');assert.equal(call.body.text,'I like cats.');assert.equal(call.body.setup.englishLevel,'能说简单句');}finally{globalThis.fetch=originalFetch}
});
test('translation failure is reported without retrying or calling chat',async()=>{
 let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({error:'翻译暂时不可用，请重试'}),{status:502,headers:{'content-type':'application/json'}})};
 try{await assert.rejects(requestJson('/api/translate',{text:'Hello',setup:{}}),/翻译暂时不可用/);assert.equal(calls,1)}finally{globalThis.fetch=originalFetch}
});

