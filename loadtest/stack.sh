#!/usr/bin/env bash
# Start the Graph simulator and N production-build app instances that talk to it.
#   loadtest/stack.sh <app-dir-with-.next-app> <instances> <log-dir>
# Stop with: loadtest/stack.sh stop
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ "${1:-}" = "stop" ]; then
  pkill -f "loadtest/graph-sim.mjs" || true
  pkill -f "standalone/server.js" || true
  exit 0
fi
APP="$1"; N="${2:-3}"; LOGS="${3:-/tmp/loadtest-logs}"
mkdir -p "$LOGS"
export SIM_PORT="${SIM_PORT:-4600}"
export GRAPH_TENANT_ID=00000000-0000-0000-0000-000000000000
export GRAPH_CLIENT_ID=00000000-0000-0000-0000-000000000001
export GRAPH_CLIENT_SECRET=simulated-not-a-secret
export GRAPH_SITE_ID="sim.sharepoint.com,00000000-0000-0000-0000-000000000002,00000000-0000-0000-0000-000000000003"
export GRAPH_SITE_URL="https://sim.sharepoint.com/sites/LoadTest"
export GRAPH_DRIVE_ID="sim-drive"
export GRAPH_STORAGE_ROOT="LoadTest"
export GRAPH_LAYOUT="cohorts-v1"
node "$HERE/graph-sim.mjs" > "$LOGS/sim.log" 2>&1 &
sleep 1
for i in $(seq 1 "$N"); do
  PORT=$((4700 + i)) HOSTNAME=127.0.0.1 NODE_ENV=production \
  NODE_OPTIONS="--require $HERE/sim-fetch.cjs" \
  APP_URL="https://loadtest.example" STORAGE_ADAPTER=graph \
  MAIL_PROVIDER=resend RESEND_API_KEY=simulated EMAIL_FROM="TechnoEdge <noreply@loadtest.example>" \
  IDENTITY_PEPPER="load-$(printf '%040d' 7)-pepper-for-isolated-runs" \
  LOCAL_TEST_ACCOUNTS=false MOCK_AUTH=false ASSESSMENT_MODE=single \
  OTP_IP_HOURLY_LIMIT=1000000 EMAIL_HOURLY_LIMIT=1000000 \
  node "$APP/.next-app/standalone/server.js" > "$LOGS/app-$i.log" 2>&1 &
done
for i in $(seq 1 "$N"); do
  for t in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:$((4700 + i))/api/health" && break; sleep 1; done
done
echo "stack up: sim :$SIM_PORT, $N instances from $APP"
