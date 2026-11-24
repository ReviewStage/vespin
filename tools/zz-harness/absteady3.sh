#!/bin/bash
# Steady state at 5,400 agents, 1,000 moves a run: main, the fold (#10747), and shape 1's prototype (outside the live queries), interleaved.
cd /workspace/repository
export OUT=/tmp/steady4.jsonl
rm -f $OUT
for round in 1 2 3 4 5 6; do
  for build in main fold outside; do
    for f in task-list-tasks.ts task-list-pull-requests.ts task-list-collections.ts; do cp /tmp/ab-files/$build/$f packages/host/src/$f; done
    ablate=""; [ "$build" = outside ] && ablate="outside,plans,groups,byTask"
    ABLATE="$ablate" DRAW_MODE=answer BUILD=$build AGENTS=5400 STEPS=1000 timeout 600 pnpm exec vitest run --project host packages/host/src/zz-task-list-steady.test.ts > /tmp/absteady3-last.log 2>&1 || { echo "FAIL answer $build"; grep -E "Error" /tmp/absteady3-last.log | head -3; }
  done
done
git checkout -q -- packages/host/src/task-list-tasks.ts packages/host/src/task-list-pull-requests.ts packages/host/src/task-list-collections.ts
echo "absteady3 done"
