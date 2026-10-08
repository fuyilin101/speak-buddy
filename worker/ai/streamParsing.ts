export type StreamReply={hasError:boolean;errorLevel:string;original:string;corrected:string;explanationZh:string;requireRepeat:boolean;replyZh:string;replyEn:string;[key:string]:unknown};
const defaults=(original:string)=>({hasError:false,errorLevel:'none',original,corrected:original,explanationZh:'',requireRepeat:false,replyZh:''});
function decodeQuoted(value:string){try{return JSON.parse(`"${value}"`)}catch{return value.replace(/\\n/g,'\n').replace(/\\"/g,'"')}}
export function partialReply(raw:string){
 const match=raw.match(/"replyEn"\s*:\s*"((?:\\.|[^"\\])*)/);if(match)return decodeQuoted(match[1]);
 const quoted=raw.match(/^\s*"((?:\\.|[^"\\])*)/);return quoted?decodeQuoted(quoted[1]):'';
}
export function normalizeStreamResult(raw:string,original:string):StreamReply|null{
 const cleaned=raw.trim();if(!cleaned)return null;let value:any;
 try{value=JSON.parse(cleaned)}catch{const match=cleaned.match(/\{[\s\S]*\}/);if(match){try{value=JSON.parse(match[0])}catch{return null}}}
 if(typeof value==='string'&&value.trim())return {...defaults(original),replyEn:value.trim()};
 if(value&&typeof value.replyEn==='string'&&value.replyEn.trim())return {...defaults(original),...value};
 return null;
}

export function isDegenerateReply(text:string){
 const normalized=text.trim().toLowerCase().replace(/[.!?。！？]+$/g,'');
 return /^(like|ok|okay|yes|no|yeah|yep|sure|嗯|好|好的)$/.test(normalized);
}

export function sanitizeHistory<T extends {role:string;content:string}>(messages:T[]){
 return messages.filter(message=>!(message.role==='assistant'&&isDegenerateReply(message.content)));
}

export function isLowQualityReply(text:string,original:string){
 const clean=(value:string)=>value.trim().toLowerCase().replace(/[.!?。！？]+$/g,'').replace(/[“”"']/g,'');
 const reply=clean(text);const input=clean(original);
 return isDegenerateReply(text)||Boolean(input&&reply===input);
}

export function isHistoryEcho(text:string,history:string[]){
 const clean=(value:string)=>value.trim().toLowerCase().replace(/[.!?。！？]+$/g,'').replace(/[“”"']/g,'');
 const reply=clean(text);
 return Boolean(reply&&history.some(item=>clean(item)===reply));
}

export function isRepeatedAssistantReply(text:string,history:string[]){
 const clean=(value:string)=>value.trim().toLowerCase().replace(/[.!?。！？]+$/g,'').replace(/[“”"']/g,'');
 const reply=clean(text);
 return Boolean(reply&&history.some(item=>clean(item)===reply));
}

export function fallbackReply(original:string){
 const text=original.toLowerCase();
 if(/\b(hello|hi|hey)\b/.test(text))return 'Hi! I’m glad you’re here. How are you feeling today?';
 if(/\b(like|love|enjoy)\b/.test(text))return 'That sounds nice! What do you like most about it?';
 if(/\b(exam|test|nervous|worried)\b/.test(text))return 'That sounds stressful. What part worries you most?';
 if(/^\s*(what|how|where|why|when|can)\b/.test(text))return 'That’s a good question. Tell me a little more about what you mean?';
 return 'I hear you! Tell me a little more about that.';
}
