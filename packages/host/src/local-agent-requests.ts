import { CHECKOUT_DIFF_SCRIPT, checkoutDiffEnv } from "@repo/features/checkout-diff";
import {
  DEVICE_AGENT_BOUNDS,
  DEVICE_AGENT_REQUEST_KIND,
  type DeviceAgentAnswer,
  type DeviceAgentLayout,
  type DeviceAgentRequest,
  deviceAgentDiffArgsSchema,
  deviceAgentReadArgsSchema,
} from "@repo/features/device-agent-wire";
import { Duration, Effect, Option, Schema, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";
import { agentOnBox } from "./local-agent-box.js";

/**
 * local-agent-requests.ts -- what a local agent's tools and the service ask of this Mac, answered only inside the agent's own folders: a file read, and a diff of its worktree.
 *
 * The service asks for a path it built under one of the agent's folders
 * (`deviceAgentLayoutIn`), but a path is only words: a `..`, or a symlink the
 * agent made in its worktree, could name any file the developer can read.
 * So every target is resolved to its real path first, every symlink
 * followed, and answered only where that real path stands inside the real
 * path of one of the agent's own places (`agentPlaces`): its folder, which
 * holds its worktree and installed skills, its attachments under the host's
 * state, and its shared files under the machine's own temp folder, never
 * that temp folder itself. Anything else is refused as a path
 * that names no file the agent may read, and a read answers no bytes. A
 * path that does not exist resolves to nothing, and is refused the same
 * way. No credential stands in the agent's folder: its GitHub sign-in is
 * the box user's own, in their home.
 *
 * A read answers at most the bytes asked for, and never more than one past
 * `DEVICE_AGENT_BOUNDS.MAX_ANSWER_BYTES`, so the caller still sees a file
 * larger than its bound.
 */

const decodeReadArgs = Schema.decodeUnknownOption(deviceAgentReadArgsSchema);
const decodeDiffArgs = Schema.decodeUnknownOption(deviceAgentDiffArgsSchema);

/** The most a diff runs before it is given up on and answered as failed: as long as the service waits on it (`DEVICE_AGENT_BOUNDS.DIFF_WAIT_MS`). */
const DIFF_DEADLINE = Duration.millis(DEVICE_AGENT_BOUNDS.DIFF_WAIT_MS);
/** How long a diff past its deadline is given to end before it is killed. */
const DIFF_KILL_GRACE = Duration.seconds(3);

/** What the box a request is answered on hands a command: the shell's variables, and where its `gh` is. */
export interface LocalAgentRequestBox {
  readonly env: Readonly<Record<string, string>>;
  readonly gh: string;
}

/** The places that are the agent's own, each absolute: its folder, its attachments, and its shared files, the only places it is written to or read from for it. */
export function agentPlaces(layout: DeviceAgentLayout): readonly string[] {
  return [layout.folder, layout.attachments, layout.sharedFiles];
}

/** Whether `path`, already real, stands at or under `root`, already real. */
function within(root: string, path: string): boolean {
  const base = root.replace(/\/+$/u, "");
  return path === base || path.startsWith(`${base}/`);
}

/**
 * The real path of `target` where it stands inside one of the agent's own
 * places, every symlink in either followed; nothing where the target cannot
 * be resolved, or resolves outside every place that can.
 */
const confinedPath = (
  layout: DeviceAgentLayout,
  target: string,
): Effect.Effect<Option.Option<string>, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    if (!target.startsWith("/")) return Option.none();
    const resolved = yield* Effect.option(fileSystem.realPath(target));
    if (Option.isNone(resolved)) return Option.none();
    for (const place of agentPlaces(layout)) {
      const root = yield* Effect.option(fileSystem.realPath(place));
      if (Option.isSome(root) && within(root.value, resolved.value)) return resolved;
    }
    return Option.none();
  });

