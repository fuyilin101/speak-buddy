import React,{useEffect,useState} from 'react';

type Props={userId:string;busy:boolean;onAnswerText?:(text:string)=>void};
type ReviewState={enabled:boolean;session?:{id:string;question:string;questionNumber:number;status:string}|null};
export default function ReviewWidget({userId,busy}:Props){
 const [state,setState]=useState<ReviewState|null>(null);const [answer,setAnswer]=useState('');const [phase,setPhase]=useState<'idle'|'answering'|'result'>('idle');const [result,setResult]=useState<any>(null);const [error,setError]=useState('');
 async function post(body:any):Promise<any>{const r=await fetch('/api/review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const d:any=await r.json().catch(()=>({error:'请求失败'}));if(!r.ok)throw new Error(d.error||'请求失败');return d;}
 async function refresh(){try{const d=await post({action:'check'});setState(d);if(d.session)setPhase('answering');}catch{} }
 useEffect(()=>{if(!busy)void refresh();},[busy]);
 if(!state)return null;
 if(!state.enabled)return <div className="review-settings"><button onClick={async()=>{try{const d=await post({action:'toggle',enabled:true});setState(d);await refresh();}catch(e){setError(e instanceof Error?e.message:'无法开启复习')}}}>开启角色主动复习</button></div>;
 if(!state.session)return null;
 const s=state.session;
 async function snooze(){try{const d=await post({action:'snooze',sessionId:s.id});setState(d);setPhase('idle');}catch(e){setError(e instanceof Error?e.message:'操作失败')}}
 async function answerNow(){const value=answer.trim();if(!value)return;setPhase('result');setError('');try{const d=await post({action:'answer',sessionId:s.id,answer:value,requestId:crypto.randomUUID()});setResult(d);if(d.completed){setState(null);}}catch(e){setPhase('answering');setError(e instanceof Error?e.message:'评估失败，请重试')}}
 async function nextQuestion(){try{const d=await post({action:'next',sessionId:s.id});if(d.session){setState(d);setAnswer('');setResult(null);setPhase('answering');}}catch(e){setError(e instanceof Error?e.message:'暂时没有下一题')}}
 return <section className="review-card" aria-live="polite"><div className="review-kicker">{s.questionNumber===1?'Luna 的小复习':'再来一道小练习'}</div>{phase==='answering'?<><div className="review-invite">记得我们之前练过的内容吗？要不要用一句英语试试看？</div><div className="review-question">{s.question}</div><textarea value={answer} onChange={e=>setAnswer(e.target.value)} placeholder="写下你的英文回答…" disabled={busy}/><div className="review-actions"><button onClick={answerNow} disabled={busy||!answer.trim()}>提交</button><button onClick={snooze}>稍后再说</button></div></>:<div className="review-result"><b>{result?.verdict==='correct'?'做得好！':result?.verdict==='uncertain'?'我们再确认一下':'差一点点'}</b><p>{result?.feedback||'正在评估…'}</p>{result?.explanationZh&&<small>{result.explanationZh}</small>}{result?.verdict==='correct'&&s.questionNumber===1&&<button onClick={nextQuestion}>再来一道</button>}{result?.verdict!=='correct'&&<button onClick={()=>setPhase('answering')}>再试一次</button>}</div>}{error&&<div className="review-error">{error}</div>}<button className="review-close" onClick={snooze}>×</button></section>;
}
