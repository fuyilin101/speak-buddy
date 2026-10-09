import type { Env } from './index';
import { recordReview } from './growthService';

const out=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json;charset=UTF-8','cache-control':'no-store'}});
const idOk=(v:unknown)=>typeof v==='string'&&/^[-a-zA-Z0-9]{20,80}$/.test(v);
const dayShanghai=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const clean=(v:unknown,max:number)=>typeof v==='string'?v.trim().slice(0,max):'';
type RecordRow={id:string;originalText:string;suggestedText:string;type:'grammar'|'expression';focusPoint:string;explanationZh:string;status:string;reviewCount:number;nextReviewAt:string|null;correctStreak:number;correctCount:number;incorrectCount:number;lastCorrectDay?:string|null};

function questionFor(r:RecordRow){
  const level=/past|过去|时态|tense/i.test(`${r.focusPoint} ${r.explanationZh} ${r.originalText}`);
  if(r.type==='grammar'&&level)return '请用英文表达：我昨天去了公园。注意使用 go 的正确过去式。';
  if(r.type==='grammar')return `请用英文造句，练习这个知识点：${r.focusPoint||r.suggestedText||'把原句说得更自然'}`;
  return `请用英文表达这个意思：“${r.originalText}”。尽量保留原意，不要逐字翻译。`;
}
function publicSession(row:any,record:any){return row?{id:row.id,question:row.question,questionNumber:row.question_number,status:row.status,record:{id:record?.id,type:record?.learning_type,focusPoint:record?.focus_point}}:null;}
async function recordFor(db:D1Database,userId:string,id:string){return await db.prepare(`SELECT id,original_text AS originalText,suggested_text AS suggestedText,learning_type AS type,focus_point AS focusPoint,explanation_zh AS explanationZh,status,review_count AS reviewCount,next_review_at AS nextReviewAt,correct_streak AS correctStreak,correct_count AS correctCount,incorrect_count AS incorrectCount,last_correct_day AS lastCorrectDay FROM learning_records WHERE id=? AND user_id=?`).bind(id,userId).first<RecordRow>();}
async function state(db:D1Database,userId:string){
  const pref=await db.prepare('SELECT enabled,last_invited_day AS lastInvitedDay,snoozed_day AS snoozedDay FROM review_preferences WHERE user_id=?').bind(userId).first<any>();
  const session=await db.prepare(`SELECT * FROM review_sessions WHERE user_id=? AND status IN ('invited','active') ORDER BY created_at DESC LIMIT 1`).bind(userId).first<any>();
  const record=session?await recordFor(db,userId,session.record_id):null;
  return {enabled:pref?.enabled!==0,session:publicSession(session,record)};
}
async function invite(db:D1Database,userId:string,manual=false){
  const day=dayShanghai(),now=new Date().toISOString();
  const pref=await db.prepare('SELECT enabled,last_invited_day,snoozed_day FROM review_preferences WHERE user_id=?').bind(userId).first<any>();
  if((!manual&&pref?.enabled===0)||(!manual&&pref?.last_invited_day===day)||(!manual&&pref?.snoozed_day===day))return state(db,userId);
  const existing=await db.prepare(`SELECT * FROM review_sessions WHERE user_id=? AND day=? AND status IN ('invited','active') LIMIT 1`).bind(userId,day).first<any>();
  if(existing){const rec=await recordFor(db,userId,existing.record_id);return {enabled:true,session:publicSession(existing,rec)};}
  const columns=`id,original_text AS originalText,suggested_text AS suggestedText,learning_type AS type,focus_point AS focusPoint,explanation_zh AS explanationZh,status,review_count AS reviewCount,next_review_at AS nextReviewAt,correct_streak AS correctStreak,correct_count AS correctCount,incorrect_count AS incorrectCount`;
  const due=await db.prepare(`SELECT ${columns} FROM learning_records WHERE user_id=? AND (status='review' OR status IS NULL) AND (next_review_at IS NULL OR next_review_at<=?) ORDER BY incorrect_count DESC,review_count ASC,updated_at ASC LIMIT 1`).bind(userId,now).first<RecordRow>();
  const available=due||await db.prepare(`SELECT ${columns} FROM learning_records WHERE user_id=? AND (status='review' OR status IS NULL) ORDER BY incorrect_count DESC,review_count ASC,updated_at ASC LIMIT 1`).bind(userId).first<RecordRow>();
  if(!available)return state(db,userId);
  const sid=`review-${crypto.randomUUID()}`;
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO review_preferences(user_id,enabled,last_invited_day,snoozed_day,updated_at) VALUES(?,1,?,?,?)`).bind(userId,day,null,now),
    db.prepare(`UPDATE review_preferences SET last_invited_day=?,updated_at=? WHERE user_id=? AND enabled=1`).bind(day,now,userId),
    db.prepare(`INSERT OR IGNORE INTO review_sessions(id,user_id,record_id,day,question_number,question,status,created_at,updated_at) VALUES(?,?,?,?,1,?,'invited',?,?)`).bind(sid,userId,available.id,day,questionFor(available),now,now)
  ]);
  const session=await db.prepare(`SELECT * FROM review_sessions WHERE user_id=? AND day=? AND status IN ('invited','active') ORDER BY created_at DESC LIMIT 1`).bind(userId,day).first<any>();
  const rec=session?await recordFor(db,userId,session.record_id):null;
  return {enabled:true,session:publicSession(session,rec)};
}
async function evaluate(env:Env,question:string,answer:string,record:any,requestId:string){
  if(!env.AI_GATEWAY_URL||!env.AI_GATEWAY_TOKEN)throw new Error('language service unavailable');
  const prompt=`You are grading one English practice answer. Return JSON only: {"verdict":"correct|incorrect|uncertain","feedback":"short friendly English feedback","explanationZh":"short Chinese explanation"}. Accept natural equivalent answers that satisfy the question. Do not mark an answer incorrect merely because it adds extra relevant words. Use uncertain when the answer is unrelated, too short to judge, or likely speech recognition noise. Never reveal or invent a target answer. Question: ${question}\nLearning focus: ${record.focus_point||record.learning_type}\nUser answer: ${answer}`;
  const response=await fetch(env.AI_GATEWAY_URL,{method:'POST',signal:AbortSignal.timeout(12000),headers:{'content-type':'application/json',authorization:`Bearer ${env.AI_GATEWAY_TOKEN}`},body:JSON.stringify({model:env.AI_CHAT_MODEL||env.AI_MODEL||'qwen3.7-flash',messages:[{role:'system',content:'Grade the answer safely and return strict JSON.'},{role:'user',content:prompt}],max_tokens:220,temperature:.1,enable_thinking:false,response_format:{type:'json_object'}})});
  if(!response.ok)throw new Error(`grading ${response.status}`);
  const raw=await response.json() as any; const content=raw.choices?.[0]?.message?.content;
  let parsed:any; try{parsed=JSON.parse(typeof content==='string'?content.match(/\{[\s\S]*\}/)?.[0]||content:'');if(typeof parsed==='string')parsed=JSON.parse(parsed);}catch{throw new Error('grading format');}
  const verdict=parsed?.verdict==='correct'||parsed?.verdict==='incorrect'||parsed?.verdict==='uncertain'?parsed.verdict:'uncertain';
  return {verdict,feedback:clean(parsed.feedback,500)||'Let’s look at that together.',explanationZh:clean(parsed.explanationZh,500)};
}
export async function reviewService(request:Request,env:Env){
  if(!env.DB)return out({error:'数据库未配置'},503); const url=new URL(request.url); const userId=url.searchParams.get('userId')||''; if(!idOk(userId))return out({error:'无效用户'},400);
  try{
    if(request.method==='GET')return out(await state(env.DB,userId));
    const body=await request.json() as any; const action=clean(body.action,30); const now=new Date().toISOString();
    if(action==='check')return out(await invite(env.DB,userId,body.manual===true));
    if(action==='toggle'){const enabled=body.enabled!==false;await env.DB.batch([env.DB.prepare(`INSERT INTO review_preferences(user_id,enabled,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at`).bind(userId,enabled?1:0,now),...(enabled?[]:[env.DB.prepare(`UPDATE review_sessions SET status='cancelled',updated_at=? WHERE user_id=? AND status IN ('invited','active')`).bind(now,userId)])]);return out(await state(env.DB,userId));}
    if(action==='snooze'){await env.DB.prepare(`INSERT INTO review_preferences(user_id,enabled,snoozed_day,updated_at) VALUES(?,1,?,?) ON CONFLICT(user_id) DO UPDATE SET snoozed_day=excluded.snoozed_day,updated_at=excluded.updated_at`).bind(userId,dayShanghai(),now).run();await env.DB.prepare(`UPDATE review_sessions SET status='skipped',updated_at=? WHERE user_id=? AND status IN ('invited','active')`).bind(now,userId).run();return out(await state(env.DB,userId));}
    const sessionId=clean(body.sessionId,80); const session=await env.DB.prepare(`SELECT * FROM review_sessions WHERE id=? AND user_id=? AND status IN ('invited','active')`).bind(sessionId,userId).first<any>(); if(!session)return out({error:'复习会话已结束，请重新开始'},409);
    if(action==='start'){await env.DB.prepare(`UPDATE review_sessions SET status='active',updated_at=? WHERE id=? AND user_id=?`).bind(now,sessionId,userId).run();const rec=await recordFor(env.DB,userId,session.record_id);return out({session:publicSession({...session,status:'active'},rec)});}
    if(action==='skip'||action==='end'){await env.DB.prepare(`UPDATE review_sessions SET status=?,updated_at=? WHERE id=? AND user_id=?`).bind(action==='skip'?'skipped':'cancelled',now,sessionId,userId).run();return out(await state(env.DB,userId));}
    if(action==='next'){
      if(session.question_number>=2)return out({error:'本次复习最多两题'},400);
      const due=await env.DB.prepare(`SELECT id,original_text AS originalText,suggested_text AS suggestedText,learning_type AS type,focus_point AS focusPoint,explanation_zh AS explanationZh,status,review_count AS reviewCount,next_review_at AS nextReviewAt,correct_streak AS correctStreak,correct_count AS correctCount,incorrect_count AS incorrectCount FROM learning_records WHERE user_id=? AND id<>? AND status='review' AND (next_review_at IS NULL OR next_review_at<=?) ORDER BY incorrect_count DESC,review_count ASC,updated_at ASC LIMIT 1`).bind(userId,session.record_id,now).first<RecordRow>();
      if(!due)return out({error:'今天没有其他到期项目了'},404);
      const sid=`review-${crypto.randomUUID()}`;await env.DB.prepare(`INSERT OR IGNORE INTO review_sessions(id,user_id,record_id,day,question_number,question,status,created_at,updated_at) VALUES(?,?,?,?,2,?,'active',?,?)`).bind(sid,userId,due.id,dayShanghai(),questionFor(due),now,now).run();const next=await env.DB.prepare(`SELECT * FROM review_sessions WHERE user_id=? AND day=? AND question_number=2 AND status='active' ORDER BY created_at DESC LIMIT 1`).bind(userId,dayShanghai()).first<any>();const rec=next?await recordFor(env.DB,userId,next.record_id):null;return out({enabled:true,session:publicSession(next,rec)});
    }
    if(action==='answer'){
      const answer=clean(body.answer,2000); if(!answer)return out({error:'请先说点什么'},400); const requestId=clean(body.requestId,80)||crypto.randomUUID();
      const old=await env.DB.prepare('SELECT verdict,feedback,state FROM review_attempts WHERE user_id=? AND request_id=?').bind(userId,requestId).first<any>(); if(old?.state==='done')return out({verdict:old.verdict,feedback:old.feedback,duplicate:true}); if(old?.state==='processing')return out({error:'正在评估，请稍候'},409);
      const attempts=await env.DB.prepare(`SELECT COUNT(*) AS count FROM review_attempts WHERE user_id=? AND session_id=?`).bind(userId,sessionId).first<any>(); if(Number(attempts?.count||0)>=5)return out({error:'这道题的尝试次数已达到上限'},429);
      const rec=await recordFor(env.DB,userId,session.record_id);if(!rec)return out({error:'学习记录已删除'},410);
      const attemptId=`attempt-${crypto.randomUUID()}`; await env.DB.prepare(`INSERT INTO review_attempts(id,user_id,session_id,request_id,answer,state,created_at,updated_at) VALUES(?,?,?,?,?,'processing',?,?)`).bind(attemptId,userId,sessionId,requestId,answer,now,now).run();
      let result:{verdict:'correct'|'incorrect'|'uncertain';feedback:string;explanationZh:string}; try{result=await evaluate(env,session.question,answer,rec,requestId);}catch(error){await env.DB.prepare(`UPDATE review_attempts SET state='failed',updated_at=? WHERE id=?`).bind(new Date().toISOString(),attemptId).run();console.error(JSON.stringify({event:'review_evaluation_failed',request_id:requestId,type:error instanceof Error?error.name:'unknown'}));return out({error:'这次评估失败了，请稍后重试'},502);}
      const finish=new Date().toISOString(),today=dayShanghai(); let next: string|null=null, status='review', streak=rec.correctStreak||0;
      if(result.verdict==='correct'){const distinct=rec.lastCorrectDay!==today; streak=distinct?streak+1:streak; const days=streak<=1?1:streak===2?3:streak===3?7:14; next=new Date(Date.now()+days*86400000).toISOString();status=streak>=4?'mastered':'review';await env.DB.batch([env.DB.prepare(`UPDATE review_attempts SET verdict=?,feedback=?,state='done',updated_at=? WHERE id=? AND state='processing'`).bind(result.verdict,JSON.stringify(result),finish,attemptId),env.DB.prepare(`UPDATE learning_records SET review_count=review_count+1,correct_count=correct_count+1,correct_streak=?,last_correct_day=?,last_review_at=?,next_review_at=?,status=?,updated_at=? WHERE id=? AND user_id=?`).bind(streak,today,finish,next,status,finish,rec.id,userId),env.DB.prepare(`UPDATE review_sessions SET status='completed',updated_at=? WHERE id=? AND user_id=?`).bind(finish,sessionId,userId)]);try{await recordReview(env,userId,rec.id);}catch(error){console.error(JSON.stringify({event:'growth_reward_failed',type:error instanceof Error?error.name:'unknown'}));}} else if(result.verdict==='incorrect'){next=new Date(Date.now()+6*3600000).toISOString();await env.DB.batch([env.DB.prepare(`UPDATE review_attempts SET verdict=?,feedback=?,state='done',updated_at=? WHERE id=? AND state='processing'`).bind(result.verdict,JSON.stringify(result),finish,attemptId),env.DB.prepare(`UPDATE learning_records SET review_count=review_count+1,incorrect_count=incorrect_count+1,correct_streak=0,last_review_at=?,next_review_at=?,status='review',updated_at=? WHERE id=? AND user_id=?`).bind(finish,next,finish,rec.id,userId)]);} else {await env.DB.prepare(`UPDATE review_attempts SET verdict=?,feedback=?,state='done',updated_at=? WHERE id=? AND state='processing'`).bind(result.verdict,JSON.stringify(result),finish,attemptId).run();}
      return out({verdict:result.verdict,feedback:result.feedback,explanationZh:result.explanationZh,completed:result.verdict==='correct',streak});
    }
    return out({error:'不支持的复习操作'},400);
  }catch(error){console.error(JSON.stringify({event:'review_route_failed',method:request.method,type:error instanceof Error?error.name:'unknown'}));return out({error:'复习服务暂时不可用，请重试'},503);}
}
