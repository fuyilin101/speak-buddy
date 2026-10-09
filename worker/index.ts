import {protectTest} from './testSecurity';
/// <reference types="@cloudflare/workers-types" />
import {profileService} from './profileService';
import {chatService} from './ai/chatService';
import {chatStreamService} from './ai/streamService';
import {createGuestCookie} from './guestSession';
import {learningService} from './learningService';
/// <reference types="@cloudflare/workers-types" />
export interface Env { ASSETS: Fetcher; DB?: D1Database; AI_GATEWAY_URL?: string; AI_GATEWAY_TOKEN?: string; AI_MODEL?: string; AI_CHAT_MODEL?: string; AI_TRANSLATION_MODEL?: string; AI_SUMMARY_MODEL?: string; AI_VISION_MODEL?: string; TEST_LOCKDOWN?: string; PUBLIC_GUEST_MODE?: string; GUEST_SESSION_SECRET?: string; ACCESS_ISSUER?: string; ACCESS_AUD?: string; TEST_ALLOWED_EMAIL?: string }
type Setup= {character:string; companionName:string; nickname:string; ageGroup:string; englishLevel:string};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json;charset=UTF-8'}});
const now=()=>new Date().toISOString();
function demo(message:string, history:unknown[]=[]){
  const chinese=/[\u4e00-\u9fff]/.test(message);
  if(chinese){
    const map:[RegExp,string,string][]=[[/我在学校/,'I am at school.','“我在学校”可以说 “I am at school.”'],[/我喜欢它/,'I like it.','“我喜欢它”可以说 “I like it.”'],[/我不知道/,'I don’t know.','“我不知道”可以说 “I don’t know.”']];
    const hit=map.find(([pattern])=>pattern.test(message)); const english=hit?.[1]??'I want to speak English.'; const explanation=hit?.[2]??'先试着用这句话表达，然后继续聊天。';
    return {hasError:true,errorLevel:'normal',original:message,corrected:english,explanationZh:explanation,requireRepeat:true,replyEn:`Try saying: “${english}”`,replyZh:'跟我复述一遍，我们再继续聊。',emotion:'encouraging'};
  }
  const hasError=/goed|yesterday.*go|very like/i.test(message); const lower=message.toLowerCase(); const turns=history.filter((m:any)=>m?.role==='assistant').length; const fallbacks=['I’m listening! What would you like to talk about?','That sounds interesting! Can you tell me one more detail?','I’m curious to hear more. What happened next?']; const fallback=/\\b(hi|hello|hey)\\b/.test(lower)?'Hi! How are you today?':/\\b(thank|thanks)\\b/.test(lower)?'You’re welcome! What would you like to talk about?':/\\b(what|how|where|why)\\b/.test(lower)?'That’s a good question! Tell me a little more.':fallbacks[turns%fallbacks.length]; return {hasError,errorLevel:hasError?'normal':'none',original:message,corrected:hasError?message.replace(/goed/gi,'went').replace(/very like/gi,'really like'):message,explanationZh:hasError?'过去发生的事情要使用正确的过去式或更自然的表达。':'',requireRepeat:false,replyEn:hasError?'Almost! What did you do yesterday?':fallback,replyZh:hasError?'试着说一遍，然后告诉我更多。':'我在听呢，再告诉我一点吧。',emotion:'neutral'};
}
function visionDemo(){return {replyEn:'I could not read the photo clearly. Could you try another one?',replyZh:'这次没有清楚识别照片，请换一张主体更清楚的照片。',summary:'Vision model unavailable or image could not be understood.'};}
async function askVisionModel(env:Env,body:any){
  if(!env.AI_GATEWAY_URL||!body.imageDataUrl)return null;
  try{
    const prompt=`你是一个温柔的英语口语伙伴。结合用户年龄段、英语水平和当前对话理解照片，只返回 JSON：replyEn,replyZh,summary,hintEn,hintZh。replyEn 只写1到2句简单英文，并自然提出一个问题；必须根据照片中看得见的主体回答；如果看不清就明确说看不清，不要猜测，不要机械描述图片。hintEn 给出一句用户可以用来接话的简单英文，hintZh 给出对应中文。`;
    const response=await fetch(env.AI_GATEWAY_URL,{method:'POST',headers:{'content-type':'application/json',...(env.AI_GATEWAY_TOKEN?{authorization:`Bearer ${env.AI_GATEWAY_TOKEN}`}:{})},body:JSON.stringify({model:env.AI_VISION_MODEL||'qwen3-vl-plus',messages:[{role:'system',content:prompt},{role:'user',content:[{type:'text',text:`设置：${JSON.stringify(body.setup||{})}；当前对话：${JSON.stringify(body.history||[]).slice(-3000)}`},{type:'image_url',image_url:{url:body.imageDataUrl}}]}],temperature:.6,max_tokens:160,enable_thinking:false})});
    if(!response.ok)return null;
    const raw=await response.json() as any; const content=raw.choices?.[0]?.message?.content??raw.output_text; const match=String(content||'').match(/\{[\s\S]*\}/); return match?JSON.parse(match[0]):null;
  }catch{return null}
}
async function parseModelJson(raw:any){
  const content=raw?.choices?.[0]?.message?.content??raw?.output_text;
  if(typeof content!=='string')return null;
  const cleaned=content.replace(/```(?:json)?/gi,'').replace(/```/g,'').trim();
  const match=cleaned.match(/\{[\s\S]*\}/); if(!match)return null;
  try{const value=JSON.parse(match[0]); if(!value||typeof value.replyEn!=='string')return null; return value;}catch{return null;}
}
function parseTranslation(raw:any){
  const content=raw?.choices?.[0]?.message?.content??raw?.output_text;
  if(typeof content!=='string')return null;
  const cleaned=content.replace(/```(?:json)?/gi,'').replace(/```/g,'').trim();
  const match=cleaned.match(/\{[\s\S]*\}/);
  if(match){try{const value=JSON.parse(match[0]);if(typeof value?.translation==='string'&&value.translation.trim())return value.translation.trim();}catch{}}
  return cleaned||null;
}
async function askTranslation(env:Env,text:string,_setup:Setup){
  if(!env.AI_GATEWAY_URL||!env.AI_GATEWAY_TOKEN)return null;
  const translationModel=env.AI_TRANSLATION_MODEL||'qwen-mt-flash';
  try{
    const response=await fetch(env.AI_GATEWAY_URL,{method:'POST',signal:AbortSignal.timeout(20000),headers:{'content-type':'application/json',authorization:`Bearer ${env.AI_GATEWAY_TOKEN}`},body:JSON.stringify({model:translationModel,messages:[{role:'user',content:text}],translation_options:{source_lang:'English',target_lang:'Chinese'},max_tokens:220,stream:false})});
    if(response.ok){const translation=parseTranslation(await response.json());if(translation)return translation;}
  }catch{}
  // Keep qwen-plus as a service fallback if the dedicated MT model is unavailable.
  try{
    const response=await fetch(env.AI_GATEWAY_URL,{method:'POST',signal:AbortSignal.timeout(20000),headers:{'content-type':'application/json',authorization:`Bearer ${env.AI_GATEWAY_TOKEN}`},body:JSON.stringify({model:env.AI_MODEL||'qwen-plus',messages:[{role:'system',content:'Translate the user English into concise natural Chinese. Return only JSON: {"translation":"..."}.'},{role:'user',content:text}],temperature:.1,max_tokens:220,stream:false,enable_thinking:false,response_format:{type:'json_object'}})});
    if(!response.ok)return null;
    return parseTranslation(await response.json());
  }catch{return null}
}
async function askModel(env:Env, body:{message:string; setup:Setup; history?:unknown[]}):Promise<ReturnType<typeof demo>|null>{
  if(!env.AI_GATEWAY_URL||!env.AI_GATEWAY_TOKEN)return null;
  const chineseInput=/[\u4e00-\u9fff]/.test(body.message);
  const prompt=`你是${body.setup.companionName}，一个温柔、鼓励孩子练习英语口语的动漫伙伴。用户年龄段：${body.setup.ageGroup}，英语水平：${body.setup.englishLevel}。${chineseInput?'用户这次输入包含中文。请把用户想表达的中文翻译成适合其水平的自然英文：corrected 必须是完整英文表达，replyEn 必须用 Try saying: “英文句子” 引导复述，requireRepeat 必须为 true；explanationZh 用中文简短解释。复述成功后再继续聊天。不要重复上一轮的英文或问题，要结合当前内容提出新的自然追问。':'用户这次输入是英文。检查语法、词汇和自然度，必要时纠正；如果没有错误就自然继续对话。'}每次只回复1到2句英文，并在 JSON 中给出轻量中文解释。只返回一个 JSON 对象，不要 Markdown 代码块，不要任何前后说明。字段必须为：hasError,errorLevel,original,corrected,explanationZh,requireRepeat,replyEn,replyZh,emotion。`;
  const messages=[{role:'system',content:prompt},...(body.history??[]).slice(-20).map((m:any)=>({role:m.role==='assistant'?'assistant':'user',content:String(m.content||'')})),{role:'user',content:body.message}];
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(env.AI_GATEWAY_URL,{method:'POST',signal:AbortSignal.timeout(25000),headers:{'content-type':'application/json',authorization:`Bearer ${env.AI_GATEWAY_TOKEN}`},body:JSON.stringify({model:env.AI_MODEL||'qwen-plus',messages,temperature:.7,max_tokens:220,stream:false,enable_thinking:false})});
      if(response.ok){const result=await parseModelJson(await response.json()); if(result)return result;}
    }catch{}
    if(attempt<2)await new Promise(resolve=>setTimeout(resolve,350*(attempt+1)));
  }
  return null;
}async function askTts(env:Env,text:string){if(!env.AI_GATEWAY_TOKEN||!text)return null; try{const r=await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${env.AI_GATEWAY_TOKEN}`},body:JSON.stringify({model:'qwen3-tts-flash',input:{text:text.slice(0,500),voice:'Serena',language_type:'English'}})}); if(!r.ok)return null; const data=await r.json() as any; return data.output?.audio?.url||null}catch{return null}}export default {async fetch(request:Request,env:Env,ctx:ExecutionContext):Promise<Response>{const protectedRequest=await protectTest(request,env);if(protectedRequest instanceof Response)return protectedRequest;request=protectedRequest;const url=new URL(request.url); if(url.pathname==='/api/session'&&request.method==='GET'){if(env.PUBLIC_GUEST_MODE!=='true'||!env.GUEST_SESSION_SECRET)return json({authenticated:true});const session=await createGuestCookie(env.GUEST_SESSION_SECRET);return new Response(JSON.stringify({authenticated:true}),{headers:{'content-type':'application/json','cache-control':'no-store','set-cookie':session.header}});} if(url.pathname.startsWith('/api/')){if(url.pathname==='/api/profile'&&(request.method==='GET'||request.method==='POST'))return profileService(request,env);if(request.method==='POST'&&url.pathname==='/api/voice'){
 if(Number(request.headers.get('content-length')||0)>6000000)return json({error:'录音过大'},413);
 const body=await request.json() as {audioDataUrl?:string};
 if(typeof body.audioDataUrl!=='string'||!/^data:audio\//.test(body.audioDataUrl)||body.audioDataUrl.length>6000000)return json({error:'录音格式或大小不正确'},400);
 if(!env.AI_GATEWAY_TOKEN||!env.AI_GATEWAY_URL)return json({error:'语音服务未配置'},503);
 try{const response=await fetch(env.AI_GATEWAY_URL,{method:'POST',signal:AbortSignal.timeout(30000),headers:{'content-type':'application/json',authorization:'Bearer '+env.AI_GATEWAY_TOKEN},body:JSON.stringify({model:'qwen3-asr-flash',messages:[{role:'user',content:[{type:'input_audio',input_audio:{data:body.audioDataUrl}}]}],stream:false,asr_options:{enable_itn:false}})});
 if(!response.ok){console.error('ASR upstream status',response.status);return json({error:'百炼语音识别暂时不可用'},502)}
 const data=await response.json() as any;const text=data.choices?.[0]?.message?.content;
 if(typeof text!=='string')return json({error:'没有有效识别结果'},502);
 return json({text});}catch{return json({error:'语音识别超时或连接失败'},502)}
 }if(request.method==='GET'&&url.pathname==='/api/health'){return json({ok:true,service:'anime-english-mvp',chatConfigured:Boolean(env.AI_GATEWAY_URL&&env.AI_GATEWAY_TOKEN),time:now()});} if(request.method==='POST'&&url.pathname==='/api/setup'){return json({ok:true,sessionId:crypto.randomUUID()});} if(request.method==='POST'&&url.pathname==='/api/tts'){const body=await request.json() as any; const audioUrl=await askTts(env,String(body.text||'')); return audioUrl?json({audioUrl}):json({error:'tts unavailable'},503);} if(request.method==='POST'&&url.pathname==='/api/translate'){const body=await request.json() as any;if(typeof body.text!=='string'||!body.text.trim()||body.text.length>4000)return json({error:'无效翻译请求'},400);const translated=await askTranslation(env,body.text.trim(),body.setup||{englishLevel:'未知'});return translated?json({translation:translated}):json({error:'翻译暂时不可用，请重试'},502);} if(request.method==='POST'&&url.pathname==='/api/vision'){const body=await request.json() as any; if(typeof body.imageDataUrl!=='string'||!body.imageDataUrl.startsWith('data:image/'))return json({error:'imageDataUrl required'},400); if(body.imageDataUrl.length>8000000)return json({error:'image too large'},413); const result=await askVisionModel(env,body)??visionDemo(); return json(result);} if(request.method==='POST'&&url.pathname==='/api/chat/stream'){try{const body=await request.json() as any;if(!body.setup||typeof body.message!=='string'||!body.message.trim()||body.message.length>4000)return json({error:'无效聊天请求'},400);body.userId=/^[-a-zA-Z0-9]{20,80}$/.test(body.userId||'')?body.userId:'legacy-demo-user';body.requestId=/^[-a-zA-Z0-9]{20,80}$/.test(body.requestId||'')?body.requestId:crypto.randomUUID();const stream=await chatStreamService(env,body,request.signal,task=>ctx.waitUntil(task));return new Response(stream,{headers:{'content-type':'text/event-stream;charset=UTF-8','cache-control':'no-cache, no-transform','connection':'keep-alive','x-accel-buffering':'no'}});}catch(error){console.error(JSON.stringify({event:'stream_route_failed',type:error instanceof Error?error.message:'unknown'}));return json({error:'流式聊天暂时不可用'},503);}} if(request.method==='POST'&&url.pathname==='/api/chat'){
 try{const body=await request.json() as any;if(!body.setup||typeof body.message!=='string'||!body.message.trim()||body.message.length>4000)return json({error:'无效聊天请求'},400); body.userId=/^[-a-zA-Z0-9]{20,80}$/.test(body.userId||'')?body.userId:'legacy-demo-user'; body.requestId=/^[-a-zA-Z0-9]{20,80}$/.test(body.requestId||'')?body.requestId:crypto.randomUUID();
 return json(await chatService(env,body));}catch(error){console.error(JSON.stringify({event:'chat_failed',type:error instanceof Error?error.message:'unknown'}));return json({error:'聊天暂时失败，请重试；这条消息没有计入对话记忆。'},503);}
 } if((url.pathname==='/api/learning'||url.pathname.startsWith('/api/learning/'))&&(request.method==='GET'||request.method==='POST'||request.method==='DELETE'))return learningService(request,env); if(request.method==='GET'&&url.pathname==='/api/mistakes'){if(!env.DB)return json([]); const userId=url.searchParams.get('userId')||'';if(!/^[-a-zA-Z0-9]{20,80}$/.test(userId))return json({error:'无效用户'},400); const r=await env.DB.prepare('SELECT * FROM mistakes WHERE user_id=? ORDER BY last_seen DESC').bind(userId).all(); return json(r.results);} return json({error:'Not found'},404);} return env.ASSETS.fetch(request);}};


