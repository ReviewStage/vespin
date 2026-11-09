import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { REPLAY_STEP_KIND, type ReplayStep } from "@repo/features/agent-replay";
import { Effect, Option } from "effect";
import {
  type ClaudeMessage,
  CODEX_SIDE,
  claudeSessionEntries,
  claudeToCodex,
  codexSummaryItem,
  codexToClaude,
  fitHistory,
  type HistoryEntry,
  type ResponsesItem,
  summarizedHistory,
  withoutMarks,
} from "./native-history.js";

/**
 * native-history.test.ts -- a source's session translated for the other harness: a Claude Code
 * session's main chain into Responses items, its tools mapped to Codex's own, and a Codex rollout
 * into Claude Code session entries, its tools mapped back, each cut where a fork cuts it; then the
 * history fitted to its window, the thinking dropped first and the oldest turns summarized ahead
 * of the newest. Hand-worked fixtures in the shapes the store keeps: Claude Code's entries as the
 * Agent SDK writes them, and Codex 0.163's rollout lines as app-server wrote them.
 */

const CWD = "/workspace/repository";
const PNG = "iVBORw0KGgo";

/** A Claude Code entry of the main transcript. */
function claude(
  type: "user" | "assistant",
  uuid: string,
  parentUuid: string | null,
  content: string | readonly Record<string, unknown>[],
  extra: Record<string, unknown> = {},
): HistoryEntry {
  return {
    type,
    uuid,
    parentUuid,
    isSidechain: false,
    sessionId: "claude-session",
    timestamp: "2026-11-09T10:00:00.000Z",
    message: { role: type, content },
    ...extra,
  };
}

/** A one-call Claude Code session: the prompt, the call, and its result where one is given. */
function oneCall(
  name: string,
  input: Record<string, unknown>,
  result: string | readonly Record<string, unknown>[] | undefined,
): HistoryEntry[] {
  return [
    claude("user", "u1", null, "Go."),
    claude("assistant", "a1", "u1", [{ type: "tool_use", id: "toolu_1", name, input }]),
    ...(result === undefined
      ? []
      : [
          claude("user", "r1", "a1", [
            { type: "tool_result", tool_use_id: "toolu_1", content: result },
          ]),
        ]),
  ];
}

/** A Codex rollout line, as app-server writes one. */
function line(type: string, payload: Record<string, unknown>): HistoryEntry {
  return { timestamp: "2026-11-09T11:00:00.000Z", type, payload };
}

function item(payload: Record<string, unknown>, turnId?: string): HistoryEntry {
  return line(
    "response_item",
    turnId === undefined
      ? payload
      : { ...payload, internal_chat_message_metadata_passthrough: { turn_id: turnId } },
  );
}

function said(role: "user" | "assistant" | "developer", text: string, turnId?: string) {
  const kind = role === "assistant" ? "output_text" : "input_text";
  return item({ type: "message", role, content: [{ type: kind, text }] }, turnId);
}

const META = line("session_meta", { id: "thread-1", cwd: CWD });
const ROLLOUT = "sessions/2026/11/09/rollout-2026-11-09T11-00-00-thread-1.jsonl";

/** One rollout file of the lines given. */
function rollout(lines: readonly HistoryEntry[]): Map<string, readonly HistoryEntry[]> {
  return new Map([[ROLLOUT, [META, ...lines]]]);
}

/** The text of every message of a translated Claude history, in order, by role. */
function claudeWords(turns: readonly (readonly ClaudeMessage[])[]): string[] {
  return turns
    .flat()
    .flatMap((message) =>
      message.content.map((block) => `${message.role}: ${String(block.text ?? block.type)}`),
    );
}

/** Ids handed out in order, as `randomUUID` would hand fresh ones. */
function idsInOrder() {
  let next = 0;
  return () => {
    next += 1;
    return `id-${next}`;
  };
}

