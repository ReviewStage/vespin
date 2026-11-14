#!/bin/zsh
# duo-row-taps.sh -- PROBE ONLY, never merged: on the folded Duo, taps each Inbox row at its center and logs what iOS hit-tests there and whether the thread opened.
#
# usage: duo-row-taps.sh <udid> <out-dir> [rounds]
# Needs the app installed on <udid> (any build of main) and idb on PATH.
set -u
U=$1; OUT=$2; ROUNDS=${3:-3}
mkdir -p $OUT; LOG=$OUT/duo-row-taps.log; : > $LOG
APP=dev.vespin.ios
X=184
# The folded Duo's Inbox rows' centers on the fixture, from the sweep's hierarchy (466x678 pt), and two points under the last row.
YS=(139 216 294 372 449 527 605 625 650)

fresh() {
  xcrun simctl terminate $U $APP >/dev/null 2>&1
  xcrun simctl launch $U $APP -fixture inbox >/dev/null 2>&1
  sleep 8
}
# The bars' frames in the hierarchy as it stands: every navigation bar, toolbar and tab bar, with the element the tap's row is.
frames() {
  idb ui describe-all --udid $U 2>/dev/null | python3 -c '
import json,sys
try: items=json.load(sys.stdin)
except Exception: print("frames unread"); sys.exit()
out=[]
for e in items:
    t=e.get("type","") or ""; r=e.get("role_description","") or ""; l=e.get("AXLabel") or ""
    if any(k in (t+" "+r) for k in ("NavigationBar","Toolbar","toolbar","TabBar","tab bar")):
        f=e.get("frame",{}); out.append("%s[%s] %d,%d %dx%d" % (t or r, l[:20], f.get("x",0), f.get("y",0), f.get("width",0), f.get("height",0)))
print("; ".join(out) or "no bars")
'
}
# Whether a thread's page stands in front: only it holds Send. Each read is kept under trees/ with the step that read it.
N=0
in_thread() {
  N=$((N + 1)); mkdir -p $OUT/trees
  idb ui describe-all --udid $U > $OUT/trees/$N-$1.json 2>&1
  grep -q '"AXLabel":"Send"' $OUT/trees/$N-$1.json
}

for r in $(seq 1 $ROUNDS); do
  for y in $YS; do
    fresh
    in_thread "r$r-y$y-before" && { echo "r$r y=$y SKIP a thread stands in front at launch" >> $LOG; continue; }
    hit=$(idb ui describe-point --udid $U $X $y 2>/dev/null | tr -d '\n' | sed -E 's/.*"AXLabel": ?"([^"]*)".*"type": ?"([^"]*)".*/\2: \1/' | cut -c1-90)
    bars=$(frames)
    idb ui tap --udid $U $X $y
    sleep 2
    if in_thread "r$r-y$y-after"; then res=pushed; else res=SWALLOWED; fi
    echo "r$r tap=($X,$y) $res | hit $hit | bars $bars" >> $LOG
  done
done

# The sweep's own path: pop from a thread, scroll down, then tap the last row, once with the list settled and once while it still coasts.
for wait in 2 0.3; do
  for r in $(seq 1 $ROUNDS); do
    fresh
    idb ui tap --udid $U $X 139; sleep 2
    idb ui swipe --udid $U 10 300 300 300 --duration 0.3; sleep 2
    idb ui swipe --udid $U 184 500 184 150 --duration 0.15; sleep $wait
    hit=$(idb ui describe-point --udid $U $X 605 2>/dev/null | tr -d '\n' | cut -c1-160)
    idb ui tap --udid $U $X 605; sleep 2
    if in_thread "pop$wait-r$r-after"; then res=pushed; else res=SWALLOWED; fi
    echo "pop wait=${wait}s r$r tap=($X,605) $res | hit $hit" >> $LOG
  done
done
idb ui describe-all --udid $U > $OUT/list-hierarchy.json 2>&1
xcrun simctl io $U screenshot $OUT/list.png >/dev/null 2>&1
echo DONE >> $LOG
