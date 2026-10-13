/** Genesis 的纯规则；不读取存档、不写入数据、不计算经验或能力分数。 */
import {fail} from './store.js';
export const DIMENSIONS={body:'training',learning:'study',creation:'project',life:'life'};
export const TYPES={study:['Mind','study'],training:['Body','training'],project:['Craft','project'],life:['Vitality','cooking']};
export const SKILL_STATES=['not_started','learning','practicing','mastered'];
export const publicState=status=>status==='not_started'?'pending':status;
export const dimensionOf=q=>q.dimension||Object.keys(DIMENSIONS).find(d=>DIMENSIONS[d]===q.type)||null;
export const dateInShanghai=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const stamp=old=>new Date(Math.max(Date.now(),Date.parse(old||'')+1||0)).toISOString();
export const parse=(raw,fallback)=>{try{return JSON.parse(raw||'null')??fallback;}catch{return fallback;}};
export function dateValid(date){return typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(Date.parse(date))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date;}
export function due(q,date){if(date<q.starts_on)return false;return q.repeat==='once'?q.scheduled_date===date:q.repeat==='daily'?true:parse(q.weekdays_json,[]).includes(new Date(date+'T12:00:00Z').getUTCDay());}
export function fields(body,allowed){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!allowed.includes(key)))fail('请求包含无效或不支持的字段。');}
export function text(value,max,label,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail(label+'格式无效或长度超限。');return value.trim();}
export function list(value,label){if(!Array.isArray(value)||value.length>50)fail(label+'必须是最多50项的列表。');return value.map(item=>text(item,2000,label,true));}
