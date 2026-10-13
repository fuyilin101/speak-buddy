/** 成长之树只负责呈现与页面状态；不请求API、不保存状态、不推断能力。 */
import {skillStatuses} from './genesis-skill-model.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function growthTreeMarkup(forest,links,collapsed=new Set(),selected=null) {
 const groups=new Map([...forest.byId.keys()].map((id,index)=>[id,'growth-children-'+index]));
 const related=new Map();for(const link of links){if(!related.has(link.skill_id))related.set(link.skill_id,[]);related.get(link.skill_id).push(link);}
 function branch(nodes,depth=0) {
  return '<ul class="growth-branches" style="--growth-cols:'+Math.min(nodes.length,3)+'">'+nodes.map(skill=>{
   const children=forest.children.get(skill.id)||[],expanded=!collapsed.has(skill.id),rows=related.get(skill.id)||[],fruits=rows.filter(link=>!link.missing&&['project','asset'].includes(link.target_type));
   return '<li class="growth-branch" data-growth-depth="'+depth+'"><div class="growth-node-head" data-growth-anchor="'+esc(skill.id)+'" data-growth-parent="'+esc(skill.parent_id||'')+'" style="--growth-delay:'+Math.min(depth,5)*70+'ms"><div class="growth-node-shell" data-status="'+skill.status+'">'+
    '<button class="skill-node growth-node" data-skill-view="'+esc(skill.id)+'" data-status="'+skill.status+'" data-selected="'+(selected===skill.id)+'" aria-label="'+esc(skill.name)+'，'+skillStatuses[skill.status]+'，'+rows.length+'条关联，查看详情"><span class="growth-node-orb" aria-hidden="true"></span><span class="growth-node-copy"><strong class="skill-node-name">'+esc(skill.name)+'</strong><span class="growth-node-category">'+esc(skill.category||'未分类')+'</span><span class="skill-node-meta"><span class="skill-status">'+skillStatuses[skill.status]+'</span><span class="growth-link-count">'+rows.length+' 条关联</span></span></span></button>'+
    (children.length?'<button class="skill-toggle growth-branch-toggle" data-skill-toggle="'+esc(skill.id)+'" aria-expanded="'+expanded+'" aria-controls="'+groups.get(skill.id)+'" aria-label="'+(expanded?'折叠':'展开')+'分支：'+esc(skill.name)+'"><span aria-hidden="true">'+(expanded?'−':'+')+'</span>'+children.length+' 条分支<span class="growth-toggle-label">'+(expanded?'收起':'展开')+'</span></button>':'')+'</div>'+
    (fruits.length?'<ul class="growth-fruits" aria-label="'+esc(skill.name)+'的关联成果">'+fruits.slice(0,3).map(link=>'<li><button data-growth-result="'+esc(link.id)+'" class="growth-fruit" data-kind="'+link.target_type+'"><span class="growth-fruit-mark" aria-hidden="true">'+(link.target_type==='project'?'◈':'◇')+'</span><span><small>'+ (link.target_type==='project'?'实践项目':'沉淀资产')+'</small><strong>'+esc(link.target_title)+'</strong></span><span aria-hidden="true">↗</span></button></li>').join('')+(fruits.length>3?'<li><button class="growth-fruit-more" data-skill-view="'+esc(skill.id)+'">查看全部 '+fruits.length+' 项成果</button></li>':'')+'</ul>':'')+'</div>'+
    (children.length?'<div class="growth-children" id="'+groups.get(skill.id)+'" '+(expanded?'':'hidden')+'>'+branch(children,depth+1)+'</div>':'')+'</li>';
  }).join('')+'</ul>';
 }
 return '<svg class="growth-connections" aria-hidden="true" focusable="false"><g></g></svg><div class="growth-tree-content">'+branch(forest.roots)+'</div>';
}

export function connectionPath(parent,child) {
 if(![parent.x,parent.y,child.x,child.y].every(Number.isFinite))return '';
 const bend=Math.max(12,(child.y-parent.y)*.48),n=value=>Number(value.toFixed(2));
 return `M ${n(parent.x)} ${n(parent.y)} C ${n(parent.x)} ${n(parent.y+bend)}, ${n(child.x)} ${n(child.y-bend)}, ${n(child.x)} ${n(child.y)}`;
}

