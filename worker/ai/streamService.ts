import type {Env} from '../index';
import type {Profile,Message} from './types';
import {analyzeEmotion} from './emotionAnalyzer';
import {updateRelationship} from './relationshipManager';
import {buildPrompt} from './promptBuilder';
import {loadMemory,saveTurn,saveSummary} from './memoryManager';
import {callJson,callStream} from './llm';

type Defer=(promise:Promise<unknown>)=>void;
async function refreshSummary(env:Env,userId:string,previous:string,messages:Message[],through:number){
 const result=await callJson(env,[
  {role:'system',content:'把对话压缩为事实摘要，只返回JSON {"summary":"..."}。保留用户正在做什么、待发生事件、未完话题、角色答应继续聊的事；禁止虚构。'},
  {role:'user',content:JSON.stringify({previous,messages})}
 ],600);
 if(typeof result.summary==='string')await saveSummary(env.DB!,userId,result.summary,through);
}

const encoder=new TextEncoder();
const event=(type:string,data:unknown)=>encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
function partialReply(raw:string){
 const match=raw.match(/"replyEn"\s*:\s*"((?:\\.|[^"\\])*)/);if(!match)return '';
 try{return JSON.parse(`"${match[1]}"`)}catch{return match[1].replace(/\\n/g,'\n').replace(/\\"/g,'"');}
}
function parseDelta(value:any){const content=value?.choices?.[0]?.delta?.content;return typeof content==='string'?content:'';}
export async function chatStreamService(env:Env,body:{userId:string;requestId:string;message:string;setup:Profile;history?:Message[]},requestSignal?:AbortSignal,defer?:Defer){
 if(!env.DB)throw new Error('数据库未配置');const db=env.DB;
 const cached=await db.prepare('SELECT response_json FROM chat_requests WHERE user_id=? AND request_id=?').bind(body.userId,body.requestId).first<{response_json:string}>();
 if(cached){const result=JSON.parse(cached.response_json);return new ReadableStream({start(controller){controller.enqueue(event('delta',{text:result.replyEn}));controller.enqueue(event('done',{result}));controller.close();}});}
 const started=performance.now();const memory=await loadMemory(env.DB,body.userId);const profile=memory.state?.profile_completed?JSON.parse(memory.state.profile_json):body.setup;const emotion=analyzeEmotion(body.message);const relationship=updateRelationship(memory.state,new Date().toISOString());
 const summary=memory.summary;const total=memory.state?.message_count||0;const shouldRefreshSummary=total-(memory.state?.summary_through||0)>=40;
 const history=memory.messages.length?memory.messages:(body.history||[]).slice(-40);const systemPrompt=buildPrompt(profile,emotion,relationship,summary);const upstream=await callStream(env,[{role:'system',content:systemPrompt},...history.map((m:any)=>({role:m.role,content:m.content})),{role:'user',content:body.message}],900,requestSignal);
 const reader=upstream.getReader();const decoder=new TextDecoder();let buffer='';let raw='';let reply='';let firstMs:number|null=null;let usage:any=null;let closed=false;
 return new ReadableStream({async start(controller){
  try{while(true){const part=await reader.read();if(part.done)break;buffer+=decoder.decode(part.value,{stream:true});const lines=buffer.split(/\r?\n/);buffer=lines.pop()||'';for(const line of lines){if(!line.startsWith('data:'))continue;const data=line.slice(5).trim();if(!data||data==='[DONE]')continue;let value:any;try{value=JSON.parse(data)}catch{continue;}usage=value.usage||usage;const delta=parseDelta(value);if(!delta)continue;raw+=delta;const next=partialReply(raw);if(next.length>reply.length){const text=next.slice(reply.length);reply=next;if(firstMs===null){firstMs=Math.round(performance.now()-started);console.log(JSON.stringify({event:'stream_timing',ttft_ms:firstMs,history_messages:history.length}));}controller.enqueue(event('delta',{text}));}}}const finalMatch=raw.match(/\{[\s\S]*\}/);let result:any;try{result=finalMatch?JSON.parse(finalMatch[0]):null}catch{result=null;}if(!result||typeof result.replyEn!=='string'||!result.replyEn.trim()){console.error(JSON.stringify({event:'stream_parse_failed',raw_length:raw.length,has_reply_key:raw.includes('replyEn'),starts_with:raw.slice(0,24)}));throw new Error('流式回复不完整');}const normalized={hasError:false,errorLevel:'none',original:body.message,corrected:body.message,explanationZh:'',requireRepeat:false,replyZh:'',...result};await saveTurn(db,body.userId,profile,relationship,body.message,normalized,emotion,body.requestId);console.log(JSON.stringify({event:'stream_timing',ttft_ms:firstMs,complete_ms:Math.round(performance.now()-started),input_tokens:usage?.prompt_tokens??null,output_tokens:usage?.completion_tokens??null,llm_calls:1,saved:true}));controller.enqueue(event('done',{result:normalized}));controller.close();closed=true;if(shouldRefreshSummary){const summaryMessages:Message[]=[...memory.messages,{role:'user',content:body.message},{role:'assistant',content:normalized.replyEn}];const task=refreshSummary(env,body.userId,memory.summary,summaryMessages,total+2).catch(()=>console.error(JSON.stringify({event:'summary_failed',deferred:true})));if(defer)defer(task);else void task;}}catch(error){console.error(JSON.stringify({event:'stream_failed',message:error instanceof Error?error.message:'unknown',saved:false}));if(!closed){controller.enqueue(event('error',{message:'流式回复中断，请重试'}));controller.close();closed=true;}}},cancel(){reader.cancel().catch(()=>{});}});
}