it("translates a Claude Code session's main chain into Responses messages, turn by turn", () => {
  const entries = [
    claude("user", "u1", null, "Fix the mailer."),
    // A branch a rewind left behind, which the chain no longer runs through.
    claude("assistant", "x1", "u1", [{ type: "text", text: "Abandoned." }]),
    claude("assistant", "a1", "u1", [
      { type: "thinking", thinking: "Check the config first.", signature: "sig" },
      { type: "text", text: "Looking." },
    ]),
    claude("assistant", "s1", "a1", [{ type: "text", text: "A subagent's work." }], {
      isSidechain: true,
    }),
    claude("user", "m1", "a1", "<system-reminder>Claude Code's own.</system-reminder>", {
      isMeta: true,
    }),
    claude("user", "u2", "m1", [
      { type: "text", text: "Also this screenshot." },
      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } },
    ]),
    claude("assistant", "a2", "u2", [{ type: "text", text: "Done." }]),
  ];

  const turns = claudeToCodex(entries, undefined).map(withoutMarks);

  assert.deepEqual(turns, [
    [
      { type: "message", role: "user", content: [{ type: "input_text", text: "Fix the mailer." }] },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Check the config first." }],
      },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Looking." }] },
    ],
    [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "Also this screenshot." },
          { type: "input_image", image_url: `data:image/png;base64,${PNG}` },
        ],
      },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done." }] },
    ],
  ]);
});

it.each([
  {
    tool: "Bash",
    input: { command: "pnpm test", description: "Run the tests" },
    result: "ok",
    expected: [
      { type: "function_call", name: "exec_command", arguments: '{"cmd":"pnpm test"}' },
      { type: "function_call_output", output: "ok" },
    ],
  },
  {
    tool: "Read",
    input: { file_path: "/w/a.ts", offset: 10, limit: 5 },
    result: "    10\tconst a = 1;",
    expected: [
      {
        type: "function_call",
        name: "exec_command",
        arguments: JSON.stringify({ cmd: "cat -n -- '/w/a.ts' | sed -n '10,14p'" }),
      },
      { type: "function_call_output", output: "    10\tconst a = 1;" },
    ],
  },
  {
    tool: "Read",
    input: { file_path: "/w/shot.png" },
    result: [{ type: "image", source: { type: "base64", media_type: "image/png", data: PNG } }],
    expected: [
      { type: "function_call", name: "view_image", arguments: '{"path":"/w/shot.png"}' },
      {
        type: "function_call_output",
        output: [{ type: "input_image", image_url: `data:image/png;base64,${PNG}` }],
      },
    ],
  },
  {
    tool: "Grep",
    input: { pattern: "TODO", path: "src", "-i": true },
    result: "src/a.ts",
    expected: [
      {
        type: "function_call",
        name: "exec_command",
        arguments: JSON.stringify({ cmd: "rg -l -i -e 'TODO' 'src'" }),
      },
      { type: "function_call_output", output: "src/a.ts" },
    ],
  },
  {
    tool: "Glob",
    input: { pattern: "**/*.ts" },
    result: "src/a.ts",
    expected: [
      {
        type: "function_call",
        name: "exec_command",
        arguments: JSON.stringify({ cmd: "rg --files --glob '**/*.ts'" }),
      },
      { type: "function_call_output", output: "src/a.ts" },
    ],
  },
  {
    tool: "Edit",
    input: { file_path: "/w/a.ts", old_string: "const a = 1;", new_string: "const a = 2;" },
    result: "The file /w/a.ts has been updated.",
    expected: [
      {
        type: "custom_tool_call",
        name: "apply_patch",
        input:
          "*** Begin Patch\n*** Update File: /w/a.ts\n@@\n-const a = 1;\n+const a = 2;\n*** End Patch",
      },
      { type: "custom_tool_call_output", output: "The file /w/a.ts has been updated." },
    ],
  },
  {
    tool: "Write",
    input: { file_path: "/w/b.ts", content: "export {};\n" },
    result: "File created successfully at: /w/b.ts",
    expected: [
      {
        type: "custom_tool_call",
        name: "apply_patch",
        input: "*** Begin Patch\n*** Add File: /w/b.ts\n+export {};\n*** End Patch",
      },
      { type: "custom_tool_call_output", output: "File created successfully at: /w/b.ts" },
    ],
  },
  {
    tool: "TodoWrite",
    input: { todos: [{ content: "Fix", status: "in_progress", activeForm: "Fixing" }] },
    result: "Todos have been modified successfully.",
    expected: [
      {
        type: "function_call",
        name: "update_plan",
        arguments: '{"plan":[{"step":"Fix","status":"in_progress"}]}',
      },
      { type: "function_call_output", output: "Todos have been modified successfully." },
    ],
  },
  {
    tool: "mcp__workspace__edit_description",
    input: { taskId: "t-1" },
    result: "saved",
    expected: [
      {
        type: "function_call",
        name: "edit_description",
        namespace: "mcp__workspace__",
        arguments: '{"taskId":"t-1"}',
      },
      { type: "function_call_output", output: "saved" },
    ],
  },
  {
    tool: "Task",
    input: { prompt: "Find the mailer" },
    result: "src/mailer.ts",
    expected: [
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: '[I called the tool Task, which this harness does not have, with {"prompt":"Find the mailer"}. Its result:]\nsrc/mailer.ts',
          },
        ],
      },
    ],
  },
])(
  "maps Claude Code's $tool to Codex's nearest native tool, or to a note",
  ({ tool, input, result, expected }) => {
    const [turn] = claudeToCodex(oneCall(tool, input, result), undefined);
    // Note that every call and its output carry the source's own id, which Codex pairs them by.
    const calls = expected.map((each) =>
      each.type === "message" ? each : { ...each, call_id: "toolu_1" },
    );
    assert.deepEqual(turn?.slice(1), calls);
  },
);

