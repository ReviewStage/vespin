/**
 * bench.ts -- times what one step of a moving row costs the web client's window, in builds side by side: script time and the components each step draws again.
 *
 * Each scene is an address of a served build of `apps/web`, the large stage
 * of the tasks-open fixture (`?fixture=tasks-open&scale=large&move=…&every=0`,
 * `packages/panel/src/tasks/open-tasks-fixture.ts`), and what to run on the
 * page once it stands (`setup`), a step to another place, say. Each round
 * opens every scene on every build in turn, interleaved, so a sandbox
 * slowing down halfway through weighs on both sides alike. On each page it
 * takes `warm` steps it does not count, then `steps` it does, each through
 * the stage's own door (`vespinFixtureStep()`), waiting `settle`
 * milliseconds after each for the window to finish drawing:
 *
 * - script ms: CDP's `ScriptDuration` (`Performance.getMetrics`) across the
 *   step, the stage's own staging included, which both builds pay alike;
 * - components: the function and class components React ran in the step's
 *   commits, counted by a shim standing in for React DevTools' hook. A
 *   component counts once per commit where it rendered: mounted, or marked as
 *   having done work. Only children of a fiber whose children changed are
 *   walked, as DevTools walks them, since a bailed-out subtree keeps the
 *   flags of the commit it last rendered in;
 * - commits: how many commits React made.
 *
 * Each figure is the median step of a round; a cell is the range of the
 * rounds' medians. `--names` adds a row for each component named, how many
 * times it rendered per step. It is not a test: nothing is asserted, no CI
 * job runs it, and nothing it writes is committed. Playwright is not a
 * dependency of the workspace: it is found beside the script, or in the
 * global npm folder, as `tools/polish` finds it.
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { parseArgs } from "node:util";

/** What a scene names: its label, the address under a build's base, and what to run once the page stands. */
interface Scene {
  readonly label: string;
  readonly address: string;
  readonly setup: string | undefined;
}

/** A build to time: its label and the base it is served at. */
interface Build {
  readonly label: string;
  readonly base: string;
}

/** What one step cost. */
interface StepCost {
  readonly scriptMs: number;
  readonly components: number;
  readonly commits: number;
  readonly named: ReadonlyMap<string, number>;
}

/** The little of Playwright this script drives. */
interface Playwright {
  chromium: { launch(): Promise<Browser> };
}

interface Browser {
  newContext(options: { viewport: { width: number; height: number } }): Promise<Context>;
  close(): Promise<void>;
}

interface Context {
  newPage(): Promise<Page>;
  newCDPSession(page: Page): Promise<CdpSession>;
  close(): Promise<void>;
}

interface Page {
  addInitScript(script: { content: string }): Promise<void>;
  goto(url: string, options: { waitUntil: "load" }): Promise<void>;
  waitForFunction(script: string, arg: undefined, options: { timeout: number }): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<Result>(script: string): Promise<Result>;
}

interface CdpSession {
  send(method: "Performance.enable"): Promise<void>;
  send(method: "Performance.getMetrics"): Promise<{ metrics: { name: string; value: number }[] }>;
}

/** The window's size, the one Vespin opens in. */
const VIEWPORT = { width: 1280, height: 840 } as const;

/**
 * The shim standing in for React DevTools' hook, laid before the page's
 * scripts: it counts each commit and the components rendered in it into
 * `window.__benchRenders`, which the bench reads and clears around a step.
 * React's own constants: the component tags (function 0, class 1,
 * forwardRef 11, memo 14, simple memo 15) and the PerformedWork flag (1).
 */
const RENDER_SHIM = `(() => {
  const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]);
  const PERFORMED_WORK = 1;
  const tally = { commits: 0, components: 0, named: {} };
  window.__benchRenders = tally;
  const nameOf = (fiber) => {
    const type = fiber.type && fiber.type.type ? fiber.type.type : fiber.type;
    return (type && (type.displayName || type.name)) || "Anonymous";
  };
  const rendered = (fiber, previous) =>
    previous === null || (fiber.flags & PERFORMED_WORK) === PERFORMED_WORK;
  const walk = (fiber, previous) => {
    if (COMPONENT_TAGS.has(fiber.tag) && fiber.tag !== 14 && rendered(fiber, previous)) {
      tally.components += 1;
      const name = nameOf(fiber);
      tally.named[name] = (tally.named[name] || 0) + 1;
    }
    if (previous !== null && previous.child === fiber.child) return;
    for (let child = fiber.child; child !== null; child = child.sibling) walk(child, child.alternate);
  };
  let renderers = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject(renderer) { renderers += 1; this.renderers.set(renderers, renderer); return renderers; },
    checkDCE() {},
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      tally.commits += 1;
      const current = root.current;
      const previous = current.alternate;
      if (previous !== null && previous.child === current.child) return;
      for (let child = current.child; child !== null; child = child.sibling) walk(child, child.alternate);
    },
  };
})();`;

