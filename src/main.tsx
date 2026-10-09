import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import {requestChat,requestJson,apiErrorMessage} from './chatTransport';
import ProfileOnboarding from './components/ProfileOnboarding';
import LearningCard,{type LearningFeedback} from './components/LearningCard';
import LearningPanel from './components/LearningPanel';
import ReviewWidget from './components/ReviewWidget';
import {isLearningProfile,type LearningProfile} from '../shared/profile';

type Setup = { character: string; companionName: string; nickname: string; ageGroup: string; englishLevel: string; age_group?: string; english_level?:string; learning_goals?:string[]; profile_completed?:boolean };
type Message = { role: 'user'|'assistant'; content: string; correction?: Correction };
type Correction = { hasError:boolean; errorLevel:string; original:string; corrected:string; explanationZh:string; requireRepeat:boolean; replyEn:string; replyZh:string; emotion:string; learningFeedback?:LearningFeedback };
type TranslationState = { source:string; text?:string; loading:boolean; error?:string };
type VoicePhase = 'idle'|'recording'|'recognizing'|'sending'|'replying'|'error';
const characters = [{id:'rabbit', name:'小白兔', tone:'温柔、耐心', image:'/assets/rabbit-v2.png'}, {id:'fox', name:'小狐狸', tone:'机灵、鼓励', image:'/assets/fox-v2.png'}, {id:'bee', name:'小蜜蜂', tone:'活泼、好奇', image:'/assets/bee-v2.png'}];
const rabbitVideos:Record<string,number>={idle:0,react:3,happy:6,bounce:6,nod:3,think:9,peek:9};
const ageGroups = ['6–9岁','10–13岁','14–17岁','18+']; const levels=['几乎不会说','能说简单句','可以简单聊天'];

