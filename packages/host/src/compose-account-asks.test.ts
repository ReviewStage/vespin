import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { agentDefaultOf } from "@repo/features/account-preferences-live";
import { AGENT_CALL_FAILURE, MEMORY_SAVE_FAILURE } from "@repo/features/agent-view";
import { DEVICE_PLATFORM } from "@repo/features/device-agent-wire";
import { MEMORY_SAVED, type MemorySummary } from "@repo/features/memory-wire";
import {
  AGENT_DEFAULT_CHOICE,
  AGENT_FALLBACK_CHOICE,
  type CatalogModel,
  MODEL_PROVIDER,
} from "@repo/features/models-wire";
import { PROVIDER_KEY_PROVIDER } from "@repo/features/provider-key-wire";
import { isRecord, type WireValue } from "@repo/wire";
import { Deferred, Duration, Effect, Fiber, Predicate } from "effect";
import { TestClock } from "effect/testing";
import type { AppAccountPreferences, AppModels } from "./app-state.js";

import {
  GATE_CLOSED_SIGNED_OUT,
  GITHUB_TOKEN,
  holding,
  KEPT,
  MEMORY,
  nextPoll,
  PROVIDER_KEY,
  SAVED_TOKEN,
  settled,
  subject,
  WORKSPACE_ID,
} from "./testing/agents-subject.js";

it.effect(
  "a provider key passes through to the service once and is answered back, and held for the windows, as its hint alone, each write's answer laid where the keys are held",
  () =>
    Effect.gen(function* () {
      const { acts, asked, providerKeys } = yield* subject();

      yield* acts.PROVIDER_KEYS_FOLLOW.hold(undefined);
      yield* settled;
      const read = providerKeys().at(-1);

      const saved = yield* acts.PROVIDER_KEYS_SAVE({
        provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
        key: PROVIDER_KEY,
      });

      const removed = yield* acts.PROVIDER_KEYS_REMOVE({
        provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
      });

      assert.deepEqual(read, { "user-dana": { rows: { keys: [KEPT] } } });
      assert.deepEqual(saved, { keys: [KEPT] });
      assert.deepEqual(removed, { keys: [] });
      assert.deepEqual(providerKeys().at(-1), { "user-dana": { rows: { keys: [] } } });
      assert.ok(!JSON.stringify([providerKeys(), saved, removed]).includes(PROVIDER_KEY));
      assert.deepEqual(asked, [
        "keys",
        `save:${PROVIDER_KEY_PROVIDER.ANTHROPIC}:the key`,
        `remove:${PROVIDER_KEY_PROVIDER.ANTHROPIC}`,
      ]);
    }),
);

it.effect(
  "an account that stored no default reads the fallback its keys pay for, and once its keys move the models are asked again and the fallback moves with them",
  () =>
    Effect.gen(function* () {
      const { acts, open, answerKeys, models, preferences } = yield* subject();
      const openai = AGENT_FALLBACK_CHOICE[MODEL_PROVIDER.OPENAI];

      const claude: CatalogModel = {
        id: AGENT_DEFAULT_CHOICE.model,
        name: "Claude Opus 5.5",
        provider: MODEL_PROVIDER.ANTHROPIC,
        efforts: ["high"],
      };

      const gpt: CatalogModel = {
        id: openai.model,
        name: "GPT-6.1 Sol",
        provider: MODEL_PROVIDER.OPENAI,
        efforts: ["high"],
      };

      const openaiKey = { ...KEPT, provider: PROVIDER_KEY_PROVIDER.OPENAI };
      answerKeys([openaiKey], [{ ...claude, credentialMissing: true }, gpt]);

      /** The default a surface draws from the slices the host told last. */
      const drawnDefault = () => {
        // SAFETY: the host tells its own slices whole, as built.
        const held = preferences().at(-1) as AppAccountPreferences | undefined;
        // SAFETY: the host tells its own slices whole, as built.
        const offered = models().at(-1) as AppModels | undefined;
        assert.ok(held?.["user-dana"]?.rows !== undefined, "the preferences answered");

        return agentDefaultOf(held["user-dana"].rows.agent, offered?.["user-dana"] ?? {});
      };

      yield* open;
      yield* acts.PROVIDER_KEYS_FOLLOW.hold(undefined);
      yield* acts.AGENTS_MODELS_FOLLOW.hold(undefined);
      yield* settled;
      assert.deepEqual(drawnDefault(), openai, "only an OpenAI key pays, so OpenAI's fallback");

      answerKeys([openaiKey, KEPT], [claude, gpt]);
      yield* acts.PROVIDER_KEYS_FOLLOW.retry(undefined);
      yield* settled;
      assert.deepEqual(
        drawnDefault(),
        AGENT_DEFAULT_CHOICE,
        "a Claude key pays now, so Anthropic's",
      );
    }),
);

