import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile('public/setup.js','utf8');
async function render(status,{fail=false}={}){
 const controls=[{disabled:false},{disabled:false},{disabled:false,textContent:'完成设置'}],error={style:{},textContent:''},inputs={password:{value:'local-test-owner-phrase'},confirmPassword:{value:'local-test-owner-phrase'}},calls=[],history=[];
 const form={querySelectorAll:()=>controls,querySelector:()=>controls[2]};
 const window={location:{hash:'#setup=fixture-proof',pathname:'/setup.html',search:'',href:''},history:{replaceState(...args){history.push(args);}}};
 const fetch=async(url,options)=>{calls.push({url,options});if(fail)throw Error('offline');return {ok:true,status:200,json:async()=>url.endsWith('/status')?status:{success:true}};};
 const document={getElementById:id=>id==='setupForm'?form:id==='errorMsg'?error:inputs[id]};
 await vm.runInContext(source,vm.createContext({document,window,URLSearchParams,fetch}));return {form,controls,error,calls,history,window};
}
const blocked=await render({setupRequired:true,protectedSetup:true,setupAuthorized:false,minLength:12});assert.ok(blocked.controls.every(c=>c.disabled));await blocked.form.onsubmit({preventDefault(){}});assert.equal(blocked.calls.length,1);assert.match(blocked.error.textContent,/专属初始化/);
const offline=await render({}, {fail:true});assert.ok(offline.controls.every(c=>c.disabled));assert.match(offline.error.textContent,/无法连接/);
const owner=await render({setupRequired:true,protectedSetup:true,setupAuthorized:true,minLength:12});assert.ok(owner.controls.every(c=>!c.disabled));assert.equal(owner.history[0][2],'/setup.html');assert.equal(owner.calls[0].options.headers['X-Genesis-Setup-Token'],'fixture-proof');await owner.form.onsubmit({preventDefault(){}});assert.equal(owner.calls[1].url,'/api/setup');assert.equal(owner.calls[1].options.headers['X-Genesis-Setup-Token'],'fixture-proof');assert.equal(owner.window.location.href,'/');
const initialized=await render({setupRequired:false,protectedSetup:true});assert.equal(initialized.window.location.href,'/login.html');
const local=await render({setupRequired:true,minLength:10});assert.ok(local.controls.every(c=>!c.disabled));
console.log('首次设置UI：证明从地址移除、未授权/离线禁提交、重复初始化跳登录、主动输入确认后保存、本地原设置兼容通过。');
