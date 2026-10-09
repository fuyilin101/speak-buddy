import type {Env} from './index';

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json;charset=UTF-8','cache-control':'no-store'}});
const validId=(value:unknown)=>typeof value==='string'&&/^[-a-zA-Z0-9]{20,80}$/.test(value);
const clean=(value:unknown,max:number)=>typeof value==='string'?value.trim().slice(0,max):'';

export async function learningService(request:Request,env:Env){
  if(!env.DB)return json({error:'数据库未配置'},503);
  const url=new URL(request.url);
  const userId=url.searchParams.get('userId')||'';
  if(!validId(userId))return json({error:'无效用户'},400);
  try{
    if(request.method==='GET'){
      const rows=await env.DB.prepare('SELECT id,source_message_id AS sourceMessageId,original_text AS originalText,suggested_text AS suggestedText,learning_type AS type,focus_point AS focusPoint,explanation_zh AS explanationZh,status,review_count AS reviewCount,created_at AS createdAt,updated_at AS updatedAt,next_review_at AS nextReviewAt FROM learning_records WHERE user_id=? ORDER BY CASE status WHEN \'review\' THEN 0 ELSE 1 END, updated_at DESC').bind(userId).all();
      return json(rows.results);
    }
    if(request.method==='POST'){
      const body=await request.json() as Record<string,unknown>;
      const type=body.type==='grammar'||body.type==='expression'?body.type:'';
      const originalText=clean(body.originalText,4000),suggestedText=clean(body.suggestedText,4000),explanationZh=clean(body.explanationZh,1000),focusPoint=clean(body.focusPoint,200),sourceMessageId=clean(body.sourceMessageId,100);
      if(!type||!originalText||!suggestedText||!explanationZh||!sourceMessageId)return json({error:'学习记录内容不完整'},400);
      const now=new Date().toISOString();
      const id=`learn-${crypto.randomUUID()}`;
      await env.DB.prepare(`INSERT INTO learning_records(id,user_id,source_message_id,original_text,suggested_text,learning_type,focus_point,explanation_zh,status,review_count,created_at,updated_at,next_review_at) VALUES(?,?,?,?,?,?,?,?,'review',0,?,?,NULL) ON CONFLICT(user_id,learning_type,original_text,suggested_text) DO UPDATE SET focus_point=excluded.focus_point,explanation_zh=excluded.explanation_zh,updated_at=excluded.updated_at`).bind(id,userId,sourceMessageId,originalText,suggestedText,type,focusPoint,explanationZh,now,now).run();
      const row=await env.DB.prepare('SELECT id,source_message_id AS sourceMessageId,original_text AS originalText,suggested_text AS suggestedText,learning_type AS type,focus_point AS focusPoint,explanation_zh AS explanationZh,status,review_count AS reviewCount,created_at AS createdAt,updated_at AS updatedAt,next_review_at AS nextReviewAt FROM learning_records WHERE user_id=? AND learning_type=? AND original_text=? AND suggested_text=?').bind(userId,type,originalText,suggestedText).first();
      return json({record:row,saved:true});
    }
    if(request.method==='DELETE'){
      const id=url.pathname.split('/').filter(Boolean).pop()||'';
      if(!/^learn-[0-9a-f-]{36}$/.test(id))return json({error:'无效学习记录'},400);
      const result=await env.DB.prepare('DELETE FROM learning_records WHERE id=? AND user_id=?').bind(id,userId).run();
      return result.meta.changes?json({deleted:true}):json({error:'记录不存在'},404);
    }
    return json({error:'不支持的请求'},405);
  }catch(error){
    console.error(JSON.stringify({event:'learning_record_failed',method:request.method,type:error instanceof Error?error.name:'unknown'}));
    return json({error:'学习记录暂时不可用，请重试'},503);
  }
}
