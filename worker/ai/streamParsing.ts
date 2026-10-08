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
