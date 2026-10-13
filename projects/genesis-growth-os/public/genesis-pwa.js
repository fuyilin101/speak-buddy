/** 安装支持独立于业务模块；不读取账号、资料或行动记录。 */
(() => {
 const button=document.getElementById('genesisInstall'),status=document.getElementById('genesisPwaStatus');
 let installPrompt=null,installed=false;
 const mode=window.matchMedia('(display-mode: standalone)');
 const standalone=()=>mode.matches||navigator.standalone===true;
 function update() {
  if(button)button.hidden=standalone()||installed||!installPrompt;
  if(!status)return;
  if(standalone())status.textContent='当前以独立应用窗口运行。';
  else if(installed)status.textContent='Genesis 已安装，可从设备桌面打开。';
  else if(installPrompt)status.textContent='此浏览器支持安装 Genesis 到桌面。';
  else status.textContent='Android：浏览器菜单中选择安装应用。iPhone：Safari 分享 → 添加到主屏幕；如有“作为 Web App 打开”，请开启。';
 }
 window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;update();});
 window.addEventListener('appinstalled',()=>{installed=true;installPrompt=null;update();});
 mode.addEventListener?.('change',update);
 button?.addEventListener('click',async()=>{
  if(!installPrompt)return;button.disabled=true;const prompt=installPrompt;
  try {await prompt.prompt();const choice=await prompt.userChoice;installPrompt=null;update();if(choice.outcome==='accepted'&&status)status.textContent='系统已接受安装请求，请从桌面打开 Genesis 确认。';}
  catch {if(status)status.textContent='安装请求未确认，请从浏览器菜单重试。';}
  finally {button.disabled=false;}
 });
 update();
 if('serviceWorker' in navigator&&window.isSecureContext)window.addEventListener('load',()=>{
  navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).catch(()=>{
   if(status)status.textContent='离线资源暂时未准备成功，网页仍可正常使用。';
   console.warn('Genesis 静态资源准备失败，请联网刷新。');
  });
 });
})();
