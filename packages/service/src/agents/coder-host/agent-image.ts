/**
 * agent-image.ts -- the image every cloud agent's sandbox boots from, as the deploy names it to Vercel, and the runner the deploy launches in it.
 *
 * The image is built from `apps/web/agent-image/` and pushed to the
 * project's registry by CI under a tag that is a digest of what went into it
 * (`apps/web/scripts/agent-image.ts`), the runner's unit among it. The web
 * build computes the same reference and ships it beside each function that
 * opens a sandbox (`apps/web/scripts/bundle-functions.ts`), under the names
 * below, with a digest of the image without the runner's unit, which a base
 * snapshot is keyed on (`../base-snapshot.ts`), and the runner's unit itself
 * (`@repo/agent-runner/pins`'s `RUNNER_UNIT`) in a folder of its own, which
 * each launch installs whole in the sandbox over whatever runner its disk
 * holds. The function reads each from the directory its own entry stands in,
 * once per instance.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RUNNER_UNIT } from "@repo/agent-runner/pins";
import { Context, Data, Effect, Layer } from "effect";

/** The image's repository in the project's registry, which a sandbox's `image` names with its tag. */
export const AGENT_IMAGE_REPOSITORY = "agent-image";

/** The file the web build writes the image's reference into, beside each function that opens a sandbox. */
export const AGENT_IMAGE_FILE = "agent-image.txt";

/** The file the web build writes a digest of the image without the runner's unit into, beside the reference. */
export const AGENT_IMAGE_BASE_FILE = "agent-image-base.txt";

/** The folder the runner's unit stands in, in the image's context and beside each function that opens a sandbox. */
export const AGENT_RUNNER_FOLDER = "agent-runner";

/** The reference could not be read where the build should have left it. */
export class AgentImageMissing extends Data.TaggedError("AgentImageMissing") {}

/** One file of the runner's unit: its name in the unit, and its bytes. */
export interface RunnerFile {
  readonly name: string;
  readonly contents: Uint8Array;
}

export interface AgentImageService {
  /** The image as Vercel resolves it in the deployment's own project: its repository and tag. */
  readonly reference: Effect.Effect<string, AgentImageMissing>;
  /** A digest of the image without the runner's unit: what a base snapshot made on it holds. */
  readonly base: Effect.Effect<string, AgentImageMissing>;
  /** The runner's unit the deploy launches, every file of it, installed whole in each sandbox at launch. */
  readonly runner: Effect.Effect<readonly RunnerFile[], AgentImageMissing>;
}

export class AgentImage extends Context.Service<AgentImage, AgentImageService>()("AgentImage") {}

/** A file the build left in the directory given. */
const builtFile = (directory: string, file: string) =>
  Effect.tryPromise({
    try: () => readFile(join(directory, file)),
    catch: () => new AgentImageMissing(),
  });

/** A file the build left in the directory given, read at its first use and held for the instance's life. */
const cachedRead = (directory: string, file: string) => Effect.cached(builtFile(directory, file));

/** The runner's unit as the build left it in its folder, read at its first use and held for the instance's life. */
const cachedRunner = (directory: string) =>
  Effect.cached(
    Effect.forEach(Object.values(RUNNER_UNIT), (name) =>
      Effect.map(
        builtFile(join(directory, AGENT_RUNNER_FOLDER), name),
        (contents): RunnerFile => ({ name, contents }),
      ),
    ),
  );

/** The reference, the base digest, and the runner's unit, each read from the directory given at its first use. */
export function agentImageFromDirectory(directory: string): Layer.Layer<AgentImage> {
  return Layer.effect(
    AgentImage,
    Effect.map(
      Effect.all([
        cachedRead(directory, AGENT_IMAGE_FILE),
        cachedRead(directory, AGENT_IMAGE_BASE_FILE),
        cachedRunner(directory),
      ]),
      ([reference, base, runner]) => ({
        reference: Effect.map(reference, (bytes) => bytes.toString("utf8").trim()),
        base: Effect.map(base, (bytes) => bytes.toString("utf8").trim()),
        runner,
      }),
    ),
  );
}
