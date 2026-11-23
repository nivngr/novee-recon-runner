#!/usr/bin/env bash
# R7: cancelling stops the agents in flight, starts nothing new, and the run says CANCELLED.
source "$(dirname "$0")/lib.sh"
start_proof "R7 — cancellation stops the agents"

DOMAIN=r7.example.com
ID=$(submit $DOMAIN 6 2)
wait_until "$ID" '.counts.running == 2 and .counts.completed == 0'
echo "   cancel: $(post "/assessments/$ID/cancel")"
wait_for "$ID" CANCELLED 300

check "scans still RUNNING at agent-service" "$(admin scans | jq "[.scans[] | select(.domain == \"$DOMAIN\" and .status == \"RUNNING\")] | length")" 0
check "scans agent-service marked STOPPED" "$(admin scans | jq "[.scans[] | select(.domain == \"$DOMAIN\" and .status == \"STOPPED\")] | length")" 2
check "agents started" "$(admin scans | jq ".startsByDomain[\"$DOMAIN\"]")" 2
check "agent rows STOPPED, stop confirmed" "$(get "/assessments/$ID" | jq '[.agents[] | select(.status == "STOPPED" and .stopConfirmed == true)] | length')" 2
check "agent rows still QUEUED (never started)" "$(get "/assessments/$ID" | jq .counts.queued)" 4
check "agent rows RUNNING" "$(get "/assessments/$ID" | jq .counts.running)" 0
check "Temporal's view of the workflow" "$(kubectl -n "$NS" exec temporal-0 -- temporal workflow describe -w "assessment-$ID" --address temporal:7233 --output json | jq -r .workflowExecutionInfo.status)" WORKFLOW_EXECUTION_STATUS_CANCELED
finish