it.effect(
  "a GitHub token passes through to the service once and is never answered back, held for the windows as its summary, each write's answer laid where it is held once the repository lists moved",
  () =>
    Effect.gen(function* () {
      // The token the windows held as each write's read of the repository lists landed, a turn after it was asked.
      const movedUnder: unknown[] = [];
      let held: () => unknown[] = () => [];

      const { acts, asked, githubToken } = yield* subject({
        repositoriesMoved: Effect.andThen(
          Effect.yieldNow,
          Effect.sync(() => void movedUnder.push(held().at(-1))),
        ),
      });

      held = githubToken;

      yield* acts.GITHUB_TOKEN_FOLLOW.hold(undefined);
      yield* settled;
      const read = githubToken().at(-1);
      const saved = yield* acts.GITHUB_TOKEN_SAVE({ token: GITHUB_TOKEN });
      const afterSave = githubToken().at(-1);
      const removed = yield* acts.GITHUB_TOKEN_REMOVE(undefined);

      assert.deepEqual(read, { "user-dana": { rows: { token: null } } });
      assert.deepEqual(saved, { token: SAVED_TOKEN });
      assert.deepEqual(afterSave, { "user-dana": { rows: { token: SAVED_TOKEN } } });
      assert.deepEqual(removed, { token: null });
      assert.deepEqual(githubToken().at(-1), { "user-dana": { rows: { token: null } } });
      assert.ok(!JSON.stringify([githubToken(), saved, removed]).includes(GITHUB_TOKEN));
      assert.deepEqual(asked, ["token", "save-token:the token", "remove-token"]);
      assert.deepEqual(movedUnder, [read, afterSave], "each write's lists move before its token");
    }),
);

/** A second memory of the workspace, kept after `MEMORY`. */
const OTHER_MEMORY: MemorySummary = {
  id: "9e2b3c4d-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
  text: "Tests run before every push.",
  keptBy: { userId: "user-1", name: "Dean" },
  forgettable: true,
  createdAt: 3,
  updatedAt: 4,
  source: null,
  recalls30d: 0,
  lastRecalledAt: null,
};

/** A memory as the workspace's live read delivers it. */
function memoryRow(memory: MemorySummary) {
  return {
    id: memory.id,
    text: memory.text,
    keeperId: memory.keptBy?.userId ?? null,
    keeperName: memory.keptBy?.name ?? null,
    forgettable: memory.forgettable,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    sourceAgentId: memory.source?.agentId ?? null,
    sourceMessageId: memory.source?.messageId ?? null,
    sourceTaskId: memory.source?.taskId ?? null,
    sourceTaskName: memory.source?.taskName ?? null,
    recalls30d: memory.recalls30d,
    lastRecalledAt: memory.lastRecalledAt,
  };
}

/** The ids of the workspace's memories as the host last told them; none where it told none. */
function memoryIdsOf(told: WireValue | undefined): readonly string[] | undefined {
  const read = isRecord(told) ? told[WORKSPACE_ID] : undefined;
  const rows = isRecord(read) ? read.rows : undefined;

  return Array.isArray(rows)
    ? rows.flatMap((row) => (isRecord(row) && Predicate.isString(row.id) ? [row.id] : []))
    : undefined;
}

