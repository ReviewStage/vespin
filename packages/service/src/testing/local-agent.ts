/**
 * local-agent.ts -- a local agent over the test's real store, the sessions of its harness, Claude Code or Cursor, that reach it through its Mac's lines, and one whose runner its Mac took and left warm past its first turn.
 *
 * Synthetic accounts, agents, Macs, and keys throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Database, type DatabaseServices } from "@repo/database/core/query";
import { type Agent, createAgent } from "@repo/database/models/agent-store";
import { deviceAgentLinesWaiting } from "@repo/database/models/device-agent-store";
import { registerDevice } from "@repo/database/models/device-store";
import { user } from "@repo/database/schemas/auth";
import { conversations, turns } from "@repo/database/schemas/storage";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { DEVICE_LAYOUT, startTask } from "@repo/database/testing";
import { AGENT_MACHINE, AGENT_PAYER } from "@repo/features/agent-wire";
import { DEVICE_AGENT_LINE_KIND, DEVICE_CAPABILITY } from "@repo/features/device-agent-wire";
import { memorySandbox } from "@repo/sandbox/testing";
import { TURN_ORIGIN, TURN_STATUS } from "@repo/wire";
import { eq } from "drizzle-orm";
import { DateTime, Effect, Layer, Option } from "effect";
import { AgentImage } from "../agents/coder-host/agent-image.js";
import { claudeCodeSessions } from "../agents/coder-host/claude-code-sessions.js";
import { cursorSessions } from "../agents/coder-host/cursor-sessions.js";
import { claimedDeviceAgentLine } from "../agents/device-agent.js";
import { AgentMachine } from "../agents/machine/agent-machine.js";
import { deviceMachine } from "../agents/machine/device-machine.js";
import { SESSION_SEND_OUTCOME } from "../agents/sessions/agent-sessions.js";
import { HostedEnvironment } from "../environment.js";
import { LINK_OUTCOME } from "../github/github-installations.js";
import { AGENT_KEY_RING } from "./agent-credentials.js";
import { connectWorkspaceGitHub, type InstallationFixture, NO_GITHUB } from "./github-app-fake.js";

/** The harnesses a local agent runs on here, each with a model it runs and the SDK its Mac registers for it, where it runs one. */
const LOCAL_HARNESS = {
  [CONVERSATION_RUNTIME.CLAUDE_CODE]: {
    model: "anthropic/claude-opus-5.5",
    sessions: claudeCodeSessions,
    device: {},
  },
  [CONVERSATION_RUNTIME.CURSOR]: {
    model: "cursor/composer-2.5",
    sessions: cursorSessions,
    device: { cursorSdk: "/Applications/Vespin.app/Contents/Resources/cursor-sdk/index.js" },
  },
} as const;

/** A harness a local agent runs on here. */
export type LocalHarness = keyof typeof LOCAL_HARNESS;

/** How a local agent is opened: in the repository the installation given reaches, on the harness given, on a host as old as asked. */
export interface LocalAgentOptions {
  /** The installation reaching the repository it works in, connected to its task's workspace; none for an agent in no repository. */
  readonly installation?: InstallationFixture;
  /** The harness its conversation runs on, as Start records it, which picks its model and what its Mac registers; Claude Code where none is named. */
  readonly harness?: LocalHarness;
  /** Whether its host is a build from before it works in every repository on its own GitHub sign-in (`DEVICE_CAPABILITY.GITHUB_SIGN_IN`), which every host registers now. */
  readonly hostPredatesOwnSignIn?: boolean;
}

/**
 * An account with a Mac that just registered, and an agent pinned to it
 * whose conversation runs in a session: its starter, its Mac, the agent,
 * and the session.
 */
export const openLocalAgent = (options: LocalAgentOptions = {}) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
    const deviceId = randomUUID();
    const harness = LOCAL_HARNESS[options.harness ?? CONVERSATION_RUNTIME.CLAUDE_CODE];
    yield* registerDevice(userId, {
      id: deviceId,
      name: "Studio",
      ...DEVICE_LAYOUT,
      ...harness.device,
      capabilities:
        options.hostPredatesOwnSignIn === true ? [] : [DEVICE_CAPABILITY.GITHUB_SIGN_IN],
    });
    const { installation } = options;
    const reached = installation?.repositories[0];
    const repository = reached === undefined ? null : `${reached.owner}/${reached.name}`;
    const task = yield* startTask(userId, { name: "Invitations", repository });

    if (installation !== undefined) {
      assert.equal(
        yield* connectWorkspaceGitHub(task.workspaceId, installation),
        LINK_OUTCOME.LINKED,
      );
    }

    const started = yield* createAgent(userId, {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      model: harness.model,
      effort: "high",
      descriptionSnapshot: "# Invitations\n",
      prompt: null,
      repository,
      machine: AGENT_MACHINE.DEVICE,
      deviceId,
      runtime: options.harness ?? CONVERSATION_RUNTIME.CLAUDE_CODE,
      payer: AGENT_PAYER.MAC_SIGN_IN,
    });

    const { agent } = Option.getOrThrow(started);
    const session = `cc-${randomUUID()}`;
    yield* db
      .update(conversations)
      .set({ runtimeSessionId: session })
      .where(eq(conversations.id, agent.conversationId));

    return { userId, deviceId, agent, session };
  });

