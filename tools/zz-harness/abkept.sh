#!/bin/bash
# The kept draw's agents phase: main, the fold with a full join, the fold with a left join, interleaved.
cd /workspace/repository
export OUT=/tmp/kept.jsonl
rm -f $OUT
for round in 1 2 3 4 5 6; do
  for build in main fold foldleft; do
    for f in task-list-tasks.ts task-list-pull-requests.ts task-list-collections.ts; do cp /tmp/ab-files/$build/$f packages/host/src/$f; done
    DRAW_MODE=kept BUILD=$build AGENTS=4831 timeout 300 pnpm exec vitest run --project host packages/host/src/zz-task-list-steady.test.ts > /tmp/abkept-last.log 2>&1 || { echo "FAIL kept $build"; grep -E "Error" /tmp/abkept-last.log | head -3; }
  done
done
for f in task-list-tasks.ts task-list-pull-requests.ts task-list-collections.ts; do cp /tmp/ab-files/fold/$f packages/host/src/$f; done
echo "abkept done"