function getUserId(){let id=localStorage.getItem('speak-buddy-user-id');if(!id){id=crypto.randomUUID();localStorage.setItem('speak-buddy-user-id',id);}return id;}
const weChatTapRecording=/MicroMessenger/i.test(navigator.userAgent);function App(){
 const [profileReady,setProfileReady]=useState(false);const [learningProfile,setLearningProfile]=useState<LearningProfile>();const [editingProfile,setEditingProfile]=useState(false);
  const [step,setStep]=useState(0); const [setup,setSetup]=useState<Setup>({character:'rabbit',companionName:'Luna',nickname:'',ageGroup:'10–13岁',englishLevel:'能说简单句'});
  const [messages,setMessages]=useState<Message[]>([]); const [translation,setTranslation]=useState<TranslationState|null>(null); const translationCacheRef=useRef(new Map<string,string>()); const [voicePhase,setVoicePhase]=useState<VoicePhase>('idle'); const holdListeningRef=useRef(false); const transcriptRef=useRef(''); const sendVoiceRef=useRef<(text:string)=>Promise<boolean>>(async()=>false); const sendingRef=useRef(false); const voiceBusyRef=useRef(false); const restartTimerRef=useRef<number|undefined>(undefined); const [voiceStatus,setVoiceStatus]=useState(''); const [conversationMode,setConversationMode]=useState<'turn'|'free'>('turn'); const [voiceSendMode,setVoiceSendMode]=useState<'manual'|'auto'>(()=>{try{return localStorage.getItem('speak-buddy-voice-send-mode')==='auto'?'auto':'manual'}catch{return 'manual'}}); const voiceSendModeRef=useRef<'manual'|'auto'>('manual'); const [showSettings,setShowSettings]=useState(false); const [listening,setListening]=useState(false); const recognitionRef=useRef<any>(null); const [input,setInput]=useState(''); const inputRef=useRef(''); const [loading,setLoading]=useState(false); const [tab,setTab]=useState<'chat'|'learning'>('chat'); const [mistakes,setMistakes]=useState<any[]>([]); const [reaction,setReaction]=useState('Hi! Tap a button and let’s play.'); const [hint,setHint]=useState<{en:string;zh:string}|null>(null); const [photoHint,setPhotoHint]=useState<{en:string;zh:string}|null>(null); const [motion,setMotion]=useState('idle'); const [photoUrl,setPhotoUrl]=useState(''); const [photoScene,setPhotoScene]=useState(false); const [photoResult,setPhotoResult]=useState({replyEn:'Let’s look at it together!',replyZh:'我正在看看这张照片。'}); const videoRef=useRef<HTMLVideoElement|null>(null); const photoInputRef=useRef<HTMLInputElement|null>(null); const audioRef=useRef<HTMLAudioElement|null>(null);
  useEffect(()=>{let active=true;(async()=>{try{const saved=localStorage.getItem('speak-buddy-setup');if(saved)setSetup(JSON.parse(saved));const history=localStorage.getItem('speak-buddy-messages');if(history)setMessages(JSON.parse(history));await fetch('/api/session',{credentials:'same-origin',cache:'no-store'});const cached=localStorage.getItem('speak-buddy-learning-profile');let profile=cached?JSON.parse(cached):null;try{const r=await fetch('/api/profile?userId='+getUserId(),{cache:'no-store'});if(r.ok){const d=await r.json() as any;if(d.profile)profile=d.profile;}}catch{}if(active&&isLearningProfile(profile)){setLearningProfile(profile);setSetup(s=>({...s,...profile,ageGroup:profile.age_group,englishLevel:profile.english_level}));setStep(4);localStorage.setItem('speak-buddy-learning-profile',JSON.stringify(profile));}}catch{}finally{if(active)setProfileReady(true);}})();return()=>{active=false};},[]);
  async function saveLearningProfile(profile:LearningProfile){const response=await fetch('/api/profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:getUserId(),profile,setup})});if(!response.ok)throw new Error('保存失败');const data=await response.json() as {profile:LearningProfile};const updated={...setup,...data.profile,ageGroup:profile.age_group,englishLevel:profile.english_level};setSetup(updated);setLearningProfile(data.profile);localStorage.setItem('speak-buddy-learning-profile',JSON.stringify(data.profile));localStorage.setItem('speak-buddy-setup',JSON.stringify(updated));setEditingProfile(false);setStep(4);}
  useEffect(()=>{if(step===4)localStorage.setItem('speak-buddy-messages',JSON.stringify(messages));},[messages,step]);
  async function translateMessage(content:string){
    const source=content.trim();if(!source)return;
    if(translation?.source===source&&translation.loading)return;
    if(translation?.source===source&&translation.text){setTranslation(null);return;} const cached=translationCacheRef.current.get(source);if(cached){setTranslation({source,text:cached,loading:false});return;}
    setTranslation({source,loading:true});
    try{
      const data=await requestJson('/api/translate',{text:source,setup}) as {translation?:string};
      const translated=String(data.translation||'').trim();
      if(!translated)throw new Error('没有得到有效翻译'); translationCacheRef.current.set(source,translated);
      setTranslation(current=>current?.source===source?{source,text:translated,loading:false}:current);
    }catch(error){
      setTranslation(current=>current?.source===source?{source,loading:false,error:apiErrorMessage(error)}:current);
    }
  }  async function saveLearningFeedback(feedback:LearningFeedback):Promise<void>{
    const data=await requestJson('/api/learning',{sourceMessageId:feedback.sourceMessageId||crypto.randomUUID(),type:feedback.type,originalText:feedback.originalText,suggestedText:feedback.suggestedText,explanationZh:feedback.explanationZh,focusPoint:feedback.focusPoint});
  }
  async function finishSetup(){ await fetch('/api/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(setup)}); localStorage.setItem('speak-buddy-setup',JSON.stringify(setup)); setStep(4); }
  async function send(text=input):Promise<boolean>{
    const normalized=text.trim();if(!normalized)return false;
    if(sendingRef.current){setInput(normalized);return false}sendingRef.current=true;
    const clientStarted=performance.now();let firstVisibleMs:number|null=null;
    setInput('');inputRef.current='';setReaction('Thinking…');setVoiceStatus('正在发送…');if(voiceBusyRef.current)setVoicePhase('replying');setLoading(true);
    const requestId=crypto.randomUUID();const payload={setup,message:normalized,history:messages.slice(-40),userId:getUserId(),requestId};
    setMessages(m=>[...m,{role:'user',content:normalized},{role:'assistant',content:''}]);let visible='';
    try{
      const data=await requestChat(payload,(chunk)=>{if(!chunk)return;if(firstVisibleMs===null)firstVisibleMs=Math.round(performance.now()-clientStarted);visible+=chunk;setVoiceStatus('AI 正在回复…');setReaction(visible);setMessages(m=>{const next=[...m];const index=next.length-1;if(next[index]?.role==='assistant')next[index]={...next[index],content:visible};return next})}) as Correction;
      setMessages(m=>{const next=[...m];const index=next.length-1;if(next[index]?.role==='assistant')next[index]={role:'assistant',content:data.replyEn,correction:data};return next});setTranslation(null);setReaction(data.replyEn);setVoiceStatus('');
      console.info('[chat-timing]',{request_id:requestId,first_visible_ms:firstVisibleMs,complete_ms:Math.round(performance.now()-clientStarted),stream_completed:true});if(data.replyEn)speak(data.replyEn);return true;
     }catch(error){console.error('[chat-failed]',{request_id:requestId,error:apiErrorMessage(error)});if((error as any)?.code==='persistence_failed'&&visible){setMessages(m=>{const next=[...m];const index=next.length-1;if(next[index]?.role==='assistant')next[index]={...next[index],content:visible};return next});}else{setMessages(m=>m.filter((item,index)=>!(index===m.length-1&&item.role==='assistant')));}setReaction('Reply interrupted. Please try again.');setVoiceStatus(apiErrorMessage(error));return true;
    }finally{sendingRef.current=false;setLoading(false)}
  }
  // Recording callbacks outlive a render: always send the recognized text with the latest setup/history.
  sendVoiceRef.current=send;
  useEffect(()=>{voiceSendModeRef.current=voiceSendMode;try{localStorage.setItem('speak-buddy-voice-send-mode',voiceSendMode)}catch{}},[voiceSendMode]);
  const recorderRef=useRef<MediaRecorder|null>(null);
  const streamRef=useRef<MediaStream|null>(null);
  const recordingGeneration=useRef(0);
  function cancelListening(){voiceBusyRef.current=false;setVoicePhase('idle');recordingGeneration.current++;holdListeningRef.current=false;window.clearTimeout(restartTimerRef.current);const recorder=recorderRef.current;recorderRef.current=null;if(recorder?.state==='recording'){recorder.onstop=null;recorder.stop()}streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null;setListening(false);setVoiceStatus('')}
  async function startListening(){
    if(holdListeningRef.current||voiceBusyRef.current){setVoiceStatus('正在处理上一段录音，请稍候');return;}
    if(sendingRef.current){setVoiceStatus('请等上一条回复完成后再录音');return}
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
          if(generation!==recordingGeneration.current){stream.getTracks().forEach(t=>t.stop());return}
          let failed=false;let autoSend=false;
          try{
            const blob=new Blob(chunks,{type:recorder.mimeType||'audio/mp4'});
            if(blob.size<500)throw new Error('录音太短，请再说一次');
            voiceBusyRef.current=true;setVoicePhase('recognizing');setVoiceStatus('正在识别语音…');
            const audioDataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(blob)});
            const data=await requestJson('/api/voice',{audioDataUrl}) as {text?:string};
            if(generation!==recordingGeneration.current)return;
            const recognized=(data.text||'').trim();if(!recognized)throw new Error('没有听清，请再说一次');
            const draft=inputRef.current.trim();const combined=draft?draft+(/[\s]$/.test(inputRef.current)?'':' ')+recognized:recognized;inputRef.current=combined;setInput(combined);
            autoSend=voiceSendModeRef.current==='auto'||mode==='free';
            if(autoSend){setVoicePhase('sending');setVoiceStatus('正在发送…');await sendVoiceRef.current(combined)}else{setVoicePhase('idle');setVoiceStatus('识别完成，请检查文字后点击发送')}
          }catch(error){failed=true;setVoicePhase('error');setVoiceStatus(error instanceof Error?error.message:'语音识别失败，请重试')}
          finally{
            if(mode==='free'&&autoSend&&holdListeningRef.current&&generation===recordingGeneration.current){
              restartTimerRef.current=window.setTimeout(()=>{const resume=()=>{if(audioRef.current&&!audioRef.current.paused){restartTimerRef.current=window.setTimeout(resume,300)}else record()};resume()},4000);
            }else{stream.getTracks().forEach(t=>t.stop());streamRef.current=null;setListening(false)}
            voiceBusyRef.current=false;if(!failed)setVoicePhase('idle');
          }
        };
        recorder.onerror=()=>{cancelListening();setVoiceStatus('录音失败，请检查麦克风或换系统浏览器')};
        recorder.start();setVoicePhase('recording');setVoiceStatus(mode==='turn'?(weChatTapRecording?'正在录音，再点一次结束':'正在录音，松开后识别'):'正在录音，每 6 秒识别一句');
        restartTimerRef.current=window.setTimeout(()=>{if(recorder.state==='recording')recorder.stop()},mode==='free'?6000:30000);
      };record();
    }catch{voiceBusyRef.current=false;setVoicePhase('error');holdListeningRef.current=false;setListening(false);setVoiceStatus('无法访问麦克风，请检查权限或换系统浏览器')}
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
  const c=characters.find(x=>x.id===setup.character)!; const latest=[...messages].reverse().find(m=>m.role==='assistant'); const speak=(text:string)=>{if(!text)return; fetch("/api/tts",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text})}).then(r=>r.ok?r.json():null).then((d:any)=>{if(d?.audioUrl){audioRef.current?.pause(); const a=new Audio(String(d.audioUrl).replace(/^http:/,"https:")); audioRef.current=a; a.play().catch(()=>setVoiceStatus("请点击 🔊 播放声音"));}else setVoiceStatus("固定音色暂时不可用，请点击 🔊 重试")}).catch(()=>setVoiceStatus("语音服务暂时不可用"))}; const touch=(text:string, nextMotion='react')=>{setReaction(text);setMotion(nextMotion);window.setTimeout(()=>setMotion('idle'),2800);}; const preparePhotoData=(file:File)=>new Promise<string>((resolve,reject)=>{const source=URL.createObjectURL(file);const image=new Image();image.onload=()=>{const max=1600;const scale=Math.min(1,max/image.width,max/image.height);const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext('2d')?.drawImage(image,0,0,canvas.width,canvas.height);URL.revokeObjectURL(source);resolve(canvas.toDataURL('image/jpeg',.82))};image.onerror=reject;image.src=source}); const pickPhoto=async(file?:File)=>{if(!file)return; const url=URL.createObjectURL(file); setPhotoUrl(url); setPhotoScene(true); setPhotoResult({replyEn:'I’m looking closely at your photo…',replyZh:'我正在认真看看这张照片……'}); touch('I’m looking at your photo…','peek'); try{const imageDataUrl=await preparePhotoData(file); const response=await fetch('/api/vision',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({setup,imageDataUrl,history:messages.slice(-20)})}); if(!response.ok)throw new Error('vision request failed'); const data=await response.json() as any;setPhotoResult({replyEn:data.replyEn||'Let’s look at it together!',replyZh:data.replyZh||'我正在看看这张照片。'}); if(data.hintEn||data.hintZh)setPhotoHint({en:data.hintEn||'Tell me more about it.',zh:data.hintZh||'告诉我更多。'}); setMessages(m=>[...m,{role:'assistant',content:data.replyEn||'Let’s look at it together!',correction:undefined}]); speak(data.replyEn||'Let’s look at it together!');}catch{setPhotoResult({replyEn:'I couldn’t read this photo yet.',replyZh:'这次没有识别成功，请换一张光线更好、主体更清楚的照片。'});}}; const rabbitVideo=setup.character==='rabbit'; return <main className="app companion-page"><header className="room-header"><button className="room-icon" onClick={()=>{cancelListening();setEditingProfile(true)}} aria-label="学习设置">←</button><div className="room-title">{setup.companionName}<small>{c.name}</small></div><button className="room-icon" onClick={()=>setShowSettings(v=>!v)} aria-label="设置">⚙️</button></header>{tab==='chat'?<><section className={'room-stage '+(photoScene?'photo-scene':'')}>{photoScene&&photoUrl&&<div className="photo-recognition"><img src={photoUrl} alt="你分享的照片"/><div className="recognition-en">{photoResult.replyEn}</div><div className="recognition-zh">{photoResult.replyZh}</div><button onClick={()=>{setPhotoScene(false);touch('Let us keep talking!','react')}}>继续聊天</button></div>}<div className="speech">{reaction}</div>{showSettings&&<div className="mode-panel"><b>Voice send mode</b><button onClick={()=>{setTab('learning');setShowSettings(false)}}>我的学习 · 纠错与表达记录</button><button className={voiceSendMode==="manual"?"active":""} onClick={()=>setVoiceSendMode("manual")}>手动发送 · 识别后检查文字</button><button className={voiceSendMode==="auto"?"active":""} onClick={()=>setVoiceSendMode("auto")}>自动发送 · 识别后直接聊天</button><b>Conversation mode</b><button onClick={()=>{cancelListening();setShowSettings(false);setEditingProfile(true)}}>学习设置 · 年龄、水平与目标</button><button className={conversationMode==='turn'?'active':''} onClick={()=>{cancelListening();setConversationMode('turn');setShowSettings(false)}}>按住说话 · 一句一句练习</button><button className={conversationMode==='free'?'active':''} onClick={()=>{cancelListening();setConversationMode('free');setShowSettings(false)}}>自由对话 · 像打电话一样</button></div>}<button className={'character-stage motion-'+motion} onClick={()=>touch('You touched me!','bounce')}>{rabbitVideo?<video ref={videoRef} src="/assets/rabbit-actions/full.mp4" poster="/assets/rabbit-v2.png" autoPlay muted playsInline loop onClick={e=>{e.currentTarget.play().catch(()=>{});}} onLoadedData={e=>{e.currentTarget.play().catch(()=>{});}}/>:<img src={c.image} alt={c.name}/>}<span className="tap-hint">轻触角色互动</span></button>{hint&&!photoScene&&<div className="hint-bubble" role="status"><div className="hint-en">{hint.en}</div><div className="hint-zh">{hint.zh}</div><button aria-label="关闭提示" onClick={()=>setHint(null)}>×</button></div>}{latest&&!photoScene&&<div className="dialogue-card"><div className="dialogue-en">{latest.content}</div><div className="dialogue-tools"><button aria-label="朗读英文" onClick={()=>speak(latest.content)}>🔊</button><button aria-label="翻译成中文" onClick={()=>translateMessage(latest.content)} disabled={translation?.source===latest.content&&translation.loading}>{translation?.source===latest.content?(translation.loading?'翻译中…':translation.text?'隐藏中文':'重试翻译'):'翻译中文'}</button></div>{translation?.source===latest.content&&translation.text&&<div className="dialogue-zh">{translation.text}</div>}{translation?.source===latest.content&&translation.error&&<div className="dialogue-zh">{translation.error}</div>}{latest.correction?.learningFeedback&&latest.correction.learningFeedback.type!=='none'&&<LearningCard feedback={latest.correction.learningFeedback} onSave={()=>saveLearningFeedback(latest.correction!.learningFeedback!)} onSpeak={speak}/>}</div>}<button className="floating-action action-top-left" title="拍照" aria-label="拍照" onClick={()=>photoInputRef.current?.click()}>📷<span>拍照</span></button><button className="floating-action action-bottom-left" title="提示" aria-label="提示" onClick={()=>{setHint(photoHint||{en:"You can say: I had a good day. How about you?",zh:"你可以接着说：我今天过得不错。你呢？"});touch("Here is a little hint for you!","happy")}}>💡<span>提示</span></button><button title="说话" aria-label="说话" onPointerDown={conversationMode==='turn'&&!weChatTapRecording?(e=>{e.currentTarget.setPointerCapture?.(e.pointerId);startListening()}):undefined} onPointerUp={conversationMode==='turn'&&!weChatTapRecording?(e=>{if(e.currentTarget.hasPointerCapture?.(e.pointerId))e.currentTarget.releasePointerCapture?.(e.pointerId);stopListening()}):undefined} onPointerCancel={conversationMode==='turn'&&!weChatTapRecording?(()=>cancelListening()):undefined} onContextMenu={e=>e.preventDefault()} aria-pressed={listening} onClick={conversationMode==='free'||weChatTapRecording?toggleFreeListening:undefined} className={'floating-action action-bottom-center '+(listening?'listening':'')}>🎙️<span>{weChatTapRecording?(listening?'结束录音':'点击录音'):'说话'}</span></button><button className="floating-action action-bottom-right" title="打字：输入你想说的话" aria-label="打字" onClick={()=>{touch('Type in English or Chinese and I will help.','react');document.getElementById('chat-input')?.focus()}}>⌨️<span>打字</span></button>{voiceStatus&&<div className="voice-status" role="status">{voiceStatus}</div>}<input ref={photoInputRef} className="photo-input" type="file" accept="image/*" capture="environment" onChange={e=>pickPhoto(e.target.files?.[0])}/></section><ReviewWidget userId={getUserId()} busy={loading||voicePhase!=='idle'||Boolean(input.trim())}/> <div className="messages compact">{messages.slice(-2).map((m,i)=><div className={'bubble '+m.role} key={i}><div>{m.content}</div>{m.correction?.hasError&&<div className="correction"><b>小提示</b><div>✅ {m.correction.corrected}</div><small>{m.correction.explanationZh}</small></div>}</div>)}</div><div className="composer"><input id="chat-input" value={input} onChange={e=>{setInput(e.target.value);inputRef.current=e.target.value}} onKeyDown={e=>e.key==='Enter'&&send()} placeholder="用英语说点什么…"/><button className="send" onClick={()=>send()}>➤</button></div></>:<LearningPanel onBack={()=>setTab('chat')} userId={getUserId()}/>}</main>
}
createRoot(document.getElementById('root')!).render(<App/>);



