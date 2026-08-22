#!/usr/bin/env bash
# §26 — careful mainnet deploy: wait until nobody is using the platform, switch on the
# "Short maintenance mode" page, build + restart + smoke-test, then let users back in.
# Rebuild the changed source FIRST (rsync from your machine), then run this.
#
#   deploy-guard.sh <instance-dir> [scope] [mode]
#     instance-dir : /opt/drepdao-main (mainnet)  |  /opt/drepdao-gov (preprod)
#     scope        : full (default) | api | web
#     mode         : safe (default) — wait until nobody is mid-action (no active writes);
#                    strict — wait until nobody is connected at all (even an idle open,
#                    polling tab blocks). Passive read-polling never blocks in safe mode.
#
# Smoke test fails  -> maintenance stays ON so users never meet a broken build; fix & rerun,
#                      or `rm <instance>/MAINTENANCE` to force the platform back open.
set -uo pipefail

INSTANCE="${1:-/opt/drepdao-main}"
SCOPE="${2:-full}"
MODE="${3:-safe}"
FLAG="$INSTANCE/MAINTENANCE"

case "$INSTANCE" in
  *drepdao-main) API_SVC=drepdao-main-api; WEB_SVC=drepdao-main-web; WEB_PORT=3400 ;;
  *drepdao-gov)  API_SVC=drepdao-gov-api;  WEB_SVC=drepdao-gov-web;  WEB_PORT=3200 ;;
  *drep-dao)     API_SVC=drepdao-api;      WEB_SVC=drepdao-web;      WEB_PORT=3000 ;;  # Innovation & Growth (preprod)
  *) echo "unknown instance: $INSTANCE"; exit 2 ;;
esac

cd "$INSTANCE" || { echo "no such dir: $INSTANCE"; exit 2; }
set -a; . ./.env; set +a
API_PORT="${API_PORT:-4310}"
: "${DEPLOY_TOKEN:?DEPLOY_TOKEN missing in $INSTANCE/.env}"

log(){ echo "[deploy $(date +%H:%M:%S)] $*"; }
jval(){ python3 -c "import sys,json;print(json.load(sys.stdin).get('$1'))" 2>/dev/null; }

# ── 1. wait for a quiet moment ───────────────────────────────────────────────
WINDOW=45; NEED_QUIET=2; MAX_WAIT=1200; quiet=0; waited=0
log "checking platform activity (mode=$MODE, window ${WINDOW}s)…"
while :; do
  R=$(curl -s -m5 -H "x-deploy-token: $DEPLOY_TOKEN" \
        "http://127.0.0.1:$API_PORT/internal/deploy/readiness?windowSec=$WINDOW" || echo '{}')
  CLIENTS=$(printf '%s' "$R" | jval activeClients)
  WRITERS=$(printf '%s' "$R" | jval activeWriters)
  if [ "$MODE" = "strict" ]; then
    [ "$CLIENTS" = "0" ] && clear=1 || clear=0
    busy="in use — ${CLIENTS:-?} connected client(s)"
  else
    # safe: only someone actively CHANGING something (a write in the window) blocks;
    # an idle tab that just background-polls does not.
    [ "$WRITERS" = "0" ] && clear=1 || clear=0
    busy="someone is actively making changes — ${WRITERS:-?} writer(s) (${CLIENTS:-0} client(s) connected)"
  fi
  if [ "$clear" = "1" ]; then
    quiet=$((quiet+1)); log "quiet — no active changes (${CLIENTS:-0} client(s) connected) ($quiet/$NEED_QUIET)…"
    [ "$quiet" -ge "$NEED_QUIET" ] && break
  else
    quiet=0; log "$busy; waiting…"
  fi
  sleep 10; waited=$((waited+10))
  if [ "$waited" -ge "$MAX_WAIT" ]; then
    log "still busy after ${MAX_WAIT}s — aborting, nothing deployed."; exit 3
  fi
done

# ── 1b. heads-up: warn connected users ~WARN_SEC before maintenance so they can finish + save ─
# Writes the epoch-seconds when maintenance will begin into <FLAG>.pending; the API serves it at
# /api/v1/maintenance/status and the app shows a counting-down banner. Then we wait it out.
WARN_SEC="${MAINTENANCE_WARN_SEC:-60}"
if [ "$WARN_SEC" -gt 0 ]; then
  echo $(( $(date +%s) + WARN_SEC )) > "$FLAG.pending"
  log "notifying users — maintenance in ${WARN_SEC}s (finish-your-work window)…"
  sleep "$WARN_SEC"
  rm -f "$FLAG.pending"
fi

# ── 2. maintenance ON (Caddy serves the page immediately, no reload needed) ───
log "enabling maintenance mode → users now see \"Short maintenance mode\""
touch "$FLAG"; sleep 2

# ── 3. build + restart under maintenance ─────────────────────────────────────
build_pkgs(){ pnpm --filter @drep-dao/shared build && pnpm --filter @drep-dao/cardano build; }
fail=0
if [ "$SCOPE" = "full" ] || [ "$SCOPE" = "api" ]; then
  log "building api…"; build_pkgs && pnpm --filter @drep-dao/api build || fail=1
  systemctl restart "$API_SVC"
fi
if [ "$SCOPE" = "full" ] || [ "$SCOPE" = "web" ]; then
  log "building web…"; [ "$SCOPE" = "web" ] && build_pkgs
  rm -rf apps/web/.next; pnpm --filter @drep-dao/web build || fail=1
  systemctl restart "$WEB_SVC"
fi
sleep 7

# ── 4. smoke test on the localhost ports (bypasses the maintenance gate) ──────
log "smoke testing the new build…"
[ "$fail" = "0" ] || log "build reported an error"
smoke(){ curl -fs -m "$2" -o /dev/null "$1" && log "ok  $3" || { log "FAIL $3"; fail=1; }; }
smoke "http://127.0.0.1:$API_PORT/api/v1/config"      10 "api /config"
smoke "http://127.0.0.1:$API_PORT/api/v1/dao/members" 20 "api /dao/members"
smoke "http://127.0.0.1:$WEB_PORT/"                    15 "web /"

# ── 5. reopen if healthy ─────────────────────────────────────────────────────
if [ "$fail" = "0" ]; then
  rm -f "$FLAG"
  log "healthy → maintenance lifted. Platform is live."
else
  log "SMOKE TEST FAILED → maintenance kept ON so users don't hit a broken build."
  log "fix and rerun, or force open with:  rm $FLAG"
  exit 4
fi
