#!/usr/bin/env bash
# R8: the UI tells the truth. A Playwright run through the deployed stack, recorded as video
# (proofs/videos/r8/). Heavy on RAM and slow: run it deliberately.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== R8 — the UI tells the truth (Playwright, video in proofs/videos/r8/)"
task test:e2e
echo "== PASS"
