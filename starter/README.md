# Starter kit

The given infrastructure, and nothing else. Copy this directory into the root of your
submission repo and build on top of it.

```
db/schema.sql             base schema: a starting point — yours to extend
k8s/00-namespace.yaml
k8s/10-postgres.yaml      given infra
k8s/20-temporal.yaml      given infra — dev server, history persisted to a PVC
k8s/30-agent-service.yaml the given dependency's manifest. DO NOT MODIFY
agent-service/            the given dependency. DO NOT MODIFY
```

Everything here except `agent-service/` and `k8s/30-agent-service.yaml` is yours to change.
Your services must not call `agent-service`'s `/admin/*` endpoints either; those are for checking
your work, by hand or from proof scripts.

**There is no build script on purpose.** Wrapping all of this up — bootstrap, build, load,
deploy — behind a task runner is part of what you are delivering (R9). We use
[Task](https://taskfile.dev) (`Taskfile.yml`); Make or a shell script is fine if you would
rather. The commands below are your starting point.

## Prerequisites

- A local **k3s** cluster. Any of these is fine:
  - k3s directly (`curl -sfL https://get.k3s.io | sh -`)
  - [k3d](https://k3d.io) (`k3d cluster create novee-task`) — easiest on macOS
  - OrbStack or Rancher Desktop with Kubernetes enabled
- `kubectl` pointed at it, plus `docker`, `curl` and `jq`.

Note which flavour you used — your `NOTES.md` run instructions need it, because the
image-load step differs between them.

## Bringing up the given infrastructure

```bash
kubectl apply -f k8s/00-namespace.yaml

# agent-service has to be built and loaded into the cluster before it can start
docker build -t novee-task/agent-service:dev agent-service
#   k3s on Linux : docker save novee-task/agent-service:dev | sudo k3s ctr images import -
#   k3d          : k3d image import novee-task/agent-service:dev -c novee-task
#   OrbStack     : nothing to do, docker images are already visible

kubectl apply -f k8s/10-postgres.yaml -f k8s/20-temporal.yaml -f k8s/30-agent-service.yaml
kubectl -n novee-task rollout status statefulset/postgres      --timeout=180s
kubectl -n novee-task rollout status statefulset/temporal      --timeout=180s
kubectl -n novee-task rollout status deployment/agent-service  --timeout=180s

kubectl -n novee-task exec -i statefulset/postgres -- psql -U novee -d novee < db/schema.sql
```

Your own images need the same build-and-load dance, so whatever you wrap this in should
handle both — that is the "one command from an empty cluster" in R9.

Handy while working:

```bash
kubectl -n novee-task port-forward svc/temporal 8233:8233   # Temporal Web UI
kubectl -n novee-task logs -l app=worker -f --tail=200      # once you have a worker
kubectl -n novee-task logs -l app=agent-service -f          # every agent start, in order
kubectl -n novee-task exec -it statefulset/postgres -- psql -U novee -d novee
```

`agent-service` logs one line per start, stop and config change, including the running
concurrency and the high-water mark. When your window is not behaving, read this first.

## Meet the agent service

Do this before you write any workflow code. It will teach you more about the task than the
brief does.

```bash
kubectl -n novee-task port-forward svc/agent-service 18080:8080 &
A=http://127.0.0.1:18080

# make it fast while you explore — 2-5s agents instead of 10s-2m
curl -s -XPOST $A/admin/config \
  -d '{"failFirstN":0,"minDurationMs":2000,"maxDurationMs":5000,"resultCount":20}' | jq

curl -s $A/techniques | jq

# start one agent, then watch it
ID=$(curl -s -XPOST $A/scans -d '{"domain":"acme.com","technique":"dns-brute"}' | jq -r .scanId)
curl -s $A/scans/$ID | jq '{status,progress,discovered}'      # RUNNING, discovered null
sleep 5
curl -s $A/scans/$ID | jq '{status, n:(.discovered|length)}'   # COMPLETED
curl -s $A/scans/$ID | jq '.discovered[:5]'                    # domain + risk
curl -s $A/scans/$ID | jq -r '.discovered[].risk' | sort | uniq -c

# the same key twice starts ONE agent. drop the header and you get two.
curl -s -XPOST $A/scans -H 'Idempotency-Key: a-0' -d '{"domain":"acme.com"}' | jq -r .scanId
curl -s -XPOST $A/scans -H 'Idempotency-Key: a-0' -d '{"domain":"acme.com"}' | jq -r .scanId

# transient vs permanent
curl -s -XPOST $A/admin/config -d '{"failFirstN":2}' | jq -c .
curl -s -o /dev/null -w '%{http_code}\n' -XPOST $A/scans -d '{"domain":"beta.com"}'  # 503
curl -s -o /dev/null -w '%{http_code}\n' -XPOST $A/scans -d '{"domain":"beta.com"}'  # 503
curl -s -o /dev/null -w '%{http_code}\n' -XPOST $A/scans -d '{"domain":"beta.com"}'  # 202
curl -s -XPOST $A/scans -d '{"domain":"nope.invalid"}' | jq -c .                      # 422, forever

# stopping one (a fresh agent: the one above has already finished)
ID=$(curl -s -XPOST $A/scans -d '{"domain":"acme.com","technique":"web-crawl"}' | jq -r .scanId)
curl -s -XPOST $A/scans/$ID/stop | jq -c '{status,progress}'                    # STOPPED

# the observation surface: this is how you check your own work
curl -s $A/admin/scans | jq '{maxConcurrent,runningNow,totalStarted,startsByDomain}'
curl -s $A/admin/scans | jq -c '.scans[] | {scanId,technique,status,startedAt,finishedAt}'

# after a reset and one approved run: how many unique domains its completed agents found.
# your discovered_domains row count for that run should equal this, crash or no crash (R2, R3).
# keep resultCount as the run had it: results are computed from the current config when read
curl -s $A/admin/scans | jq -r '.scans[] | select(.domain=="acme.com" and .status=="COMPLETED") | .scanId' \
  | while read -r id; do curl -s $A/scans/$id | jq -r '.discovered[].domain'; done | sort -u | wc -l

curl -s -XPOST $A/admin/reset | jq -c .
```

### The two numbers that matter

- **`maxConcurrent`** — the most agents `agent-service` ever saw running at the same time.
  If your window is 2 and this comes back 6, you fanned out. It is measured by the service,
  not claimed by you.
- **`totalStarted`** — how many agents were actually started. An `Idempotency-Key` replay
  does not increment it. If you asked for 6 and this says 9, three starts were retried into
  existence.

The `scans` array is sorted by start time, so it reads as a timeline: with a window of W,
no more than W entries overlap at any instant, and each start should line up with a finish.

### Turning the difficulty up

All of these are off or mild by default. Turn them on when you want to test a specific
requirement.

| Knob | What it does |
|---|---|
| `failFirstN` | transient `503`s per domain before the first successful start. Default 2. |
| `failEveryN` | every Nth agent started for a domain ends `FAILED` with `agent_crashed` — an HTTP 200 reporting failure. |
| `stallEveryN` | every Nth agent started for a domain freezes at `progress: 0.4` and **never** reaches a terminal status. Nothing errors, so nothing retries. |
| `maxConcurrent` | a hard cap: `429` once this many agents are running. Off by default — we would rather your window be right than be enforced. |
| `minDurationMs` / `maxDurationMs` | how long agents take. Defaults 10s–2m. |
| `resultCount` | subdomains per completed agent. Default 250. |

## Notes

- The Temporal dev server is a single pod with a SQLite file on a PVC. Deleting the namespace
  loses all workflow history.
- Temporal Web UI on `:8233` (port-forward above). **Use it.** Most of the nine requirements
  are visible in the event history if you look — including the size of that history.
- `agent-service` keeps its scan registry and concurrency high-water mark in process memory
  and runs `replicas: 1` for that reason. Do not scale it, and remember that restarting it
  clears the counters.
- `POST /admin/reset` between experiments. `maxConcurrent` is a high-water mark and never
  goes down on its own, so one careless fan-out early on will haunt every later reading.
