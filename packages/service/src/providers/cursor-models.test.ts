import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { user } from "@repo/database/schemas/auth";
import { getTestDB } from "@repo/database/testing";
import { CONTEXT_WINDOW } from "@repo/features/agent-wire";
import { PROVIDER_KEY_PROVIDER } from "@repo/features/provider-key-wire";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { connectAgentApiKeys } from "../testing/agent-credentials.js";
import { LOCAL_AGENT_ENVIRONMENT } from "../testing/local-agent.js";
import {
  CursorModelCatalog,
  cursorModelCatalogLayer,
  cursorModelSelectionOf,
  cursorModelsOf,
  withCursorModels,
} from "./cursor-models.js";

/**
 * Cursor's model list as `GET api.cursor.com/v1/models` answers it, written
 * by hand in its shape: Auto, which lists nothing to choose; Grok, whose
 * effort is `reasoning_effort`, which runs fast, and whose 500K window runs
 * in Max Mode alone, at standard speed alone; and Opus, whose effort is `effort` and whose fast
 * version runs in Max Mode alone.
 */
const LIST = [
  { id: "default", displayName: "Auto" },
  {
    id: "grok-4.7",
    displayName: "Grok 4.7",
    parameters: [
      {
        id: "reasoning_effort",
        values: [{ value: "low" }, { value: "medium" }, { value: "high" }],
      },
      { id: "fast", values: [{ value: "false" }, { value: "true" }] },
      { id: "context", values: [{ value: "256k" }, { value: "500k" }] },
    ],
    variants: [
      {
        params: [
          { id: "context", value: "256k" },
          { id: "fast", value: "false" },
        ],
        isDefault: true,
      },
      {
        params: [
          { id: "context", value: "256k" },
          { id: "fast", value: "true" },
        ],
      },
      {
        params: [
          { id: "context", value: "500k" },
          { id: "fast", value: "false" },
        ],
        isMaxMode: true,
      },
    ],
  },
  {
    id: "claude-opus-5.5",
    displayName: "Opus 5.5",
    parameters: [
      { id: "effort", values: [{ value: "high" }, { value: "max" }] },
      { id: "fast", values: [{ value: "false" }, { value: "true" }] },
    ],
    variants: [
      { params: [{ id: "fast", value: "false" }], isDefault: true },
      { params: [{ id: "fast", value: "true" }], isMaxMode: true },
    ],
  },
];

const OFFER = { experimentOn: true, apiVersion: 4 };

it("offers every model Cursor lists once, at fast speed where a variant runs fast, on two context windows where a variant runs on a larger one, and on the one window it lists otherwise", () => {
  const offered = withCursorModels([], OFFER, cursorModelsOf(LIST));

  assert.deepEqual(
    offered.map((model) => [
      model.id,
      model.name,
      model.efforts,
      model.contextWindows,
      model.contextWindow,
    ]),
    [
      ["cursor/auto", "Auto", ["default"], undefined, undefined],
      [
        "cursor/grok-4.7",
        "Grok 4.7",
        ["low", "medium", "high"],
        { standardTokens: 256_000, longTokens: 500_000 },
        500_000,
      ],
      // Note that Grok's larger window runs at standard speed alone, so its fast version has one window.
      ["cursor/grok-4.7-fast", "Grok 4.7 (Fast)", ["low", "medium", "high"], undefined, 256_000],
      // Note that Opus lists no window, so it is offered none rather than a guessed one.
      ["cursor/claude-opus-5.5", "Opus 5.5", ["high", "max"], undefined, undefined],
      ["cursor/claude-opus-5.5-fast", "Opus 5.5 (Fast)", ["high", "max"], undefined, undefined],
    ],
  );
});

