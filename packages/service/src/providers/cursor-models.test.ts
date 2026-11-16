import assert from "node:assert/strict";
import { it } from "vitest";
import { cursorModelSelectionOf, cursorModelsOf, withCursorModels } from "./cursor-models.js";

/**
 * Cursor's model list as `GET api.cursor.com/v1/models` answers it, written
 * by hand in its shape: Auto, which lists nothing to choose; Grok, whose
 * effort is `reasoning_effort`, which runs fast, and whose 500K window runs
 * in Max Mode alone; and Opus, whose effort is `effort` and whose fast
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

it("offers every model Cursor lists, each at fast speed where a variant runs fast, and a Max Mode model of its own where a variant runs in Max Mode alone", () => {
  const offered = withCursorModels([], OFFER, cursorModelsOf(LIST));

  assert.deepEqual(
    offered.map((model) => [model.id, model.name, model.efforts]),
    [
      ["cursor/auto", "Auto", ["default"]],
      ["cursor/grok-4.7", "Grok 4.7", ["low", "medium", "high"]],
      ["cursor/grok-4.7-fast", "Grok 4.7 (Fast)", ["low", "medium", "high"]],
      ["cursor/grok-4.7-max", "Grok 4.7 (Max Mode)", ["low", "medium", "high"]],
      ["cursor/claude-opus-5.5", "Opus 5.5", ["high", "max"]],
      ["cursor/claude-opus-5.5-max", "Opus 5.5 (Max Mode)", ["high", "max"]],
      ["cursor/claude-opus-5.5-max-fast", "Opus 5.5 (Max Mode) (Fast)", ["high", "max"]],
    ],
  );
});

it("reads each model of Cursor's list on its own: one it cannot read is left out, and one with no name is named by its id", () => {
  const offered = withCursorModels(
    [],
    OFFER,
    cursorModelsOf([{ id: 7, displayName: "Broken" }, { id: "kimi-k3" }, ...LIST.slice(0, 1)]),
  );

  assert.deepEqual(
    offered.map((model) => [model.id, model.name]),
    [
      ["cursor/kimi-k3", "kimi-k3"],
      ["cursor/auto", "Auto"],
    ],
  );
});

it.each([
  ["Auto, which sends nothing to choose", "cursor/auto", "default", { id: "default" }],
  [
    "Grok's fast version, its effort under its own parameter and its standard window",
    "cursor/grok-4.7-fast",
    "high",
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
    "Grok in Max Mode, on its Max Mode window",
    "cursor/grok-4.7-max",
    "low",
    {
      id: "grok-4.7",
      params: [
        { id: "context", value: "500k" },
        { id: "fast", value: "false" },
        { id: "reasoning_effort", value: "low" },
      ],
      maxMode: true,
    },
  ],
  [
    "Opus fast, which runs in Max Mode alone",
    "cursor/claude-opus-5.5-max-fast",
    "max",
    {
      id: "claude-opus-5.5",
      params: [
        { id: "effort", value: "max" },
        { id: "fast", value: "true" },
      ],
      maxMode: true,
    },
  ],
])("runs %s as Cursor's SDK takes it", (_case, catalogId, effort, selection) => {
  assert.deepEqual(cursorModelSelectionOf(cursorModelsOf(LIST), catalogId, effort), selection);
});

it("offers no Cursor model to an account without Cursor agents on, or a client that cannot read them", () => {
  const models = cursorModelsOf(LIST);

  assert.deepEqual(withCursorModels([], { experimentOn: false, apiVersion: 4 }, models), []);
  assert.deepEqual(withCursorModels([], { experimentOn: true, apiVersion: 3 }, models), []);
});
