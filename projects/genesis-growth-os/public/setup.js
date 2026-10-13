(async function () {
  const form = document.getElementById('setupForm');
  const errorEl = document.getElementById('errorMsg');
  let minLength = 10;
  let authorized = false;
  // 专属证明仅在当前页面内存；立即移除fragment，不写入存储、查询参数或日志。
  let setupToken = new URLSearchParams(window.location.hash.slice(1)).get('setup') || '';
  if (setupToken) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  const proofHeaders = () => setupToken ? {'X-Genesis-Setup-Token':setupToken} : {};
  const controls = form.querySelectorAll('input,button[type="submit"]');
  controls.forEach(el=>el.disabled=true);

  function showError(message) {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  }

  try {
    const res = await fetch('/api/setup/status',{headers:proofHeaders(),cache:'no-store'});
    if (!res.ok) throw Error('status');
    const status = await res.json();
    minLength = status.minLength || minLength;
    if (!status.setupRequired) { setupToken=''; window.location.href = '/login.html'; return; }
    authorized = !status.protectedSetup || status.setupAuthorized === true;
    if (!authorized) showError('首次设置需要专属初始化链接，请使用为你准备的链接打开此页。');
    else controls.forEach(el=>el.disabled=false);
  } catch (_) {
    showError('无法连接服务器，请联网后重试。');
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    if(!authorized)return showError('请先使用有效的专属初始化链接。');
    errorEl.style.display = 'none';
    const password = document.getElementById('password').value;
    const confirm = document.getElementById('confirmPassword').value;
    if (password !== confirm) return showError('两次密码输入不一致。');
    if (password.length < minLength) return showError(`密码至少需要 ${minLength} 个字符。`);

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = '正在保存…';
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...proofHeaders() },
        body: JSON.stringify({ password })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setupToken='';
        window.location.href = '/';
        return;
      }
      showError(data.error || data.message || '设置失败，请重试。');
      if(res.status===403||res.status===409){authorized=false;controls.forEach(el=>el.disabled=true);}
    } catch (_) {
      showError('无法连接服务器，请联网后重试。');
    } finally {
      btn.disabled = !authorized;
      btn.textContent = '完成设置';
    }
  };
})();