/** What the sessions reach beside the store and the deployment's environment: the Mac's machine, and no GitHub or image, which a Mac's launch in no repository never asks. */
const LOCAL_AGENT_SERVICES = Layer.mergeAll(
  Layer.effect(AgentMachine, deviceMachine),
  memorySandbox().layer,
  NO_GITHUB,
  Layer.succeed(AgentImage, {
    reference: Effect.die(new Error("a Mac opens no image")),
    runner: Effect.die(new Error("a Mac opens no image")),
  }),
);

/**
 * The account's sessions on the harness given, Claude Code where none is,
 * over its Macs alone, which launch a local agent's runner and write its
 * messages as lines its Mac follows, each launch numbering its events from
 * naught.
 */
export const localAgentSessions = (
  userId: string,
  harness: LocalHarness = CONVERSATION_RUNTIME.CLAUDE_CODE,
) =>
  LOCAL_HARNESS[harness]
    .sessions({
      userId,
      eventsUrl: "https://app.test/api/agents/runner/events",
      linesUrl: "https://app.test/api/agents/runner-lines",
      transcriptsUrl: "https://app.test/api/agents/runner-transcripts",
      picturesUrl: "https://app.test/api/agents/runner-pictures",
      mcpUrl: "https://app.test/api/agents/mcp",
      integrations: () => Effect.succeed([]),
      instructions: () => Effect.succeed("You are a Vespin coding agent."),
      nextSequence: () => Effect.succeed(0),
    })
    .pipe(Effect.provide(LOCAL_AGENT_SERVICES)) satisfies Effect.Effect<
    unknown,
    never,
    DatabaseServices | HostedEnvironment
  >;

/** The deployment's environment a local agent's launch is sealed under, and its saved keys opened with: a key ring, and nothing else. */
export const LOCAL_AGENT_ENVIRONMENT = Layer.succeed(HostedEnvironment, {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  posthogDistinctIdKey: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: AGENT_KEY_RING,
  titleAnthropicApiKey: undefined,
  previewApiKeys: {},
});

/** The developer's message as the store hands it to the agent's sessions. */
export const typedMessage = (agent: Agent, text: string) => ({
  conversationId: agent.conversationId,
  turn: "typed" as const,
  message: text,
});

/**
 * A local agent on the harness given whose Start launched its runner,
 * which its Mac took, and whose first turn then settled, as its IDLE's
 * batch writes it: the agent, its sessions, the session its Start claimed,
 * the turn that settled, and the launch line its Mac claimed.
 */
export const warmLocalAgentOn = Effect.fnUntraced(function* (harness: LocalHarness) {
  const db = yield* Database;
  const opened = yield* openLocalAgent({ harness });
  const { userId, deviceId, agent } = opened;
  const sessions = yield* localAgentSessions(userId, harness);
  const started = yield* sessions.open(typedMessage(agent, "Fix the invitations."));
  assert.ok(started.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
  const { sessionId } = started;
  // The agent's record names the session, as its Start claims it.
  yield* db
    .update(conversations)
    .set({ runtimeSessionId: sessionId })
    .where(eq(conversations.id, agent.conversationId));
  const [launch] = yield* deviceAgentLinesWaiting(userId, deviceId);
  assert.equal(launch?.kind, DEVICE_AGENT_LINE_KIND.LAUNCH);
  yield* claimedDeviceAgentLine(userId, deviceId, launch.id);
  const settledAt = yield* DateTime.nowAsDate;

  const [settled] = yield* db
    .insert(turns)
    .values({
      userId,
      conversationId: agent.conversationId,
      origin: TURN_ORIGIN.TYPED,
      status: TURN_STATUS.SETTLED,
      queuedAt: settledAt,
      settledAt,
    })
    .returning({ id: turns.id });

  assert.ok(settled !== undefined);

  return { ...opened, sessions, sessionId, turnId: settled.id, launchId: launch.id };
});

/** A warm local agent on Claude Code (`warmLocalAgentOn`). */
export const warmLocalAgent = warmLocalAgentOn(CONVERSATION_RUNTIME.CLAUDE_CODE);

export type WarmLocalAgent = Effect.Success<typeof warmLocalAgent>;

/** What the agent's Mac has yet to take, line by line: a message line by the text it carries, any other by its kind. */
export const linesWaiting = (warm: WarmLocalAgent) =>
  Effect.map(deviceAgentLinesWaiting(warm.userId, warm.deviceId), (lines) =>
    lines.map((line) =>
      line.kind === DEVICE_AGENT_LINE_KIND.MESSAGE ? String(line.payload.text) : line.kind,
    ),
  );

/** Whether the newest launch line waiting for the agent's Mac carries the text given among its first lines, which its sealed secrets hold and its Mac's claim opens. */
export const launchCarries = (warm: WarmLocalAgent, text: string) =>
  Effect.gen(function* () {
    const waiting = yield* deviceAgentLinesWaiting(warm.userId, warm.deviceId);
    const launch = waiting.filter((line) => line.kind === DEVICE_AGENT_LINE_KIND.LAUNCH).at(-1);

    if (launch === undefined) return false;
    const claimed = yield* claimedDeviceAgentLine(warm.userId, warm.deviceId, launch.id);
    const opened = Option.map(claimed, (line) => ("secrets" in line ? line.secrets : null));

    return JSON.stringify(Option.getOrNull(opened)).includes(text);
  });
