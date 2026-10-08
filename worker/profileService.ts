import type {Env} from './index';
import {isLearningProfile} from '../shared/profile';
export async function profileService(request:Request,env:Env){
 const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 if(!env.DB)return json({error:'数据库未配置'},503);
 try{
 if(request.method==='GET'){const id=new URL(request.url).searchParams.get('userId');if(!/^[-a-zA-Z0-9]{20,80}$/.test(id||''))return json({error:'无效用户'},400);const row=await env.DB.prepare('SELECT profile_json,profile_completed,profile_completed_at FROM chat_profiles WHERE id=?').bind(id).first<any>();if(!row?.profile_completed)return json({profile:null});return json({profile:{...JSON.parse(row.profile_json),profile_completed_at:row.profile_completed_at}});}
 const body=await request.json() as any;const profile=body.profile;if(!/^[-a-zA-Z0-9]{20,80}$/.test(body.userId||'')||!isLearningProfile(profile))return json({error:'请选择年龄、英语水平和1～3个目标'},400);
 const time=new Date().toISOString();const stored={...profile,profile_completed_at:time};
 const existing=await env.DB.prepare('SELECT profile_json FROM chat_profiles WHERE id=?').bind(body.userId).first<{profile_json:string}>();const combined={...(existing?JSON.parse(existing.profile_json):{}),...stored,character:body.setup?.character||'rabbit',companionName:String(body.setup?.companionName||'Luna').slice(0,40),nickname:String(body.setup?.nickname||'').slice(0,40),ageGroup:profile.age_group,englishLevel:profile.english_level};
 await env.DB.prepare(`INSERT INTO chat_profiles(id,profile_json,first_chat_at,last_chat_at,age_group,english_level,learning_goals,profile_completed,profile_completed_at) VALUES(?,?,?,?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET profile_json=excluded.profile_json,age_group=excluded.age_group,english_level=excluded.english_level,learning_goals=excluded.learning_goals,profile_completed=1,profile_completed_at=excluded.profile_completed_at`).bind(body.userId,JSON.stringify(combined),time,time,profile.age_group,profile.english_level,JSON.stringify(profile.learning_goals),time).run();return json({profile:combined});
 }catch{console.error(JSON.stringify({event:'profile_save_failed'}));return json({error:'保存失败，请重试'},503);}
}
