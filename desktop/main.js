// ================================================================
//  UDD 桌面版 — Electron 主进程
//
//  职责：
//    1. 内置本地服务器（fork 项目自带的 server.js，监听 127.0.0.1 随机端口）
//    2. 创建窗口加载 http://127.0.0.1:<port>/udd-app.html
//    3. 双击 .udd 文件唤起本应用：启动参数 / second-instance / open-file
//       收集路径，推送给页面（app.openUddPath）
//    4. 「工具」菜单提供 .udd 文件关联注册/取消（HKCU，无需管理员）
//    5. 未保存关闭确认（绕过页面 beforeunload 的静默拦截）
// ================================================================
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const { fork } = require('child_process');

// ---- 路径：开发模式 desktop/.. 为项目根；打包后 web 资源在 resources/udd-web ----
const IS_PACKAGED = app.isPackaged;
// --hidden：无界面测试模式（配合 --remote-debugging-port 做自动化验证，不弹窗）
const HIDDEN_MODE = process.argv.includes('--hidden');
const WEB_ROOT = IS_PACKAGED
  ? path.join(process.resourcesPath, 'udd-web')
  : path.join(__dirname, '..');
const SERVER_PATH = path.join(WEB_ROOT, 'server.js');

let serverProc = null;
let serverPort = 0;
let mainWindow = null;
let allowClose = false;
let rendererReady = false;  // 页面注册完 udd:open-file 监听器后置 true
const pendingFiles = [];    // 待推送给页面的 .udd 路径

// ---- 单实例 + .udd 文件转发 ----
// 不用 Electron 自带的 requestSingleInstanceLock：Chromium 的进程单例在 Windows 上
// 无法序列化含中文的命令行（process_singleton_win "Invalid format for start command"），
// 双击中文文件名的 .udd 会把第二个实例挂死。这里用命名管道自实现，UTF-8 JSON 转发。
const SINGLETON_PIPE = process.platform === 'win32'
  ? '\\\\.\\pipe\\udd-desktop-singleton-' + (process.env.USERNAME || 'user')
  : path.join(app.getPath('userData'), 'singleton.sock');

function tryBindSingleton() {
  return new Promise(resolve => {
    const server = net.createServer(conn => {
      let buf = '';
      conn.on('data', d => {
        buf += d.toString('utf8');
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (!line) continue;
          try {
            const msg = JSON.parse(line);
            if (Array.isArray(msg.files)) msg.files.forEach(p => pendingFiles.push(p));
          } catch (e) { /* 忽略坏行 */ }
          flushPendingFiles();
          if (mainWindow && !HIDDEN_MODE) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
          }
          conn.write('UDD-OK\n');
        }
      });
    });
    server.once('error', () => resolve(false));
    server.listen(SINGLETON_PIPE, () => resolve(true));
  });
}

// 把 .udd 路径转发给已运行的第一个实例；成功返回 true
function forwardToFirstInstance(files) {
  return new Promise(resolve => {
    const sock = net.connect(SINGLETON_PIPE);
    const done = ok => { try { sock.destroy(); } catch (_) {} resolve(ok); };
    const timer = setTimeout(() => done(false), 3000);
    sock.on('error', () => { clearTimeout(timer); done(false); });
    sock.on('connect', () => {
      sock.write(JSON.stringify({ files }) + '\n');
    });
    sock.on('data', d => {
      if (d.toString('utf8').includes('UDD-OK')) {
        clearTimeout(timer);
        done(true);
      }
    });
  });
}

// 从命令行参数中挑出存在的 .udd 文件
function collectUddArgs(argv) {
  const out = [];
  for (const a of argv || []) {
    if (typeof a === 'string' && /\.udd$/i.test(a.trim()) && fs.existsSync(a.trim())) {
      out.push(path.resolve(a.trim()));
    }
  }
  return out;
}

