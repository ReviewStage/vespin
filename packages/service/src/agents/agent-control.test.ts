import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { createAgent, readAgent } from "@repo/database/models/agent-store";
import { recordRepositoryReads } from "@repo/database/models/github-repository-reads";
import { readGitHubTokenRow } from "@repo/database/models/github-token-store";
import { createTask } from "@repo/database/models/task-store";
import { storeWriter } from "@repo/database/models/writer";
import { CONVERSATION_RUNTIME, MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import { getTestDB, joinWorkspace, openWorkspace } from "@repo/database/testing";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { memorySandbox } from "@repo/sandbox/testing";
import { DateTime, Effect, Layer, Option } from "effect";
import { HOSTED_REFUSAL } from "../http/http-effect.js";
import {
  connectWorkspaceGitHub,
  githubReaching,
  type InstallationFixture,
  NO_GITHUB,
  openGithubUser,
  openTokenMember,
} from "../testing/github-app-fake.js";
import { agentPullRequestReach } from "./coder-host/published.js";
import { TAKEN_ON } from "./coder-host/replay.js";
import { routedSessions } from "./coder-host/runtime-sessions.js";
import { SNAPSHOT_MISS } from "./coder-host/snapshot.js";
import { steerAgent } from "./coder-host/steer.js";
import { startFromOf } from "./coder-host/takeover.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";
import type { TypedTurn } from "./sessions/agent-sessions.js";

/** What every case runs over: the store, and sandboxes kept in memory. */
const SUITE = Layer.merge(getTestDB(), memorySandbox().layer);

/**
 * Who controls a coding agent that runs on its starter's own GitHub token,
 * over a real dialect: a teammate whose own verified token reads its
 * repository reaches it, but its messages and a start from it, continued or
 * forked, are refused before its harness, GitHub, or its sandbox is asked; a
 * teammate who keeps no token reaches nothing. And an agent the App reaches,
 * on a task on its owner's token, takes no message from a teammate who
 * reaches the agent but not the task, nor reads its pull requests. Synthetic accounts, tasks, and words
 * throughout; the harness and GitHub answer nothing.
 */

/** An agent on its starter's own token, with a teammate whose token reads its repository and one who keeps none. */
const openTokenAgent = Effect.gen(function* () {
  const owner = yield* openGithubUser();
  const reader = yield* openTokenMember({ token: "fixture-reader-token" });
  const tokenless = yield* openGithubUser();
  const workspace = yield* openWorkspace(owner);
  for (const each of [reader, tokenless]) yield* joinWorkspace(workspace, each);
  const now = yield* DateTime.nowAsDate;
  const sealed = (yield* readGitHubTokenRow(reader))?.sealedToken ?? "";
  const side = [{ repository: "octo-member/side", readable: true }];
  yield* recordRepositoryReads(reader, sealed, side, now);
  const task = yield* createTask(owner, {
    organizationId: workspace,
    repository: "octo-member/side",
    githubAccess: GITHUB_ACCESS.TOKEN,
  });
  const started = yield* createAgent(owner, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    descriptionSnapshot: "# Side\n",
    prompt: null,
    repository: "octo-member/side",
    githubAccess: GITHUB_ACCESS.TOKEN,
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  });
  return { owner, reader, tokenless, workspace, task, agent: Option.getOrThrow(started).agent };
});

