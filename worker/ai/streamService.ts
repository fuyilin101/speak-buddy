import type {Env} from '../index';
import type {Profile,Message} from './types';
import {analyzeEmotion} from './emotionAnalyzer';
import {updateRelationship} from './relationshipManager';
import {buildPrompt} from './promptBuilder';
import {loadMemory,saveTurn,saveSummary,saveLearningRecord} from './memoryManager';
import {callJson,callStream} from './llm';
import {recordChat} from '../growthService';
import {normalizeStreamResult,partialReply,sanitizeHistory,modelHistory,isSingleEnglishWord,isLowQualityReply,isHistoryEcho,isRepeatedAssistantReply,fallbackReply} from './streamParsing';

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
function parseDelta(value:any){const content=value?.choices?.[0]?.delta?.content;return typeof content==='string'?content:'';}
export async function chatStreamService(env:Env,body:{userId:string;requestId:string;message:string;setup:Profile;history?:Message[]},requestSignal?:AbortSignal,defer?:Defer){
 if(!env.DB)throw new Error('数据库未配置');const db=env.DB;
 const cached=await db.prepare('SELECT response_json FROM chat_requests WHERE user_id=? AND request_id=?').bind(body.userId,body.requestId).first<{response_json:string}>();
 if(cached){const result=JSON.parse(cached.response_json);return new ReadableStream({start(controller){controller.enqueue(event('delta',{text:result.replyEn}));controller.enqueue(event('done',{result}));controller.close();}});}
 const started=performance.now();console.log(JSON.stringify({event:'stream_request_started',request_id:body.requestId}));const memory=await loadMemory(env.DB,body.userId);const profile=memory.state?.profile_completed?JSON.parse(memory.state.profile_json):body.setup;const emotion=analyzeEmotion(body.message);const relationship=updateRelationship(memory.state,new Date().toISOString());
 const summary=memory.summary;const total=memory.state?.message_count||0;const shouldRefreshSummary=total-(memory.state?.summary_through||0)>=40;
 const history=sanitizeHistory(memory.messages.length?memory.messages:(body.history||[]).slice(-40));const systemPrompt=buildPrompt(profile,emotion,relationship,summary);const vocabularyInstruction=isSingleEnglishWord(body.message)?{role:'system',content:'The user sent exactly one English word for vocabulary practice. Define that word in simple English, give one short example sentence, and ask one related question. Your replyEn must contain the meaning and example; never merely repeat the word.'}:null;const upstream=await callStream(env,[{role:'system',content:systemPrompt},...modelHistory(history),...(vocabularyInstruction?[vocabularyInstruction]:[]),{role:'user',content:body.message}],900,requestSignal,body.requestId);
 const reader=upstream.getReader();const decoder=new TextDecoder();let buffer='';let raw='';let reply='';let visibleReply='';let firstMs:number|null=null;let usage:any=null;let closed=false;let persistenceFailure=false;
 return new ReadableStream({async start(controller){
  try {
    while (true) {
      const part=await reader.read();
      if(part.done) break;
      buffer+=decoder.decode(part.value,{stream:true});
      const lines=buffer.split(/\r?\n/);
      buffer=lines.pop()||'';
      for(const line of lines){
        if(!line.startsWith('data:')) continue;
        const data=line.slice(5).trim();
        if(!data||data==='[DONE]') continue;
        let value:any;
        try{value=JSON.parse(data)}catch{continue;}
        usage=value.usage||usage;
        const delta=parseDelta(value);
        if(!delta) continue;
        raw+=delta;
        const next=partialReply(raw);
        if(next.length>reply.length){
          const userHistory=history.filter((item:any)=>item.role==='user').map((item:any)=>String(item.content||''));
          const wasEcho=Boolean(body.message.trim()&&body.message.trim().toLowerCase().startsWith(next.trim().toLowerCase()))||userHistory.some(item=>item.trim().toLowerCase().startsWith(next.trim().toLowerCase()));
          const hold=wasEcho||next.trim().toLowerCase()==='like';
          reply=next;
          if(!hold){
            const text=next.slice(visibleReply.length);
            visibleReply=next;
            if(firstMs===null){
              firstMs=Math.round(performance.now()-started);
              console.log(JSON.stringify({event:'stream_timing',request_id:body.requestId,ttft_ms:firstMs,history_messages:history.length}));
            }
            if(text)controller.enqueue(event('delta',{text}));
          }
        }
      }
    }
    raw+=decoder.decode();
    const result=normalizeStreamResult(raw,body.message);
    let normalized=result;
    // Qwen occasionally emits a valid JSON scalar (for example `true`) instead
    // of the required reply object. Treat this known schema failure as a
    // deterministic local fallback, while keeping arbitrary/empty corruption
    // as an error so it is never presented as a successful answer.
    if(!normalized&&/^(true|false|null)$/i.test(raw.trim())){
      normalized={hasError:false,errorLevel:'none',original:body.message,corrected:body.message,explanationZh:'',requireRepeat:false,replyZh:'',replyEn:fallbackReply(body.message),learningFeedback:{type:'none',originalText:body.message,suggestedText:body.message,explanationZh:'',focusPoint:''}};
      console.warn(JSON.stringify({event:'stream_schema_fallback',request_id:body.requestId,raw_scalar:raw.trim()}));
    }
    if(!normalized){
      console.error(JSON.stringify({event:'stream_parse_failed',request_id:body.requestId,raw_length:raw.length,has_reply_key:raw.includes('replyEn'),starts_with:raw.slice(0,24)}));
      throw new Error('流式回复不完整');
    }
    const userHistory=history.filter((item:any)=>item.role==='user').map((item:any)=>String(item.content||''));
    const assistantHistory=history.filter((item:any)=>item.role==='assistant').map((item:any)=>String(item.content||''));
    if(isLowQualityReply(normalized.replyEn,body.message)||isHistoryEcho(normalized.replyEn,userHistory)||isRepeatedAssistantReply(normalized.replyEn,assistantHistory)){
      normalized={...normalized,replyEn:fallbackReply(body.message)};
      console.log(JSON.stringify({event:'reply_quality_fallback',request_id:body.requestId,original_chars:body.message.length,reply_chars:result?.replyEn?.length??0,fallback_chars:normalized.replyEn.length}));
    }
    normalized.learningFeedback={...normalized.learningFeedback,sourceMessageId:body.requestId};
    if(normalized.replyEn.length>visibleReply.length){
      const text=normalized.replyEn.slice(visibleReply.length);
      visibleReply=normalized.replyEn;
      if(firstMs===null){
        firstMs=Math.round(performance.now()-started);
        console.log(JSON.stringify({event:'stream_timing',request_id:body.requestId,ttft_ms:firstMs,history_messages:history.length}));
      }
      if(text)controller.enqueue(event('delta',{text}));
    }
    try{await saveTurn(db,body.userId,profile,relationship,body.message,normalized,emotion,body.requestId);}catch(error){persistenceFailure=true;throw error;}
    try{await recordChat(env,body.userId,body.requestId,body.message);}catch(error){console.error(JSON.stringify({event:'growth_award_failed',request_id:body.requestId,type:error instanceof Error?error.name:'unknown'}));}
    if(normalized.learningFeedback?.type==='grammar'){
      try{
        const recordId=await saveLearningRecord(db,body.userId,body.requestId,normalized.learningFeedback);
        if(recordId)normalized.learningFeedback={...normalized.learningFeedback,learningSaved:true,recordId};
      }catch(error){console.error(JSON.stringify({event:'learning_record_auto_save_failed',request_id:body.requestId,type:error instanceof Error?error.name:'unknown'}));}
    }
    console.log(JSON.stringify({event:'stream_completed',request_id:body.requestId,ttft_ms:firstMs,complete_ms:Math.round(performance.now()-started),input_tokens:usage?.prompt_tokens??null,output_tokens:usage?.completion_tokens??null,raw_length:raw.length,reply_chars:normalized.replyEn.length,history_messages:history.length,llm_calls:1,saved:true,sse_done:true}));
    controller.enqueue(event('done',{result:normalized}));
    controller.close();
    closed=true;
    if(shouldRefreshSummary){
      const summaryMessages:Message[]=[...memory.messages,{role:'user',content:body.message},{role:'assistant',content:normalized.replyEn}];
      const task=refreshSummary(env,body.userId,memory.summary,summaryMessages,total+2).catch(()=>console.error(JSON.stringify({event:'summary_failed',request_id:body.requestId,deferred:true})));
      if(defer)defer(task);else void task;
    }
  }catch(error){
    console.error(JSON.stringify({event:'stream_failed',request_id:body.requestId,message:error instanceof Error?error.message:'unknown',saved:false}));
    if(!closed){controller.enqueue(event('error',{message:persistenceFailure?'回复已生成，但保存失败，请稍后刷新重试':'流式回复中断，请重试',code:persistenceFailure?'persistence_failed':'stream_failed'}));controller.close();closed=true;}
  }},cancel(){reader.cancel().catch(()=>{});}});
}


