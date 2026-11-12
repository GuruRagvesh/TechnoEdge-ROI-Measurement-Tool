#!/usr/bin/env bash
# Start the Graph simulator and N production-build app instances that talk to it.
#   loadtest/stack.sh <app-dir-with-.next-app> <instances> <log-dir>
# Stop with: loadtest/stack.sh stop
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BASE_PORT="${BASE_PORT:-4700}"
export SIM_PORT="${SIM_PORT:-4600}"
PIDS="/tmp/loadtest-stack-$BASE_PORT.pids"
stop_all() {
  # Next.js renames its process to "next-server", so match that title too,
  # and kill recorded PIDs; then confirm the ports are free.
  [ -f "$PIDS" ] && xargs -r kill < "$PIDS" 2>/dev/null || true
  rm -f "$PIDS"
  if [ "${STOP_EVERYTHING:-0}" = 1 ]; then
    pkill -f "loadtest/graph-sim.mjs" || true
    pkill -f "next-server" || true
    pkill -f "standalone/server.js" || true
  fi
  for t in $(seq 1 20); do
    busy=0
    for port in $SIM_PORT $((BASE_PORT + 1)) $((BASE_PORT + 2)) $((BASE_PORT + 3)); do
      curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$port/" && busy=1
    done
    [ "$busy" = 0 ] && return 0
    sleep 1
  done
  echo "ports still busy after stop" >&2
  return 1
}
if [ "${1:-}" = "stop" ]; then
  stop_all
  exit $?
fi
APP="$1"; N="${2:-3}"; LOGS="${3:-/tmp/loadtest-logs}"
mkdir -p "$LOGS"
stop_all
export GRAPH_TENANT_ID=00000000-0000-0000-0000-000000000000
export GRAPH_CLIENT_ID=00000000-0000-0000-0000-000000000001
export GRAPH_CLIENT_SECRET=simulated-not-a-secret
export GRAPH_SITE_ID="sim.sharepoint.com,00000000-0000-0000-0000-000000000002,00000000-0000-0000-0000-000000000003"
export GRAPH_SITE_URL="https://sim.sharepoint.com/sites/LoadTest"
export GRAPH_DRIVE_ID="sim-drive"
export GRAPH_STORAGE_ROOT="LoadTest"
export GRAPH_LAYOUT="cohorts-v1"
node "$HERE/graph-sim.mjs" > "$LOGS/sim.log" 2>&1 &
echo $! >> "$PIDS"
sleep 1
for i in $(seq 1 "$N"); do
  PORT=$((BASE_PORT + i)) HOSTNAME=127.0.0.1 NODE_ENV=production \
  NODE_OPTIONS="--require $HERE/sim-fetch.cjs" \
  APP_URL="https://loadtest.example" STORAGE_ADAPTER=graph \
  MAIL_PROVIDER=resend RESEND_API_KEY=simulated EMAIL_FROM="TechnoEdge <noreply@loadtest.example>" \
  IDENTITY_PEPPER="load-$(printf '%040d' 7)-pepper-for-isolated-runs" \
  LOCAL_TEST_ACCOUNTS=false MOCK_AUTH=false ASSESSMENT_MODE=single \
  OTP_IP_HOURLY_LIMIT=1000000 EMAIL_HOURLY_LIMIT=1000000 \
  node "$APP/.next-app/standalone/server.js" > "$LOGS/app-$i.log" 2>&1 &
  echo $! >> "$PIDS"
done
# Every instance must be serving this exact build.
BUILD="$(cat "$APP/.next-app/BUILD_ID")"
for i in $(seq 1 "$N"); do
  ok=0
  for t in $(seq 1 60); do
    if curl -s --max-time 5 "http://127.0.0.1:$((BASE_PORT + i))/login" | grep -q "$BUILD"; then ok=1; break; fi
    sleep 1
  done
  if [ "$ok" != 1 ]; then echo "instance $i is not serving build $BUILD" >&2; exit 1; fi
done
echo "stack up: sim :$SIM_PORT, $N instances on $((BASE_PORT + 1))+ serving build $BUILD from $APP"
