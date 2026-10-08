import type {Relationship} from './types';
export function updateRelationship(previous:Relationship|null,now:string):Relationship{
 const first=previous?.first_chat_at||now;
 const newConversation=!previous||Date.parse(now)-Date.parse(previous.last_chat_at)>30*60*1000;
 const count=(previous?.conversation_count||0)+(newConversation?1:0);
 const messages=(previous?.message_count||0)+2;
 const days=(Date.parse(now)-Date.parse(first))/86400000;
 const level=days>=30&&count>=15?'long_term':days>=7&&count>=5&&messages>=60?'close':count>=3||messages>=20?'familiar':'new';
 return {conversation_count:count,message_count:messages,first_chat_at:first,last_chat_at:now,relationship_level:level};
}
