#!/bin/bash
# 双击启动公网隧道（Terminal 窗口关闭即停）
cd "$(dirname "$0")"
exec ./start-tunnel.sh