it("answers a call the session holds no result for as aborted", () => {
  const [turn] = claudeToCodex(oneCall("Bash", { command: "sleep 600" }, undefined), undefined);

  assert.deepEqual(turn?.at(-1), {
    type: "function_call_output",
    call_id: "toolu_1",
    output: "aborted",
  });
});

it("ends a Claude Code session's history just before the line a fork cuts at", () => {
  const entries = [
    claude("user", "u1", null, "First."),
    claude("assistant", "a1", "u1", [{ type: "text", text: "One." }]),
    claude("user", "line-2", "a1", "Second."),
    claude("assistant", "a2", "line-2", [{ type: "text", text: "Two." }]),
  ];

  const turns = claudeToCodex(entries, "line-2");

  assert.deepEqual(turns, [
    [
      { type: "message", role: "user", content: [{ type: "input_text", text: "First." }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "One." }] },
    ],
  ]);
});

it("writes a Codex rollout as linked Claude Code entries, each call answered in the next message under an id Anthropic takes", () => {
  const files = rollout([
    said("developer", "<permissions instructions>Codex's own.</permissions instructions>"),
    said(
      "user",
      "<environment_context>\n  <cwd>/workspace/repository</cwd>\n</environment_context>",
    ),
    said("user", "Fix the mailer."),
    item({
      type: "reasoning",
      summary: [{ type: "summary_text", text: "Look at the config." }],
      encrypted_content: "gAAAAB-sealed",
    }),
    item({
      type: "function_call",
      name: "exec_command",
      arguments: '{"cmd":"pnpm test"}',
      call_id: "call.1/x",
    }),
    item({ type: "function_call_output", call_id: "call.1/x", output: "ok" }),
    said("assistant", "Done."),
  ]);

  const entries = claudeSessionEntries(
    codexToClaude(files, undefined, CWD).flat(),
    "thread-1",
    CWD,
    idsInOrder(),
    "2026-11-09T12:00:00.000Z",
  );

  const at = "2026-11-09T11:00:00.000Z";
  const common = { isSidechain: false, sessionId: "thread-1", cwd: CWD, userType: "external" };
  assert.deepEqual(entries, [
    {
      type: "user",
      uuid: "id-1",
      parentUuid: null,
      ...common,
      timestamp: at,
      message: { role: "user", content: [{ type: "text", text: "Fix the mailer." }] },
    },
    {
      type: "assistant",
      uuid: "id-2",
      parentUuid: "id-1",
      ...common,
      timestamp: at,
      message: {
        id: "msg_id2",
        type: "message",
        role: "assistant",
        content: [
          { type: "text", text: "Look at the config." },
          {
            type: "tool_use",
            id: "call_1_x",
            name: "Bash",
            input: { command: "pnpm test" },
          },
        ],
      },
    },
    {
      type: "user",
      uuid: "id-3",
      parentUuid: "id-2",
      ...common,
      timestamp: at,
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "call_1_x", content: "ok" }],
      },
    },
    {
      type: "assistant",
      uuid: "id-4",
      parentUuid: "id-3",
      ...common,
      timestamp: at,
      message: {
        id: "msg_id4",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Done." }],
      },
    },
  ]);
});

