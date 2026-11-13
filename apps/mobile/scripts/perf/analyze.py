#!/usr/bin/env python3
"""analyze.py OUT -- MEASUREMENT ONLY: per labeled tap ("T:<path>"), from the probe's log, Maestro's commands and the recording's frames.

For each tap: when its first native event reached JS (the tap's moment in
JS), the React commits until the next command (count, components rendered,
fibers mounted, ms from the event to the last commit), the JS-thread stalls
in that span, and, from the screen recording (whose frames are written only
when the screen changes), the first changed frame and the frame the screen
settled on (no change for 400 ms). Prints a table per path, medians.
"""

import glob
import json
import os
import statistics
import sys
from collections import Counter, defaultdict

OUT = sys.argv[1]
SETTLE_GAP_MS = 400
WINDOW_MS = 3000


def load_probe():
    rows = []
    with open(os.path.join(OUT, "probe.jsonl")) as f:
        for line in f:
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    rows.sort(key=lambda r: r["t"])
    return rows


def find_label(node):
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "label" and isinstance(value, str):
                return value
            found = find_label(value)
            if found:
                return found
    elif isinstance(node, list):
        for value in node:
            found = find_label(value)
            if found:
                return found
    return None


def load_commands():
    files = glob.glob(os.path.join(OUT, "debug", "**", "commands-*.json"), recursive=True)
    commands = []
    for path in files:
        with open(path) as f:
            for entry in json.load(f):
                meta = entry.get("metadata", {})
                start = meta.get("timestamp")
                if start is None:
                    continue
                commands.append(
                    {
                        "label": find_label(entry.get("command")),
                        "start": start,
                        "duration": meta.get("duration") or 0,
                        "status": meta.get("status"),
                    }
                )
    commands.sort(key=lambda c: c["start"])
    return commands


def load_frames():
    start = None
    with open(os.path.join(OUT, "record.log")) as f:
        for line in f:
            if "Recording started" in line:
                start = int(line.split(" ", 1)[0])
                break
    if start is None:
        return []
    frames = []
    with open(os.path.join(OUT, "frames.txt")) as f:
        for line in f:
            line = line.strip().rstrip(",")
            if line:
                try:
                    frames.append(start + float(line) * 1000)
                except ValueError:
                    pass
    return frames


def median(values):
    values = [v for v in values if v is not None]
    return round(statistics.median(values)) if values else None


def main():
    probe = load_probe()
    commands = load_commands()
    frames = load_frames()
    events = [r for r in probe if r["kind"] == "event"]
    commits = [r for r in probe if r["kind"] == "commit"]
    stalls = [r for r in probe if r["kind"] == "stall"]

    taps = defaultdict(list)
    for i, command in enumerate(commands):
        label = command["label"]
        if not label or not label.startswith("T:"):
            continue
        start = command["start"]
        end = commands[i + 1]["start"] if i + 1 < len(commands) else start + WINDOW_MS
        end = min(end, start + command["duration"] + WINDOW_MS)
        first_event = next((e for e in events if start <= e["t"] < end), None)
        moment = first_event["t"] if first_event else None
        mine = [c for c in commits if (moment or start) <= c["t"] < end]
        rendered = Counter()
        for c in mine:
            for name, count in c.get("top", []):
                rendered[name] += count
        stall_ms = sum(s["ms"] for s in stalls if (moment or start) <= s["t"] < end)
        walk_ms = sum(c.get("walkMs", 0) for c in mine)
        anchor = moment or start
        changed = [f for f in frames if anchor - 30 <= f < end]
        first_frame = changed[0] if changed else None
        settle = None
        if changed:
            settle = changed[0]
            for f in changed[1:]:
                if f - settle > SETTLE_GAP_MS:
                    break
                settle = f
        taps[label[2:]].append(
            {
                "event": first_event["name"] if first_event else None,
                "event_after_cmd": round(moment - start) if moment else None,
                "commits": len(mine),
                "rendered": sum(c["rendered"] for c in mine),
                "mounted": sum(c["mounted"] for c in mine),
                "to_last_commit": round(mine[-1]["t"] - anchor) if mine else None,
                "stall": stall_ms,
                "walk": round(walk_ms),
                "to_first_frame": round(first_frame - anchor) if first_frame else None,
                "to_settle": round(settle - anchor) if settle else None,
                "top": rendered.most_common(12),
            }
        )

    print(f"probe rows {len(probe)}, commands {len(commands)}, frames {len(frames)}")
    print(
        "path | n | event | ev-after-cmd | commits | comps rendered | mounted | "
        "to last commit | stalls ms | probe walk ms | to 1st frame | to settle"
    )
    for path, rows in taps.items():
        print(
            " | ".join(
                str(x)
                for x in [
                    path,
                    len(rows),
                    Counter(r["event"] for r in rows).most_common(1)[0][0],
                    median([r["event_after_cmd"] for r in rows]),
                    median([r["commits"] for r in rows]),
                    median([r["rendered"] for r in rows]),
                    median([r["mounted"] for r in rows]),
                    median([r["to_last_commit"] for r in rows]),
                    median([r["stall"] for r in rows]),
                    median([r["walk"] for r in rows]),
                    median([r["to_first_frame"] for r in rows]),
                    median([r["to_settle"] for r in rows]),
                ]
            )
        )
    print("\nmost rendered components per path (summed over its taps):")
    for path, rows in taps.items():
        total = Counter()
        for r in rows:
            for name, count in r["top"]:
                total[name] += count
        print(f"{path}: " + ", ".join(f"{n}×{c}" for n, c in total.most_common(14)))
    # Background churn: commits and rendered components per second while nothing is tapped.
    if probe:
        span = (probe[-1]["t"] - probe[0]["t"]) / 1000
        print(
            f"\nwhole run: {span:.0f}s, {len(commits)} commits, "
            f"{sum(c['rendered'] for c in commits)} components rendered, "
            f"{sum(s['ms'] for s in stalls)} ms of stalls over {len(stalls)} stalls"
        )
        names = Counter(e["name"] for e in events)
        print("events: " + ", ".join(f"{n}×{c}" for n, c in names.most_common(15)))
    with open(os.path.join(OUT, "taps.json"), "w") as f:
        json.dump(taps, f)


main()
