/**
 * agent-image.ts -- the image every cloud agent's sandbox boots from: its build context, and the tag a digest of that context names it by.
 *
 * The context is `agent-image/` as committed, the Dockerfile and tmux's
 * settings, with what the build writes beside them: the runner's unit
 * (`@repo/agent-runner/pins`'s `RUNNER_UNIT`), every file of it as
 * `@repo/agent-runner`'s own build leaves them, in a folder of its own, and
 * the agent's recording pointer (`recording-cursor.ts`). Its tag is a digest of every file in it, so
 * the image changes exactly when what goes into it does, and a deploy that
 * changes none of it boots the image the one before it did.
 *
 * CI stages the context and pushes the image under that tag
 * (`.github/workflows/ci.yml`'s `agent-image` job), and the web build computes
 * the same reference and ships it beside each function that opens a sandbox
 * (`bundle-functions.ts`), so a deploy names the image its own commit built.
 * Beside it goes the unit itself, in its folder, which each launch installs
 * whole in the sandbox (`@repo/service/agents/coder-host/agent-image`).
 *
 * Run as `tsx scripts/agent-image.ts <directory>`, it writes the context into
 * the directory and prints the tag.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { RUNNER_UNIT } from "@repo/agent-runner/pins";
import { RECORDING_CURSOR_SOURCE } from "@repo/service/agents/browser/recording-cursor";
import {
  AGENT_IMAGE_FILE,
  AGENT_IMAGE_REPOSITORY,
  AGENT_RUNNER_FOLDER,
} from "@repo/service/agents/coder-host/agent-image";

const WEB = join(import.meta.dirname, "..");

/** Where the context's files come from: the committed folder, and the runner's unit as its build leaves it. */
const SOURCE = {
  DIRECTORY: join(WEB, "agent-image"),
  COMMITTED: ["Dockerfile", "tmux.conf"],
  RUNNER_DIST: join(WEB, "..", "..", "packages", "agent-runner", "dist"),
} as const;

/** Each file of the runner's unit by its name in the context: in the unit's folder. */
const RUNNER_FILES = Object.values(RUNNER_UNIT).map((name) => ({
  name,
  inContext: posix.join(AGENT_RUNNER_FOLDER, name),
}));

/** How many hex digits of the context's digest the tag keeps. */
const TAG_DIGITS = 24;

/** One file of the context: its name in the folder the Dockerfile builds from, and its bytes. */
export interface ContextFile {
  readonly name: string;
  readonly contents: Uint8Array;
}

/** The context's files, by name, in the order the digest reads them; a build without every file of the runner's unit fails here. */
export async function agentImageContext(): Promise<readonly ContextFile[]> {
  const runner = await Promise.all(
    RUNNER_FILES.map(async ({ name, inContext }) => {
      const path = join(SOURCE.RUNNER_DIST, name);

      const contents = await readFile(path).catch(() => {
        throw new Error(
          `${relative(WEB, path)} is missing: run \`pnpm --filter @repo/agent-runner build\` first`,
        );
      });

      return { name: inContext, contents };
    }),
  );

  const committed = await Promise.all(
    SOURCE.COMMITTED.map(async (name) => ({
      name,
      contents: await readFile(join(SOURCE.DIRECTORY, name)),
    })),
  );

  return [
    ...committed,
    ...runner,
    { name: "cursor.js", contents: Buffer.from(RECORDING_CURSOR_SOURCE, "utf8") },
  ];
}

/** The context's tag: a digest of each file's name and bytes, every field ended by a NUL so none runs into the next. */
function agentImageTag(context: readonly ContextFile[]): string {
  const digest = createHash("sha256");

  for (const file of context)
    digest.update(file.name).update("\0").update(file.contents).update("\0");

  return digest.digest("hex").slice(0, TAG_DIGITS);
}

/**
 * The files each function that opens a sandbox ships: the image as a deploy
 * names it to Vercel, its repository in the project's registry and its tag;
 * and the runner's unit, in its folder.
 */
export function shippedBesideFunctions(context: readonly ContextFile[]): readonly ContextFile[] {
  const runner = RUNNER_FILES.map(({ inContext }) => {
    const file = context.find((each) => each.name === inContext);

    if (file === undefined) throw new Error(`the image's context holds no ${inContext}`);

    return file;
  });

  return [
    {
      name: AGENT_IMAGE_FILE,
      contents: Buffer.from(`${AGENT_IMAGE_REPOSITORY}:${agentImageTag(context)}\n`, "utf8"),
    },
    ...runner,
  ];
}

/** Writes the context into the directory given, and answers its tag. */
async function stageAgentImage(directory: string): Promise<string> {
  const context = await agentImageContext();
  await Promise.all(
    context.map(async (file) => {
      const path = join(directory, file.name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.contents);
    }),
  );

  return agentImageTag(context);
}

const executedPath = process.argv[1];

if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  const directory = process.argv[2];

  if (directory === undefined) throw new Error("usage: tsx scripts/agent-image.ts <directory>");
  // biome-ignore lint/suspicious/noConsole: the tag is the script's answer, which CI reads off its output.
  console.log(await stageAgentImage(directory));
}
