#!/bin/bash
# 启动 Cloudflare 快速隧道，把本机 UDD 网页版发布到公网。
# 注意：快速隧道的域名每次重启都会变；最新地址会写入
#   ~/Library/Logs/UDD/远程访问地址.txt
#   ~/Library/Logs/UDD/tunnel.log
# 如需固定域名，请登录 Cloudflare 后使用命名隧道（cloudflared tunnel login）。
set -uo pipefail
cd "$(dirname "$0")"

PORT="${UDD_PORT:-8080}"
LOG_DIR="$HOME/Library/Logs/UDD"
URL_FILE="$LOG_DIR/远程访问地址.txt"
mkdir -p "$LOG_DIR"

echo "[UDD] 启动隧道 → http://127.0.0.1:$PORT"

# 强制 http2：部分代理/网络环境下 QUIC(UDP 7844) 会被拦截
cloudflared tunnel --no-autoupdate --protocol http2 \
  --url "http://127.0.0.1:$PORT" 2>&1 | while IFS= read -r line; do
    printf '%s\n' "$line" >> "$LOG_DIR/tunnel.log"
    url="$(printf '%s' "$line" | grep -oE 'https://[A-Za-z0-9.-]+\.trycloudflare\.com' | head -1 || true)"
    if [ -n "$url" ]; then
      printf '%s\n' "$url" > "$URL_FILE"
      printf '[UDD] 远程地址: %s\n' "$url" >> "$LOG_DIR/tunnel.log"
    fi
  done
