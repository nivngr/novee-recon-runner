#!/usr/bin/env bash
# R6: nothing is stored until a human approves; reject stores nothing (the staged findings are kept); the
# findings are readable while waiting.
source "$(dirname "$0")/lib.sh"
start_proof "R6 — the human gate"

YES=$(submit r6-approve.example.com 3 3)
NO=$(submit r6-reject.example.com 3 3)
echo "   approve before the run asks: $(post "/assessments/$YES/approve")"
wait_for "$YES" AWAITING_APPROVAL
wait_for "$NO" AWAITING_APPROVAL

echo "-- while waiting: readable, nothing stored"
check "domain list source while waiting" "$(get "/assessments/$YES/domains" | jq -r .source)" staged
check "domains listed while waiting > 0" "$(get "/assessments/$YES/domains" | jq '.domains | length > 0')" true
check "rows stored while waiting" "$(sql "select count(*) from discovered_domains where assessment_id = '$YES'")" 0

echo "-- approve one, reject the other"
echo "   approve: $(post "/assessments/$YES/approve")"
echo "   approve again: $(post "/assessments/$YES/approve")"
echo "   reject:  $(post "/assessments/$NO/reject")"
wait_for "$YES" COMPLETED
wait_for "$NO" REJECTED

LISTED=$(get "/assessments/$YES/domains" | jq '.domains | length')
check "approved: domain list source" "$(get "/assessments/$YES/domains" | jq -r .source)" final
check "approved: rows stored = domains listed" "$(sql "select count(*) from discovered_domains where assessment_id = '$YES'")" "$LISTED"
check "rejected: rows stored" "$(sql "select count(*) from discovered_domains where assessment_id = '$NO'")" 0
check "rejected: staged findings kept" "$(sql "select count(*) > 0 from staged_discoveries where assessment_id = '$NO'")" t
check "rejected: actions offered afterwards" "$(get "/assessments/$NO" | jq -c .allowedActions)" '[]'
finish
