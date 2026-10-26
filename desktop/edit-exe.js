// ================================================================
//  用 rcedit 给 win-unpacked/UDD.exe 补图标与版本信息。
//
//  背景：winCodeSign 缓存包里有 macOS 符号链接，非管理员解压必失败，
//  因此打包配置 signAndEditExecutable:false 跳过 electron-builder 的
//  内置 rcedit 步骤，由本脚本在 dir 构建之后手动执行一次。
// ================================================================
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pkg = require('./package.json');
const outDir = path.join(__dirname, (pkg.build && pkg.build.directories && pkg.build.directories.output) || 'release');
const exePath = path.join(outDir, 'win-unpacked', (pkg.build.productName || pkg.name) + '.exe');
const iconPath = path.join(__dirname, 'build', 'icon.ico');
const version = pkg.version || '1.0.0';

function findRcedit() {
  // 1) electron-builder 缓存里找（多个 hash 目录任一即可）
  const cacheRoot = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign');
  if (fs.existsSync(cacheRoot)) {
    for (const d of fs.readdirSync(cacheRoot)) {
      const p = path.join(cacheRoot, d, 'rcedit-x64.exe');
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

const rcedit = findRcedit();
if (!rcedit) {
  console.error('未找到 rcedit-x64.exe（electron-builder winCodeSign 缓存缺失）');
  process.exit(1);
}
if (!fs.existsSync(exePath)) {
  console.error('未找到 ' + exePath + '，请先执行 electron-builder --win dir');
  process.exit(1);
}

const ver = version + '.0';
const args = [
  exePath,
  '--set-icon', iconPath,
  '--set-version-string', 'ProductName', 'UDD - 统一数据展示系统',
  '--set-version-string', 'FileDescription', 'UDD - 统一数据展示系统',
  '--set-version-string', 'CompanyName', 'UDD',
  '--set-version-string', 'LegalCopyright', 'Copyright © UDD',
  '--set-version-string', 'OriginalFilename', path.basename(exePath),
  '--set-file-version', ver,
  '--set-product-version', ver,
];
execFileSync(rcedit, args, { stdio: 'inherit' });
console.log('OK: 已为 ' + exePath + ' 设置图标与版本信息');
