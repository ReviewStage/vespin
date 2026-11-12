import assert from "node:assert/strict";
import { Predicate } from "effect";
import { test } from "vitest";
import {
  ROW_PART,
  type RowReading,
  sameTurnRow,
  TURN_ROW,
  type TurnRow,
  turnRows,
} from "./turn-rows.js";

/** A block as a tab hands it to the fold: what it is to the fold, its name, and whether it still moves. */
interface Block {
  readonly part: (typeof ROW_PART)[keyof typeof ROW_PART];
  readonly name: string;
  readonly running?: boolean;
}

const READING: RowReading<Block> = {
  key: (block) => block.name,
  part: (block) => block.part,
  running: (block) => block.running === true,
};

const call = (name: string): Block => ({ part: ROW_PART.CALL, name });
const thought = (name: string): Block => ({ part: ROW_PART.NOTE, name });
const words = (name: string): Block => ({ part: ROW_PART.WORDS, name });
const subagent = (name: string): Block => ({ part: ROW_PART.SUBAGENT, name });
const agent = (name: string): Block => ({ part: ROW_PART.AGENT, name });
const arrived = (name: string): Block => ({ part: ROW_PART.ARRIVED, name });

/** A turn's rows as a reader scans them: each block by name, and each group's line, what it holds, and whether it is open and running. */
function scanned(rows: readonly TurnRow<Block>[]): unknown[] {
  return rows.map((row) => {
    if (row.kind === TURN_ROW.BLOCK) return row.block.name;

    return [
      row.summary,
      row.blocks.map((block) => block.name),
      { open: row.open, running: row.running },
    ];
  });
}

/** The rows of a turn of `blocks`, moving or finished. */
function rowsOf(blocks: readonly Block[], moving: boolean) {
  return scanned(turnRows(blocks, READING, { moving }));
}

test("a thought between two calls joins their group, whose line counts the calls alone", () => {
  assert.deepEqual(
    rowsOf([call("ls"), thought("Read the one file."), call("cat"), words("One file.")], true),
    [
      ["2 tool calls", ["ls", "Read the one file.", "cat"], { open: false, running: false }],
      "One file.",
    ],
  );
});

test("a finished turn folds only its work, so every one of its words stands, an answer given before the agent waited among them, as it did while the turn moved", () => {
  const turn = [
    thought("Find the upgrade."),
    call("git log"),
    subagent("Compare the scroll changes."),
    agent("Fix the anchoring."),
    words("I answered on the thread."),
    call("gh pr checks"),
    call("gh pr view"),
    words("Every check passed."),
  ];

  const closed = { open: false, running: false };
  assert.deepEqual(rowsOf(turn, false), [
    [
      "2 tool calls, 1 subagent",
      ["Find the upgrade.", "git log", "Compare the scroll changes.", "Fix the anchoring."],
      closed,
    ],
    "I answered on the thread.",
    ["2 tool calls", ["gh pr checks", "gh pr view"], closed],
    "Every check passed.",
  ]);
  assert.deepEqual(rowsOf(turn, true), rowsOf(turn, false));
});

test("a message that reached a turn while it ran stands where it arrived, between the groups, each counting its own calls", () => {
  const turn = [
    call("a"),
    call("b"),
    arrived("GitHub reviewed the pull request."),
    call("c"),
    words("Fixed."),
  ];

  assert.deepEqual(rowsOf(turn.slice(0, 4), true), [
    ["2 tool calls", ["a", "b"], { open: false, running: false }],
    "GitHub reviewed the pull request.",
    ["1 tool call", ["c"], { open: true, running: false }],
  ]);
  assert.deepEqual(rowsOf(turn, false), [
    ["2 tool calls", ["a", "b"], { open: false, running: false }],
    "GitHub reviewed the pull request.",
    "c",
    "Fixed.",
  ]);
  // A stretch with no call between two messages keeps its rows.
  assert.deepEqual(
    rowsOf(
      [call("a"), arrived("First."), thought("Read both."), arrived("Second."), words("Done.")],
      false,
    ),
    ["a", "First.", "Read both.", "Second.", "Done."],
  );
});

test("a finished turn's run of one call alone stands on its own row rather than in a group, and a call with a thought beside it is still grouped", () => {
  assert.deepEqual(rowsOf([call("delete_section"), words("Deleted.")], false), [
    "delete_section",
    "Deleted.",
  ]);
  assert.deepEqual(rowsOf([subagent("Compare the queues."), words("Seven days.")], false), [
    "Compare the queues.",
    "Seven days.",
  ]);
  assert.deepEqual(
    rowsOf([thought("Delete it."), call("delete_section"), words("Deleted.")], false),
    [
      ["1 tool call", ["Delete it.", "delete_section"], { open: false, running: false }],
      "Deleted.",
    ],
  );
});

/** A value read otherwise: words with more, a flag flipped, a list one item shorter, a record with a key more. */
function changed(value: unknown): string | boolean | object {
  if (Predicate.isString(value)) return `${value} again`;

  if (Predicate.isBoolean(value)) return !value;

  if (Array.isArray(value)) return value.slice(1);

  // SAFETY: the arrays are handled above, and every other field a row holds is an object.
  return { ...(value as object), more: true };
}

test("a row of each kind reads alike copied whole, and otherwise once any of its fields or its blocks' fields changes", () => {
  const moving = turnRows([call("read"), call("grep"), words("Reading.")], READING, {
    moving: true,
  });

  const finished = turnRows([call("read"), thought("why"), call("grep"), words("Done.")], READING, {
    moving: false,
  });

  const rows = [...moving, ...finished];

  for (const kind of Object.values(TURN_ROW)) {
    assert.ok(
      rows.some((row) => row.kind === kind),
      `the turns hold a ${kind} row`,
    );
  }

  for (const row of rows) {
    assert.ok(sameTurnRow(row, structuredClone(row)), `a ${row.kind} row copied whole`);

    for (const key of Object.keys(row)) {
      // SAFETY: `key` is one of the row's own keys, and the copy only changes that field's value.
      const other = { ...row, [key]: changed(row[key as keyof typeof row]) } as TurnRow<Block>;
      assert.ok(!sameTurnRow(row, other), `a ${row.kind} row whose ${key} changed`);
    }
  }

  const block = finished.find((row) => row.kind === TURN_ROW.BLOCK);
  assert.ok(block?.kind === TURN_ROW.BLOCK, "a block row");
  assert.ok(
    !sameTurnRow(block, { ...block, block: { ...block.block, name: "Done again." } }),
    "a block row whose block's words changed",
  );
});