/** Reads and clears the shim's tally. */
const TAKE_RENDERS = `(() => {
  const tally = window.__benchRenders;
  const taken = { commits: tally.commits, components: tally.components, named: tally.named };
  tally.commits = 0; tally.components = 0; tally.named = {};
  return taken;
})()`;

/** One line to the terminal. */
function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** Playwright, from beside this script or from the global npm folder. */
function loadPlaywright(): Playwright {
  const require = createRequire(import.meta.url);

  try {
    // SAFETY: the playwright package's main export is the module `Playwright` names.
    return require("playwright") as Playwright;
  } catch {
    const root = spawnSync("npm", ["root", "-g"], { encoding: "utf8" }).stdout.trim();

    try {
      // SAFETY: the global playwright package's main export is the module `Playwright` names.
      return require(path.join(root, "playwright")) as Playwright;
    } catch {
      throw new Error(
        "Playwright is not installed: run `npm install -g playwright && playwright install chromium`",
      );
    }
  }
}

/** A `label=value` flag, split at its first `=`. */
interface LabeledFlag {
  readonly label: string;
  readonly value: string;
}

/** A `label=value` flag split at its first `=`. */
function labeled(flag: string, what: string): LabeledFlag {
  const at = flag.indexOf("=");

  if (at <= 0) throw new Error(`--${what} takes label=value, not "${flag}"`);

  return { label: flag.slice(0, at), value: flag.slice(at + 1) };
}

