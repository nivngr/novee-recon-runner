#!/usr/bin/env bash
# R3: every activity fails right after its side effect (twice), as if the worker died before reporting success.
# The retries must change nothing: N agents started, N rows, each domain stored once.
source "$(dirname "$0")/lib.sh"
start_proof "R3 — exactly-once effects under retried activities"

DOMAIN=r3.example.com
echo "   failFirstAttempts=2: every activity's first 2 attempts fail after doing their work"
echo "   (agent-service also refuses each domain's first 2 starts with 503)"
ID=$(submit $DOMAIN 4 2 '{"failFirstAttempts":2}')
wait_for "$ID" AWAITING_APPROVAL
post "/assessments/$ID/approve" > /dev/null
wait_for "$ID" COMPLETED

check "agents started for 4 requested (agent-service)" "$(admin scans | jq ".startsByDomain[\"$DOMAIN\"]")" 4
check "agent rows" "$(sql "select count(*) from assessment_agents where assessment_id = '$ID'")" 4
check "staged rows with a duplicate (agent, domain)" "$(sql "select count(*) - count(distinct (agent_index, domain)) from staged_discoveries where assessment_id = '$ID'")" 0
check "stored domains appearing more than once" "$(sql "select count(*) from (select domain from discovered_domains where assessment_id = '$ID' group by domain having count(*) > 1) d")" 0
STAGED=$(sql "select count(distinct domain) from staged_discoveries where assessment_id = '$ID'")
check "stored domains = distinct staged domains" "$(sql "select count(*) from discovered_domains where assessment_id = '$ID'")" "$STAGED"
check "stored domains = agent-service's own count (unique domains of its COMPLETED scans)" "$(sql "select count(*) from discovered_domains where assessment_id = '$ID'")" "$(ground_truth $DOMAIN)"
echo "   activity attempts in the workflow's history (attempt > 1 = retried):"
kubectl -n "$NS" exec temporal-0 -- temporal workflow show -w "assessment-$ID" --address temporal:7233 --output json \
  | jq -r '[.events[] | select(.eventType == "EVENT_TYPE_ACTIVITY_TASK_STARTED") | .activityTaskStartedEventAttributes.attempt] | group_by(.) | map("     attempt \(.[0]): \(length) tasks") | .[]'
finish
