#!/usr/bin/env bash
# Manual test: make a run stuck, watch the UI say so, then let it recover.
#
#   proofs/manual/stuck-writes.sh on    # the database refuses updates to `assessments` (reads still work)
#   proofs/manual/stuck-writes.sh off   # back to normal
#
# Try it: start a run with 2 agents, window 2. While it's RUNNING, turn this `on`. When the agents finish, the worker
# can't move the run to AGGREGATING: its `setRunStatus` activity fails and Temporal retries it. About 30s later the run
# page shows "This run is stuck: setRunStatus keeps failing (attempt N) — … writes to assessments are blocked".
# Turn it `off`: the next retry succeeds, the banner disappears, and the run carries on to "Awaiting approval".
# (While it's on, approve/cancel/window requests fail too: they write to the same table.)
#
# A temporary trigger, created and dropped by hand: a test fault, not a schema change, never in a migration.
set -euo pipefail
sql() { kubectl -n novee-task exec postgres-0 -- psql -U novee -d novee -qc "$1"; }

case "${1:-}" in
  on)
    sql "CREATE OR REPLACE FUNCTION manual_test_block_writes() RETURNS trigger LANGUAGE plpgsql AS \$\$
         BEGIN RAISE EXCEPTION 'manual test: writes to assessments are blocked'; END \$\$;"
    sql "CREATE OR REPLACE TRIGGER manual_test_block_writes BEFORE UPDATE ON assessments
         FOR EACH ROW EXECUTE FUNCTION manual_test_block_writes();"
    echo "writes to assessments are now refused; run '$0 off' to undo" ;;
  off)
    sql "DROP TRIGGER IF EXISTS manual_test_block_writes ON assessments;"
    sql "DROP FUNCTION IF EXISTS manual_test_block_writes();"
    echo "writes to assessments are allowed again" ;;
  *)
    sed -n '2,13p' "$0"; exit 1 ;;
esac
