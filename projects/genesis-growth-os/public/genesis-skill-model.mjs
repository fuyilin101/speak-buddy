/** 层级只组织用户节点；不推断状态或计算成长分数。 */
export const skillStatuses = {not_started:'尚未开始',learning:'学习中',practicing:'实践中',mastered:'已掌握'};
export const skillTargets = {goal:'目标',quest:'使命',project:'项目',asset:'资产'};
export function skillForest(skills) {
 if(!Array.isArray(skills) || skills.length>1000) throw Error('技能节点数据无效。');
 const byId=new Map(),children=new Map();
 for(const skill of skills) {
  if(!skill || typeof skill.id!=='string' || !skill.id || byId.has(skill.id) || typeof skill.name!=='string' || !Object.hasOwn(skillStatuses,skill.status)) throw Error('技能节点数据不完整。');
  byId.set(skill.id,skill);
 }
 for(const skill of skills) {
  if(skill.parent_id!==null && !byId.has(skill.parent_id)) throw Error('技能父节点不存在，请检查数据。');
  const seen=new Set([skill.id]);let parent=byId.get(skill.parent_id);
  while(parent) {if(seen.has(parent.id)) throw Error('技能层级存在循环，请检查数据。');seen.add(parent.id);parent=byId.get(parent.parent_id);}
  if(!children.has(skill.parent_id)) children.set(skill.parent_id,[]);
  children.get(skill.parent_id).push(skill);
 }
 return {byId,children,roots:children.get(null)||[]};
}
export function descendantIds(forest,id) {
 const ids=new Set([id]),stack=[id];
 while(stack.length) for(const child of forest.children.get(stack.pop())||[]) {ids.add(child.id);stack.push(child.id);}
 return ids;
}