it.effect(
  "a forget draws its memory gone before the service answers and keeps it gone through an answer from before it until the read carries its transaction, and a refused forget puts back the memory it drew gone",
  () =>
    Effect.gen(function* () {
      const harness = yield* subject();
      const { acts, live, answerForgets } = harness;
      const shown = () => memoryIdsOf(harness.memories().at(-1));
      yield* acts.MEMORIES_FOLLOW.hold({ workspaceId: WORKSPACE_ID });
      yield* settled;
      // The read is woken by a write once, so it hands a wait for the next.
      live.memories.set({ memories: [memoryRow(OTHER_MEMORY), memoryRow(MEMORY)] }, ["9100"]);
      yield* nextPoll;
      assert.deepEqual(shown(), [OTHER_MEMORY.id, MEMORY.id]);

      const answering = yield* Deferred.make<void>();
      answerForgets({ memories: [OTHER_MEMORY], txid: "9200" }, Deferred.await(answering));

      const forgetting = yield* Effect.forkChild(
        acts.MEMORIES_FORGET({ workspaceId: WORKSPACE_ID, id: MEMORY.id }),
      );

      yield* settled;
      assert.equal(forgetting.pollUnsafe(), undefined, "no answer while the service is asked");
      assert.deepEqual(shown(), [OTHER_MEMORY.id], "gone before the service answers");

      yield* Deferred.succeed(answering, undefined);
      assert.deepEqual(yield* Fiber.join(forgetting), { memories: [OTHER_MEMORY], txid: "9200" });
      // The read answers once more from before the forget, which still stands over it.
      live.memories.set({ memories: [memoryRow(OTHER_MEMORY), memoryRow(MEMORY)] });
      yield* nextPoll;
      assert.deepEqual(shown(), [OTHER_MEMORY.id]);
      live.memories.set({ memories: [memoryRow(OTHER_MEMORY)] }, ["9200"]);
      yield* nextPoll;
      assert.deepEqual(shown(), [OTHER_MEMORY.id]);

      const refusing = yield* Deferred.make<void>();
      answerForgets({ failure: AGENT_CALL_FAILURE.NOT_PERMITTED }, Deferred.await(refusing));

      const refused = yield* Effect.forkChild(
        acts.MEMORIES_FORGET({ workspaceId: WORKSPACE_ID, id: OTHER_MEMORY.id }),
      );

      yield* settled;
      assert.deepEqual(shown(), []);
      yield* Deferred.succeed(refusing, undefined);
      assert.deepEqual(yield* Fiber.join(refused), { failure: AGENT_CALL_FAILURE.NOT_PERMITTED });
      yield* settled;
      assert.deepEqual(shown(), [OTHER_MEMORY.id], "put back once the service refused it");
    }),
);

/** The words of the workspace's memories as the host last told them; none where it told none. */
function memoryTextsOf(told: WireValue | undefined): readonly string[] | undefined {
  const read = isRecord(told) ? told[WORKSPACE_ID] : undefined;
  const rows = isRecord(read) ? read.rows : undefined;

  return Array.isArray(rows)
    ? rows.flatMap((row) => (isRecord(row) && Predicate.isString(row.text) ? [row.text] : []))
    : undefined;
}

it.effect(
  "an edit draws its memory's new words before the service answers and keeps the words it answered, and a refused edit puts back the words it drew over",
  () =>
    Effect.gen(function* () {
      const harness = yield* subject();
      const { acts, live, answerSaves } = harness;
      const shown = () => memoryTextsOf(harness.memories().at(-1));
      yield* acts.MEMORIES_FOLLOW.hold({ workspaceId: WORKSPACE_ID });
      yield* settled;
      live.memories.set({ memories: [memoryRow(MEMORY)] }, ["9100"]);
      yield* nextPoll;
      assert.deepEqual(shown(), [MEMORY.text]);

      const corrected = "The store tests run on Postgres.";
      const answering = yield* Deferred.make<void>();
      answerSaves(
        {
          outcome: MEMORY_SAVED.CORRECTED,
          memory: { ...MEMORY, text: corrected, updatedAt: MEMORY.updatedAt + 1 },
        },
        Deferred.await(answering),
      );

      const saving = yield* Effect.forkChild(
        acts.MEMORIES_SAVE({ workspaceId: WORKSPACE_ID, text: corrected, replaces: MEMORY.id }),
      );

      yield* settled;
      assert.deepEqual(shown(), [corrected], "drawn before the service answers");
      yield* Deferred.succeed(answering, undefined);
      yield* Fiber.join(saving);
      yield* settled;
      assert.deepEqual(shown(), [corrected], "kept once the service answered");

      const refusing = yield* Deferred.make<void>();
      answerSaves({ failure: MEMORY_SAVE_FAILURE.MEMORY_CREDENTIAL }, Deferred.await(refusing));

      const refused = yield* Effect.forkChild(
        acts.MEMORIES_SAVE({ workspaceId: WORKSPACE_ID, text: "token=…", replaces: MEMORY.id }),
      );

      yield* settled;
      assert.deepEqual(shown(), ["token=…"]);
      yield* Deferred.succeed(refusing, undefined);
      assert.deepEqual(yield* Fiber.join(refused), {
        failure: MEMORY_SAVE_FAILURE.MEMORY_CREDENTIAL,
      });
      yield* settled;
      assert.deepEqual(shown(), [corrected], "put back once the service refused it");
    }),
);