it.each([
  {
    call: { type: "function_call", name: "exec_command", arguments: '{"cmd":"ls","workdir":"/w"}' },
    expected: { name: "Bash", input: { command: "cd '/w' && ls" } },
  },
  {
    call: {
      type: "function_call",
      name: "update_plan",
      arguments: '{"plan":[{"step":"Fix","status":"completed"}]}',
    },
    expected: {
      name: "TodoWrite",
      input: { todos: [{ content: "Fix", status: "completed", activeForm: "Fix" }] },
    },
  },
  {
    call: { type: "function_call", name: "view_image", arguments: '{"path":"shot.png"}' },
    expected: { name: "Read", input: { file_path: `${CWD}/shot.png` } },
  },
  {
    call: {
      type: "function_call",
      name: "edit_description",
      namespace: "mcp__workspace__",
      arguments: '{"taskId":"t-1"}',
    },
    expected: { name: "mcp__workspace__edit_description", input: { taskId: "t-1" } },
  },
  {
    call: {
      type: "custom_tool_call",
      name: "apply_patch",
      input:
        "*** Begin Patch\n*** Update File: src/a.ts\n@@\n const x = 0;\n-const a = 1;\n+const a = 2;\n*** End Patch",
    },
    expected: {
      name: "Edit",
      input: {
        file_path: `${CWD}/src/a.ts`,
        old_string: "const x = 0;\nconst a = 1;",
        new_string: "const x = 0;\nconst a = 2;",
      },
    },
  },
  {
    call: {
      type: "custom_tool_call",
      name: "apply_patch",
      input: "*** Begin Patch\n*** Add File: b.ts\n+export {};\n*** End Patch",
    },
    expected: { name: "Write", input: { file_path: `${CWD}/b.ts`, content: "export {};\n" } },
  },
  {
    call: {
      type: "custom_tool_call",
      name: "apply_patch",
      input: "*** Begin Patch\n*** Add File: b.ts\n+b\n*** Delete File: c.ts\n*** End Patch",
    },
    expected: {
      name: "apply_patch",
      input: {
        patch: "*** Begin Patch\n*** Add File: b.ts\n+b\n*** Delete File: c.ts\n*** End Patch",
      },
    },
  },
  {
    call: { type: "function_call", name: "write_stdin", arguments: '{"session_id":3,"chars":"y"}' },
    expected: { name: "write_stdin", input: { session_id: 3, chars: "y" } },
  },
])(
  "maps Codex's $call.name back to Claude Code's own tool, or keeps its name",
  ({ call, expected }) => {
    const files = rollout([said("user", "Go."), item({ ...call, call_id: "call_1" })]);

    const [turn] = codexToClaude(files, undefined, CWD);

    assert.deepEqual(turn?.[1]?.content, [{ type: "tool_use", id: "call_1", ...expected }]);
  },
);

