#!/usr/bin/env python3
"""frames.py -- for one journey's cfr60.mp4: every frame-to-frame change (ffmpeg scene score), each Maestro step on the video's clock, and a contact sheet of the 0.5 s after each tap/back/launch/key step.

Usage: frames.py <journey dir> <out dir>
"""
import glob, json, os, re, subprocess, sys

jdir, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
video = os.path.join(jdir, "cfr60.mp4")
started = int(open(os.path.join(jdir, "started-ms")).read().strip())

log = subprocess.run(
    ["ffmpeg", "-hide_banner", "-i", video, "-vf", "select='gte(scene,0)',metadata=print", "-an", "-f", "null", "-"],
    capture_output=True, text=True).stderr
scores, t = [], None
for line in log.splitlines():
    m = re.search(r"pts_time:([0-9.]+)", line)
    if m: t = float(m.group(1))
    m = re.search(r"lavfi.scene_score=([0-9.]+)", line)
    if m and t is not None: scores.append((t, float(m.group(1))))
json.dump(scores, open(os.path.join(out, "scores.json"), "w"))

steps = []
for f in sorted(glob.glob(os.path.join(jdir, "commands-*.json")) + glob.glob(os.path.join(jdir, "debug*", "commands-*.json"))):
    try: data = json.load(open(f))
    except Exception: continue
    for entry in data:
        cmd = entry.get("command", {}); meta = entry.get("metadata", {})
        ts = meta.get("timestamp")
        if ts is None: continue
        name = next(iter(cmd), "?")
        steps.append({"t": round((ts - started) / 1000.0, 3), "step": name,
                      "detail": json.dumps(cmd.get(name), default=str)[:90],
                      "status": meta.get("status"), "ms": meta.get("duration")})
steps.sort(key=lambda s: s["t"])
json.dump(steps, open(os.path.join(out, "steps.json"), "w"), indent=1)

FLOOR = 0.002
bursts, cur = [], None
for t, s in scores:
    if s > FLOOR:
        if cur and t - cur["end"] <= 0.05: cur["end"] = t; cur["peak"] = max(cur["peak"], s); cur["frames"] += 1
        else: cur = {"start": t, "end": t, "peak": s, "frames": 1}; bursts.append(cur)
json.dump(bursts, open(os.path.join(out, "bursts.json"), "w"), indent=1)

def sheet(t0, name, n=30):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{max(0,t0):.3f}", "-i", video,
                    "-frames:v", "1", "-vf", f"select='lt(n,{n})',scale=180:-2,tile=6x{(n+5)//6}",
                    os.path.join(out, name)], check=False)
for i, s in enumerate(steps):
    if any(k in s["step"].lower() for k in ("tap", "launch", "presskey", "back", "inputtext", "swipe")):
        sheet(s["t"], f"s{i:03d}-{s['step']}.png")
print(f"{len(scores)} frames, {len(steps)} steps, {len(bursts)} bursts -> {out}")
