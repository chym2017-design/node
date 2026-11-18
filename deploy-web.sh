#!/bin/bash
# 把网页版运行所需的文件同步到 ~/Library/Application Support/UDD-Web/app，
# 供 launchd 后台服务使用。
#
# 为什么需要这份副本：项目在非系统卷（/Volumes/...）上，launchd 启动的后台进程
# 没有该卷的 TCC 访问权限。部署到用户目录后服务可以正常开机自启。
# 更新代码后重新执行本脚本，再重启服务即可。
set -euo pipefail
cd "$(dirname "$0")"

DEST="$HOME/Library/Application Support/UDD-Web/app"
mkdir -p "$DEST"

rsync -a --delete \
  udd-app.html login.html account-ui.js files.html files.css files.js \
  css js \
  server.js accounts-lib.js accounts-admin.js space-lib.js \
  start-web.sh start-tunnel.sh \
  使用说明书.udd \
  "$DEST/"

chmod +x "$DEST/start-web.sh" "$DEST/start-tunnel.sh"
echo "[UDD] 已同步到: $DEST"
