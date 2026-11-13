#!/bin/zsh -l
# job.sh TAG [REF...] -- MEASUREMENT ONLY: the probe branch with each REF merged over it, bundled (--no-minify, so components keep their names) into a copy of Nov 12's app, then tap-timing.sh on the iPhone 18 Pro and the landscape iOS 26.5 iPad. Results under ~/vespin-perf/TAG/.
# It builds in a worktree of its own (WT, default $W/perf-wt) off the rig's checkout (R, default $W/repo), so a failed merge never leaves the shared checkout mid-conflict; node_modules there are pnpm's hard links, and the worktree goes when the job ends.
# Env: PROFILE (1, the default: the profiling renderer and per-commit component walk, to find causes; 0: the production renderer, for a PR's before and after timings), W (the iPad agent's rig, default ~/vespin-ipad-agent), BASE (its Vmain.app), IPH and IPAD (UDIDs), DEVICES ("iphone ipad").
set -u
T=$1; shift
W=${W:-$HOME/vespin-ipad-agent}; BASE=${BASE:-$W/Vmain.app}
IPH=${IPH:-CE9E34B9-693F-475C-8AC7-308952029222}; IPAD=${IPAD:-ABD9B3FE-4859-40A8-85F9-63B98B47142F}
P=$HOME/vespin-perf; R=${R:-$W/repo}; O=$P/$T; mkdir -p $P; rm -rf $O; mkdir -p $O; L=$O/job.log
WT=${WT:-$W/perf-wt}
git -C $R fetch -q origin main "+refs/heads/chore/probe-tap-timing:refs/remotes/origin/chore/probe-tap-timing" && for ref in "$@"; do git -C $R fetch -q origin "+refs/heads/$ref:refs/remotes/origin/$ref" 2>/dev/null; done
git -C $R worktree remove --force $WT 2>/dev/null; rm -rf $WT; git -C $R worktree prune
git -C $R worktree add -q --detach $WT origin/chore/probe-tap-timing || { echo "WORKTREE FAILED" >> $L; exit 1; }
trap 'cd $HOME; git -C $R worktree remove --force $WT 2>/dev/null; rm -rf $WT; git -C $R worktree prune' EXIT
cd $WT
for ref in "$@"; do git -c user.name=perf -c user.email=perf@localhost merge -q --no-edit origin/$ref >> $L 2>&1 || { git merge --abort 2>/dev/null; echo "MERGE FAILED $ref" >> $L; exit 1; }; done
echo "built $(git rev-parse --short HEAD) = probe + $* (PROFILE=${PROFILE:-1})" >> $L
pnpm install --frozen-lockfile --prefer-offline > $O/install.log 2>&1; echo "install $?" >> $L
cd apps/mobile && rm -rf dist && env -u LC_ALL LANG=en_US.UTF-8 EXPO_NO_TELEMETRY=1 PERF_PROFILE=${PROFILE:-1} pnpm exec expo export --platform ios $([[ ${PROFILE:-1} == 1 ]] && echo --no-minify) --output-dir dist > $O/export.log 2>&1; echo "export $?" >> $L
A=$P/V$T.app; rm -rf $A && cp -R $BASE $A && cp dist/_expo/static/js/ios/*.hbc $A/main.jsbundle && rm -rf dist
codesign --force --sign - --preserve-metadata=entitlements,identifier,flags $A >/dev/null 2>&1; echo "signed $?" >> $L
H=$WT/apps/mobile/scripts/perf
for D in ${=DEVICES:-iphone ipad}; do
  [[ $D == iphone ]] && U=$IPH || U=$IPAD
  xcrun simctl boot $U 2>/dev/null; xcrun simctl bootstatus $U -b >/dev/null 2>&1; xcrun simctl ui $U appearance light
  $H/tap-timing.sh $A $U $WT/apps/mobile/maestro/perf/$D.yaml $O/$D > $O/$D.txt 2>&1
  echo "$D: $(cat $O/$D/status 2>/dev/null)" >> $L
  # The rig's floor: the same kind of taps on stock apps, recorded and read the same way.
  [[ ${FLOOR:-1} == 1 ]] && { $H/tap-timing.sh $A $U $WT/apps/mobile/maestro/perf/floor.yaml $O/$D-floor > $O/$D-floor.txt 2>&1; echo "$D floor: $(cat $O/$D-floor/status 2>/dev/null)" >> $L; }
  xcrun simctl shutdown $U 2>/dev/null
done
rm -rf $A; rm -f $O/*/screen.mp4.tmp; echo ALLDONE >> $L
