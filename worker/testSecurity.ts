import type {Env} from './index';
const deny=(status:number,error:string,retryAfter?:number)=>new Response(JSON.stringify({error}),{status,headers:{'content-type':'application/json','cache-control':'no-store',...(retryAfter?{'retry-after':String(Math.max(1,Math.ceil(retryAfter)))}:{})}});
const decode=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(s.length/4)*4,'=')),c=>c.charCodeAt(0));
export async function protectTest(request:Request,env:Env):Promise<Request|Response>{
 if(env.TEST_LOCKDOWN!=='true')return request;
 if(!env.ACCESS_ISSUER||!env.ACCESS_AUD||!env.DB)return deny(503,'测试访问保护尚未配置完成');
 try{
  const token=request.headers.get('Cf-Access-Jwt-Assertion')||request.headers.get('cookie')?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1]||'';
  const parts=token.split('.');if(parts.length!==3)return deny(401,'请先通过 Cloudflare Access 登录');
  const header=JSON.parse(new TextDecoder().decode(decode(parts[0])));
  const claims=JSON.parse(new TextDecoder().decode(decode(parts[1])));
  const seconds=Date.now()/1000;
  if(header.alg!=='RS256'||claims.iss!==env.ACCESS_ISSUER||!Array.isArray(claims.aud)||!claims.aud.includes(env.ACCESS_AUD)||typeof claims.exp!=='number'||claims.exp<=seconds||claims.iat>seconds+60||claims.nbf>seconds||claims.email!==env.TEST_ALLOWED_EMAIL)return deny(403,'没有测试访问权限');
  const response=await fetch(env.ACCESS_ISSUER+'/cdn-cgi/access/certs',{signal:AbortSignal.timeout(5000)});
  if(!response.ok)return deny(503,'访问认证暂时不可用');
  const certs=await response.json() as {keys:(JsonWebKey&{kid:string})[]};const jwk=certs.keys.find(k=>k.kid===header.kid);if(!jwk)return deny(403,'无效访问凭证');
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))return deny(403,'无效访问凭证');
  const url=new URL(request.url);
  if(url.pathname.startsWith('/api/')&&request.method==='POST'){
   if(Number(request.headers.get('content-length')||0)>8000000)return deny(413,'请求过大');
   const now=new Date(),minute=now.toISOString().slice(0,16),day=minute.slice(0,10);
   const secondsUntilNextMinute=60-now.getSeconds();
   const secondsUntilNextDay=86400-(now.getUTCHours()*3600+now.getUTCMinutes()*60+now.getUTCSeconds());
   await env.DB.batch([env.DB.prepare('INSERT OR IGNORE INTO test_usage(bucket,count) VALUES(?,0)').bind(minute),env.DB.prepare('INSERT OR IGNORE INTO test_usage(bucket,count) VALUES(?,0)').bind(day)]);
   const result=await env.DB.prepare(`UPDATE test_usage SET count=count+1 WHERE bucket=? AND count<40 AND (SELECT count FROM test_usage WHERE bucket=?)<400 RETURNING count`).bind(minute,day).first();
   // Initialize both buckets, then retry on the next request. Never allow an uncounted call.
   if(!result){
    const [minuteRow,dayRow]=await Promise.all([
     env.DB.prepare('SELECT count FROM test_usage WHERE bucket=?').bind(minute).first<{count:number}>(),
     env.DB.prepare('SELECT count FROM test_usage WHERE bucket=?').bind(day).first<{count:number}>()
    ]);
    await env.DB.batch([env.DB.prepare('INSERT OR IGNORE INTO test_usage(bucket,count) VALUES(?,0)').bind(minute),env.DB.prepare('INSERT OR IGNORE INTO test_usage(bucket,count) VALUES(?,0)').bind(day)]);
    if((dayRow?.count??0)>=400)return deny(429,'今日测试额度已用完，请明天再试',secondsUntilNextDay);
    if((minuteRow?.count??0)>=40)return deny(429,'本分钟测试请求已达40次，请稍后再试',secondsUntilNextMinute);
    return deny(429,'请求暂时无法处理，请稍后重试',secondsUntilNextMinute);
   }
   const daily=await env.DB.prepare('UPDATE test_usage SET count=count+1 WHERE bucket=? AND count<400 RETURNING count').bind(day).first();if(!daily)return deny(429,'今日测试额度已用完，请明天再试',secondsUntilNextDay);
   console.log(JSON.stringify({event:'test_usage',path:url.pathname,minute_count:result.count,day_count:daily.count}));
  }
  // All test profile and chat rows use the verified owner, never the supplied userId.
  const id='test-owner-2270110783-qq-com';url.searchParams.set('userId',id);
  if(request.method==='POST'&&['/api/profile','/api/chat','/api/chat/stream'].includes(url.pathname)){const body=await request.json() as Record<string,unknown>;body.userId=id;return new Request(url,{method:request.method,headers:request.headers,body:JSON.stringify(body),signal:request.signal});}
  return new Request(url,request);
 }catch{return deny(503,'测试访问认证失败');}
}
