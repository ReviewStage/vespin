/**
 * host-bench.ts -- times the host's real task-list live queries (`taskListCollections`) over a busy account's rows, in worktrees side by side: the first draw of the kept list, the first whole answer, and what one moved live agent and one moved task cost.
 *
 * `bench.ts` cannot see these: its fixture lays its lists over the window's
 * document, so the host's live queries never run under it, and a change to
 * the tallies, the pull-request lines, or the summaries is invisible to it.
 * This one runs them in Node, V8 with its JIT as the desktop's main process
 * has, over the large seed (`host-seed.ts`: 3,240 plans, 5,400 agents, about
 * 93% archived). Each build is a worktree of the repository, and each
 * measurement runs in a fresh process of `host-worker.ts`, which loads that
 * worktree's own host. Every round runs each build's processes in turn,
 * interleaved, so a sandbox slowing down halfway through weighs on every
 * build alike. A figure is a process's own median; a cell is the range of the
 * rounds' figures. It is not a test: nothing is asserted, no CI job runs
 * it, and nothing it writes is committed.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** The two kinds of process a round runs per build, each a worker mode. */
const MODE = { KEPT: "kept", ANSWER: "answer", PAGED: "paged" } as const;

/** A worktree to time, by its label. */
interface Build {
  readonly label: string;
  readonly root: string;
}

/** A step's summary as the worker prints it. */
interface StepSummary {
  readonly median: number;
  readonly p95: number;
  readonly mean: number;
}

/** One worker's line. */
interface Measured {
  readonly keptDraw?: number;
  readonly keptTasks?: number;
  readonly keptAgents?: number;
  readonly firstAnswer?: number;
  readonly pagedTotal?: number;
  readonly pagedLongest?: number;
  readonly agentStep?: StepSummary;
  readonly taskStep?: StepSummary;
}

/** A figure a table reports: its words, and what to read off a round's line. */
interface Figure {
  readonly name: string;
  readonly mode: (typeof MODE)[keyof typeof MODE];
  readonly of: (line: Measured) => number | undefined;
}

const FIGURES: readonly Figure[] = [
  { name: "kept draw, tasks phase (ms)", mode: MODE.KEPT, of: (line) => line.keptTasks },
  { name: "kept draw, agents phase (ms)", mode: MODE.KEPT, of: (line) => line.keptAgents },
  { name: "kept draw, whole stand (ms)", mode: MODE.KEPT, of: (line) => line.keptDraw },
  { name: "first whole answer (ms)", mode: MODE.ANSWER, of: (line) => line.firstAnswer },
  {
    name: "first whole answer in pages, all (ms)",
    mode: MODE.PAGED,
    of: (line) => line.pagedTotal,
  },
  {
    name: "first whole answer in pages, longest (ms)",
    mode: MODE.PAGED,
    of: (line) => line.pagedLongest,
  },
  {
    name: "per moved live agent, median (ms)",
    mode: MODE.ANSWER,
    of: (line) => line.agentStep?.median,
  },
  {
    name: "per moved live agent, p95 (ms)",
    mode: MODE.ANSWER,
    of: (line) => line.agentStep?.p95,
  },
  {
    name: "per moved task, median (ms)",
    mode: MODE.ANSWER,
    of: (line) => line.taskStep?.median,
  },
  { name: "per moved task, p95 (ms)", mode: MODE.ANSWER, of: (line) => line.taskStep?.p95 },
];

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "../..");
const tsx = path.join(repositoryRoot, "node_modules/.bin/tsx");
const worker = path.join(here, "host-worker.ts");

const { values } = parseArgs({
  options: {
    build: { type: "string", multiple: true, default: [] },
    rounds: { type: "string", default: "6" },
    agents: { type: "string", default: "5400" },
    "kept-agents": { type: "string", default: "4831" },
    steps: { type: "string", default: "400" },
    only: { type: "string" },
    help: { type: "boolean", default: false },
  },
});

function say(words: string): void {
  process.stderr.write(`${words}\n`);
}

if (values.help) {
  say(`node tools/bench/host-bench.ts [--build <label>=<worktree> …] [options]

  --build         a worktree to time: before=../vespin-before (one or more; the
                  default is this checkout as here=.). Each needs its own
                  node_modules (./scripts/bootstrap.sh).
  --rounds        interleaved rounds (6)
  --agents        agents in the first-answer and moved-row runs (5400)
  --kept-agents   agents in the kept draw's local copy (4831, a phone's)
  --steps         moved agents, then moved tasks, per process (400)
  --only          kept | answer | paged: run one kind of process only

See tools/bench/README.md.`);
  process.exit(0);
}

const builds: Build[] = (values.build.length === 0 ? [`here=${repositoryRoot}`] : values.build).map(
  (flag) => {
    const split = flag.indexOf("=");

    if (split <= 0) throw new Error(`--build wants label=<worktree>, got ${flag}`);

    return { label: flag.slice(0, split), root: path.resolve(flag.slice(split + 1)) };
  },
);

const modes = Object.values(MODE).filter(
  (mode) => values.only === undefined || mode === values.only,
);

/** One fresh process of the worker over `build`, its line. */
function measure(build: Build, mode: string): Measured {
  const agents = mode === MODE.KEPT ? values["kept-agents"] : values.agents;

  const run = spawnSync(
    tsx,
    [worker, "--root", build.root, "--mode", mode, "--agents", agents, "--steps", values.steps],
    { cwd: build.root, encoding: "utf8", maxBuffer: 1 << 26, timeout: 600_000 },
  );

  const line = run.stdout.trim().split("\n").at(-1);

  if (run.status !== 0 || line === undefined || !line.startsWith("{")) {
    throw new Error(`${build.label} ${mode} failed:\n${run.stderr || run.stdout}`);
  }

  // SAFETY: the worker prints the JSON of a `Measured` as its last line.
  return JSON.parse(line) as Measured;
}

/** A cell: the lowest and highest of the rounds' figures. */
function cell(figures: readonly number[]): string {
  const low = Math.min(...figures);
  const high = Math.max(...figures);

  return low === high ? low.toFixed(1) : `${low.toFixed(1)}–${high.toFixed(1)}`;
}

const lines = new Map<string, Measured[]>(builds.map((build) => [build.label, []]));

for (let round = 0; round < Number(values.rounds); round += 1) {
  for (const mode of modes) {
    for (const build of builds) {
      lines.get(build.label)?.push(measure(build, mode));
      say(`${mode} · ${build.label} · round ${round + 1}`);
    }
  }
}

const shown = FIGURES.filter((figure) => modes.includes(figure.mode));
const width = Math.max(...shown.map((figure) => figure.name.length));

const header = [
  "".padEnd(width),
  ...builds.map((build) => build.label.padStart(Math.max(12, build.label.length))),
];

process.stdout.write(`${header.join("  ")}\n`);

for (const figure of shown) {
  const cells = builds.map((build) => {
    const figures = (lines.get(build.label) ?? [])
      .map(figure.of)
      .filter((value): value is number => value !== undefined);

    return cell(figures).padStart(Math.max(12, build.label.length));
  });

  process.stdout.write(`${[figure.name.padEnd(width), ...cells].join("  ")}\n`);
}