// macOS：通过 Finder 双击文件打开
app.on('open-file', (e, filePath) => {
  e.preventDefault();
  if (/\.udd$/i.test(filePath)) {
    pendingFiles.push(path.resolve(filePath));
    flushPendingFiles();
  }
});

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function pollReady(port, tries = 0) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/api/root`, res => {
      res.resume();
      res.statusCode === 200 ? resolve(true) : retry();
    });
    req.on('error', retry);
    function retry() {
      if (tries >= 60) return reject(new Error('服务器启动超时'));
      setTimeout(() => pollReady(port, tries + 1).then(resolve, reject), 250);
    }
  });
}

async function startServer() {
  // 优先固定端口：localStorage / IndexedDB 按 origin（含端口）隔离，
  // 端口固定才能跨启动保留用户会话、设置和仓库目录。
  // 固定端口被占用时依次顺延，最后回退随机空闲端口（此时不保证持久化）。
  const PREFERRED = 47831;
  const tryPort = async (port) => {
    serverProc = fork(SERVER_PATH, [String(port), WEB_ROOT], {
      cwd: WEB_ROOT,
      stdio: 'pipe',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    const proc = serverProc;
    proc.stdout && proc.stdout.on('data', () => {});
    proc.stderr && proc.stderr.on('data', () => {});
    // 端口被占用时 server.js 会因 EADDRINUSE 立即退出：早失败，别干等 15 秒
    const exited = new Promise((_, rej) => proc.once('exit', code => rej(new Error('server exited: ' + code))));
    await Promise.race([pollReady(port), exited]);
    serverPort = port;
    return port;
  };
  for (const port of [PREFERRED, PREFERRED + 1, PREFERRED + 2]) {
    try { return await tryPort(port); } catch (e) { try { serverProc.kill(); } catch (_) {} }
  }
  for (let i = 0; i < 3; i++) {
    try { return await tryPort(await getFreePort()); } catch (e) { try { serverProc.kill(); } catch (_) {} }
  }
  throw new Error('服务器启动失败');
}

function flushPendingFiles() {
  if (!mainWindow || !rendererReady || !pendingFiles.length) return;
  const files = pendingFiles.splice(0);
  for (const p of files) {
    mainWindow.webContents.send('udd:open-file', p);
  }
}

function createWindow() {
  const iconPath = path.join(__dirname, 'build', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: !HIDDEN_MODE,
    title: 'UDD - 统一数据展示系统',
    // 打包版 exe 已内嵌图标（rcedit），无需额外传；开发模式用 build/icon.png
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: HIDDEN_MODE ? false : true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAutoHideMenuBar(true);
  mainWindow.loadURL(`http://127.0.0.1:${serverPort}/udd-app.html`);

  // 页面（重）加载期间监听器必然失效，等待页面主动发来就绪握手再推送文件
  mainWindow.webContents.on('did-start-loading', () => { rendererReady = false; });

  // 只允许本应用内置服务器内的导航；外部链接交给系统浏览器
  mainWindow.webContents.on('will-navigate', e => {
    if (!e.url.startsWith(`http://127.0.0.1:${serverPort}`)) e.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1:')) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 页面对 dirty 状态挂了 beforeunload（会静默拦截关闭），
  // 这里查询 app.dirty 后用 destroy() 关闭，dirty 时弹确认框。
  mainWindow.on('close', e => {
    if (allowClose || mainWindow.isDestroyed()) return;
    e.preventDefault();
    Promise.resolve(mainWindow.webContents.executeJavaScript('!!(window.app && window.app.dirty)', true))
      .then(dirty => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (!dirty) { mainWindow.destroy(); return; }
        const choice = dialog.showMessageBoxSync(mainWindow, {
          type: 'warning',
          buttons: ['放弃更改并退出', '取消'],
          defaultId: 1,
          cancelId: 1,
          message: '有未保存的更改',
          detail: '当前文档有未保存的修改，退出将丢失这些更改。',
        });
        if (choice === 0) mainWindow.destroy();
      })
      .catch(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy(); });
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ---- .udd 文件关联（HKCU 注册表，无需管理员） ----
function runReg(args) {
  return new Promise(resolve => {
    const { spawn } = require('child_process');
    const p = spawn('reg', args, { windowsHide: true });
    let code = -1;
    p.on('error', () => resolve(false));
    p.on('close', c => { code = c; resolve(code === 0); });
  });
}

function regQueryValue(key) {
  return new Promise(resolve => {
    const { spawn } = require('child_process');
    const p = spawn('reg', ['query', key, '/ve'], { windowsHide: true });
    let out = '';
    p.stdout.on('data', d => out += d);
    p.on('error', () => resolve(null));
    p.on('close', () => {
      const m = /REG_SZ\s+(.*)/.exec(out);
      resolve(m ? m[1].trim() : null);
    });
  });
}

// 关联指向的 exe：electron-builder 便携版的 execPath 是临时解压目录，
// 用 PORTABLE_EXECUTABLE_FILE（原始 exe 路径）注册才能稳定生效
function getAssocExe() {
  if (process.env.PORTABLE_EXECUTABLE_FILE && fs.existsSync(process.env.PORTABLE_EXECUTABLE_FILE)) {
    return process.env.PORTABLE_EXECUTABLE_FILE;
  }
  return process.execPath;
}

function assocDisabledFlag() {
  return path.join(app.getPath('userData'), 'udd-assoc-disabled.flag');
}

async function writeUddAssocReg(exe) {
  let ok = true;
  ok = await runReg(['add', 'HKCU\\Software\\Classes\\.udd', '/ve', '/t', 'REG_SZ', '/d', 'UDD.Document', '/f']) && ok;
  ok = await runReg(['add', 'HKCU\\Software\\Classes\\UDD.Document', '/ve', '/t', 'REG_SZ', '/d', 'UDD 统一数据文档', '/f']) && ok;
  ok = await runReg(['add', 'HKCU\\Software\\Classes\\UDD.Document\\DefaultIcon', '/ve', '/t', 'REG_SZ', '/d', `"${exe}",0`, '/f']) && ok;
  ok = await runReg(['add', 'HKCU\\Software\\Classes\\UDD.Document\\shell\\open\\command', '/ve', '/t', 'REG_SZ', '/d', `"${exe}" "%1"`, '/f']) && ok;
  await runReg(['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.udd\\OpenWithProgids', '/ve', '/t', 'REG_SZ', '/d', 'UDD.Document', '/f']);
  return ok;
}

// 启动时自动确保 .udd 关联指向本程序（打包版 + Windows + 未被用户显式取消时）。
// 幂等：注册表已指向当前 exe 则什么都不做。
async function ensureUddAssociationOnStartup() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  if (fs.existsSync(assocDisabledFlag())) return;
  try {
    const exe = getAssocExe();
    const expect = `"${exe}" "%1"`;
    const current = await regQueryValue('HKCU\\Software\\Classes\\UDD.Document\\shell\\open\\command');
    if (current === expect) return;
    await writeUddAssocReg(exe);
  } catch (e) { /* 关联失败不影响应用使用 */ }
}

async function setUddAssociation(register) {
  if (process.platform !== 'win32') {
    dialog.showMessageBox({ type: 'info', message: '文件关联目前仅支持 Windows。' });
    return;
  }
  let ok;
  if (register) {
    try { fs.rmSync(assocDisabledFlag(), { force: true }); } catch (_) {}
    ok = await writeUddAssocReg(getAssocExe());
  } else {
    try { fs.writeFileSync(assocDisabledFlag(), '1'); } catch (_) {}
    ok = await runReg(['delete', 'HKCU\\Software\\Classes\\.udd', '/f']);
    ok = await runReg(['delete', 'HKCU\\Software\\Classes\\UDD.Document', '/f']) && ok;
    await runReg(['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.udd', '/f']);
  }
  dialog.showMessageBox({
    type: ok ? 'info' : 'error',
    message: ok
      ? (register ? '已注册 .udd 文件关联，双击 .udd 文件即可用 UDD 打开。' : '已取消 .udd 文件关联。')
      : '注册表操作失败，请重试。',
  });
}

function buildMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: '文件',
      submenu: [
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'forceReload', label: '强制刷新' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '工具',
      submenu: [
        { label: '关联 .udd 文件（用 UDD 打开）', click: () => setUddAssociation(true) },
        { label: '取消 .udd 文件关联', click: () => setUddAssociation(false) },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 UDD',
          click: () => dialog.showMessageBox({
            type: 'info',
            title: '关于 UDD',
            message: 'UDD - 统一数据展示系统',
            detail: '一份数据，多种展示。\n桌面版 ' + app.getVersion() + '\nElectron ' + process.versions.electron,
          }),
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

// 页面注册完 udd:open-file 监听器后发来握手，此后主进程才推送待打开文件
ipcMain.on('udd:renderer-ready', () => {
  rendererReady = true;
  flushPendingFiles();
});

// 同步确认框：Electron 渲染进程不支持 window.confirm，改用系统对话框
ipcMain.on('udd:confirm', (e, payload) => {
  const opts = {
    type: 'warning',
    buttons: ['确定', '取消'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    message: (payload && payload.message) || '确认操作？',
    detail: (payload && payload.detail) || '',
  };
  try {
    const r = (mainWindow && !mainWindow.isDestroyed())
      ? dialog.showMessageBoxSync(mainWindow, opts)
      : dialog.showMessageBoxSync(opts);
    e.returnValue = r === 0;
  } catch (err) {
    e.returnValue = false;
  }
});

// 仓库面板默认目录：用户「文档」目录
ipcMain.handle('udd:get-documents-dir', () => {
  try { return app.getPath('documents'); } catch (e) { return ''; }
});

// 原生「打开」对话框：返回选中的完整路径（多选）
ipcMain.handle('udd:open-dialog', async () => {
  const opts = {
    title: '打开 UDD 文档',
    filters: [
      { name: 'UDD 文档', extensions: ['udd', 'json'] },
      { name: '所有文件', extensions: ['*'] },
    ],
    properties: ['openFile', 'multiSelections'],
  };
  const r = (mainWindow && !mainWindow.isDestroyed())
    ? await dialog.showOpenDialog(mainWindow, opts)
    : await dialog.showOpenDialog(opts);
  return r.canceled ? [] : r.filePaths;
});

// ---- 启动流程：先抢单实例管道（抢不到就把 .udd 转发给已有实例后退出） ----
(async function bootstrap() {
  const files = collectUddArgs(process.argv);
  const isFirst = await tryBindSingleton();
  if (!isFirst) {
    const sent = await forwardToFirstInstance(files);
    if (sent) { app.exit(0); return; }
    // 管道被占但握手失败（残留实例已死或外部进程占用）：再抢一次
    const retry = await tryBindSingleton();
    if (!retry) { app.exit(1); return; }
  }
  await app.whenReady();
  try {
    await startServer();
  } catch (e) {
    dialog.showErrorBox('服务器启动失败', String(e && e.message || e));
    app.quit();
    return;
  }
  pendingFiles.push(...files);
  buildMenu();
  createWindow();
  // 确保双击 .udd 时用本应用打开（幂等，仅打包版）
  ensureUddAssociationOnStartup();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
})();

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (serverProc) {
    try { serverProc.kill(); } catch (_) {}
    serverProc = null;
  }
});
