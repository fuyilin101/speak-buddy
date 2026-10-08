import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import ProfileOnboarding from './components/ProfileOnboarding';
import {isLearningProfile,type LearningProfile} from '../shared/profile';

type Setup = { character: string; companionName: string; nickname: string; ageGroup: string; englishLevel: string; age_group?: string; english_level?:string; learning_goals?:string[]; profile_completed?:boolean };
type Message = { role: 'user'|'assistant'; content: string; correction?: Correction };
type Correction = { hasError:boolean; errorLevel:string; original:string; corrected:string; explanationZh:string; requireRepeat:boolean; replyEn:string; replyZh:string; emotion:string };
const characters = [{id:'rabbit', name:'小白兔', tone:'温柔、耐心', image:'/assets/rabbit-v2.png'}, {id:'fox', name:'小狐狸', tone:'机灵、鼓励', image:'/assets/fox-v2.png'}, {id:'bee', name:'小蜜蜂', tone:'活泼、好奇', image:'/assets/bee-v2.png'}];
const rabbitVideos:Record<string,number>={idle:0,react:3,happy:6,bounce:6,nod:3,think:9,peek:9};
const ageGroups = ['6–9岁','10–13岁','14–17岁','18+']; const levels=['几乎不会说','能说简单句','可以简单聊天'];

