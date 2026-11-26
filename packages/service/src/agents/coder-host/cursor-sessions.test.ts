import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { CURSOR_SDK_ENTRY } from "@repo/agent-runner/pins";
import { PERMISSION_MODE, RUNNER_ENV, RUNNER_HARNESS } from "@repo/agent-runner/protocol";
import { Database } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import {
  type KeyRing,
  parseKeyRing,
  sealProviderKey,
} from "@repo/database/models/provider-key-seal";
import { saveProviderKey } from "@repo/database/models/provider-key-store";
import { storeWriter } from "@repo/database/models/writer";
import { user } from "@repo/database/schemas/auth";
import { CONVERSATION_RUNTIME, MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import { getTestDB, startTask } from "@repo/database/testing";
import { AGENT_PERMISSION_MODE } from "@repo/features/agent-approval-wire";
import { AGENT_PAYER } from "@repo/features/agent-wire";
import { PROVIDER_KEY_KIND, PROVIDER_KEY_PROVIDER } from "@repo/features/provider-key-wire";
import { memorySandbox } from "@repo/sandbox/testing";
import { fixtureToken, vercelSandboxOver } from "@repo/sandbox/vercel/testing";
import type { WireRecord } from "@repo/wire";
import { sentLineId } from "@repo/wire/host-ids";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { Effect, Layer, Option, Redacted, Result } from "effect";
import { afterEach, vi } from "vitest";
import { HostedEnvironment, type HostedEnvironmentValues } from "../../environment.js";
import { GITHUB_APP_WITH_TOKENS } from "../../testing/github-app-fake.js";
import {
  readCursorConfig,
  runnerSandboxApi,
  stdinRead,
} from "../../testing/runner-sandbox-fake.js";
import { sandboxMachineLayer } from "../machine/sandbox-machine.js";
import { SESSION_SEND_OUTCOME } from "../sessions/agent-sessions.js";
import { AgentImage } from "./agent-image.js";
import { cursorSessions } from "./cursor-sessions.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/**
 * A coding agent's sessions on Cursor, against a fake of Vercel Sandbox's
 * REST API over a real store: the launch on the account's Cursor key, held
 * at the firewall on both of Cursor's hosts behind a placeholder, and its
 * config on Cursor's own model and mode. Synthetic accounts and keys
 * throughout.
 */

const SUITE = Layer.merge(getTestDB(), memorySandbox().layer);
const KEK = `1:${Buffer.alloc(32, 3).toString("base64")}`;
const INSTRUCTIONS = "You are a Vespin coding agent.";

const NO_KEYS: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  posthogDistinctIdKey: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: Redacted.make(KEK),
  titleAnthropicApiKey: undefined,
  previewApiKeys: {},
};

function ring(): KeyRing {
  const parsed = parseKeyRing(Redacted.make(KEK));

  if (Result.isFailure(parsed)) return assert.fail("not a ring");

  return parsed.success;
}

/** Everything but the store: Vercel behind one client, the agent's machine, and the image. */
function services(api: ReturnType<typeof runnerSandboxApi>) {
  const http = Layer.provideMerge(vercelSandboxOver(api.respond), fakeHttpClientLayer(api.respond));

  return Layer.mergeAll(
    http,
    sandboxMachineLayer({ run: (effect) => Effect.runPromise(effect) }).pipe(Layer.provide(http)),
    GITHUB_APP_WITH_TOKENS.pipe(Layer.provide(http)),
    Layer.succeed(HostedEnvironment, NO_KEYS),
    Layer.succeed(AgentImage, {
      reference: Effect.succeed("agent-image:fixture"),
      runner: Effect.succeed([]),
    }),
  );
}

/** What the newest policy the sandbox's firewall was sent sets on the host given. */
const rulesOn = (api: ReturnType<typeof runnerSandboxApi>, host: string) => {
  // SAFETY: the fake keeps each network policy as the service sent it, whose rules are listed by host under `allow`.
  const policy = api.policies.at(-1)?.policy as { readonly allow?: WireRecord } | undefined;

  return policy?.allow?.[host];
};

afterEach(() => {
  vi.unstubAllEnvs();
});