/** The account's hosts the remove case lists: one kept, and one removed. */
const KEPT_HOST = "4b1c2d3e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const GONE_HOST = "5c2d3e4f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";

/** A host as the account's live read delivers it. */
function hostRow(id: string, name: string) {
  return { id, name, platform: DEVICE_PLATFORM.LINUX, machineId: null, model: null, update: null };
}

/** The ids of the account's hosts as the host last told them; none where it told none. */
function hostIdsOf(told: WireValue | undefined): readonly string[] | undefined {
  const read = isRecord(told) ? told["user-dana"] : undefined;
  const held = isRecord(read) ? read.rows : undefined;
  const rows = isRecord(held) ? held.hosts : undefined;

  return Array.isArray(rows)
    ? rows.flatMap((row) => (isRecord(row) && Predicate.isString(row.id) ? [row.id] : []))
    : undefined;
}

it.effect(
  "a removal draws its host gone before the service answers and keeps it gone through an answer from before it until the read carries its transaction, and a refused removal puts back the host it drew gone",
  () =>
    Effect.gen(function* () {
      const harness = yield* subject();
      const { acts, live, answerRemoves } = harness;
      const shown = () => hostIdsOf(harness.hosts().at(-1));
      const both = { hosts: [hostRow(KEPT_HOST, "ams-01"), hostRow(GONE_HOST, "fra-03")] };
      yield* acts.HOSTS_FOLLOW.hold(undefined);
      yield* settled;
      // The read is woken by a write once, so it hands a wait for the next.
      live.hosts.set(both, ["9300"]);
      yield* nextPoll;
      assert.deepEqual(shown(), [KEPT_HOST, GONE_HOST]);

      const answering = yield* Deferred.make<void>();
      answerRemoves({ done: true, txid: "9400" }, Deferred.await(answering));
      const removing = yield* Effect.forkChild(acts.HOSTS_REMOVE({ id: GONE_HOST }));
      yield* settled;
      assert.equal(removing.pollUnsafe(), undefined, "no answer while the service is asked");
      assert.deepEqual(shown(), [KEPT_HOST], "gone before the service answers");

      yield* Deferred.succeed(answering, undefined);
      assert.deepEqual(yield* Fiber.join(removing), { done: true, txid: "9400" });
      // The read answers once more from before the removal, which still stands over it.
      live.hosts.set(both);
      yield* nextPoll;
      assert.deepEqual(shown(), [KEPT_HOST]);
      live.hosts.set({ hosts: [hostRow(KEPT_HOST, "ams-01")] }, ["9400"]);
      yield* nextPoll;
      assert.deepEqual(shown(), [KEPT_HOST]);

      const refusing = yield* Deferred.make<void>();
      answerRemoves({ failure: AGENT_CALL_FAILURE.NOT_FOUND }, Deferred.await(refusing));
      const refused = yield* Effect.forkChild(acts.HOSTS_REMOVE({ id: KEPT_HOST }));
      yield* settled;
      assert.deepEqual(shown(), []);
      yield* Deferred.succeed(refusing, undefined);
      assert.deepEqual(yield* Fiber.join(refused), { failure: AGENT_CALL_FAILURE.NOT_FOUND });
      yield* settled;
      assert.deepEqual(shown(), [KEPT_HOST], "put back once the service refused it");
    }),
);

