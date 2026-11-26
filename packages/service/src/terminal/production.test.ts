import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { readVisibleAgent } from "@repo/database/models/agent-store";
import { recordRepositoryReads } from "@repo/database/models/github-repository-reads";
import { readGitHubTokenRow } from "@repo/database/models/github-token-store";
import { agentTable } from "@repo/database/schemas/agent";
import {
  getTestDB,
  joinWorkspace,
  openAgentOnOwnTask,
  openWorkspace,
} from "@repo/database/testing";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { memorySandbox } from "@repo/sandbox/testing";
import { eq } from "drizzle-orm";
import { DateTime, Effect, Layer, Option } from "effect";
import { AgentImage } from "../agents/coder-host/agent-image.js";
import { HostedEnvironment } from "../environment.js";
import { NO_GITHUB, openGithubUser, openTokenMember } from "../testing/github-app-fake.js";
import { relayDependencies } from "./production.js";

/**
 * The Terminal's reach as the deployment stands it, over a real dialect: a
 * teammate reaches an agent the App reaches and an account outside its
 * workspace does not, and a teammate whose own token reads the repository
 * of an agent on its starter's own token sees the agent but opens no shell
 * in it, which its starter does.
 * Synthetic accounts throughout; no sandbox or GitHub is asked.
 */

const REPOSITORY = "acme/api";

const SUITE = Layer.mergeAll(
  getTestDB(),
  memorySandbox().layer,
  NO_GITHUB,
  Layer.succeed(AgentImage, {
    reference: Effect.succeed("agent-image:fixture"),
    runner: Effect.succeed([]),
  }),
  Layer.succeed(HostedEnvironment, {
    posthogPersonalApiKey: undefined,
    posthogProjectId: undefined,
    posthogApiHost: undefined,
    posthogProjectApiKey: undefined,
    posthogIngestHost: undefined,
    posthogDistinctIdKey: undefined,
    cronSecret: undefined,
    githubWebhookSecret: undefined,
    providerKeyEncryptionKeys: undefined,
    titleAnthropicApiKey: undefined,
    previewApiKeys: {},
  }),
);

it.layer(SUITE)("the Terminal's reach", (it) => {
  it.effect(
    "a teammate reaches an agent and an outsider does not, and an agent on its starter's own token is its starter's alone",
    () =>
      Effect.gen(function* () {
        const starter = yield* openGithubUser();
        const reader = yield* openTokenMember({ token: "fixture-reader-token" });
        const outsider = yield* openGithubUser();
        const workspace = yield* openWorkspace(starter);
        yield* openWorkspace(outsider);
        yield* joinWorkspace(workspace, reader);
        const sealed = (yield* readGitHubTokenRow(reader))?.sealedToken ?? "";

        yield* recordRepositoryReads(
          reader,
          sealed,
          [{ repository: REPOSITORY, readable: true }],
          yield* DateTime.nowAsDate,
        );

        const shared = yield* openAgentOnOwnTask(starter, workspace);
        const own = yield* openAgentOnOwnTask(starter, workspace);
        yield* Database.use((db) =>
          db
            .update(agentTable)
            .set({ githubAccess: GITHUB_ACCESS.TOKEN })
            .where(eq(agentTable.id, own)),
        );

        const { reach } = yield* relayDependencies;

        assert.ok(Option.isSome(yield* reach(reader, shared)));
        assert.ok(Option.isNone(yield* reach(outsider, shared)));
        assert.ok(Option.isSome(yield* reach(starter, own)));
        assert.ok(Option.isSome(yield* readVisibleAgent(reader, own)));
        assert.ok(Option.isNone(yield* reach(reader, own)));
      }),
  );
});