it.layer(SUITE)("a coding agent's sessions on Cursor", (it) => {
  it.effect(
    "an agent on its starter's Cursor key launches with a placeholder as CURSOR_API_KEY, the key swapped in at the firewall on both of Cursor's hosts, on Cursor's own model and Auto-review",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const apiKey = "crsr_fixture_account_key";
        const userId = `user-${randomUUID()}`;
        yield* Effect.flatMap(Database, (db) =>
          db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
        );
        const task = yield* startTask(userId, { name: "Teammate invitations" });

        const started = yield* createAgent(userId, {
          taskId: task.id,
          idempotencyKey: "start-key",
          model: "cursor/grok-4.7-fast",
          effort: "high",
          descriptionSnapshot: "# Teammate invitations\n",
          prompt: null,
          repository: null,
          runtime: CONVERSATION_RUNTIME.CURSOR,
          payer: AGENT_PAYER.API_KEY,
          permissionMode: AGENT_PERMISSION_MODE.AUTO,
        });

        assert.ok(Option.isSome(started));
        const agent = started.value.agent;

        const owner = {
          userId,
          provider: PROVIDER_KEY_PROVIDER.CURSOR,
          kind: PROVIDER_KEY_KIND.API_KEY,
        };

        yield* saveProviderKey(
          userId,
          owner.provider,
          owner.kind,
          sealProviderKey(ring(), owner, Redacted.make(apiKey)),
          "crsr…-key",
          null,
          new Date(0),
        );

        const api = runnerSandboxApi();

        const sessions = yield* cursorSessions({
          userId,
          eventsUrl: "https://app.test/api/agents/runner-events",
          linesUrl: "https://app.test/api/agents/runner-lines",
          mcpUrl: "https://app.test/api/agents/mcp",
          transcriptsUrl: "https://app.test/api/agents/runner-transcripts",
          picturesUrl: "https://app.test/api/agents/runner-pictures",
          integrations: () => Effect.succeed([]),
          instructions: () => Effect.succeed(INSTRUCTIONS),
          nextSequence: () => Effect.succeed(0),
        }).pipe(Effect.provide(services(api)));

        // The Start's line, written awaiting the turn its send queues, and that turn delivered.
        const clientKey = randomUUID();
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        yield* writer.writeAwaitingLine(
          { userId, conversationId: agent.conversationId },
          { text: "Fix the invitations.", clientKey, sender: { kind: MESSAGE_SENDER.APP } },
          Effect.succeed(true),
        );

        const sent = {
          conversationId: agent.conversationId,
          turn: "typed" as const,
          message: "Fix the invitations.",
          lineId: sentLineId(clientKey),
        };

        const opened = yield* sessions.open(sent);
        assert.ok(opened.outcome === SESSION_SEND_OUTCOME.ACCEPTED);
        yield* sessions.deliverTurn(opened.sessionId, agent.conversationId);

        const [command] = api.commands;
        assert.ok(command !== undefined);
        const placeholder = command.env[RUNNER_ENV.CURSOR_API_KEY];
        assert.ok(placeholder !== undefined && placeholder.length > 20);

        const swap = {
          match: {
            headers: [
              { key: { exact: "authorization" }, value: { exact: `Bearer ${placeholder}` } },
            ],
          },
          transform: [{ headers: { authorization: `Bearer ${apiKey}` } }],
        };

        assert.deepEqual(rulesOn(api, "api.cursor.com"), [swap]);
        assert.deepEqual(rulesOn(api, "api2.cursor.sh"), [
          {
            ...swap,
            match: { ...swap.match, path: { startsWith: "/auth/exchange_user_api_key" } },
          },
        ]);

        const { config } = stdinRead(command, readCursorConfig);
        assert.equal(config.harness, RUNNER_HARNESS.CURSOR);
        assert.equal(config.sdk, CURSOR_SDK_ENTRY);
        assert.deepEqual(config.model, {
          id: "grok-4.7",
          params: [
            { id: "context", value: "256k" },
            { id: "reasoning_effort", value: "high" },
            { id: "fast", value: "true" },
          ],
        });
        assert.equal(config.permissionMode, PERMISSION_MODE.AUTO);
        assert.equal(config.instructions, INSTRUCTIONS);
        assert.equal(JSON.stringify([command, api.sandboxes]).includes(apiKey), false);
      }),
  );
});
