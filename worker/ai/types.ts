export type Profile={character:string;companionName:string;nickname:string;ageGroup:string;englishLevel:string;age_group?:string;english_level?:string;learning_goals?:string[];profile_completed?:boolean;response_length_preference?:'short'|'standard'|'detailed'};
export type ScenarioContext={id:string;titleZh:string;goalZh:string;taskEn:string;role:string};
export type Message={role:'user'|'assistant';content:string;timestamp?:string};
export type Emotion={emotion:string;intensity:number;need:string;should_give_advice:boolean};
export type Relationship={conversation_count:number;message_count:number;first_chat_at:string;last_chat_at:string;relationship_level:string};
