import React,{useEffect,useState} from 'react';

type Props={userId:string;busy:boolean;open?:boolean;onClose?:()=>void;onVoiceAnswer?:()=>void;registerVoiceAnswer?:(handler:(text:string)=>void)=>()=>void};
type ReviewState={enabled:boolean;session?:{id:string;question:string;questionNumber:number;status:string}|null};
export default function ReviewWidget({userId,busy,open=false,onClose,onVoiceAnswer,registerVoiceAnswer}:Props){
 const [state,setState]=useState<ReviewState|null>(null);const [answer,setAnswer]=useState('');const [phase,setPhase]=useState<'idle'|'answering'|'result'>('idle');const [result,setResult]=useState<any>(null);const [error,setError]=useState('');
 async function post(body:any):Promise<any>{const r=await fetch('/api/review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const d:any=await r.json().catch(()=>({error:'请求失败'}));if(!r.ok)throw new Error(d.error||'请求失败');return d;}
 async function refresh(){try{const d=await post({action:'check',manual:true});setState(d);if(d.session)setPhase('answering');}catch{} }
 useEffect(()=>{if(open&&!busy)void refresh();},[open,busy]);
 useEffect(()=>registerVoiceAnswer?.(text=>{setAnswer(text);setPhase('answering');setError('')}),[registerVoiceAnswer]);
 if(!open)return null;
 if(!state)return <section className="review-card review-loading">正在准备你的错题复习…</section>;
 if(!state.enabled)return <section className="review-card review-empty"><b>错题复习</b><p>主动提醒已关闭，但你仍然可以手动复习历史错误。</p><button onClick={async()=>{try{const d=await post({action:'toggle',enabled:true});setState(d);await refresh();}catch(e){setError(e instanceof Error?e.message:'无法开始复习')}}}>开始复习</button></section>;
 if(!state.session)return <section className="review-card review-empty"><b>Luna 的小复习</b><p>目前没有可复习的历史错误。先聊几句英语，之后我会帮你记录值得练习的表达。</p><button onClick={onClose}>返回聊天</button></section>;
 const s=state.session;
 async function snooze(){try{const d=await post({action:'snooze',sessionId:s.id});setState(d);setPhase('idle');}catch(e){setError(e instanceof Error?e.message:'操作失败')}}
 async function answerNow(){const value=answer.trim();if(!value)return;setPhase('result');setError('');try{const d=await post({action:'answer',sessionId:s.id,answer:value,requestId:crypto.randomUUID()});setResult(d);if(d.completed){setState(null);}}catch(e){setPhase('answering');setError(e instanceof Error?e.message:'评估失败，请重试')}}
 async function disable(){try{const d=await post({action:'toggle',enabled:false});setState(d);setPhase('idle');}catch(e){setError(e instanceof Error?e.message:'操作失败')}}
 async function nextQuestion(){try{const d=await post({action:'next',sessionId:s.id});if(d.session){setState(d);setAnswer('');setResult(null);setPhase('answering');}}catch(e){setError(e instanceof Error?e.message:'暂时没有下一题')}}
 return <section className="review-card" aria-live="polite"><div className="review-kicker">{s.questionNumber===1?'Luna 的小复习':'再来一道小练习'}</div>{phase==='answering'?<><div className="review-invite">根据你之前的错误，练习一个具体表达：</div><div className="review-question">{s.question}</div><textarea value={answer} onChange={e=>setAnswer(e.target.value)} placeholder="写下英文回答，或点击麦克风识别" disabled={busy}/><div className="review-actions"><button onClick={onVoiceAnswer} disabled={busy}>🎙️ 语音回答</button><button onClick={answerNow} disabled={busy||!answer.trim()}>提交答案</button><button onClick={snooze}>退出复习</button></div></>:<div className="review-result"><b>{result?.verdict==='correct'?'做得好！ +1 XP':result?.verdict==='uncertain'?'我们再确认一下':'差一点点'}</b><p>{result?.feedback||'正在评估…'}</p>{result?.explanationZh&&<small>{result.explanationZh}</small>}{result?.verdict==='correct'&&s.questionNumber===1&&<button onClick={nextQuestion}>下一题</button>}{result?.verdict!=='correct'&&<button onClick={()=>setPhase('answering')}>再试一次</button>}{result?.verdict==='correct'&&s.questionNumber>1&&<button onClick={onClose}>返回聊天</button>}</div>}{error&&<div className="review-error">{error}</div>}<button className="review-close" onClick={onClose}>×</button></section>;
}
