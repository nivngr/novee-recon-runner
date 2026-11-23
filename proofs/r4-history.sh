#!/usr/bin/env bash
# R4: bulk results stay out of Temporal's history. Every activity returns a small value; the findings
# themselves (hundreds of subdomains) live only in Postgres.
source "$(dirname "$0")/lib.sh"
start_proof "R4 — what the workflow's history holds"

ID=$(submit r4.example.com 4 2)
wait_for "$ID" AWAITING_APPROVAL
post "/assessments/$ID/approve" > /dev/null
wait_for "$ID" COMPLETED

kubectl -n "$NS" exec temporal-0 -- temporal workflow show -w "assessment-$ID" --address temporal:7233 --output json > "$WORK/r4-history.json"
echo "   each activity's result, as stored in the history:"
jq -r '
  (.events | map(select(.eventType == "EVENT_TYPE_ACTIVITY_TASK_SCHEDULED") | {key: .eventId, value: .activityTaskScheduledEventAttributes.activityType.name}) | from_entries) as $names
  | .events[] | select(.eventType == "EVENT_TYPE_ACTIVITY_TASK_COMPLETED") | .activityTaskCompletedEventAttributes
  | "     \($names[.scheduledEventId] | . + " " * (14 - length)) \(.result.payloads[0].data // "" | @base64d | length | tostring | " " * (4 - length) + .) bytes  \(.result.payloads[0].data // "" | @base64d)"' \
  "$WORK/r4-history.json"

LARGEST=$(jq '[.. | objects | select(has("data") and has("metadata")) | .data | @base64d | length] | max' "$WORK/r4-history.json")
EVENTS=$(jq '.events | length' "$WORK/r4-history.json")
HISTORY_BYTES=$(wc -c < "$WORK/r4-history.json" | tr -d ' ')
STAGED=$(sql "select count(*) from staged_discoveries where assessment_id = '$ID'")
STORED=$(sql "select count(*) from discovered_domains where assessment_id = '$ID'")
echo "   history: $EVENTS events, $HISTORY_BYTES bytes as JSON; findings in Postgres: $STAGED staged, $STORED stored"
check_at_most "largest payload anywhere in the history (bytes)" "$LARGEST" 1024
check "history mentions any found subdomain" "$(jq -r '[.. | objects | select(has("data")) | .data | @base64d] | map(select(test("\\.r4\\.example\\.com"))) | length' "$WORK/r4-history.json")" 0
finish
