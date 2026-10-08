/// <reference types="@cloudflare/workers-types" />
import type {Message,Profile,Relationship} from './types';
export async function loadMemory(db:D1Database,id:string){
 const [state,rows]=await Promise.all([
  db.prepare('SELECT * FROM chat_profiles WHERE id=?').bind(id).first<any>(),
  db.prepare('SELECT role,content,created_at AS timestamp FROM recent_messages WHERE user_id=? ORDER BY seq DESC LIMIT 40').bind(id).all<Message>()
 ]);
 return {state,messages:rows.results.reverse(),summary:state?.conversation_summary||''};
}
export async function saveTurn(db:D1Database,id:string,profile:Profile,relationship:Relationship,message:string,result:any,emotion:any,requestId:string){
 const time=relationship.last_chat_at;
 await db.batch([
 db.prepare(`INSERT INTO chat_profiles(id,profile_json,conversation_summary,conversation_count,message_count,first_chat_at,last_chat_at,relationship_level) VALUES(?,?,'',?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET profile_json=excluded.profile_json,conversation_count=excluded.conversation_count,message_count=excluded.message_count,last_chat_at=excluded.last_chat_at,relationship_level=excluded.relationship_level`).bind(id,JSON.stringify(profile),relationship.conversation_count,relationship.message_count,relationship.first_chat_at,time,relationship.relationship_level),
 db.prepare('INSERT INTO recent_messages(user_id,role,content,created_at,emotion_json,request_id) VALUES(?,?,?,?,?,?)').bind(id,'user',message,time,JSON.stringify(emotion),requestId),
 db.prepare('INSERT INTO recent_messages(user_id,role,content,created_at,emotion_json,request_id) VALUES(?,?,?,?,?,?)').bind(id,'assistant',result.replyEn,time,JSON.stringify(emotion),requestId),
 db.prepare('INSERT INTO chat_requests(user_id,request_id,response_json) VALUES(?,?,?)').bind(id,requestId,JSON.stringify(result))]);
}
export async function saveSummary(db:D1Database,id:string,summary:string,through:number){
 await db.batch([db.prepare('UPDATE chat_profiles SET conversation_summary=?,summary_through=? WHERE id=? AND summary_through<?').bind(summary.slice(0,4000),through,id,through),db.prepare('DELETE FROM recent_messages WHERE user_id=? AND seq NOT IN (SELECT seq FROM recent_messages WHERE user_id=? ORDER BY seq DESC LIMIT 40)').bind(id,id)]);
}



