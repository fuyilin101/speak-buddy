import type {Emotion} from './types';
export function analyzeEmotion(text:string):Emotion{
 const rules:[string,RegExp][]=[['sad',/考砸|难过|伤心|被.*骂|failed|sad|upset/i],['anxious',/考试|担心|焦虑|紧张|exam|worried|anxious/i],['tired',/累|疲惫|tired|exhausted/i],['angry',/烦|生气|愤怒|angry|annoyed/i],['lonely',/孤独|没人陪|lonely/i],['embarrassed',/尴尬|丢脸|embarrassed/i],['confused',/不懂|迷茫|confused/i],['excited',/兴奋|激动|excited/i],['happy',/开心|高兴|happy|great day/i]];
 const emotion=rules.find(([,r])=>r.test(text))?.[0]||'neutral';
 const advice=/怎么办|建议|怎么做|方案|should I|advice|how can I/i.test(text);
 const information=/区别|是什么|为什么|解释|教程|difference|what is|explain|https?/i.test(text);
 const need=advice?'advice':information?'information':['sad','angry','anxious','embarrassed'].includes(emotion)?'comfort':emotion==='lonely'?'companionship':'chat';
 return {emotion,intensity:emotion==='neutral'?0:0.65,need,should_give_advice:advice};
}