it("reads each model of Cursor's list on its own: one it cannot read is left out, one with no name is named by its id, and one whose name an earlier model took carries its id", () => {
  const offered = withCursorModels(
    [],
    OFFER,
    cursorModelsOf([
      { id: 7, displayName: "Broken" },
      { id: "kimi-k3" },
      ...LIST.slice(0, 1),
      { id: "auto-smart", displayName: "Auto" },
    ]),
  );

  assert.deepEqual(
    offered.map((model) => [model.id, model.name]),
    [
      ["cursor/kimi-k3", "kimi-k3"],
      ["cursor/auto", "Auto"],
      ["cursor/auto-smart", "Auto (auto-smart)"],
    ],
  );
});

it.each([
  ["Auto, which sends nothing to choose", "cursor/auto", "default", undefined, { id: "default" }],
  [
    "Grok's fast version, its effort under its own parameter and its one window",
    "cursor/grok-4.7-fast",
    "high",
    undefined,
    {
      id: "grok-4.7",
      params: [
        { id: "context", value: "256k" },
        { id: "reasoning_effort", value: "high" },
        { id: "fast", value: "true" },
      ],
    },
  ],
  [
    "Grok on its standard window, outside Max Mode",
    "cursor/grok-4.7",
    "low",
    CONTEXT_WINDOW.STANDARD,
    {
      id: "grok-4.7",
      params: [
        { id: "context", value: "256k" },
        { id: "reasoning_effort", value: "low" },
        { id: "fast", value: "false" },
      ],
    },
  ],
  [
    "Grok on its long window, the default, which runs in Max Mode alone",
    "cursor/grok-4.7",
    "low",
    undefined,
    {
      id: "grok-4.7",
      params: [
        { id: "context", value: "500k" },
        { id: "reasoning_effort", value: "low" },
        { id: "fast", value: "false" },
      ],
      maxMode: true,
    },
  ],
  [
    "Opus fast, which runs in Max Mode alone",
    "cursor/claude-opus-5.5-fast",
    "max",
    undefined,
    {
      id: "claude-opus-5.5",
      params: [
        { id: "effort", value: "max" },
        { id: "fast", value: "true" },
      ],
      maxMode: true,
    },
  ],
  [
    "a fast model the list does not name, as while Cursor's list cannot be read, on Cursor's id and its speed alone",
    "cursor/gpt-6-fast",
    "high",
    undefined,
    { id: "gpt-6", params: [{ id: "fast", value: "true" }] },
  ],
] as const)("runs %s as Cursor's SDK takes it", (_case, catalogId, effort, window, selection) => {
  assert.deepEqual(
    cursorModelSelectionOf(cursorModelsOf(LIST), catalogId, effort, window),
    selection,
  );
});

it("offers no Cursor model to an account without Cursor agents on, or a client that cannot read them", () => {
  const models = cursorModelsOf(LIST);

  assert.deepEqual(withCursorModels([], { experimentOn: false, apiVersion: 4 }, models), []);
  assert.deepEqual(withCursorModels([], { experimentOn: true, apiVersion: 3 }, models), []);
});

it.layer(getTestDB())("Cursor's list as the service reads it", (it) => {
  it.effect(
    "keeps offering the account's last list it read while Cursor's list cannot be read",
    () =>
      Effect.gen(function* () {
        const userId = `user-${randomUUID()}`;
        yield* Effect.flatMap(Database, (db) =>
          db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
        );
        yield* connectAgentApiKeys(userId, { providers: [PROVIDER_KEY_PROVIDER.CURSOR] });
        let reads = 0;

        // Cursor answers its list once, then times out on every read after.
        const cursor = fakeHttpClientLayer(() => {
          reads += 1;

          if (reads > 1) throw new Error("timed out");

          return Response.json({ items: LIST });
        });

        const catalog = yield* Effect.provide(
          CursorModelCatalog,
          cursorModelCatalogLayer.pipe(Layer.provide(Layer.merge(cursor, LOCAL_AGENT_ENVIRONMENT))),
        );

        const first = yield* catalog.forAccount(userId);
        yield* TestClock.adjust("1 hour");
        const later = yield* catalog.forAccount(userId);

        assert.equal(reads, 2);
        assert.deepEqual(later, first);
        assert.ok(later.some((model) => model.catalogId === "cursor/claude-opus-5.5"));
      }),
  );
});
