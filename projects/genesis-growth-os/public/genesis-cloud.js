/** 读取只读摘要。页面刷新和导航只发送 GET，绝不调用 Forge 奖励函数。 */
async function getJson(path) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try {
  const response = await fetch(path, { method: 'GET', cache: 'no-store', signal:controller.signal });
  if (response.status === 401) { location.href='/login.html'; throw new Error('请先登录。'); }
  if (response.status === 428) { location.href='/setup.html'; throw new Error('请先完成本地密码设置。'); }
  const data = await response.json().catch(() => { throw Object.assign(new Error('服务器返回了无法解析的数据。'),{status:response.status}); });
  if (!response.ok) throw Object.assign(new Error(data.error || `读取失败（${response.status}）`),{status:response.status});
  return data;
  } catch(error) {if(error.name==='AbortError')throw new Error('读取超时，请重试。');if(error.name==='TypeError')throw new Error('网络暂时不可用，请重试。');throw error;}
  finally {clearTimeout(timer);}
}
export async function readGrowthHome() {
  const [home, vault] = await Promise.all([getJson('/api/genesis/home'), getJson('/api/genesis/dashboard')]);
  if(home.readonly!==true || !home.identity || !home.training || !Array.isArray(home.capabilities)) throw new Error('首页数据结构不完整，不能显示为已同步。');
  return { home, vault };
}

const cockpitPaths={home:'/api/genesis/home',skills:'/api/genesis/skills',vault:'/api/genesis/dashboard'};
/** 每个结果独立交给展示层，某个接口缓慢或失败不挡住其他区域。 */
export async function readCockpitSection(section) {
  if(!Object.hasOwn(cockpitPaths,section))throw Error('未知首页区域。');
  try {
    const value=await getJson(cockpitPaths[section]);
    const valid=section==='home'?value.readonly===true&&value.identity&&value.training&&Array.isArray(value.capabilities):section==='skills'?value.available===true&&Array.isArray(value.skills)&&Array.isArray(value.links)&&value.options:Array.isArray(value.projects)&&Array.isArray(value.assets)&&Array.isArray(value.growthRecords)&&value.summary;
    if(!valid)throw Error('区域数据结构不完整，请重试。');
    return {value,error:null,unavailable:false};
  } catch(error) {
    if(section==='skills'&&error.status===404)return {value:null,error:null,unavailable:true};
    return {value:null,error:error.message,unavailable:false};
  }
}
export async function readCockpit(onResult=()=>{}) {
  const pairs=await Promise.all(Object.keys(cockpitPaths).map(async section=>{
    const result=await readCockpitSection(section);await onResult(section,result);return [section,result];
  }));
  return Object.fromEntries(pairs);
}