it("reads a compacted rollout from the history that replaced what came before", () => {
  const files = rollout([
    said("user", "Old ask."),
    said("assistant", "Old answer."),
    line("compacted", {
      message: "A summary.",
      replacement_history: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "Kept ask." }] },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Kept answer." }],
        },
      ],
    }),
    said("user", "New ask."),
  ]);

  assert.deepEqual(claudeWords(codexToClaude(files, undefined, CWD)), [
    "user: Kept ask.",
    "assistant: Kept answer.",
    "user: New ask.",
  ]);
});

it("reads a reverted thread from the segment a revert began, standing on the lines its base names", () => {
  const files = new Map<string, readonly HistoryEntry[]>([
    [
      ROLLOUT,
      [
        META,
        said("user", "First."),
        said("assistant", "One."),
        said("user", "Second."),
        said("assistant", "Two."),
      ],
    ],
    [
      ROLLOUT.replace(".jsonl", "_01a1c22e-c54f-77b3-8748-7037accf178c.jsonl"),
      [
        line("session_meta", {
          id: "thread-1",
          history_base: { thread_id: "thread-1", end_ordinal_exclusive: 3 },
        }),
        said("user", "Third."),
        said("assistant", "Three."),
      ],
    ],
  ]);

  assert.deepEqual(claudeWords(codexToClaude(files, undefined, CWD)), [
    "user: First.",
    "assistant: One.",
    "user: Third.",
    "assistant: Three.",
  ]);
});

it("ends a Codex rollout's history before the turn that took the line a fork cuts at", () => {
  const files = rollout([
    said("user", "First.", "turn-1"),
    said("assistant", "One.", "turn-1"),
    line("event_msg", { type: "task_started", turn_id: "turn-2" }),
    said("user", "Second.", "turn-2"),
    line("event_msg", {
      type: "item_completed",
      turn_id: "turn-2",
      item: { type: "UserMessage", id: "u-2", client_id: "line-2" },
    }),
    said("assistant", "Two.", "turn-2"),
  ]);

  assert.deepEqual(claudeWords(codexToClaude(files, "line-2", CWD)), [
    "user: First.",
    "assistant: One.",
  ]);
});

/** A user's prompt and the assistant's answer, as Codex items. */
function codexTurn(ask: string, answer: string): ResponsesItem[] {
  return [
    { type: "message", role: "user", content: [{ type: "input_text", text: ask }] },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: answer }] },
  ];
}

it("fits a history by dropping its thinking before any turn", () => {
  const [turn] = claudeToCodex(
    [
      claude("user", "u1", null, "Go."),
      claude("assistant", "a1", "u1", [
        { type: "thinking", thinking: "x".repeat(3_000) },
        { type: "text", text: "Done." },
      ]),
    ],
    undefined,
  );
  assert.ok(turn !== undefined);

  const fitted = fitHistory(CODEX_SIDE, [turn], 1_000);

  assert.deepEqual(fitted, { kept: [codexTurn("Go.", "Done.")], dropped: [] });
});

it.effect("keeps the newest turns that fit and puts the summary of the rest first", () =>
  Effect.gen(function* () {
    const oldest = codexTurn("x".repeat(20_000), "Fixed the config.");
    const newest = codexTurn("Now the emails.", "Sent.");
    const read: ReplayStep[][] = [];

    const items = yield* summarizedHistory(
      CODEX_SIDE,
      fitHistory(CODEX_SIDE, [oldest, newest], 9_000),
      (steps) =>
        Effect.sync(() => {
          read.push([...steps]);
          return Option.some({ text: "The config was fixed.", steps: steps.length });
        }),
      codexSummaryItem,
    );

    assert.deepEqual(items, [
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Summary of the earlier part of this conversation, which is left out:\n\nThe config was fixed.",
          },
        ],
      },
      ...newest,
    ]);
    assert.deepEqual(
      read.flat().map((step) => [step.kind, step.words.slice(0, 20)]),
      [
        [REPLAY_STEP_KIND.LINE, "x".repeat(20)],
        [REPLAY_STEP_KIND.SAID, "Fixed the config."],
      ],
    );
  }),
);
