#!/usr/bin/env bash
# S0.7 F6(A) founder walkthrough — cross-process MCP TCP attach.
#
# Validates: launch → token+port files appear → 401 without token → 401 with
# wrong token → 200 with right token → SIGTERM → token+port files wiped.
#
# Usage (npm repo):
#   npm run build && bash scripts/walkthrough-f6a.sh
#
# Usage (project-aegis Py repo):
#   bash scripts/walkthrough-f6a.sh --py
set -u
PY_MODE=0
[[ "${1:-}" == "--py" ]] && PY_MODE=1

TOKEN_FILE="$HOME/.config/hangpay/.attach_token"
PORT_FILE="$HOME/.config/hangpay/.attach_port"
PASS=0
FAIL=0
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; PASS=$((PASS+1)); }
fail() { printf "  \033[31m✗\033[0m %s\n" "$1"; FAIL=$((FAIL+1)); }

step() { printf "\n\033[1m▸ %s\033[0m\n" "$1"; }

cleanup_pre() {
  rm -f "$TOKEN_FILE" "$PORT_FILE"
}

start_server() {
  if [[ $PY_MODE -eq 1 ]]; then
    .venv/bin/python -m HANGPAY_pay.mcp_server --transport tcp >/tmp/popf6a.log 2>&1 &
  else
    node dist/mcp-server.js --transport tcp >/tmp/popf6a.log 2>&1 &
  fi
  echo $!
}

step "1. Pre-flight: clear stale attach files"
cleanup_pre
[[ ! -e "$TOKEN_FILE" ]] && ok "no stale .attach_token" || fail ".attach_token still exists"
[[ ! -e "$PORT_FILE"  ]] && ok "no stale .attach_port"  || fail ".attach_port still exists"

step "2. Launch server in --transport tcp"
PID=$(start_server)
sleep 2
if kill -0 "$PID" 2>/dev/null; then
  ok "server running (pid $PID)"
else
  fail "server died at startup — see /tmp/popf6a.log"
  cat /tmp/popf6a.log
  exit 1
fi

step "3. Verify token + port files exist with mode 0600"
if [[ -f "$TOKEN_FILE" ]]; then
  TOKEN=$(cat "$TOKEN_FILE")
  TLEN=${#TOKEN}
  TMODE=$(stat -f '%A' "$TOKEN_FILE" 2>/dev/null || stat -c '%a' "$TOKEN_FILE")
  [[ "$TLEN" == "64" ]] && ok "token is 64 hex chars" || fail "token wrong length: $TLEN"
  [[ "$TMODE" == "600" ]] && ok ".attach_token mode 0600" || fail ".attach_token mode $TMODE"
else
  fail ".attach_token not created"
fi
if [[ -f "$PORT_FILE" ]]; then
  PORT=$(cat "$PORT_FILE")
  PMODE=$(stat -f '%A' "$PORT_FILE" 2>/dev/null || stat -c '%a' "$PORT_FILE")
  [[ "$PORT" =~ ^[0-9]+$ ]] && ok "port is numeric ($PORT)" || fail "port malformed: $PORT"
  [[ "$PMODE" == "600" ]] && ok ".attach_port mode 0600" || fail ".attach_port mode $PMODE"
else
  fail ".attach_port not created"
fi

URL="http://127.0.0.1:$PORT/"

step "4. POST without Authorization header → expect 401"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL")
[[ "$CODE" == "401" ]] && ok "no-auth → 401" || fail "no-auth got $CODE (expected 401)"

step "5. POST with WRONG bearer → expect 401"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer wrongtoken" "$URL")
[[ "$CODE" == "401" ]] && ok "wrong-bearer → 401" || fail "wrong-bearer got $CODE (expected 401)"

step "6. POST MCP initialize with CORRECT bearer → expect 200"
INIT_BODY='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"walkthrough","version":"0.1"}}}'
CODE=$(curl -s -o /tmp/popf6a.resp -w '%{http_code}' -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "$INIT_BODY" "$URL")
if [[ "$CODE" == "200" ]]; then
  ok "auth + initialize → 200"
else
  fail "auth + initialize got $CODE (expected 200)"
  echo "    response body:"; sed 's/^/      /' /tmp/popf6a.resp | head -5
fi

step "7. SIGTERM → server exits cleanly + attach files wiped"
kill -TERM "$PID" 2>/dev/null
sleep 1
wait "$PID" 2>/dev/null
[[ ! -e "$TOKEN_FILE" ]] && ok ".attach_token wiped on SIGTERM" || fail ".attach_token survived SIGTERM"
[[ ! -e "$PORT_FILE"  ]] && ok ".attach_port wiped on SIGTERM"  || fail ".attach_port survived SIGTERM"

printf "\n\033[1mResult: %d passed, %d failed\033[0m\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1

