import React,{useEffect,useState} from 'react';
export default function GrowthBadge(){
  const [g,setG]=useState<any>(null); const [open,setOpen]=useState(false);
  useEffect(()=>{fetch('/api/growth').then(r=>r.ok?r.json():null).then(setG).catch(()=>{});},[]);
  if(!g)return null;
  const next=g.nextXp||g.xp+100; const prev=g.level>1?([0,100,300,700,1400][g.level-1]||0):0;
  const pct=Math.max(0,Math.min(100,Math.round((g.xp-prev)/Math.max(1,next-prev)*100)));
  return <>
    <aside className="growth-badge" role="button" tabIndex={0} onClick={()=>setOpen(true)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' ')setOpen(true)}}>
      <b>Lv.{g.level} · {g.title}</b><span>{g.xp} XP</span><div className="growth-track"><i style={{width:`${pct}%`}}/></div><small>查看成长规则</small>
    </aside>
    {open&&<div className="growth-rules-backdrop" role="dialog" aria-modal="true"><section className="growth-rules"><button className="growth-rules-close" onClick={()=>setOpen(false)} aria-label="关闭">×</button><h2>成长规则</h2><p>当前：Lv.{g.level} {g.title} · {g.xp} XP</p><p>{g.nextXp?`距离下一等级还需要 ${Math.max(0,g.nextXp-g.xp)} XP`:'已达到当前最高等级'}</p><h3>等级</h3><ul>{(g.levels||[]).map((x:any)=><li key={x.level}>Lv.{x.level} {x.title}：{x.need} XP</li>)}</ul><h3>有效学习行为</h3><ul>{(g.rules?.rewards||[]).map((r:any)=><li key={r.key}>{r.label}：{r.open?`${r.xp} XP`:'未开放'}</li>)}</ul><p className="growth-rules-note">每日最多获得 {g.rules?.dailyCap??150} XP。同一事件不能重复领奖。成长等级和英语能力等级（A1～C1）是两套不同的记录。</p></section></div>}
  </>;
}
