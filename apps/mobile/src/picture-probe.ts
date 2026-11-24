// picture-probe.ts -- PROBE ONLY, never merged: how long N pictures take to land by the old read (fetch, base64 on the JS thread, a write), by the native download into a file, and by a lookup of the file kept, with the JS thread's stalls in each, written to Documents/picture-probe.json for the Mac rig to read.
//
// Run as `xcrun simctl launch booted dev.vespin.ios -fixture inbox -pictureProbe http://127.0.0.1:8765/`,
// against a server on the Mac whose `index.txt` lists the pictures' names, one a line.

import { Base64 } from "effect/encoding";
import { File, Paths } from "expo-file-system";
import { downloadAsync } from "expo-file-system/legacy";
import { Platform, Settings } from "react-native";

/** A gap between ticks longer than this is the JS thread held by work. */
const STALL_MS = 34;
const TICK_MS = 8;

/** How long after the bundle loads the probe starts, so the launch's own work is done. */
const START_AFTER_MS = 6_000;

/** How many times each path runs, the first warming nothing but measured too. */
const ROUNDS = 3;

const PATH = { BASE64: "base64", DOWNLOAD: "download", KEPT: "kept" } as const;

type Path = (typeof PATH)[keyof typeof PATH];

interface Phase {
  readonly path: Path;
  readonly round: number;
  readonly totalMs: number;
  readonly perPictureMs: readonly number[];
  readonly bytes: number;
  readonly stallCount: number;
  readonly stallMaxMs: number;
  readonly stallSumMs: number;
}

const rounded = (ms: number) => Math.round(ms * 10) / 10;

/** The JS thread's stalls while `run` runs: each gap between ticks past `STALL_MS`. */
async function watched<T>(run: () => Promise<T>): Promise<{ value: T; stalls: number[] }> {
  const stalls: number[] = [];
  let last = performance.now();
  let watching = true;

  const tick = () => {
    const now = performance.now();

    if (now - last > STALL_MS) stalls.push(now - last);
    last = now;

    if (watching) setTimeout(tick, TICK_MS);
  };

  setTimeout(tick, TICK_MS);
  const value = await run();
  watching = false;

  return { value, stalls };
}

/** The old read: the body fetched whole, spelled in base64 on the JS thread, and written from it. */
async function base64Read(url: string, file: File): Promise<number> {
  const response = await fetch(url);
  const base64 = Base64.encode(new Uint8Array(await response.arrayBuffer()));
  file.write(base64, { encoding: "base64" });

  return file.size;
}

/** The new read: the body downloaded by the system's URL session straight into the file. */
async function downloadRead(url: string, file: File): Promise<number> {
  await downloadAsync(url, file.uri);

  return file.size;
}

/** The revisit: the file kept looked up. */
async function keptRead(_url: string, file: File): Promise<number> {
  return file.exists ? file.size : 0;
}

const READ = { [PATH.BASE64]: base64Read, [PATH.DOWNLOAD]: downloadRead, [PATH.KEPT]: keptRead };

/** One path over every picture at once, as a transcript asks for the pictures on screen together. */
async function phase(path: Path, round: number, urls: readonly string[]): Promise<Phase> {
  const files = urls.map(
    (_, at) =>
      new File(Paths.cache, `probe-${path === PATH.KEPT ? PATH.DOWNLOAD : path}-${at}.png`),
  );

  if (path !== PATH.KEPT) for (const file of files) if (file.exists) file.delete();

  const start = performance.now();

  const { value, stalls } = await watched(() =>
    Promise.all(
      urls.map(async (url, at) => {
        const asked = performance.now();
        const bytes = await READ[path](url, files[at] as File);

        return { ms: performance.now() - asked, bytes };
      }),
    ),
  );

  return {
    path,
    round,
    totalMs: rounded(performance.now() - start),
    perPictureMs: value.map(({ ms }) => rounded(ms)),
    bytes: value.reduce((sum, { bytes }) => sum + bytes, 0),
    stallCount: stalls.length,
    stallMaxMs: rounded(Math.max(0, ...stalls)),
    stallSumMs: rounded(stalls.reduce((sum, ms) => sum + ms, 0)),
  };
}

async function run(base: string): Promise<void> {
  const out = new File(Paths.document, "picture-probe.json");

  try {
    const index = await (await fetch(`${base}index.txt`)).text();
    const names = index.split("\n").filter(Boolean);
    const urls = names.map((name) => `${base}${name}`);
    const phases: Phase[] = [];

    for (let round = 1; round <= ROUNDS; round += 1) {
      for (const path of [PATH.BASE64, PATH.DOWNLOAD, PATH.KEPT])
        phases.push(await phase(path, round, urls));
    }

    out.write(JSON.stringify({ pictures: names.length, phases }, null, 2));
  } catch (cause) {
    out.write(JSON.stringify({ error: String(cause) }));
  }
}

const base = Platform.OS === "ios" ? Settings.get("pictureProbe") : undefined;

if (typeof base === "string" && base.length > 0) setTimeout(() => void run(base), START_AFTER_MS);
