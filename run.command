#!/bin/bash

cd "$(dirname "$0")" || exit 1

dashboard_port=5178
listening_pids="$(lsof -tiTCP:"$dashboard_port" -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$listening_pids" ]; then
  echo "正在停止占用分析中心端口 $dashboard_port 的旧进程: $listening_pids"
  for pid in $listening_pids; do
    kill "$pid" 2>/dev/null || true
  done

  # Give Node a moment to close its listener gracefully before escalating.
  for _ in {1..20}; do
    remaining_pids="$(lsof -tiTCP:"$dashboard_port" -sTCP:LISTEN 2>/dev/null || true)"
    [ -z "$remaining_pids" ] && break
    sleep 0.1
  done

  if [ -n "${remaining_pids:-}" ]; then
    echo "旧进程未及时退出，正在强制停止: $remaining_pids"
    for pid in $remaining_pids; do
      kill -9 "$pid" 2>/dev/null || true
    done
  fi
fi

node src/cli.js "$@"
EXIT_CODE=$?

if [ "$#" -gt 0 ]; then
  exit "$EXIT_CODE"
fi

echo
read -r -n 1 -s -p "Press any key to continue..."
echo
exit "$EXIT_CODE"
