#!/usr/bin/env bash
# R1: at most W agents run at once, a new one starts as one finishes, and W can change mid-run.
source "$(dirname "$0")/lib.sh"
start_proof "R1 — the concurrency window"

# The largest gap between a start and the finish that made room for it (seconds), for starts after the first $2.
refill_gap() { # <domain> <window>
  admin scans | jq --arg d "$1" --argjson w "$2" '
    def t: sub("\\.[0-9]+"; "") | fromdateiso8601;
    [.scans[] | select(.domain == $d)] as $s
    | ($s | map(.startedAt | t) | sort) as $starts
    | ($s | map(select(.finishedAt != null) | .finishedAt | t) | sort) as $finishes
    | [$starts[$w:][] as $start | $start - ([$finishes[] | select(. <= $start)] | max // -1000)] | max'
}

echo "-- run A: 6 agents, window 2"
A_DOMAIN=r1-a.example.com
A=$(submit $A_DOMAIN 6 2)
wait_for "$A" AWAITING_APPROVAL
check "most agents running at once (agent-service)" "$(admin scans | jq .maxConcurrent)" 2
check "agents started for 6 requested" "$(admin scans | jq ".startsByDomain[\"$A_DOMAIN\"]")" 6
check_at_most "slowest refill: start after the finish that freed its slot (s)" "$(refill_gap $A_DOMAIN 2)" 3
post "/assessments/$A/approve" > /dev/null && wait_for "$A" COMPLETED

echo "-- run B: 6 agents, window 2 → raised to 4 → lowered to 1"
curl -s -X POST "$AGENTS/admin/reset" > /dev/null
B=$(submit r1-b.example.com 6 2)
wait_until "$B" '.counts.completed >= 1'
echo "   raise: $(put "/assessments/$B/window" '{"size":4}')"
wait_until "$B" '.counts.running == 4'
check "most agents running at once after the raise" "$(admin scans | jq .maxConcurrent)" 4
echo "   lower: $(put "/assessments/$B/window" '{"size":1}')"
wait_for "$B" AWAITING_APPROVAL
check "most agents running at once (never above 4)" "$(admin scans | jq .maxConcurrent)" 4
check "agents stopped by lowering the window" "$(get "/assessments/$B" | jq .counts.stopped)" 0
check "agents completed" "$(get "/assessments/$B" | jq .counts.completed)" 6
post "/assessments/$B/approve" > /dev/null && wait_for "$B" COMPLETED

finish
