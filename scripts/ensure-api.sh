#!/usr/bin/env bash
set -euo pipefail
PORT=${PORT:-4000}
HEALTH="http://127.0.0.1:${PORT}/health"
PIDFILE=".run/api.pid"
LOGDIR=".logs"; mkdir -p "$LOGDIR" ".run"
if curl -fsS "$HEALTH" >/dev/null 2>&1; then echo "API already running on :$PORT"; exit 0; fi
if [[ -f "$PIDFILE" ]] && ! ps -p "$(cat "$PIDFILE")" >/dev/null 2>&1; then rm -f "$PIDFILE"; fi
( nohup pnpm dev:api > "$LOGDIR/api.out" 2> "$LOGDIR/api.err" & echo $! > "$PIDFILE" )
for i in {1..60}; do
if curl -fsS "$HEALTH" >/dev/null 2>&1; then echo "API ready"; exit 0; fi
sleep 0.5
done
echo "API failed to become ready"; exit 1