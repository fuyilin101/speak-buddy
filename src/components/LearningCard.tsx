import React,{useState} from 'react';

export type LearningFeedback={type:'grammar'|'expression'|'none';originalText:string;suggestedText:string;explanationZh:string;focusPoint:string;learningSaved?:boolean;recordId?:string;sourceMessageId?:string};
type Props={feedback:LearningFeedback;onSave:()=>Promise<void>;onSpeak?:(text:string)=>void};

export default function LearningCard({feedback,onSave,onSpeak}:Props){
 const [open,setOpen]=useState(false);const [saving,setSaving]=useState(false);const [error,setError]=useState('');
 if(!feedback||feedback.type==='none'||!feedback.suggestedText)return null;
 const save=async()=>{if(feedback.learningSaved||saving)return;setSaving(true);setError('');try{await onSave()}catch(e){setError(e instanceof Error?e.message:'保存失败，请重试')}finally{setSaving(false)}};
 return <aside className="learning-card" aria-label="英语学习提示">
  <div className="learning-card-head"><span className="learning-kind">{feedback.type==='grammar'?'语法纠错':'表达帮助'}</span><span className="learning-focus">{feedback.focusPoint||'自然表达'}</span></div>
  <div className="learning-original">你的表达：{feedback.originalText}</div>
  <div className="learning-suggested"><b>{feedback.suggestedText}</b>{onSpeak&&<button className="learning-speak" aria-label="播放正确英文" onClick={()=>onSpeak(feedback.suggestedText)}>🔊</button>}</div>
  <button className="learning-why" onClick={()=>setOpen(v=>!v)}>{open?'收起说明':'为什么这样说'} <span>{open?'⌃':'⌄'}</span></button>
  {open&&<p className="learning-explanation">{feedback.explanationZh}</p>}
  <div className="learning-card-foot">{feedback.type==='grammar'||feedback.type==='expression'?<button className={feedback.learningSaved?'learning-saved':'learning-save'} disabled={feedback.learningSaved||saving} onClick={save}>{feedback.learningSaved?'已记录':saving?'正在记录…':'加入复习'}</button>:null}{error&&<span className="learning-error">{error}</span>}</div>
 </aside>;
}
