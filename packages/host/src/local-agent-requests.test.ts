import { execFileSync } from "node:child_process";
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { CHECKOUT_DIFF_EXIT } from "@repo/features/checkout-diff";
import {
  DEVICE_AGENT_REQUEST_KIND,
  type DeviceAgentLayout,
  type DeviceAgentRequest,
  deviceAgentAttachmentsFolder,
  deviceAgentLayoutIn,
  deviceAgentsFolder,
  deviceAgentTempFolder,
} from "@repo/features/device-agent-wire";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { Effect, Layer } from "effect";
import * as FileSystem from "effect/FileSystem";
import { answeredLocalAgentRequest } from "./local-agent-requests.js";

const AGENT = "6f1c2b9e-1d3a-4c55-9a0e-2f6b8c1d0e11";

const NODE = NodeChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
);

/** The box a request is answered on: the test's own PATH, and git told to read no system config. */
const BOX = {
  env: { PATH: process.env.PATH ?? "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1" },
  gh: "/usr/local/bin/gh",
};

/** The agent's layout on a device whose home, machine temp, and state folders stand under the root given. */
const layoutUnder = (root: string) =>
  deviceAgentLayoutIn(
    {
      agentsFolder: deviceAgentsFolder(`${root}/home`),
      tempFolder: deviceAgentTempFolder(`${root}/tmp`),
      attachmentsFolder: deviceAgentAttachmentsFolder(`${root}/state`),
    },
    AGENT,
  );

/** Another agent of the machine, whose shared files stand beside this one's in the machine's temp folder. */
const OTHER_AGENT = "0b2d4f6a-8c1e-4a3b-9d5f-7e9a1c3b5d70";

/**
 * A home, a machine temp folder, and a state folder, with one agent's
 * worktree, attachments, and shared files each holding a file, a secret
 * beside the home, another agent's shared file, and a symlink in the
 * worktree pointing at the secret.
 */
const staged = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const root = yield* temporaryDirectoryScoped("local-agent-");
  const layout = layoutUnder(root);

  for (const place of [layout.checkoutPath, layout.attachments, layout.sharedFiles]) {
    yield* fileSystem.makeDirectory(place, { recursive: true });
    yield* fileSystem.writeFileString(`${place}/notes.txt`, "the agent's own");
  }

  yield* fileSystem.writeFileString(`${root}/secret.txt`, "the developer's own");
  yield* fileSystem.makeDirectory(`${root}/tmp/vespin/${OTHER_AGENT}`, { recursive: true });
  yield* fileSystem.writeFileString(`${root}/tmp/vespin/${OTHER_AGENT}/notes.txt`, "another's");
  yield* fileSystem.symlink(`${root}/secret.txt`, `${layout.checkoutPath}/escape.txt`);

  return { root, layout };
});

const read = (layout: DeviceAgentLayout, path: string) =>
  answeredLocalAgentRequest(layout, BOX, {
    kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE,
    args: { path, maxBytes: 1_024 },
  });

const diff = (layout: DeviceAgentLayout, args: DeviceAgentRequest["args"]) =>
  answeredLocalAgentRequest(layout, BOX, { kind: DEVICE_AGENT_REQUEST_KIND.DIFF_CHECKOUT, args });

/** A home with one agent's worktree as a git repository: one file committed, then changed, and another left untracked; answers the commit. */
const stagedRepository = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const root = yield* temporaryDirectoryScoped("local-agent-");
  const layout = layoutUnder(root);
  yield* fileSystem.makeDirectory(layout.checkoutPath, { recursive: true });
  const env = { ...BOX.env, HOME: root, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@test" };

  const git = (args: readonly string[]) =>
    execFileSync("git", args, {
      cwd: layout.checkoutPath,
      env: { ...env, GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@test" },
      encoding: "utf8",
    }).trim();

  git(["init", "--quiet"]);
  yield* fileSystem.writeFileString(`${layout.checkoutPath}/notes.txt`, "one\n");
  git(["add", "-A"]);
  git(["commit", "--quiet", "-m", "first"]);
  const commit = git(["rev-parse", "HEAD"]);
  // Note that the change is a different size, because git trusts a file whose size and times match its index entry, and an edit of the same size in the same second as the commit can match them.
  yield* fileSystem.writeFileString(`${layout.checkoutPath}/notes.txt`, "one\ntwo\n");
  yield* fileSystem.writeFileString(`${layout.checkoutPath}/fresh.txt`, "new\n");

  return { layout, commit };
});

