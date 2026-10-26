# UDD 桌面版（Electron）

把 UDD 网页应用打包成 Windows 桌面软件：双击即可打开，双击 `.udd` 文件自动用本软件打开。

## 目录结构

```
desktop/
  main.js        Electron 主进程（内置服务器、单实例、.udd 文件打开、关联注册）
  preload.js     渲染进程桥接（contextBridge，暴露 window.uddDesktop）
  build-icon.js  生成应用图标（纯 Node，无依赖）→ build/icon.png + icon.ico
  edit-exe.js    打包后用 rcedit 给 UDD.exe 补图标/版本信息
  package.json   electron-builder 配置
  build/         图标产物
  releaseN/      打包产物（git 忽略）
```

## 开发调试

```bash
cd desktop
npm install          # 首次；npm 需用系统 npm（本机 ~/bin/npm 包装器已损坏）
npm start            # 开发模式运行
```

注意：本机构建需设镜像环境变量（已写入 dist 流程之外，手动构建时执行）：

```bash
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
```

## 打包

```bash
npm run dist
```

流程：`--win dir` 产出 win-unpacked → `edit-exe.js` 补图标 → `--prepackaged` 产出
`UDD Setup 1.0.0.exe`（NSIS 安装包）和 `UDD-Portable-1.0.0.exe`（免安装便携版）。

> 为什么绕开 electron-builder 内置的 exe 编辑/签名步骤？
> winCodeSign 缓存包含 macOS 符号链接，非管理员解压必失败（本机实测），
> 因此 `win.signAndEditExecutable: false` + 手动 rcedit。

## 实现要点

- **内置服务器**：主进程 fork 项目自带的 `server.js`（监听 127.0.0.1 随机空闲端口），
  页面从 `http://127.0.0.1:<port>/udd-app.html` 加载；媒体代理、filePath 直存、
  仓库面板全部开箱可用。
- **单实例 + .udd 转发**：不用 Electron 自带 requestSingleInstanceLock——Chromium
  的进程单例在 Windows 上无法序列化含中文的命令行（"Invalid format for start
  command"），双击中文文件名的 .udd 会把第二个实例挂死。改用命名管道
  `\\.\pipe\udd-desktop-singleton-<user>`，第二个实例把 .udd 路径以 UTF-8 JSON
  转发给首个实例后立即退出。
- **页面就绪握手**：页面 init() 注册完 `udd:open-file` 监听后调
  `window.uddDesktop.notifyReady()`，主进程确认后才推送待打开文件，
  避免冷启动时消息早于监听器注册而丢失。
- **.udd 文件关联**：打包版每次启动幂等检查/注册 HKCU 注册表（无需管理员，
  免 UAC）；「工具」菜单可手动注册/取消（取消后写 flag 文件，不再自动注册）。
  便携版用 `PORTABLE_EXECUTABLE_FILE`（原始 exe 路径）注册。
- **未保存关闭确认**：页面 beforeunload 在 Electron 里会静默拦截关闭，主进程
  close 事件里查询 `app.dirty`，dirty 时弹确认框，用 `destroy()` 绕过。

## 打开 .udd 的方式

- 资源管理器双击 .udd →（关联已注册）唤起本应用打开
- 应用已运行时再双击 → 第二实例转发路径给已有窗口并聚焦（不重复开窗）
- 命令行 `UDD.exe 文件.udd`