it.effect(
  "a command write waiting its turn as the account changes is never sent for the account signed in after",
  () =>
    Effect.gen(function* () {
      let signedIn = "user-dana";
      const { acts, asked, holdCommandAdds } = yield* subject({ accountId: () => signedIn });
      const firstAnswered = yield* Deferred.make<void>();
      holdCommandAdds(Deferred.await(firstAnswered));

      const first = yield* Effect.forkChild(acts.ALLOWED_COMMANDS_WRITE({ add: ["pnpm", "test"] }));
      yield* settled;

      const second = yield* Effect.forkChild(
        acts.ALLOWED_COMMANDS_WRITE({ add: ["pnpm", "lint"] }),
      );

      yield* settled;
      signedIn = "user-eli";
      yield* Deferred.succeed(firstAnswered, undefined);

      yield* Fiber.join(first);
      const queued = yield* Fiber.join(second);
      assert.deepEqual(queued, { failure: AGENT_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(
        asked.filter((each) => each.startsWith("add-command")),
        ["add-command:pnpm test"],
      );
    }),
);

it.effect(
  "a command write answered after the account changes is answered to the window but never laid on the list of the account signed in after",
  () =>
    Effect.gen(function* () {
      let signedIn = "user-dana";

      const { acts, open, holdCommandAdds, allowedCommands } = yield* subject({
        accountId: () => signedIn,
      });

      const answered = yield* Deferred.make<void>();
      holdCommandAdds(Deferred.await(answered));
      yield* acts.ALLOWED_COMMANDS_FOLLOW.hold(undefined);
      yield* settled;

      const adding = yield* Effect.forkChild(
        acts.ALLOWED_COMMANDS_WRITE({ add: ["pnpm", "test"] }),
      );

      yield* settled;
      signedIn = "user-eli";
      yield* open;
      yield* settled;
      yield* Deferred.succeed(answered, undefined);
      const answer = yield* Fiber.join(adding);
      yield* settled;

      assert.ok("commands" in answer && answer.commands.length === 1);
      const told = allowedCommands().at(-1);
      assert.ok(isRecord(told));
      assert.deepEqual(told["user-eli"], { rows: { commands: [] } });
    }),
);

it.effect("a closed gate answers a forget unanswered before the service is asked", () =>
  Effect.gen(function* () {
    const signedOut = yield* subject({ signedIn: false });

    const unanswered = yield* signedOut.acts.MEMORIES_FORGET({
      workspaceId: WORKSPACE_ID,
      id: MEMORY.id,
    });

    assert.deepEqual(unanswered, GATE_CLOSED_SIGNED_OUT);
    assert.deepEqual(signedOut.asked, []);
  }),
);

it.effect(
  "the account's beats are asked as a window holds them and every twenty seconds while it does, and never once it lets them go",
  () =>
    Effect.gen(function* () {
      const { acts, asked, answerPresence, beats } = yield* subject();
      const device = "6d2c1b0a-9f8e-4d7c-8b6a-5e4d3c2b1a09";
      answerPresence({ devices: [{ deviceId: device, ageMs: 5_000 }] });
      const presenceAsks = () => asked.filter((ask) => ask === "presence").length;

      const letGo = yield* holding(acts.HOSTS_PRESENCE_FOLLOW.hold(undefined));
      yield* settled;
      assert.equal(presenceAsks(), 1);
      // Note that the test's clock stands at 0, so a beat five seconds old beat at -5000.
      assert.deepEqual(beats().at(-1), {
        "user-dana": { rows: { beats: [{ deviceId: device, beatAt: -5_000 }], askedAt: 0 } },
      });

      yield* TestClock.adjust(Duration.seconds(20));
      yield* settled;
      assert.equal(presenceAsks(), 2);

      yield* letGo;
      yield* TestClock.adjust(Duration.seconds(60));
      yield* settled;
      assert.equal(presenceAsks(), 2);
    }),
);

it.effect("a read of the beats that fails keeps the beats it answered before, stale", () =>
  Effect.gen(function* () {
    const { acts, answerPresence, failPresence, beats } = yield* subject();
    const device = "6d2c1b0a-9f8e-4d7c-8b6a-5e4d3c2b1a09";
    answerPresence({ devices: [{ deviceId: device, ageMs: 5_000 }] });
    yield* acts.HOSTS_PRESENCE_FOLLOW.hold(undefined);
    yield* settled;

    failPresence();
    yield* TestClock.adjust(Duration.seconds(20));
    yield* settled;
    assert.deepEqual(beats().at(-1), {
      "user-dana": {
        rows: { beats: [{ deviceId: device, beatAt: -5_000 }], askedAt: 20_000, stale: true },
      },
    });
  }),
);
