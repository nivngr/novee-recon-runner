#!/usr/bin/env bash
# R9: one command from an empty cluster to the running stack. With RECREATE=1 it first deletes and recreates the
# local k3d cluster (development only; graders bring their own k3s and run `task up`).
source "$(dirname "$0")/lib.sh"
echo "== R9 — one-command deploy"
cd "$(dirname "$0")/.."
if [[ "${RECREATE:-0}" == 1 ]]; then
  echo "   recreating the k3d cluster"
  k3d cluster delete novee-task > /dev/null && task cluster > /dev/null
fi
T0=$SECONDS
task up > "$WORK/r9-up.log" 2>&1 || { tail -20 "$WORK/r9-up.log"; echo "== FAIL (task up)"; exit 1; }
echo "   task up: exit 0 in $((SECONDS - T0))s"
kubectl -n "$NS" get deploy,statefulset,job --no-headers | sed 's/^/     /'

for deploy in api worker web agent-service; do
  check "$deploy ready replicas" "$(kubectl -n "$NS" get deploy "$deploy" -o jsonpath='{.status.readyReplicas}')" "$(kubectl -n "$NS" get deploy "$deploy" -o jsonpath='{.spec.replicas}')"
done
check "worker replicas" "$(kubectl -n "$NS" get deploy worker -o jsonpath='{.spec.replicas}')" 2
check "Services selecting the worker" "$(kubectl -n "$NS" get svc -o json | jq '[.items[] | select(.spec.selector.app == "worker")] | length')" 0
check "worker liveness probe" "$(kubectl -n "$NS" get deploy worker -o jsonpath='{.spec.template.spec.containers[0].livenessProbe.exec.command[2]}')" 'test $(( $(date +%s) - $(stat -c %Y /tmp/healthy) )) -lt 30'
check "worker memory limit" "$(kubectl -n "$NS" get deploy worker -o jsonpath='{.spec.template.spec.containers[0].resources.limits.memory}')" 512Mi
check "migrate Job succeeded" "$(kubectl -n "$NS" get job migrate -o jsonpath='{.status.succeeded}')" 1

VICTIM=$(kubectl -n "$NS" get pods -l app=worker -o jsonpath='{.items[0].metadata.name}')
kubectl -n "$NS" delete pod "$VICTIM" --wait=true > /dev/null # returns once it's gone
# The Deployment notices and starts a replacement; wait until two workers other than the deleted one are ready.
ready_workers() { kubectl -n "$NS" get pods -l app=worker -o json | jq '[.items[] | select(.metadata.deletionTimestamp == null and any(.status.conditions[]?; .type == "Ready" and .status == "True"))] | length'; }
for _ in $(seq 1 60); do [[ "$(ready_workers)" == 2 ]] && break; sleep 2; done
check "ready workers after deleting $VICTIM" "$(ready_workers)" 2
finish
