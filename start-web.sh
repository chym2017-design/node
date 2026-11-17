#!/bin/bash
# UDD 网页版启动脚本（多账号模式）
#
# 默认行为：
#   - 监听 0.0.0.0:8080，局域网内其他设备可访问
#   - 数据目录 ~/UDD-Data（可用 UDD_DATA_ROOT 覆盖）
#     accounts.json 存账号/邀请码；users/<用户名>/ 是每个账号的独立空间
#   - 前台 /login 注册、登录；注册需要邀请码
#   - 强制沙箱：每个账号只能访问自己的目录
#
# 首次启动会自动生成一个邀请码，打印在日志里（也见 ~/Library/Logs/UDD/web.log）。
# 后续邀请码用：node accounts-admin.js invite
#
# 可选环境变量：UDD_PORT、UDD_HOST、UDD_DATA_ROOT、UDD_INVITE_CODES
set -euo pipefail
cd "$(dirname "$0")"

ROOT="${UDD_DATA_ROOT:-$HOME/UDD-Data}"
PORT="${UDD_PORT:-8080}"

mkdir -p "$ROOT"

export UDD_HOST="${UDD_HOST:-0.0.0.0}"
export UDD_PORT="$PORT"
export UDD_DATA_ROOT="$ROOT"
export UDD_MULTIUSER=1

echo "[UDD] 多账号模式    数据目录: $ROOT"
echo "[UDD] 监听: $UDD_HOST:$UDD_PORT    登录页: /login"

exec node server.js
