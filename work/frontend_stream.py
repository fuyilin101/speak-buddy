from pathlib import Path
import re
p=Path('src/main.tsx');s=p.read_text(encoding='utf8')
# insert stream helper before finishSetup
anchor='  async function finishSetup()'
helper='''  async function chatStreamRequest(payload:unknown,onDelta:(text:string)=>void){
    const controller=new AbortController();const response=await fetch('/api/chat/stream',{method:'POST',headers:{'content-type':'application/json','accept':'text/event-stream'},body:JSON.stringify(payload),signal:controller.signal});
    if(!response.ok||!response.body)throw new Error('stream unavailable');
    const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';let result:any=null;
    const consume=(block:string)=>{let type='message';const dataLines:string[]=[];for(const line of block.split(/\\r?\\n/)){if(line.startsWith('event:'))type=line.slice(6).trim();if(line.startsWith('data:'))dataLines.push(line.slice(5).trim())}if(!dataLines.length)return;let data:any;try{data=JSON.parse(dataLines.join('\\n'))}catch{return}if(type==='delta'&&typeof data.text==='string')onDelta(data.text);if(type==='done')result=data.result;if(type==='error')throw new Error(data.message||'stream error')};
    while(true){const part=await reader.read();if(part.done)break;buffer+=decoder.decode(part.value,{stream:true});const blocks=buffer.split(/\\r?\\n\\r?\\n/);buffer=blocks.pop()||'';for(const block of blocks)consume(block)}if(buffer.trim())consume(buffer);if(!result)throw new Error('incomplete stream');return result;
  }
'''
if anchor not in s: raise SystemExit('anchor missing')
s=s.replace(anchor,helper+anchor,1)
pattern=r"  async function send\(text=input\)\{.*?\n  \}"
replacement='''  async function send(text=input){
    if(!text.trim()||loading)return;const clientStarted=performance.now();setInput('');setReaction('Thinking…');setLoading(true);const requestId=crypto.randomUUID();const payload={setup,message:text,history:messages.slice(-40),userId:getUserId(),requestId};setMessages(m=>[...m,{role:'user',content:text},{role:'assistant',content:'',correction:undefined}]);
    let visible='';let usedStream=false;
    const update=(chunk:string)=>{usedStream=true;visible+=chunk;setMessages(m=>{const next=[...m];const index=next.length-1;if(index>=0&&next[index].role==='assistant')next[index]={...next[index],content:visible};return next});if(visible)setReaction(visible)};
    try{const data=await chatStreamRequest(payload,update) as Correction;const firstVisibleMs=Math.round(performance.now()-clientStarted);setMessages(m=>{const next=[...m];const index=next.length-1;if(index>=0&&next[index].role==='assistant')next[index]={role:'assistant',content:data.replyEn,correction:data};return next});setShowTranslation(false);setReaction(data.replyEn||'I’m listening!');console.info('[chat-timing]',{first_visible_ms:firstVisibleMs,complete_ms:Math.round(performance.now()-clientStarted),streaming:true});if(data.replyEn)speak(data.replyEn);
    }catch{try{const data=await chatRequest({...payload,requestId:crypto.randomUUID()}) as Correction;setMessages(m=>{const next=[...m];const index=next.length-1;if(index>=0&&next[index].role==='assistant')next[index]={role:'assistant',content:data.replyEn,correction:data};return next});setReaction(data.replyEn||'I’m listening!');console.info('[chat-timing]',{streaming:false,fallback:true,complete_ms:Math.round(performance.now()-clientStarted)});if(data.replyEn)speak(data.replyEn);}catch{setMessages(m=>m.filter((item,index)=>!(index===m.length-1&&item.role==='assistant'&&!item.content)));setReaction('I\\'m having trouble connecting. Please try again.');setVoiceStatus('回复失败，请检查网络后重试')}}finally{setLoading(false)}
  }'''
s2,n=re.subn(pattern,replacement,s,count=1,flags=re.S)
if n!=1: raise SystemExit(f'send matches {n}')
p.write_text(s2,encoding='utf8')
