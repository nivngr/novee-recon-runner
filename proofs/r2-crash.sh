#!/usr/bin/env bash
# R2: kill every worker mid-run; the run carries on, no agent is started twice, and the result is complete.
source "$(dirname "$0")/lib.sh"
start_proof "R2 — surviving the death of every worker"

DOMAIN=r2.example.com
ID=$(submit $DOMAIN 6 2)
wait_until "$ID" '.counts.completed >= 1 and .counts.running == 2'
echo "   workers before: $(kubectl -n "$NS" get pods -l app=worker -o jsonpath='{.items[*].metadata.name}')"
kubectl -n "$NS" delete pod -l app=worker --wait=false | sed 's/^/   /'
echo "   $(date +%T) every worker pod deleted mid-run"
# The replacements: pods not being deleted, and Ready. (Deleted pods linger while they terminate.)
live_workers() { kubectl -n "$NS" get pods -l app=worker -o json | jq -r '[.items[] | select(.metadata.deletionTimestamp == null and any(.status.conditions[]?; .type == "Ready" and .status == "True")) | .metadata.name] | join(" ")'; }
for _ in $(seq 1 90); do [[ "$(live_workers | wc -w | tr -d ' ')" == 2 ]] && break; sleep 2; done
echo "   $(date +%T) workers after: $(live_workers)"

wait_for "$ID" AWAITING_APPROVAL
post "/assessments/$ID/approve" > /dev/null
wait_for "$ID" COMPLETED

echo "   which worker last handled each agent:"
sql "select agent_index, status, worker from assessment_agents where assessment_id = '$ID' order by 1" | sed 's/^/     /'
check "agents started for 6 requested (agent-service totalStarted)" "$(admin scans | jq .totalStarted)" 6
check "agents completed" "$(get "/assessments/$ID" | jq .counts.completed)" 6
STAGED=$(sql "select count(distinct domain) from staged_discoveries where assessment_id = '$ID'")
check "stored domains = distinct union of what the agents found" "$(sql "select count(*) from discovered_domains where assessment_id = '$ID'")" "$STAGED"
check "stored domains = agent-service's own count (unique domains of its COMPLETED scans)" "$(sql "select count(*) from discovered_domains where assessment_id = '$ID'")" "$(ground_truth $DOMAIN)"
finish
