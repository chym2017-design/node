UDD - 统一数据展示系统
=======================

文件结构说明
-----------

udd-app.html        主入口 HTML，包含页面结构和脚本引用
server.js            本地 Node.js 服务器，提供文件系统 API（读写文件、目录浏览）

css/
  udd-styles.css     全部 CSS 样式（布局、大纲、文档、思维导图、仓库、媒体等）

js/
  udd-data.js        数据基础：压缩/解压（ESCAPE_TABLE）、样式字段定义、
                     范围样式系统、树结构工具函数（getLevel, isTNode 等）
  udd-ref.js         引用系统：引用解析（parseRef, resolveRef）、跨文档引用、
                     节点渲染描述符、共享 UI 组件（body 按钮、折叠开关、
                     缩进/反缩进、拖拽移动）、调色板数据
  udd-media.js       媒体渲染：媒体标签解析、图片/视频/音频渲染、
                     灯箱预览、拖拽缩放、属性编辑器
  udd-file.js        文件与存储：默认数据、IndexedDB 持久化、撤销管理器、
                     提示消息、UDD 文件格式（ZIP 压缩/解压）
  udd-outline.js     大纲视图：OutlineView 类，树形编辑、拖拽排序、
                     引用显示、媒体渲染、键盘导航
  udd-document.js    文档视图：DocumentView 类，分页式文档渲染、
                     标题层级、正文、引用克隆、内联编辑
  udd-mindmap.js     思维导图视图：MindmapView 类，多种布局（向右/双向/组织架构）、
                     连线样式、配色方案、缩放平移、导出 PNG/SVG
  xlsx.min.js         SheetJS 库（本地离线），来源 https://cdn.sheetjs.com/xlsx-0.20.3/
                     作用：读写 xlsx 格式，Excel 兼容复制粘贴
  udd-sheet.js       表格视图：SheetView 类，网格渲染、单元格编辑、选区、
                     Excel 兼容复制粘贴、下拉填充、多 Sheet tab 管理、
                     UDD 引用（=t1-1.content）、SheetJS workbook 交互
  udd-app.js         应用控制器：App 类（多文档会话管理、工具栏、侧边栏、
                     仓库面板、文件操作、快捷键）、PWA 清单、启动初始化

脚本加载顺序（有依赖关系）
  1. js/jszip.min.js（本地文件，已下载，无需联网）
     来源：https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js
     作用：读写 .udd 文件（ZIP 格式压缩包）
  2. udd-data.js
  3. udd-ref.js（依赖 udd-data.js）
  4. udd-media.js（依赖 udd-data.js）
  5. udd-file.js（依赖 udd-data.js）
  6. udd-outline.js（依赖 udd-data/ref/media）
  7. udd-document.js（依赖 udd-data/ref/media）
  8. udd-mindmap.js（依赖 udd-data/ref/media）
  9. xlsx.min.js（SheetJS 库，本地，表格视图 Excel 兼容）
 10. udd-sheet.js（依赖 xlsx.min.js、udd-ref.js）
 11. udd-app.js（依赖以上全部）

启动方式
  node server.js [端口] [根目录]
  默认端口 8080，默认根目录为 server.js 所在目录
  浏览器打开 http://localhost:8080
