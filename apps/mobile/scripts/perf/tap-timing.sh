#!/bin/zsh -l
# tap-timing.sh APP UDID FLOW OUT -- MEASUREMENT ONLY: install APP on the simulator UDID, record its screen while Maestro runs FLOW, pull the probe's log, and print each labeled tap's timings (analyze.py).
set -u
A=$1; U=$2; F=$3; O=$4; H=${0:A:h}
export JAVA_HOME=$(brew --prefix openjdk)/libexec/openjdk.jdk/Contents/Home; export PATH=$JAVA_HOME/bin:$PATH
rm -rf $O; mkdir -p $O/debug
xcrun simctl boot $U 2>/dev/null; xcrun simctl bootstatus $U -b >/dev/null 2>&1
xcrun simctl uninstall $U dev.vespin.ios 2>/dev/null; xcrun simctl install $U $A || { echo "INSTALL FAILED"; exit 2; }
# The recording's start, on the wall clock, timestamps its first frame.
( xcrun simctl io $U recordVideo --codec=h264 --force $O/screen.mp4 2>&1 | while IFS= read -r l; do print -r -- "$(python3 -c 'import time;print(f"{time.time()*1000:.0f}")') $l"; done > $O/record.log ) &
for i in {1..20}; do grep -q "Recording started" $O/record.log 2>/dev/null && break; sleep 0.5; done
maestro --device $U test --debug-output $O/debug --flatten-debug-output $F > $O/maestro.raw 2>&1; echo "maestro exit $?" > $O/status
pkill -INT -f "recordVideo.*$O/screen.mp4"; sleep 3
C=$(xcrun simctl get_app_container $U dev.vespin.ios data 2>/dev/null)
cat $C/Documents/perf-probe-*.jsonl > $O/probe.jsonl 2>/dev/null; echo >> $O/probe.jsonl
ffprobe -v error -select_streams v -show_entries frame=pts_time -of csv=p=0 $O/screen.mp4 > $O/frames.txt 2>/dev/null
python3 $H/analyze.py $O; rm -f $O/screen.mp4
