#!/usr/bin/env bash
# R5: each kind of failure is told apart and handled as its kind requires.
source "$(dirname "$0")/lib.sh"
start_proof "R5 — failure classification"

echo "-- an unsupported domain: refused once, never retried, the run says so"
DOMAIN=nope.invalid
T0=$SECONDS
BAD=$(submit $DOMAIN 4 2)
wait_for "$BAD" REJECTED_INPUT 60
check_at_most "seconds from submit to REJECTED_INPUT" "$((SECONDS - T0))" 30
check "agents agent-service started for it" "$(admin scans | jq ".startsByDomain[\"$DOMAIN\"] // 0")" 0
HISTORY=$(kubectl -n "$NS" exec temporal-0 -- temporal workflow show -w "assessment-$BAD" --address temporal:7233 --output json)
check "startAgent attempts in the history" "$(jq '[.events[] | select(.eventType == "EVENT_TYPE_ACTIVITY_TASK_SCHEDULED" and .activityTaskScheduledEventAttributes.activityType.name == "startAgent")] | length' <<< "$HISTORY")" 1
check "agents never started (still QUEUED)" "$(get "/assessments/$BAD" | jq .counts.queued)" 3

echo "-- agents that crash (failEveryN=3): they fail, the run carries on and completes with the rest"
admin_config '{"failEveryN":3}'
CRASHY=$(submit r5-crash.example.com 6 3)
wait_for "$CRASHY" AWAITING_APPROVAL
check "agents FAILED" "$(get "/assessments/$CRASHY" | jq .counts.failed)" 2
check "agents COMPLETED" "$(get "/assessments/$CRASHY" | jq .counts.completed)" 4
check "agents started (crashed ones are not replaced)" "$(admin scans | jq '.startsByDomain["r5-crash.example.com"]')" 6
post "/assessments/$CRASHY/approve" > /dev/null
wait_for "$CRASHY" COMPLETED

echo "-- agents that hang (stallEveryN=3, no-progress timeout 15s): given up on, stopped, the run completes"
curl -s -X POST "$AGENTS/admin/reset" > /dev/null
admin_config '{"stallEveryN":3}'
STALLY=$(submit r5-stall.example.com 6 3 '{"stallTimeoutS":15}')
wait_for "$STALLY" AWAITING_APPROVAL
check "agents LOST (no progress)" "$(get "/assessments/$STALLY" | jq '[.agents[] | select(.status == "LOST" and .lostReason == "NO_PROGRESS")] | length')" 2
check "lost agents whose stop agent-service confirmed" "$(get "/assessments/$STALLY" | jq '[.agents[] | select(.status == "LOST" and .stopConfirmed == true)] | length')" 2
check "scans still RUNNING at agent-service" "$(admin scans | jq '[.scans[] | select(.domain == "r5-stall.example.com" and .status == "RUNNING")] | length')" 0
post "/assessments/$STALLY/approve" > /dev/null
wait_for "$STALLY" COMPLETED
finish