/** The median of `values`. */
function median(values: readonly number[]): number {
  const sorted = values.toSorted((one, other) => one - other);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** The page's script time so far, in milliseconds. */
async function scriptMs(session: CdpSession): Promise<number> {
  const { metrics } = await session.send("Performance.getMetrics");

  return (metrics.find((metric) => metric.name === "ScriptDuration")?.value ?? 0) * 1000;
}

/** Opens `scene` on `build` and times `steps` steps after `warm` uncounted ones. */
async function timeScene(
  browser: Browser,
  build: Build,
  scene: Scene,
  options: { readonly warm: number; readonly steps: number; readonly settle: number },
): Promise<StepCost[]> {
  const context = await browser.newContext({ viewport: VIEWPORT });

  try {
    const page = await context.newPage();
    await page.addInitScript({ content: RENDER_SHIM });
    const session = await context.newCDPSession(page);
    await session.send("Performance.enable");
    await page.goto(new URL(scene.address, build.base).toString(), { waitUntil: "load" });
    await page.waitForFunction("typeof window.vespinFixtureStep === 'function'", undefined, {
      timeout: 60_000,
    });
    await page.waitForTimeout(3000);

    if (scene.setup !== undefined) {
      await page.evaluate(scene.setup);
      await page.waitForTimeout(3000);
    }

    const costs: StepCost[] = [];

    for (let step = 0; step < options.warm + options.steps; step += 1) {
      await page.evaluate(TAKE_RENDERS);
      const before = await scriptMs(session);
      await page.evaluate("window.vespinFixtureStep()");
      await page.waitForTimeout(options.settle);
      const after = await scriptMs(session);

      const renders = await page.evaluate<{
        commits: number;
        components: number;
        named: Record<string, number>;
      }>(TAKE_RENDERS);

      if (step < options.warm) continue;
      costs.push({
        scriptMs: after - before,
        components: renders.components,
        commits: renders.commits,
        named: new Map(Object.entries(renders.named)),
      });
    }

    return costs;
  } finally {
    await context.close();
  }
}

/** A cell of the table: the range of the rounds' medians, to `digits` places. */
function rangeCell(medians: readonly number[], digits: number): string {
  const low = Math.min(...medians).toFixed(digits);
  const high = Math.max(...medians).toFixed(digits);

  return low === high ? low : `${low}–${high}`;
}

/** Prints one scene's table, a column for each build. */
function printScene(
  scene: Scene,
  builds: readonly Build[],
  rounds: ReadonlyMap<string, StepCost[][]>,
  names: readonly string[],
): void {
  const head = `| ${scene.label}, per step | ${builds.map((build) => build.label).join(" | ")} |`;
  say("");
  say(head);
  say(`| --- | ${builds.map(() => "---").join(" | ")} |`);

  const row = (label: string, figure: (cost: StepCost) => number, digits: number) => {
    const cells = builds.map((build) =>
      rangeCell(
        (rounds.get(build.label) ?? []).map((costs) => median(costs.map(figure))),
        digits,
      ),
    );

    say(`| ${label} | ${cells.join(" | ")} |`);
  };

  row("script ms", (cost) => cost.scriptMs, 1);
  row("components rendered", (cost) => cost.components, 0);
  row("commits", (cost) => cost.commits, 1);

  for (const name of names) row(`\`${name}\` renders`, (cost) => cost.named.get(name) ?? 0, 1);
}

/** Prints the components rendered most in the last round of each build, for finding what to name with `--names`. */
function printTop(scene: Scene, rounds: ReadonlyMap<string, StepCost[][]>, top: number): void {
  for (const [label, costs] of rounds) {
    const totals = new Map<string, number>();
    const last = costs.at(-1) ?? [];

    for (const cost of last) {
      for (const [name, count] of cost.named) totals.set(name, (totals.get(name) ?? 0) + count);
    }

    const ranked = [...totals]
      .toSorted((one, other) => other[1] - one[1])
      .slice(0, top)
      .map(([name, count]) => `${name} ${(count / Math.max(last.length, 1)).toFixed(1)}`);

    say(`  ${scene.label} · ${label}: ${ranked.join(", ")}`);
  }
}

const { values } = parseArgs({
  options: {
    build: { type: "string", multiple: true },
    scene: { type: "string", multiple: true },
    setup: { type: "string", multiple: true },
    rounds: { type: "string", default: "3" },
    steps: { type: "string", default: "20" },
    warm: { type: "string", default: "3" },
    settle: { type: "string", default: "150" },
    names: { type: "string", default: "" },
    top: { type: "string", default: "0" },
    help: { type: "boolean", default: false },
  },
});

if (values.help || values.build === undefined || values.scene === undefined) {
  say(`node tools/bench/bench.ts --build <label>=<base> … --scene <label>=<address> … [options]

  --build    a served build: before=http://localhost:4310 (one or more)
  --scene    an address under each build: open=/app?fixture=tasks-open&scale=large&move=task&every=0
  --setup    label=<script> run on that scene's page once it stands, a step to another place say
  --rounds   interleaved rounds (3)      --steps   steps timed per page (20)
  --warm     steps taken first, uncounted (3)
  --settle   milliseconds waited after each step for the window to draw (150)
  --names    comma-separated components to count per step: MainTabBars,OverviewAgents
  --top      list each build's N components rendered most per step (0)

See tools/bench/README.md.`);
  process.exit(values.help ? 0 : 1);
}

const builds = values.build.map((flag) => {
  const { label, value } = labeled(flag, "build");

  return { label, base: value };
});

const setups = new Map(
  (values.setup ?? []).map((flag) => {
    const { label, value } = labeled(flag, "setup");

    return [label, value] as const;
  }),
);

const scenes: Scene[] = values.scene.map((flag) => {
  const { label, value } = labeled(flag, "scene");

  return { label, address: value, setup: setups.get(label) };
});

const options = {
  warm: Number(values.warm),
  steps: Number(values.steps),
  settle: Number(values.settle),
};

const names = values.names.split(",").filter((name) => name !== "");
const browser = await loadPlaywright().chromium.launch();

try {
  for (const scene of scenes) {
    const rounds = new Map<string, StepCost[][]>(builds.map((build) => [build.label, []]));

    for (let round = 0; round < Number(values.rounds); round += 1) {
      for (const build of builds) {
        const costs = await timeScene(browser, build, scene, options);
        rounds.get(build.label)?.push(costs);
        say(`${scene.label} · ${build.label} · round ${round + 1}: ${costs.length} steps`);
      }
    }

    printScene(scene, builds, rounds, names);

    if (Number(values.top) > 0) printTop(scene, rounds, Number(values.top));
  }
} finally {
  await browser.close();
}
