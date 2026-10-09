export type LearningFeedback={type:'grammar'|'expression'|'none';originalText:string;suggestedText:string;explanationZh:string;focusPoint:string;learningSaved?:boolean;recordId?:string;sourceMessageId?:string};
export type StreamReply={hasError:boolean;errorLevel:string;original:string;corrected:string;explanationZh:string;requireRepeat:boolean;replyZh:string;replyEn:string;learningFeedback:LearningFeedback;[key:string]:unknown};
const noneFeedback=(original:string):LearningFeedback=>({type:'none',originalText:original,suggestedText:original,explanationZh:'',focusPoint:''});
const defaults=(original:string)=>({hasError:false,errorLevel:'none',original,corrected:original,explanationZh:'',requireRepeat:false,replyZh:'',learningFeedback:noneFeedback(original)});
function normalizeFeedback(value:any,original:string,legacy:any):LearningFeedback{
 const source=value&&typeof value==='object'?value:{};
 const type=source.type==='grammar'||source.type==='expression'||source.type==='none'?source.type:'none';
 const originalText=typeof source.originalText==='string'&&source.originalText.trim()?source.originalText.trim().slice(0,4000):original.slice(0,4000);
 const suggestedText=typeof source.suggestedText==='string'&&source.suggestedText.trim()?source.suggestedText.trim().slice(0,4000):'';
 const explanationZh=typeof source.explanationZh==='string'?source.explanationZh.trim().slice(0,1000):'';
 const focusPoint=typeof source.focusPoint==='string'?source.focusPoint.trim().slice(0,200):'';
 if(type!=='none'&&suggestedText&&explanationZh)return {type,originalText,suggestedText,explanationZh,focusPoint};
 if(legacy?.hasError===true&&typeof legacy.corrected==='string'&&legacy.corrected.trim()&&legacy.corrected.trim()!==original.trim())return {type:'grammar',originalText:typeof legacy.original==='string'?legacy.original.slice(0,4000):original.slice(0,4000),suggestedText:legacy.corrected.trim().slice(0,4000),explanationZh:typeof legacy.explanationZh==='string'?legacy.explanationZh.trim().slice(0,1000):'',focusPoint:typeof legacy.errorLevel==='string'?legacy.errorLevel.slice(0,200):'grammar'};
 return noneFeedback(original);
}
function decodeQuoted(value:string){try{return JSON.parse(`"${value}"`)}catch{return value.replace(/\\n/g,'\n').replace(/\\"/g,'"')}}
export function partialReply(raw:string){
 const match=raw.match(/"replyEn"\s*:\s*"((?:\\.|[^"\\])*)/);if(match)return decodeQuoted(match[1]);
 const quoted=raw.match(/^\s*"((?:\\.|[^"\\])*)/);return quoted?decodeQuoted(quoted[1]):'';
}
export function normalizeStreamResult(raw:string,original:string):StreamReply|null{
 const cleaned=raw.trim();if(!cleaned)return null;let value:any;
 try{value=JSON.parse(cleaned)}catch{const match=cleaned.match(/\{[\s\S]*\}/);if(match){try{value=JSON.parse(match[0])}catch{return null}}}
 if(typeof value==='string'&&value.trim())return {...defaults(original),replyEn:value.trim()};
 if(value&&typeof value.replyEn==='string'&&value.replyEn.trim())return {...defaults(original),...value,learningFeedback:normalizeFeedback(value.learningFeedback,original,value)};
 return null;
}

export function isDegenerateReply(text:string){
 const normalized=text.trim().toLowerCase().replace(/[.!?。！？]+$/g,'');
 return /^(like|ok|okay|yes|no|yeah|yep|sure|嗯|好|好的)$/.test(normalized);
}

export function sanitizeHistory<T extends {role:string;content:string}>(messages:T[]){
 return messages.filter(message=>!(message.role==='assistant'&&(
  /^[a-z]+[.!?]?$/i.test(message.content.trim())||isDegenerateReply(message.content)||
  /^(I hear you[!.]|That sounds nice! What do you like most|That’s a good question\. Tell me|That sounds stressful\. What part|Hi! I’m glad you’re here\.|I’m listening\.|That sounds interesting\. Can you)/.test(message.content)
 )));
}

// JSON-mode conversation examples must use the same output format as the
// next assistant turn. Keep every user message, including short vocabulary.
export function modelHistory<T extends {role:string;content:string}>(messages:T[]){
 return sanitizeHistory(messages).map(message=>({role:message.role,content:message.role==='assistant'?JSON.stringify({replyEn:message.content,hasError:false,replyZh:''}):message.content}));
}
export function isSingleEnglishWord(text:string){return /^[A-Za-z]+$/.test(text.trim());}

export function isLowQualityReply(text:string,original:string){
 const clean=(value:string)=>value.trim().toLowerCase().replace(/[.!?。！？]+$/g,'').replace(/[“”"']/g,'');
 const reply=clean(text);const input=clean(original);
 const loneEnglishWord=/^[a-z]+$/.test(reply)&&reply.length<=32;
 return isDegenerateReply(text)||loneEnglishWord||Boolean(input&&reply===input);
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
 if(/[妈妈母亲家人爸爸妈妈]/.test(original))return 'You’re talking about your family. What would you like to tell me about them?';
 if(!/[a-z]/i.test(original))return 'I’m listening. Try a short English sentence, like “I feel happy today.”';
 const choices=['I hear you. Tell me a little more about that.','I’m listening. What happened next?','That sounds interesting. Can you say a little more?'];
 const index=[...original].reduce((sum,char)=>sum+char.charCodeAt(0),0)%choices.length;
 return choices[index];
}
