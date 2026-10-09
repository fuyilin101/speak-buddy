export class ApiError extends Error {
  constructor(message:string,public status=0,public code?:string){super(message)}
}
export function apiErrorMessage(error:unknown){
 if(error instanceof DOMException&&error.name==='AbortError')return '网络超时，请重试';
 return error instanceof Error?error.message:'网络连接失败，请重试';
}
async function checked(response:Response,expected:string){
 if(response.redirected||response.headers.get('content-type')?.includes('text/html'))throw new ApiError('登录已失效，请刷新页面重新登录');
 if(!response.ok){let detail='';try{detail=(await response.json() as {error?:string}).error||''}catch{}
  const retryAfter=response.headers.get('retry-after');
  const retryHint=retryAfter?`（约 ${retryAfter} 秒后可重试）`:'';
  throw new ApiError(response.status===429?(detail||'测试请求额度已用完，请稍后重试')+retryHint:response.status===401||response.status===403?'请刷新页面重新登录':detail||'服务器暂时不可用，请重试',response.status);
 }
 if(!response.headers.get('content-type')?.includes(expected))throw new ApiError('服务器返回格式不正确，请重试');
 return response;
}
export async function requestJson(path:string,payload:unknown,timeout=35000){
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);
 try{const response=await checked(await fetch(path,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:controller.signal}),'application/json');return await response.json();}finally{clearTimeout(timer)}
}
export async function requestChatStream(payload:unknown,onDelta:(text:string)=>void){
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),45000);
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 try{
  const response=await checked(await fetch('/api/chat/stream',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json',accept:'text/event-stream'},body:JSON.stringify(payload),signal:controller.signal}),'text/event-stream');
  if(!response.body)throw new ApiError('回复连接没有建立，请重试');
  reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';let result:any=null;
   const consume=(block:string)=>{let type='message';const lines:string[]=[];for(const line of block.split(/\r?\n/)){if(line.startsWith('event:'))type=line.slice(6).trim();if(line.startsWith('data:'))lines.push(line.slice(5).trim())}if(!lines.length)return;const data=JSON.parse(lines.join('\n'));if(type==='delta'&&typeof data.text==='string')onDelta(data.text);if(type==='done')result=data.result;if(type==='error')throw new ApiError(data.message||'流式回复中断，请重试',0,data.code);};
  while(true){const part=await reader.read();if(part.done){buffer+=decoder.decode();break}buffer+=decoder.decode(part.value,{stream:true});const blocks=buffer.split(/\r?\n\r?\n/);buffer=blocks.pop()||'';for(const block of blocks)consume(block)}
  if(buffer.trim())consume(buffer);if(!result||typeof result.replyEn!=='string')throw new ApiError('回复中断，请重试');return result;
 }finally{clearTimeout(timer);controller.abort();await reader?.cancel().catch(()=>{});reader?.releaseLock();}
}
// Only missing-route responses prove that the streaming handler did not start Qwen.
export async function requestChat(payload:unknown,onDelta:(text:string)=>void){
 try{return await requestChatStream(payload,onDelta)}catch(error){if(error instanceof ApiError&&(error.status===404||error.status===405))return requestJson('/api/chat',payload);throw error;}
}
export async function submitVoiceText(text:string,send:(text:string)=>Promise<boolean>,status:(text:string)=>void){
 const normalized=text.trim();if(!normalized){status('没有听清，请再说一次');return false}
 status('正在发送…');const sent=await send(normalized);if(!sent)status('上一条消息还在回复，识别文字已放入输入框，请稍后发送');return sent;
}