export class GrowthTree {
 constructor(element,{collapsed=new Set(),onSelect,onResult}={}) {
  this.element=element;this.collapsed=collapsed;this.onSelect=onSelect;this.onResult=onResult;this.selected=null;this.introduced=false;this.frame=0;
  this.click=event=>{
   const toggle=event.target.closest('[data-skill-toggle]');
   if(toggle&&this.forest){const id=toggle.dataset.skillToggle;this.collapsed.has(id)?this.collapsed.delete(id):this.collapsed.add(id);this.render();this.restoreToggle(id);return;}
   const result=event.target.closest('[data-growth-result]');if(result){this.onResult?.(result.dataset.growthResult);return;}
   const node=event.target.closest('[data-skill-view]');if(node)this.onSelect?.(node.dataset.skillView);
  };
  element.addEventListener('click',this.click);
  this.resize=()=>this.schedule();
  this.observer=typeof ResizeObserver==='function'?new ResizeObserver(this.resize):null;
  this.observer?.observe(element);if(!this.observer)window.addEventListener('resize',this.resize);
 }
 setData(forest,links) {
  this.forest=forest;this.links=links;
  if(!this.initialFoldDone&&forest.roots.length){this.initialFoldDone=true;if(window.matchMedia('(max-width:700px)').matches)for(const skill of forest.byId.values())if(skill.parent_id&&(forest.children.get(skill.id)||[]).length)this.collapsed.add(skill.id);}
  for(const id of this.collapsed)if(!forest.byId.has(id))this.collapsed.delete(id);
  this.render();
 }
 render() {
  if(!this.forest)return;
  this.element.classList.add('growth-tree-canvas');
  this.element.innerHTML=this.forest.roots.length?growthTreeMarkup(this.forest,this.links,this.collapsed,this.selected):'<div class="skill-empty growth-tree-empty"><span class="skill-empty-mark" aria-hidden="true">◇</span><h2>让第一条成长路线生根</h2><p>创建一个想培养的方向，把真实行动、项目和资产连接到这里。</p><button type="button" class="skill-primary" data-growth-create>创建第一个技能</button></div>';
  this.schedule();this.enter();
 }
 enter() {
  if(document.body.dataset.growthRoute!=='skills'||!this.forest)return;
  this.schedule();
  if(!this.introduced&&this.forest.roots.length){this.introduced=true;this.element.classList.add('is-growing');this.introTimer=setTimeout(()=>{this.element.classList.remove('is-growing');this.schedule();},1000);}
 }
 select(id) {
  this.selected=id;
  for(const node of this.element.querySelectorAll('.growth-node'))node.setAttribute('data-selected',String(node.dataset.skillView===id));
 }
 expandAll(expanded) {
  if(!this.forest)return;
  this.collapsed.clear();if(!expanded)for(const [id,children]of this.forest.children)if(id&&children.length)this.collapsed.add(id);
  this.render();
 }
 restoreToggle(id) {
  [...this.element.querySelectorAll('[data-skill-toggle]')].find(node=>node.dataset.skillToggle===id)?.focus({preventScroll:true});
 }
 schedule() {if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;this.draw();});}
 draw() {
  const svg=this.element.querySelector('svg'),box=this.element.getBoundingClientRect();
  if(!svg||box.width===0||box.height===0||window.matchMedia('(max-width:700px)').matches){svg?.querySelector('g').replaceChildren();return;}
  const anchors=new Map();for(const element of this.element.querySelectorAll('[data-growth-anchor]'))if(element.getClientRects().length){const r=element.getBoundingClientRect();anchors.set(element.dataset.growthAnchor,{parent:element.dataset.growthParent,x:r.left-box.left+r.width/2,top:r.top-box.top,bottom:r.bottom-box.top,status:element.querySelector('.growth-node')?.dataset.status});}
  const paths=[];for(const child of anchors.values()){const parent=anchors.get(child.parent);if(!parent)continue;paths.push('<path class="growth-connection" data-status="'+parent.status+'" pathLength="1" d="'+connectionPath({x:parent.x,y:parent.bottom+3},{x:child.x,y:child.top-5})+'"/>');}
  svg.setAttribute('viewBox','0 0 '+box.width+' '+box.height);svg.querySelector('g').innerHTML=paths.join('');
 }
 destroy() {
  this.element.removeEventListener('click',this.click);this.observer?.disconnect();window.removeEventListener('resize',this.resize);cancelAnimationFrame(this.frame);clearTimeout(this.introTimer);
 }
}