function getUserId(){let id=localStorage.getItem('speak-buddy-user-id');if(!id){id=crypto.randomUUID();localStorage.setItem('speak-buddy-user-id',id);}return id;}
function App(){
 const [profileReady,setProfileReady]=useState(false);const [learningProfile,setLearningProfile]=useState<LearningProfile>();const [editingProfile,setEditingProfile]=useState(false);
  const [step,setStep]=useState(0); const [setup,setSetup]=useState<Setup>({character:'rabbit',companionName:'Luna',nickname:'',ageGroup:'10–13岁',englishLevel:'能说简单句'});
  const [messages,setMessages]=useState<Message[]>([]); const [showTranslation,setShowTranslation]=useState(false); const holdListeningRef=useRef(false); const transcriptRef=useRef(''); const sendVoiceRef=useRef<(text:string)=>Promise<void>>(async()=>{}); const restartTimerRef=useRef<number|undefined>(undefined); const [voiceStatus,setVoiceStatus]=useState(''); const [conversationMode,setConversationMode]=useState<'turn'|'free'>('turn'); const [showSettings,setShowSettings]=useState(false); const [listening,setListening]=useState(false); const recognitionRef=useRef<any>(null); const [input,setInput]=useState(''); const [loading,setLoading]=useState(false); const [tab,setTab]=useState<'chat'|'mistakes'>('chat'); const [mistakes,setMistakes]=useState<any[]>([]); const [reaction,setReaction]=useState('Hi! Tap a button and let’s play.'); const [hint,setHint]=useState<{en:string;zh:string}|null>(null); const [photoHint,setPhotoHint]=useState<{en:string;zh:string}|null>(null); const [motion,setMotion]=useState('idle'); const [photoUrl,setPhotoUrl]=useState(''); const [photoScene,setPhotoScene]=useState(false); const [photoResult,setPhotoResult]=useState({replyEn:'Let’s look at it together!',replyZh:'我正在看看这张照片。'}); const videoRef=useRef<HTMLVideoElement|null>(null); const photoInputRef=useRef<HTMLInputElement|null>(null); const audioRef=useRef<HTMLAudioElement|null>(null);
  useEffect(()=>{let active=true;(async()=>{try{const saved=localStorage.getItem('speak-buddy-setup');if(saved)setSetup(JSON.parse(saved));const history=localStorage.getItem('speak-buddy-messages');if(history)setMessages(JSON.parse(history));const cached=localStorage.getItem('speak-buddy-learning-profile');let profile=cached?JSON.parse(cached):null;try{const r=await fetch('/api/profile?userId='+getUserId(),{cache:'no-store'});if(r.ok){const d=await r.json() as any;if(d.profile)profile=d.profile;}}catch{}if(active&&isLearningProfile(profile)){setLearningProfile(profile);setSetup(s=>({...s,...profile,ageGroup:profile.age_group,englishLevel:profile.english_level}));setStep(4);localStorage.setItem('speak-buddy-learning-profile',JSON.stringify(profile));}}catch{}finally{if(active)setProfileReady(true);}})();return()=>{active=false};},[]);
  async function saveLearningProfile(profile:LearningProfile){const response=await fetch('/api/profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:getUserId(),profile,setup})});if(!response.ok)throw new Error('保存失败');const data=await response.json() as {profile:LearningProfile};const updated={...setup,...data.profile,ageGroup:profile.age_group,englishLevel:profile.english_level};setSetup(updated);setLearningProfile(data.profile);localStorage.setItem('speak-buddy-learning-profile',JSON.stringify(data.profile));localStorage.setItem('speak-buddy-setup',JSON.stringify(updated));setEditingProfile(false);setStep(4);}
  useEffect(()=>{if(step===4)localStorage.setItem('speak-buddy-messages',JSON.stringify(messages));},[messages,step]);
  async function chatRequest(payload:unknown){const urls=['/api/chat','https://anime-english-mvp.anime-english-mvp.workers.dev/api/chat'];let last:unknown;for(const url of urls){for(let attempt=0;attempt<2;attempt++){try{const controller=new AbortController();const timer=window.setTimeout(()=>controller.abort(),30000);const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});window.clearTimeout(timer);if(response.ok){const data=await response.json() as any;if(data&&typeof data.replyEn==='string')return data;last=new Error('Invalid chat response');}else last=new Error('HTTP '+response.status);}catch(error){last=error;}await new Promise(resolve=>window.setTimeout(resolve,500));}}throw last||new Error('chat request failed');}
  async function chatStreamRequest(payload:unknown,onDelta:(text:string)=>void){
    const controller=new AbortController();const response=await fetch('/api/chat/stream',{method:'POST',headers:{'content-type':'application/json','accept':'text/event-stream'},body:JSON.stringify(payload),signal:controller.signal});
    if(!response.ok||!response.body)throw new Error('stream unavailable');
    const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';let result:any=null;
    const consume=(block:string)=>{let type='message';const dataLines:string[]=[];for(const line of block.split(/\r?\n/)){if(line.startsWith('event:'))type=line.slice(6).trim();if(line.startsWith('data:'))dataLines.push(line.slice(5).trim())}if(!dataLines.length)return;let data:any;try{data=JSON.parse(dataLines.join('\n'))}catch{return}if(type==='delta'&&typeof data.text==='string')onDelta(data.text);if(type==='done')result=data.result;if(type==='error')throw new Error(data.message||'stream error')};
    while(true){const part=await reader.read();if(part.done)break;buffer+=decoder.decode(part.value,{stream:true});const blocks=buffer.split(/\r?\n\r?\n/);buffer=blocks.pop()||'';for(const block of blocks)consume(block)}if(buffer.trim())consume(buffer);if(!result)throw new Error('incomplete stream');return result;
  }
  async function finishSetup(){ await fetch('/api/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(setup)}); localStorage.setItem('speak-buddy-setup',JSON.stringify(setup)); setStep(4); }
  async function send(text=input){
    if(!text.trim()||loading)return;const clientStarted=performance.now();setInput('');setReaction('Thinking…');setLoading(true);const requestId=crypto.randomUUID();const payload={setup,message:text,history:messages.slice(-40),userId:getUserId(),requestId};setMessages(m=>[...m,{role:'user',content:text},{role:'assistant',content:'',correction:undefined}]);
    let visible='';let usedStream=false;
    const update=(chunk:string)=>{usedStream=true;visible+=chunk;setMessages(m=>{const next=[...m];const index=next.length-1;if(index>=0&&next[index].role==='assistant')next[index]={...next[index],content:visible};return next});if(visible)setReaction(visible)};
    try{const data=await chatStreamRequest(payload,update) as Correction;const firstVisibleMs=Math.round(performance.now()-clientStarted);setMessages(m=>{const next=[...m];const index=next.length-1;if(index>=0&&next[index].role==='assistant')next[index]={role:'assistant',content:data.replyEn,correction:data};return next});setShowTranslation(false);setReaction(data.replyEn||'I’m listening!');console.info('[chat-timing]',{first_visible_ms:firstVisibleMs,complete_ms:Math.round(performance.now()-clientStarted),streaming:true});if(data.replyEn)speak(data.replyEn);
    }catch{try{const data=await chatRequest(payload) as Correction;setMessages(m=>{const next=[...m];const index=next.length-1;if(index>=0&&next[index].role==='assistant')next[index]={role:'assistant',content:data.replyEn,correction:data};return next});setReaction(data.replyEn||'I’m listening!');console.info('[chat-timing]',{streaming:false,fallback:true,complete_ms:Math.round(performance.now()-clientStarted)});if(data.replyEn)speak(data.replyEn);}catch{setMessages(m=>m.filter((item,index)=>!(index===m.length-1&&item.role==='assistant'&&!item.content)));setReaction('I\'m having trouble connecting. Please try again.');setVoiceStatus('回复失败，请检查网络后重试')}}finally{setLoading(false)}
  }
  const recorderRef=useRef<MediaRecorder|null>(null);
  const streamRef=useRef<MediaStream|null>(null);
  const recordingGeneration=useRef(0);
  function cancelListening(){recordingGeneration.current++;holdListeningRef.current=false;window.clearTimeout(restartTimerRef.current);const recorder=recorderRef.current;recorderRef.current=null;if(recorder?.state==='recording'){recorder.onstop=null;recorder.stop()}streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null;setListening(false);setVoiceStatus('')}
  async function startListening(){
    if(holdListeningRef.current)return;
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){
      setVoiceStatus('此浏览器不支持网页录音，请在系统浏览器打开');return;
    }
    const generation=++recordingGeneration.current;
    holdListeningRef.current=true;setListening(true);setVoiceStatus('请允许麦克风权限…');
    audioRef.current?.pause();
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
      if(generation!==recordingGeneration.current||!holdListeningRef.current){stream.getTracks().forEach(t=>t.stop());return}
      streamRef.current=stream;
      const mode=conversationMode;
      const record=()=>{
        if(!holdListeningRef.current||generation!==recordingGeneration.current)return;
        const mime=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(t=>MediaRecorder.isTypeSupported(t));
        const recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);
        recorderRef.current=recorder;const chunks:BlobPart[]=[];
        recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
        recorder.onstop=async()=>{
          recorderRef.current=null;window.clearTimeout(restartTimerRef.current);
          if(generation!==recordingGeneration.current)return;
          try{
            const blob=new Blob(chunks,{type:recorder.mimeType});
            if(blob.size<500){setVoiceStatus('录音太短，请再试一次');return}
            setVoiceStatus('正在识别语音…');
            const audioDataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(blob)});
            const response=await fetch('/api/voice',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({audioDataUrl})});
            const data=await response.json() as {text?:string;error?:string};if(!response.ok)throw new Error(data.error||'语音识别失败');
            if(generation!==recordingGeneration.current)return;
            if(data.text?.trim()){setVoiceStatus('正在回复…');await sendVoiceRef.current(data.text)}else setVoiceStatus('没有听清，请再说一次');
          }catch{setVoiceStatus('语音识别失败，请重试')}
          finally{
            if(mode==='free'&&holdListeningRef.current&&generation===recordingGeneration.current){
              // Pause recording while the companion reply audio is being prepared/played.
              restartTimerRef.current=window.setTimeout(()=>{const resume=()=>{if(audioRef.current&&!audioRef.current.paused){restartTimerRef.current=window.setTimeout(resume,300)}else record()};resume()},4000);
            }else{stream.getTracks().forEach(t=>t.stop());streamRef.current=null;setListening(false)}
          }
        };
        recorder.start();setVoiceStatus(mode==='turn'?'正在录音，松开发送':'正在录音，每 6 秒识别一句');
        restartTimerRef.current=window.setTimeout(()=>{if(recorder.state==='recording')recorder.stop()},mode==='free'?6000:30000);
      };record();
    }catch{holdListeningRef.current=false;setListening(false);setVoiceStatus('无法访问麦克风，请检查权限或换系统浏览器')}
  }
  function stopListening(){holdListeningRef.current=false;window.clearTimeout(restartTimerRef.current);setListening(false);const r=recorderRef.current;if(r?.state==='recording')r.stop();else{recordingGeneration.current++;streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null}}
  function toggleFreeListening(){if(holdListeningRef.current)stopListening();else void startListening()}
  useEffect(()=>{
    if(step!==4||tab!=='chat')cancelListening();
    const onHidden=()=>{if(document.hidden)cancelListening();};
    document.addEventListener('visibilitychange',onHidden);
    return ()=>{document.removeEventListener('visibilitychange',onHidden);cancelListening();};
  },[step,tab]);

  if(!profileReady)return <main className="profile-loading">正在准备你的学习空间…</main>;
  if(!learningProfile||editingProfile)return <ProfileOnboarding initial={learningProfile} editing={Boolean(learningProfile)} onCancel={()=>setEditingProfile(false)} onSave={saveLearningProfile}/>;
  const c=characters.find(x=>x.id===setup.character)!; const latest=[...messages].reverse().find(m=>m.role==='assistant'); const speak=(text:string)=>{if(!text)return; fetch("/api/tts",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text})}).then(r=>r.ok?r.json():null).then((d:any)=>{if(d?.audioUrl){audioRef.current?.pause(); const a=new Audio(String(d.audioUrl).replace(/^http:/,"https:")); audioRef.current=a; a.play().catch(()=>setVoiceStatus("请点击 🔊 播放声音"));}else setVoiceStatus("固定音色暂时不可用，请点击 🔊 重试")}).catch(()=>setVoiceStatus("语音服务暂时不可用"))}; const touch=(text:string, nextMotion='react')=>{setReaction(text);setMotion(nextMotion);window.setTimeout(()=>setMotion('idle'),2800);}; const preparePhotoData=(file:File)=>new Promise<string>((resolve,reject)=>{const source=URL.createObjectURL(file);const image=new Image();image.onload=()=>{const max=1600;const scale=Math.min(1,max/image.width,max/image.height);const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext('2d')?.drawImage(image,0,0,canvas.width,canvas.height);URL.revokeObjectURL(source);resolve(canvas.toDataURL('image/jpeg',.82))};image.onerror=reject;image.src=source}); const pickPhoto=async(file?:File)=>{if(!file)return; const url=URL.createObjectURL(file); setPhotoUrl(url); setPhotoScene(true); setPhotoResult({replyEn:'I’m looking closely at your photo…',replyZh:'我正在认真看看这张照片……'}); touch('I’m looking at your photo…','peek'); try{const imageDataUrl=await preparePhotoData(file); const response=await fetch('/api/vision',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({setup,imageDataUrl,history:messages.slice(-20)})}); if(!response.ok)throw new Error('vision request failed'); const data=await response.json() as any;setPhotoResult({replyEn:data.replyEn||'Let’s look at it together!',replyZh:data.replyZh||'我正在看看这张照片。'}); if(data.hintEn||data.hintZh)setPhotoHint({en:data.hintEn||'Tell me more about it.',zh:data.hintZh||'告诉我更多。'}); setMessages(m=>[...m,{role:'assistant',content:data.replyEn||'Let’s look at it together!',correction:undefined}]); speak(data.replyEn||'Let’s look at it together!');}catch{setPhotoResult({replyEn:'I couldn’t read this photo yet.',replyZh:'这次没有识别成功，请换一张光线更好、主体更清楚的照片。'});}}; const rabbitVideo=setup.character==='rabbit'; return <main className="app companion-page"><header className="room-header"><button className="room-icon" onClick={()=>{cancelListening();setEditingProfile(true)}} aria-label="学习设置">←</button><div className="room-title">{setup.companionName}<small>{c.name}</small></div><button className="room-icon" onClick={()=>setShowSettings(v=>!v)} aria-label="设置">⚙️</button></header>{tab==='chat'?<><section className={'room-stage '+(photoScene?'photo-scene':'')}>{photoScene&&photoUrl&&<div className="photo-recognition"><img src={photoUrl} alt="你分享的照片"/><div className="recognition-en">{photoResult.replyEn}</div><div className="recognition-zh">{photoResult.replyZh}</div><button onClick={()=>{setPhotoScene(false);touch('Let us keep talking!','react')}}>继续聊天</button></div>}<div className="speech">{reaction}</div>{showSettings&&<div className="mode-panel"><b>Conversation mode</b><button onClick={()=>{cancelListening();setShowSettings(false);setEditingProfile(true)}}>学习设置 · 年龄、水平与目标</button><button className={conversationMode==='turn'?'active':''} onClick={()=>{cancelListening();setConversationMode('turn');setShowSettings(false)}}>按住说话 · 一句一句练习</button><button className={conversationMode==='free'?'active':''} onClick={()=>{cancelListening();setConversationMode('free');setShowSettings(false)}}>自由对话 · 像打电话一样</button></div>}<button className={'character-stage motion-'+motion} onClick={()=>touch('You touched me!','bounce')}>{rabbitVideo?<video ref={videoRef} src="/assets/rabbit-actions/full.mp4" poster="/assets/rabbit-v2.png" autoPlay muted playsInline loop onClick={e=>{e.currentTarget.play().catch(()=>{});}} onLoadedData={e=>{e.currentTarget.play().catch(()=>{});}}/>:<img src={c.image} alt={c.name}/>}<span className="tap-hint">轻触角色互动</span></button>{hint&&!photoScene&&<div className="hint-bubble" role="status"><div className="hint-en">{hint.en}</div><div className="hint-zh">{hint.zh}</div><button aria-label="关闭提示" onClick={()=>setHint(null)}>×</button></div>}{latest&&!photoScene&&<div className="dialogue-card"><div className="dialogue-en">{latest.content}</div><div className="dialogue-tools"><button aria-label="朗读英文" onClick={()=>speak(latest.content)}>🔊</button><button onClick={()=>setShowTranslation(v=>!v)}>文</button><button aria-label="隐藏翻译">◌</button></div>{showTranslation&&<div className="dialogue-zh">{latest.correction?.replyZh||'继续告诉我更多吧。'}</div>}</div>}<button className="floating-action action-top-left" title="拍照" aria-label="拍照" onClick={()=>photoInputRef.current?.click()}>📷<span>拍照</span></button><button className="floating-action action-bottom-left" title="提示" aria-label="提示" onClick={()=>{setHint(photoHint||{en:"You can say: I had a good day. How about you?",zh:"你可以接着说：我今天过得不错。你呢？"});touch("Here is a little hint for you!","happy")}}>💡<span>提示</span></button><button title="说话" aria-label="说话" onPointerDown={conversationMode==='turn'?(e=>{e.currentTarget.setPointerCapture?.(e.pointerId);startListening()}):undefined} onPointerUp={conversationMode==='turn'?(e=>{if(e.currentTarget.hasPointerCapture?.(e.pointerId))e.currentTarget.releasePointerCapture?.(e.pointerId);stopListening()}):undefined} onPointerCancel={conversationMode==='turn'?(e=>{e.preventDefault();}):undefined} onContextMenu={e=>e.preventDefault()} aria-pressed={listening} onClick={conversationMode==='free'?toggleFreeListening:undefined} className={'floating-action action-bottom-center '+(listening?'listening':'')}>🎙️<span>说话</span></button><button className="floating-action action-bottom-right" title="打字：输入你想说的话" aria-label="打字" onClick={()=>{touch('Type in English or Chinese and I will help.','react');document.getElementById('chat-input')?.focus()}}>⌨️<span>打字</span></button>{voiceStatus&&<div className="voice-status" role="status">{voiceStatus}</div>}<input ref={photoInputRef} className="photo-input" type="file" accept="image/*" capture="environment" onChange={e=>pickPhoto(e.target.files?.[0])}/></section><div className="messages compact">{messages.slice(-2).map((m,i)=><div className={'bubble '+m.role} key={i}><div>{m.content}</div>{m.correction?.hasError&&<div className="correction"><b>小提示</b><div>✅ {m.correction.corrected}</div><small>{m.correction.explanationZh}</small></div>}</div>)}</div><div className="composer"><input id="chat-input" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()} placeholder="用英语说点什么…"/><button className="send" onClick={()=>send()}>➤</button></div></>:<div className="mistakes"><button className="back" onClick={()=>setTab('chat')}>← 回到聊天</button>{mistakes.length===0?<p className="empty">还没有错误记录，继续聊天就会出现啦。</p>:mistakes.map(m=><div className="mistake"><b>{m.original} → {m.corrected}</b><p>{m.explanationZh}</p><small>出现 {m.count} 次 · {m.mastery}</small></div>)}</div>}</main>
}
createRoot(document.getElementById('root')!).render(<App/>);




































