#!/usr/bin/env bash
# Restart the Oracle API server.
# Usage: bash restart.sh

PORT=3000

# Kill whatever is listening on the port.
PID=$(netstat -ano 2>/dev/null | grep " 0\.0\.0\.0:${PORT} \| \[::]:${PORT} " | awk '{print $5}' | head -1)
if [ -n "$PID" ] && [ "$PID" -gt 0 ] 2>/dev/null; then
  echo "Killing PID $PID on port $PORT..."
  powershell.exe -Command "Stop-Process -Id $PID -Force" 2>/dev/null
  sleep 1
fi

echo "Starting Oracle API..."
node api/server.js &
sleep 2
curl -s http://localhost:${PORT}/health && echo ""
