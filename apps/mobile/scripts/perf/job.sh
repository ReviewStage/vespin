#!/bin/zsh -l
# job.sh TAG [REF...] -- MEASUREMENT ONLY: the probe branch with each REF merged over it, bundled (--no-minify, so components keep their names) into a copy of Nov 12's app, then tap-timing.sh on the iPhone 18 Pro and the landscape iOS 26.5 iPad. Results under ~/vespin-perf/TAG/.
# It uses the rig's own checkout (R, default $W/repo) between the rig's jobs, so no second node_modules is made.
# Env: W (the iPad agent's rig, default ~/vespin-ipad-agent), BASE (its Vmain.app), IPH and IPAD (UDIDs), DEVICES ("iphone ipad").
set -u
T=$1; shift
W=${W:-$HOME/vespin-ipad-agent}; BASE=${BASE:-$W/Vmain.app}
IPH=${IPH:-CE9E34B9-693F-475C-8AC7-308952029222}; IPAD=${IPAD:-ABD9B3FE-4859-40A8-85F9-63B98B47142F}
P=$HOME/vespin-perf; R=${R:-$W/repo}; O=$P/$T; mkdir -p $P; rm -rf $O; mkdir -p $O; L=$O/job.log
cd $R && git checkout -q -- . && git fetch -q origin main "+refs/heads/chore/probe-tap-timing:refs/remotes/origin/chore/probe-tap-timing" && for ref in "$@"; do git fetch -q origin "+refs/heads/$ref:refs/remotes/origin/$ref" 2>/dev/null; done
git checkout -q --detach origin/chore/probe-tap-timing || { echo "CHECKOUT FAILED" >> $L; exit 1; }
for ref in "$@"; do git -c user.name=perf -c user.email=perf@localhost merge -q --no-edit origin/$ref >> $L 2>&1 || git -c user.name=perf -c user.email=perf@localhost merge -q --no-edit $ref >> $L 2>&1 || { echo "MERGE FAILED $ref" >> $L; exit 1; }; done
echo "built $(git rev-parse --short HEAD) = probe + $*" >> $L
pnpm install --frozen-lockfile > $O/install.log 2>&1; echo "install $?" >> $L
cd apps/mobile && rm -rf dist && env -u LC_ALL LANG=en_US.UTF-8 EXPO_NO_TELEMETRY=1 pnpm exec expo export --platform ios --no-minify --output-dir dist > $O/export.log 2>&1; echo "export $?" >> $L
A=$P/V$T.app; rm -rf $A && cp -R $BASE $A && cp dist/_expo/static/js/ios/*.hbc $A/main.jsbundle && rm -rf dist
codesign --force --sign - --preserve-metadata=entitlements,identifier,flags $A >/dev/null 2>&1; echo "signed $?" >> $L
H=$R/apps/mobile/scripts/perf
for D in ${=DEVICES:-iphone ipad}; do
  [[ $D == iphone ]] && U=$IPH || U=$IPAD
  xcrun simctl boot $U 2>/dev/null; xcrun simctl bootstatus $U -b >/dev/null 2>&1; xcrun simctl ui $U appearance light
  $H/tap-timing.sh $A $U $R/apps/mobile/maestro/perf/$D.yaml $O/$D > $O/$D.txt 2>&1
  echo "$D: $(cat $O/$D/status 2>/dev/null)" >> $L
  xcrun simctl shutdown $U 2>/dev/null
done
rm -rf $A; rm -f $O/*/screen.mp4.tmp; echo ALLDONE >> $L
