// 暴露给页面的最小桌面桥接 API（contextIsolation 隔离）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('uddDesktop', {
  isDesktop: true,
  // 之后（管道转发 / open-file）推送过来的文件
  onOpenFile: (cb) => ipcRenderer.on('udd:open-file', (_e, filePath) => cb(filePath)),
  // 页面注册完 onOpenFile 监听后调用：主进程确认后才开始推送待打开文件
  notifyReady: () => ipcRenderer.send('udd:renderer-ready'),
});
