import type {Env} from '../index';

function modelCandidates(env:Env, preferred?:string){
 const values=[preferred,env.AI_CHAT_MODEL,env.AI_MODEL,'qwen-plus'].filter((value):value is string=>Boolean(value));
 return values.filter((value,index)=>values.indexOf(value)===index);
}

export async function callJson(env:Env,messages:{role:string;content:string}[],maxTokens=900,preferredModel?:string){
 const started=performance.now();let attempts=0;
 for(const model of modelCandidates(env,preferredModel)) for(let attempt=0;attempt<2;attempt++){attempts++;
  try{const response=await fetch(env.AI_GATEWAY_URL!,{method:'POST',signal:AbortSignal.timeout(12000),headers:{'content-type':'application/json',authorization:`Bearer ${env.AI_GATEWAY_TOKEN}`},body:JSON.stringify({model,messages,max_tokens:maxTokens,temperature:0.65,enable_thinking:false,response_format:{type:'json_object'}})});
   if(!response.ok){console.error(JSON.stringify({event:'llm_failure',model,status:response.status,attempt}));if(response.status<500&&response.status!==429)break;continue;}
   const raw=await response.json() as any;console.log(JSON.stringify({event:'llm_timing',model,elapsed_ms:Math.round(performance.now()-started),attempts,ttft_ms:null,input_tokens:raw.usage?.prompt_tokens??null,output_tokens:raw.usage?.completion_tokens??null}));const content=raw.choices?.[0]?.message?.content;const match=typeof content==='string'?content.match(/\{[\s\S]*\}/):null;
   if(match)return JSON.parse(match[0]);console.error(JSON.stringify({event:'llm_format_failure',model,attempt}));
  }catch(error){console.error(JSON.stringify({event:'llm_exception',model,attempt,type:error instanceof Error?error.name:'unknown'}));}
 }
 throw new Error('语言服务暂时不可用');
}

export async function callStream(env:Env,messages:{role:string;content:string}[],maxTokens=900,signal?:AbortSignal,requestId?:string){
 const started=performance.now();let attempts=0;
 for(const model of modelCandidates(env)) for(let attempt=0;attempt<2;attempt++){attempts++;
  try{const response=await fetch(env.AI_GATEWAY_URL!,{method:'POST',signal:signal||AbortSignal.timeout(30000),headers:{'content-type':'application/json',authorization:`Bearer ${env.AI_GATEWAY_TOKEN}`},body:JSON.stringify({model,messages,max_tokens:maxTokens,temperature:0.65,enable_thinking:false,response_format:{type:'json_object'},stream:true})});
   if(!response.ok||!response.body){console.error(JSON.stringify({event:'llm_stream_failure',request_id:requestId,model,status:response.status,attempt}));if(response.status<500&&response.status!==429)break;continue;}
   console.log(JSON.stringify({event:'llm_stream_open',request_id:requestId,model,elapsed_ms:Math.round(performance.now()-started),attempts}));return response.body;
  }catch(error){console.error(JSON.stringify({event:'llm_stream_exception',request_id:requestId,model,attempt,type:error instanceof Error?error.name:'unknown'}));}
 }
 throw new Error('语言服务暂时不可用');
}