/** The first `bound` bytes of the regular file at `path`, real and confined; nothing where it is no file or cannot be read. */
const readBounded = (path: string, bound: number) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const info = yield* fileSystem.stat(path);
    if (info.type !== "File") return null;
    if (bound === 0) return new Uint8Array();
    const read = yield* Effect.scoped(
      Effect.flatMap(fileSystem.open(path, { flag: "r" }), (file) => file.readAlloc(bound)),
    );
    return Option.getOrElse(read, () => new Uint8Array());
  }).pipe(Effect.orElseSucceed(() => null));

/** A read asked: the bytes of the file it names, inside the agent's own places; no bytes for anything else. */
const answeredRead = (layout: DeviceAgentLayout, args: unknown) =>
  Effect.gen(function* () {
    const read = decodeReadArgs(args);
    const answer = (bytes: Uint8Array | null): DeviceAgentAnswer => ({
      kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE,
      bytes,
    });
    if (Option.isNone(read)) return answer(null);
    const path = yield* confinedPath(layout, read.value.path);
    if (Option.isNone(path)) return answer(null);
    const bound = Math.max(
      0,
      Math.min(read.value.maxBytes, DEVICE_AGENT_BOUNDS.MAX_ANSWER_BYTES + 1),
    );
    return answer(yield* readBounded(path.value, bound));
  });

/**
 * A diff asked: the one diff script both machines run
 * (`@repo/features/checkout-diff`), run in the agent's worktree as the
 * agent on the box with the two sides in its variables, answered with its
 * exit and what it printed; exit 1 and nothing printed where it could not
 * run, ran past its deadline, or its arguments could not be read. Note that
 * the runner is not stopped for it, because a diff writes nothing to the
 * worktree, only an index copy and the diff beside the git dir.
 */
const answeredDiff = (layout: DeviceAgentLayout, box: LocalAgentRequestBox, args: unknown) =>
  Effect.gen(function* () {
    const failed: DeviceAgentAnswer = {
      kind: DEVICE_AGENT_REQUEST_KIND.DIFF_CHECKOUT,
      exit: 1,
      diff: "",
    };
    const range = decodeDiffArgs(args);
    if (Option.isNone(range)) return failed;
    const run = agentOnBox(
      {
        command: "/bin/bash",
        args: ["-c", CHECKOUT_DIFF_SCRIPT],
        env: { ...box.env, ...checkoutDiffEnv(range.value) },
      },
      box.gh,
    );
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* ChildProcess.make(run.command, [...run.args], {
          cwd: layout.checkoutPath,
          env: run.env,
          extendEnv: false,
          stdin: "ignore",
          stderr: "ignore",
          forceKillAfter: DIFF_KILL_GRACE,
        });
        const [diff, exited] = yield* Effect.all(
          [Stream.mkString(Stream.decodeText(handle.stdout)), handle.exitCode],
          { concurrency: "unbounded" },
        );
        const answer: DeviceAgentAnswer = {
          kind: DEVICE_AGENT_REQUEST_KIND.DIFF_CHECKOUT,
          exit: Number(exited),
          diff: diff.slice(0, DEVICE_AGENT_BOUNDS.MAX_DIFF_CHARS),
        };
        return answer;
      }),
    ).pipe(
      Effect.timeoutOption(DIFF_DEADLINE),
      Effect.map(Option.getOrElse(() => failed)),
      Effect.orElseSucceed(() => failed),
    );
  });

/** What one request of a local agent answers, inside the agent's own places given: a read of its tools', or a diff of the service's. */
export const answeredLocalAgentRequest = (
  layout: DeviceAgentLayout,
  box: LocalAgentRequestBox,
  request: Pick<DeviceAgentRequest, "kind" | "args">,
): Effect.Effect<
  DeviceAgentAnswer,
  never,
  FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
> =>
  request.kind === DEVICE_AGENT_REQUEST_KIND.DIFF_CHECKOUT
    ? answeredDiff(layout, box, request.args)
    : answeredRead(layout, request.args);
