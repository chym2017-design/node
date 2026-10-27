// 暴露给页面的最小桌面桥接 API（contextIsolation 隔离）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('uddDesktop', {
  isDesktop: true,
  // 之后（管道转发 / open-file）推送过来的文件
  onOpenFile: (cb) => ipcRenderer.on('udd:open-file', (_e, filePath) => cb(filePath)),
  // 页面注册完 onOpenFile 监听后调用：主进程确认后才开始推送待打开文件
  notifyReady: () => ipcRenderer.send('udd:renderer-ready'),
  // 同步确认框（Electron 不支持 window.confirm）
  confirmSync: (message, detail) => ipcRenderer.sendSync('udd:confirm', { message, detail }),
  // 用户「文档」目录（仓库面板默认目录）
  getDocumentsDir: () => ipcRenderer.invoke('udd:get-documents-dir'),
  // 原生打开对话框（返回完整路径数组；网页版 showOpenFilePicker 拿不到路径）
  openFileDialog: () => ipcRenderer.invoke('udd:open-dialog'),
});
