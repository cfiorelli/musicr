#!/usr/bin/env bash
set -euo pipefail
PIDFILE=".run/api.pid"
if [[ -f "$PIDFILE" ]]; then kill "$(cat "$PIDFILE")" || true; rm -f "$PIDFILE"; echo "API stopped"; else echo "No PID file; nothing to stop"; fi