// ================================================================
//  UDD 网页版账号浮层
//  仅在多用户模式、已登录的 udd-app.html 中注入。
//  职责：显示当前账号、退出登录、发现会话被切换/过期时回到登录页。
// ================================================================
(function () {
  if (window.__UDD_ACCOUNT_UI__) return;
  window.__UDD_ACCOUNT_UI__ = true;

  var user = window.__UDD_ACCOUNT_USER__ || '';

  function loginUrl() {
    var next = location.pathname + location.search;
    return '/login?next=' + encodeURIComponent(next);
  }

  function deleteDb(name) {
    return new Promise(function (resolve) {
      var done = false;
      function finish() { if (!done) { done = true; resolve(); } }
      try {
        var req = indexedDB.deleteDatabase(name);
        req.onsuccess = finish;
        req.onerror = finish;
        req.onblocked = function () { setTimeout(finish, 1200); };
      } catch (e) { finish(); }
    });
  }

  async function clearSiteData() {
    try {
      if (indexedDB.databases) {
        var dbs = await indexedDB.databases();
        for (var i = 0; i < dbs.length; i++) {
          if (dbs[i] && dbs[i].name) await deleteDb(dbs[i].name);
        }
      } else {
        await deleteDb('udd-db');
      }
    } catch (e) { /* ignore */ }
    try { localStorage.clear(); } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}
  }

  async function checkAuth() {
    try {
      var r = await fetch('/api/auth/me', { cache: 'no-store' });
      if (!r.ok) { location.href = loginUrl(); return; }
      var j = await r.json();
      if (j.user && j.user !== user) {
        // 同一浏览器另一个标签页换了账号：清掉旧账号的本地缓存再重载
        await clearSiteData();
        try { localStorage.setItem('udd_last_user', j.user); } catch (e) {}
        location.reload();
      }
    } catch (e) { /* 网络抖动时忽略 */ }
  }

  function logout() {
    var btn = document.getElementById('udd-account-logout');
    if (btn) { btn.disabled = true; btn.textContent = '退出中…'; }
    fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .catch(function () {})
      .then(function () { location.href = '/login'; });
  }

  function mount() {
    if (document.getElementById('udd-account-chip')) return;

    var style = document.createElement('style');
    style.textContent = [
      '#udd-account-chip{display:flex;align-items:center;gap:8px;margin-left:auto;font-size:12px;line-height:1.4;font-family:inherit;color:#64748b;user-select:none}',
      '#udd-account-name{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#udd-account-logout{border:0;background:transparent;color:#2563eb;border-radius:6px;padding:1px 4px;',
      'font:inherit;font-weight:600;cursor:pointer}',
      '#udd-account-logout:hover{background:#eff6ff}',
      '#udd-account-logout:disabled{opacity:.6;cursor:default}',
      // 没有状态栏时（未来改版）退回到固定左下角浮层
      '#udd-account-chip.udd-floating{position:fixed;left:14px;bottom:14px;z-index:9002;margin:0;padding:5px 6px 5px 11px;',
      'border-radius:999px;background:rgba(255,255,255,.94);border:1px solid rgba(226,232,240,.95);',
      'box-shadow:0 6px 20px rgba(15,23,42,.14);opacity:.55;transition:opacity .15s;backdrop-filter:saturate(160%) blur(6px)}',
      '#udd-account-chip.udd-floating:hover{opacity:1}',
      '#udd-account-chip.udd-floating #udd-account-logout{background:#eff6ff;border-radius:999px;padding:4px 10px}',
    ].join('');
    document.head.appendChild(style);

    var chip = document.createElement('span');
    chip.id = 'udd-account-chip';

    var sep = document.createElement('span');
    sep.className = 'sep';
    chip.appendChild(sep);

    var name = document.createElement('span');
    name.id = 'udd-account-name';
    name.textContent = '账号：' + user;
    chip.appendChild(name);

    var btn = document.createElement('button');
    btn.id = 'udd-account-logout';
    btn.type = 'button';
    btn.textContent = '退出';
    btn.addEventListener('click', logout);
    chip.appendChild(btn);

    var bar = document.getElementById('status-bar');
    if (bar) {
      bar.appendChild(chip);
    } else {
      chip.className = 'udd-floating';
      document.body.appendChild(chip);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  checkAuth();
  setInterval(checkAuth, 20000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) checkAuth();
  });
  window.addEventListener('focus', checkAuth);

  try {
    var bc = new BroadcastChannel('udd-auth');
    bc.onmessage = function (ev) {
      if (ev && ev.data && ev.data.type === 'login' && ev.data.user !== user) checkAuth();
    };
  } catch (e) { /* ignore */ }
})();
