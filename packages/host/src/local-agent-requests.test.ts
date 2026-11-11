import { execFileSync } from "node:child_process";
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { CHECKOUT_DIFF_EXIT } from "@repo/features/checkout-diff";
import { DEVICE_AGENT_REQUEST_KIND, deviceAgentLayout } from "@repo/features/device-agent-wire";
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

/** A home with one agent's worktree holding a file, a secret beside the home, the agent's gh sign-in where a host kept it before and where it keeps it now, in gh's config in the agent's home, and a symlink in the worktree pointing at each. */
const staged = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const root = yield* temporaryDirectoryScoped("local-agent-");
  const layout = deviceAgentLayout(`${root}/home`, AGENT);
  yield* fileSystem.makeDirectory(layout.checkoutPath, { recursive: true });
  yield* fileSystem.writeFileString(`${layout.checkoutPath}/notes.txt`, "the agent's own");
  yield* fileSystem.writeFileString(`${root}/secret.txt`, "the developer's own");
  yield* fileSystem.symlink(`${root}/secret.txt`, `${layout.checkoutPath}/escape.txt`);
  yield* fileSystem.makeDirectory(layout.githubConfig, { recursive: true });
  yield* fileSystem.writeFileString(`${layout.githubConfig}/hosts.yml`, "oauth_token: ghs_fixture");
  yield* fileSystem.symlink(`${layout.githubConfig}/hosts.yml`, `${layout.checkoutPath}/gh.yml`);
  const ghConfig = `${layout.folder}/home/.config/gh`;
  yield* fileSystem.makeDirectory(ghConfig, { recursive: true });
  yield* fileSystem.writeFileString(`${ghConfig}/hosts.yml`, "oauth_token: ghs_fixture");
  yield* fileSystem.symlink(`${ghConfig}/hosts.yml`, `${layout.checkoutPath}/home-gh.yml`);
  return { root, layout };
});

const read = (layout: ReturnType<typeof deviceAgentLayout>, path: string) =>
  answeredLocalAgentRequest(layout, BOX, {
    kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE,
    args: { path, maxBytes: 1_024 },
  });

const diff = (layout: ReturnType<typeof deviceAgentLayout>, args: Record<string, unknown>) =>
  answeredLocalAgentRequest(layout, BOX, { kind: DEVICE_AGENT_REQUEST_KIND.DIFF_CHECKOUT, args });

/** A home with one agent's worktree as a git repository: one file committed, then changed, and another left untracked; answers the commit. */
const stagedRepository = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const root = yield* temporaryDirectoryScoped("local-agent-");
  const layout = deviceAgentLayout(`${root}/home`, AGENT);
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
  yield* fileSystem.writeFileString(`${layout.checkoutPath}/notes.txt`, "two\n");
  yield* fileSystem.writeFileString(`${layout.checkoutPath}/fresh.txt`, "new\n");
  return { layout, commit };
});

describe("answeredLocalAgentRequest", () => {
  it.effect("reads a file inside the agent's folder", () =>
    Effect.gen(function* () {
      const { layout } = yield* staged;
      const answer = yield* read(layout, `${layout.checkoutPath}/notes.txt`);
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
      case: "a symlink in the worktree pointing outside",
      path: (root: string) => `${root}/home/.vespin/agents/${AGENT}/repository/escape.txt`,
    },
    {
      case: "the agent's own gh sign-in, where a host keeps its GitHub token",
      path: (root: string) => `${root}/home/.vespin/agents/${AGENT}/gh/hosts.yml`,
    },
    {
      case: "a symlink in the worktree pointing at the agent's gh sign-in",
      path: (root: string) => `${root}/home/.vespin/agents/${AGENT}/repository/gh.yml`,
    },
    {
      case: "gh's config in the agent's home, where a host whose agents run on the box keeps its GitHub token",
      path: (root: string) => `${root}/home/.vespin/agents/${AGENT}/home/.config/gh/hosts.yml`,
    },
    {
      case: "a symlink in the worktree pointing at gh's config in the agent's home",
      path: (root: string) => `${root}/home/.vespin/agents/${AGENT}/repository/home-gh.yml`,
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
        assert.ok(diffed.diff.includes("\n-one\n+two\n"), diffed.diff);
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
