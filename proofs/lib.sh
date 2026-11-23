# Shared helpers for the proof scripts (sourced, not run). Needs kubectl (context on the cluster), curl, jq.
# Proof scripts may call agent-service's /admin/* endpoints; our services never do.

set -euo pipefail

NS=novee-task
API=http://localhost:18081
AGENTS=http://localhost:28080
FAILURES=0
PORT_FORWARDS=()
WORK=$(mktemp -d) # scratch files for one proof run

# ---------------------------------------------------------------- setup

port_forward() { # <service> <local port>
  kubectl -n "$NS" port-forward "svc/$1" "$2:8080" > /dev/null 2>&1 &
  PORT_FORWARDS+=("$!")
  until curl -s -o /dev/null "http://localhost:$2/healthz"; do sleep 0.5; done
}

cleanup() {
  # `${a[@]+...}`: an empty array is "unbound" under `set -u` in macOS's Bash 3.2.
  for pid in ${PORT_FORWARDS[@]+"${PORT_FORWARDS[@]}"}; do { kill "$pid" && wait "$pid"; } 2> /dev/null || true; done
  rm -rf "$WORK"
}
trap cleanup EXIT

start_proof() { # <title>
  echo "== $1"
  echo "   $(date -u +%Y-%m-%dT%H:%M:%SZ) on $(kubectl config current-context), images $(kubectl -n "$NS" get deploy api -o jsonpath='{.spec.template.spec.containers[0].image}')"
  port_forward api 18081
  port_forward agent-service 28080
  curl -s -X POST "$AGENTS/admin/reset" > /dev/null
  echo "   agent-service reset (default config, counters zeroed)"
}

# ---------------------------------------------------------------- talking to the system

get() { curl -s "$API$1"; }
post() { # <path> [json body]
  if (( $# > 1 )); then curl -s -X POST "$API$1" -H 'content-type: application/json' -d "$2"; else curl -s -X POST "$API$1"; fi
}
put() { curl -s -X PUT "$API$1" -H 'content-type: application/json' -d "$2"; }
admin() { curl -s "$AGENTS/admin/$1"; }
admin_config() { curl -s -X POST "$AGENTS/admin/config" -H 'content-type: application/json' -d "$1" > /dev/null; }
sql() { kubectl -n "$NS" exec postgres-0 -- psql -U novee -d novee -tAc "$1"; }

# submit <domain> <agents> <window> [settings json] → prints the run id
submit() {
  local id
  id=$(uuidgen | tr '[:upper:]' '[:lower:]')
  post /assessments "{\"id\":\"$id\",\"domain\":\"$1\",\"agentCount\":$2,\"windowSize\":$3${4:+,\"settings\":$4}}" > /dev/null
  echo "$id"
}

# ground_truth <domain> → unique domains found by agent-service's COMPLETED scans for <domain>, read from
# agent-service itself (the starter README's check; needs a reset before the run so only its scans count)
ground_truth() {
  admin scans | jq -r --arg d "$1" '.scans[] | select(.domain == $d and .status == "COMPLETED") | .scanId' \
    | while read -r id; do curl -s "$AGENTS/scans/$id" | jq -r '.discovered[].domain'; done | sort -u | wc -l | tr -d ' '
}

# start_lines <domain> → how many start requests for <domain> agent-service has logged (log lines survive resets)
start_lines() { kubectl -n "$NS" logs deploy/agent-service | grep -cF "start domain=\"$1\"" || true; }

status_of() { get "/assessments/$1" | jq -r .status; }

# wait_until <id> <jq condition on the run view> [timeout s] — polls every 2s, printing each change
wait_until() {
  local id=$1 condition=$2 timeout=${3:-900} start=$SECONDS last='' view
  while :; do
    view=$(get "/assessments/$id")
    local line
    line=$(jq -r '"\(.status)\(if .pending then " (\(.pending))" else "" end) \(.counts | "completed=\(.completed) running=\(.running) queued=\(.queued) failed=\(.failed) lost=\(.lost) stopped=\(.stopped)") window=\(.window)"' <<< "$view")
    if [[ "$line" != "$last" ]]; then echo "   $(date +%T) $line"; last=$line; fi
    [[ "$(jq -r "$condition" <<< "$view")" == "true" ]] && return 0
    if (( SECONDS - start > timeout )); then echo "   timed out waiting for: $condition"; return 1; fi
    sleep 2
  done
}

wait_for() { wait_until "$1" ".status == \"$2\"" "${3:-900}"; } # <id> <status> [timeout s]

# ---------------------------------------------------------------- verdicts

check() { # <description> <actual> <expected>
  if [[ "$2" == "$3" ]]; then
    echo "   PASS  $1: $2"
  else
    echo "   FAIL  $1: got $2, expected $3"
    FAILURES=$((FAILURES + 1))
  fi
}

check_at_most() { # <description> <actual> <limit>
  if (( $2 <= $3 )); then
    echo "   PASS  $1: $2 (limit $3)"
  else
    echo "   FAIL  $1: $2, over the limit $3"
    FAILURES=$((FAILURES + 1))
  fi
}

finish() {
  if (( FAILURES == 0 )); then echo "== PASS"; else echo "== FAIL ($FAILURES)"; exit 1; fi
}
