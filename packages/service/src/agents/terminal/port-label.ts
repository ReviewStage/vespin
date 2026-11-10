/**
 * port-label.ts -- the few words that say what serves a port in an agent's sandbox, such as `storybook dev` or `pnpm dev · web`, made from the command line of the process that listens on it.
 *
 * A label is built from names alone: the program, the script or package it
 * runs, its first subcommand, and the package or folder a package manager
 * was pointed at. A flag's value, an address, or any word past the first is
 * never kept, since a command line can carry a secret, and a word is kept
 * only where it reads as a name (`NAME`). An interpreter (`node`, `python`)
 * is named by what it runs, a script under `node_modules` by its package,
 * and a runner (`npx`, `pnpm exec`) by the command it runs.
 */

/** A name a label may keep: short, lower case, and starting with a letter, as a program's, a script's, or a package's name reads. */
const NAME = /^[a-z][a-z0-9._:-]{0,31}$/;

/** A subcommand or a script a label may keep: shorter still, and with no digit, as `dev` or `dev:web` reads and a token rarely does. */
const VERB = /^[a-z][a-z:-]{0,23}$/;

/** Programs named by the script or module they run rather than their own name. */
const INTERPRETERS: ReadonlySet<string> = new Set(["node", "nodejs", "deno", "tsx", "ts-node"]);

/** Python, of whichever version, named by the module or script it runs. */
const PYTHON = /^python[0-9.]*$/;

/** Package managers, named with the script they run and where. */
const PACKAGE_MANAGERS: ReadonlySet<string> = new Set(["npm", "pnpm", "yarn", "bun"]);

/** Runners named by the command they run. */
const RUNNERS: ReadonlySet<string> = new Set(["npx", "pnpx", "bunx", "env"]);

/** A package manager's words that run the command after them, as a runner does. */
const PASSES_ON: ReadonlySet<string> = new Set(["exec", "dlx", "x"]);

/** A package manager's words before the script it runs. */
const RUNS_SCRIPT: ReadonlySet<string> = new Set(["run", "run-script"]);

/** A package manager's flags whose value names the package or folder it runs in. */
const PLACE_FLAGS: ReadonlySet<string> = new Set([
  "--filter",
  "-F",
  "-C",
  "--dir",
  "--cwd",
  "--prefix",
  "--workspace",
  "-w",
]);

/** The same flags written with their value after `=`. */
const PLACE_FLAG_VALUE = /^--(?:filter|dir|cwd|prefix|workspace)=(.+)$/;

/** Between what runs and where. */
const PLACE_JOIN = " · ";

/** A path's last segment. */
function baseName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? "";
}

/** A word, where it reads as a name. */
function named(word: string | undefined): string | undefined {
  return word !== undefined && NAME.test(word) ? word : undefined;
}

/** The name a package or folder a package manager was pointed at goes by: `@repo/web`, `./apps/web`, and `web...` are all `web`. */
function placeOf(value: string): string | undefined {
  return named(baseName(value.replace(/^!/, "").replace(/\.{3}$/, "")));
}

/** What a script an interpreter runs is called: its package where it lies under `node_modules`, its own name, less its extension, otherwise. */
function scriptName(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const modules = segments.lastIndexOf("node_modules");
  if (modules === -1) return named(baseName(path).replace(/\.[^.]+$/, ""));
  const first = segments[modules + 1];
  const second = segments[modules + 2];
  // Note that `.bin` holds a package's commands by name, and a scoped package is named without its scope.
  return named(first === ".bin" || first?.startsWith("@") === true ? second : first);
}

/** A program and the subcommand right after it, where one stands there. */
function withSubcommand(name: string | undefined, rest: readonly string[]): string | undefined {
  if (name === undefined) return undefined;
  const subcommand = rest[0] !== undefined && VERB.test(rest[0]) ? rest[0] : undefined;
  return subcommand === undefined ? name : `${name} ${subcommand}`;
}

/** What an interpreter runs: a Python module given by `-m`, or the first word that is not a flag. */
function interpreted(program: string, rest: readonly string[]): string | undefined {
  const module = rest.indexOf("-m");
  if (PYTHON.test(program) && module !== -1) {
    return withSubcommand(named(rest[module + 1]), rest.slice(module + 2));
  }
  const at = rest.findIndex((word) => !word.startsWith("-") && word !== "run");
  if (at === -1) return program;
  return withSubcommand(scriptName(rest[at] ?? ""), rest.slice(at + 1));
}

/** A package manager's run: the script it runs and the package or folder it was pointed at, or the command it passes on to. */
function managed(manager: string, rest: readonly string[]): string | undefined {
  let place: string | undefined;
  for (let at = 0; at < rest.length; at++) {
    const word = rest[at] ?? "";
    const valued = PLACE_FLAG_VALUE.exec(word)?.[1];
    if (valued !== undefined) place = placeOf(valued);
    else if (PLACE_FLAGS.has(word) || (manager === "yarn" && word === "workspace")) {
      place = placeOf(rest[at + 1] ?? "");
      at++;
    } else if (PASSES_ON.has(word)) return labelOf(rest.slice(at + 1));
    else if (!word.startsWith("-") && !RUNS_SCRIPT.has(word)) {
      // Note that bun runs a file as an interpreter does.
      if (manager === "bun" && word.includes(".")) return interpreted(manager, rest.slice(at));
      if (!VERB.test(word)) return manager;
      const script = word;
      return place === undefined
        ? `${manager} ${script}`
        : `${manager} ${script}${PLACE_JOIN}${place}`;
    }
  }
  return manager;
}

/** Whether a runner's word is the command it runs, rather than a flag or an assignment. */
function isCommand(word: string): boolean {
  return !word.startsWith("-") && !word.includes("=");
}

/** The label of a command line, by the rules above; none where nothing in it reads as a name. */
export function labelOf(argv: readonly string[]): string | undefined {
  // Note that a process that renamed itself, as `next-server (v15.0.0)` does, reads as one word with spaces.
  const words = argv.length === 1 ? (argv[0] ?? "").trim().split(/\s+/) : argv;
  const [first, ...rest] = words;
  if (first === undefined || first === "") return undefined;
  const program = baseName(first);
  if (RUNNERS.has(program)) {
    // Note that a runner's own flags and an environment's assignments come before the command it runs.
    const command = rest.findIndex(isCommand);
    return command === -1 ? undefined : labelOf(rest.slice(command));
  }
  if (PACKAGE_MANAGERS.has(program)) return managed(program, rest);
  if (INTERPRETERS.has(program) || PYTHON.test(program)) return interpreted(program, rest);
  return withSubcommand(named(program), rest);
}

/** A label and the folder it runs in, which tells apart two servers that would read the same. */
export function labelIn(label: string, cwd: string): string {
  const place = named(baseName(cwd));
  return place === undefined ? label : `${label}${PLACE_JOIN}${place}`;
}