it.layer(SUITE)("an agent on its starter's own GitHub token", (it) => {
  it.effect(
    "a teammate who sees it is refused its messages and a start from it, and a teammate who keeps no token reaches it not at all",
    () =>
      Effect.gen(function* () {
        const { reader, tokenless, task, agent } = yield* openTokenAgent;
        const agentSessions = yield* routedSessions<TypedTurn>(reader);
        const steer = (userId: string) =>
          steerAgent(agentSessions, storeWriter({ tools: CODER_TOOL_SET }), userId, agent, {
            text: "Carry on.",
            clientKey: randomUUID(),
            sender: { kind: MESSAGE_SENDER.MEMBER, userId },
          });
        const startFrom = (userId: string, messageId?: string) =>
          startFromOf(
            userId,
            { taskId: task.id },
            { agentId: agent.id, ...(messageId === undefined ? undefined : { messageId }) },
            [],
            randomUUID(),
          );

        assert.ok(Option.isSome(yield* readAgent(reader, agent.id)));
        assert.ok(Option.isNone(yield* readAgent(tokenless, agent.id)));
        assert.deepEqual(yield* Effect.flip(steer(reader)), HOSTED_REFUSAL.NOT_PERMITTED);
        assert.deepEqual(yield* Effect.flip(startFrom(reader)), HOSTED_REFUSAL.NOT_PERMITTED);
        assert.deepEqual(
          yield* Effect.flip(startFrom(reader, randomUUID())),
          HOSTED_REFUSAL.NOT_PERMITTED,
        );
        assert.deepEqual(yield* Effect.flip(startFrom(tokenless)), HOSTED_REFUSAL.NOT_FOUND);
      }).pipe(Effect.provide(NO_GITHUB)),
  );

  it.effect(
    "a teammate who reaches the agent but not its task's GitHub visibility is refused its messages and its pull requests",
    () =>
      Effect.gen(function* () {
        const { owner, tokenless, workspace, task } = yield* openTokenAgent;
        // Note that a native runtime with no payer asks for no API key, so the send reaches the task's gate.
        const repository = "octo-member/app-side";
        const started = yield* createAgent(owner, {
          taskId: task.id,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          descriptionSnapshot: "# Side\n",
          prompt: null,
          repository,
          githubAccess: GITHUB_ACCESS.APP,
          runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
        });
        const agent = Option.getOrThrow(started).agent;
        const agentSessions = yield* routedSessions<TypedTurn>(tokenless);

        assert.ok(Option.isSome(yield* readAgent(tokenless, agent.id)));
        const refused = yield* Effect.flip(
          steerAgent(agentSessions, storeWriter({ tools: CODER_TOOL_SET }), tokenless, agent, {
            text: "Carry on.",
            clientKey: randomUUID(),
            sender: { kind: MESSAGE_SENDER.MEMBER, userId: tokenless },
          }),
        );
        assert.deepEqual(refused, HOSTED_REFUSAL.NOT_FOUND);
        // The workspace's installation reaches the agent's repository, so only the task's visibility refuses the read.
        const installation: InstallationFixture = {
          id: 300,
          login: "octo-member",
          repositories: [{ owner: "octo-member", name: "app-side" }],
        };
        yield* connectWorkspaceGitHub(workspace, installation);
        const unreached = yield* Effect.flip(
          agentPullRequestReach(tokenless, { ...agent, repository }).pipe(
            Effect.provide(githubReaching([installation]).layer),
          ),
        );
        assert.equal(unreached._tag, "RepositoryNotReachable");
      }).pipe(Effect.provide(NO_GITHUB)),
  );
});

it.layer(SUITE)("an agent on its starter's own Mac", (it) => {
  it.effect(
    "a teammate who sees it is refused its messages, but continues or forks it from the branch it pushed, reading nothing of the Mac",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const teammate = yield* openGithubUser();
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, teammate);
        const task = yield* createTask(owner, {
          organizationId: workspace,
          repository: "octo-member/app",
          githubAccess: GITHUB_ACCESS.APP,
        });
        const started = yield* createAgent(owner, {
          taskId: task.id,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          descriptionSnapshot: "# App\n",
          prompt: null,
          repository: "octo-member/app",
          githubAccess: GITHUB_ACCESS.APP,
          runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
          machine: AGENT_MACHINE.DEVICE,
        });
        const onMac = Option.getOrThrow(started).agent;
        const agentSessions = yield* routedSessions<TypedTurn>(teammate);

        const refused = yield* Effect.flip(
          steerAgent(agentSessions, storeWriter({ tools: CODER_TOOL_SET }), teammate, onMac, {
            text: "Carry on.",
            clientKey: randomUUID(),
            sender: { kind: MESSAGE_SENDER.MEMBER, userId: teammate },
          }),
        );
        const from = yield* startFromOf(
          teammate,
          { taskId: task.id },
          { agentId: onMac.id },
          [],
          randomUUID(),
        );

        assert.deepEqual(refused, HOSTED_REFUSAL.NOT_PERMITTED);
        assert.deepEqual(from.told.work, {
          on: TAKEN_ON.COPY,
          copy: { copied: false, miss: SNAPSHOT_MISS.ON_DEVICE },
        });
      }).pipe(Effect.provide(NO_GITHUB)),
  );
});