describe("answeredLocalAgentRequest", () => {
  it.effect(
    "refuses a read in its shared files once their root is a link someone else left in the machine's temp folder",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const { root, layout } = yield* staged;
        yield* fileSystem.rename(`${root}/tmp/vespin`, `${root}/planted`);
        yield* fileSystem.symlink(`${root}/planted`, `${root}/tmp/vespin`);
        const answer = yield* read(layout, `${layout.sharedFiles}/notes.txt`);
        assert.deepStrictEqual(answer, { kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE, bytes: null });
      }).pipe(Effect.scoped, Effect.provide(NODE)),
  );

  it.effect.each([
    { case: "its worktree", place: (layout: DeviceAgentLayout) => layout.checkoutPath },
    { case: "its attachments", place: (layout: DeviceAgentLayout) => layout.attachments },
    { case: "its shared files", place: (layout: DeviceAgentLayout) => layout.sharedFiles },
  ])("reads a file in $case", ({ place }) =>
    Effect.gen(function* () {
      const { layout } = yield* staged;
      const answer = yield* read(layout, `${place(layout)}/notes.txt`);
      assert.deepStrictEqual(answer, {
        kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE,
        bytes: new TextEncoder().encode("the agent's own"),
      });
    }).pipe(Effect.scoped, Effect.provide(NODE)),
  );

  it.effect.each([
    { case: "a path outside the agent's folder", path: (root: string) => `${root}/secret.txt` },
    {
      case: "a path that climbs out with ..",
      path: (root: string) =>
        `${root}/home/.vespin/agents/${AGENT}/repository/../../../../../secret.txt`,
    },
    {
      case: "another agent's shared file in the machine's temp folder",
      path: (root: string) => `${root}/tmp/vespin/${OTHER_AGENT}/notes.txt`,
    },
    {
      case: "a symlink in the worktree pointing outside",
      path: (root: string) => `${root}/home/.vespin/agents/${AGENT}/repository/escape.txt`,
    },
  ])("refuses $case", ({ path }) =>
    Effect.gen(function* () {
      const { root, layout } = yield* staged;
      const answer = yield* read(layout, path(root));
      assert.deepStrictEqual(answer, { kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE, bytes: null });
    }).pipe(Effect.scoped, Effect.provide(NODE)),
  );

  it.effect(
    "diffs the worktree from a commit to how it stands, untracked files among the changes, and answers the script's exit where a commit is not in the worktree or the arguments do not read",
    () =>
      Effect.gen(function* () {
        const { layout, commit } = yield* stagedRepository;

        const diffed = yield* diff(layout, { from: commit, to: null });
        const missing = yield* diff(layout, { from: "0".repeat(40), to: null });
        const unread = yield* diff(layout, { commit });

        assert.equal(diffed.kind, DEVICE_AGENT_REQUEST_KIND.DIFF_CHECKOUT);

        if (diffed.kind !== DEVICE_AGENT_REQUEST_KIND.DIFF_CHECKOUT) return;
        assert.equal(diffed.exit, 0);
        assert.ok(diffed.diff.includes("diff --git a/notes.txt b/notes.txt"), diffed.diff);
        assert.ok(diffed.diff.includes("\n one\n+two\n"), diffed.diff);
        assert.ok(diffed.diff.includes("diff --git a/fresh.txt b/fresh.txt"), diffed.diff);
        assert.deepStrictEqual(missing, {
          kind: DEVICE_AGENT_REQUEST_KIND.DIFF_CHECKOUT,
          exit: CHECKOUT_DIFF_EXIT.MISSING,
          diff: "",
        });
        assert.deepStrictEqual(unread, {
          kind: DEVICE_AGENT_REQUEST_KIND.DIFF_CHECKOUT,
          exit: 1,
          diff: "",
        });
      }).pipe(Effect.scoped, Effect.provide(NODE)),
  );
});
