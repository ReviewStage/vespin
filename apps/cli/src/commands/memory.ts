/**
 * memory.ts -- `vespin memory list`, `search`, `save`, and `forget`: the workspace's shared memory of settled facts, every one as Settings › Memory lists it, the few some words find, one kept or corrected in the member's words, and one forgotten.
 *
 * Each acts in the workspace the command acts in (`../workspace.js`) through
 * the procedures Settings › Memory and the member MCP server's memory tools
 * reach: `account.memories`, `account.searchMemories`, `account.saveMemory`,
 * and `account.forgetMemory`. Who may forget which, the workspace's bound of
 * memories, a keep that looks like a credential, and Memory being off for
 * the workspace are the service's to refuse, and the refusal is printed as
 * it answers it.
 */

import { CLI_EXIT } from "@repo/features/cli-exit";
import { MEMORY_SAVED, type MemorySummary } from "@repo/features/memory-wire";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { answer, CommandFailed, columns, readInput } from "../output.js";
import { askService, session } from "../session.js";
import { resolveWorkspace } from "../workspace.js";

/** How each outcome of a keep is said. */
const SAVED_WORDS = {
  [MEMORY_SAVED.KEPT]: "Kept",
  [MEMORY_SAVED.ALREADY_KEPT]: "Already kept",
  [MEMORY_SAVED.CORRECTED]: "Corrected",
} as const;

/** A memory as every answer prints it. */
function memoryJson(memory: MemorySummary) {
  return {
    id: memory.id,
    text: memory.text,
    keptBy: memory.keptBy,
    forgettable: memory.forgettable,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };
}

/** Memories as a person reads them: the id, who kept it, and its words. */
function memoryLines(memories: readonly MemorySummary[]): string[] {
  if (memories.length === 0) return ["No memories."];
  return columns(
    memories.map((memory) => [memory.id, memory.keptBy?.name ?? "(gone)", memory.text]),
  );
}

const listCommand = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const { workspace } = yield* resolveWorkspace;
    const { hosted } = yield* session;
    const { memories } = yield* askService(hosted.account.memories, {
      workspaceId: workspace.id,
    });
    yield* answer({
      json: { memories: memories.map(memoryJson) },
      lines: memoryLines(memories),
      ids: memories.map(({ id }) => id),
    });
  }),
).pipe(
  Command.withDescription("List every memory of the workspace, the latest kept first"),
  Command.withExamples([{ command: "vespin memory list", description: "Every memory" }]),
);

const searchCommand = Command.make(
  "search",
  {
    words: Argument.String("words").pipe(
      Argument.variadic(),
      Argument.withDescription("A few words for the area at hand; none for the latest kept"),
    ),
  },
  ({ words }) =>
    Effect.gen(function* () {
      const { workspace } = yield* resolveWorkspace;
      const { hosted } = yield* session;
      const query = words.join(" ").trim();
      const found = yield* askService(hosted.account.searchMemories, {
        workspaceId: workspace.id,
        ...(query === "" ? undefined : { query }),
      });
      yield* answer({
        json: { memories: found.memories.map(memoryJson), total: found.total },
        lines: memoryLines(found.memories),
        ids: found.memories.map(({ id }) => id),
      });
    }),
).pipe(
  Command.withDescription("Search the workspace's memories by a few words, best first"),
  Command.withExamples([
    { command: "vespin memory search how tests run", description: "Memories about tests" },
  ]),
);

const saveCommand = Command.make(
  "save",
  {
    words: Argument.String("text").pipe(
      Argument.variadic(),
      Argument.withDescription("The fact or convention, as one self-contained statement"),
    ),
    input: Flag.String("input").pipe(
      Flag.withAlias("F"),
      Flag.optional,
      Flag.withDescription("The statement, from a file or - for stdin, in place of words"),
    ),
    replaces: Flag.String("replaces").pipe(
      Flag.optional,
      Flag.withDescription(
        "The memory this corrects, by its id, rewritten rather than kept beside",
      ),
    ),
  },
  ({ words, input, replaces }) =>
    Effect.gen(function* () {
      if (Option.isSome(input) && words.length > 0) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message: "Give the memory as words or with -F, not both.",
        });
      }
      const text = (Option.isSome(input) ? yield* readInput(input.value) : words.join(" ")).trim();
      if (text === "") {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message: "Give the memory as words or with -F.",
        });
      }
      const { workspace } = yield* resolveWorkspace;
      const { hosted } = yield* session;
      const saved = yield* askService(hosted.account.saveMemory, {
        workspaceId: workspace.id,
        text,
        ...(Option.isSome(replaces) ? { replaces: replaces.value } : undefined),
      });
      yield* answer({
        json: { outcome: saved.outcome, memory: memoryJson(saved.memory) },
        lines: [`${SAVED_WORDS[saved.outcome]} ${saved.memory.id}.`],
        ids: [saved.memory.id],
      });
    }),
).pipe(
  Command.withDescription("Keep a fact or convention in the workspace's memory, as your words"),
  Command.withExamples([
    {
      command: 'vespin memory save "Tests run on PGlite through test:store."',
      description: "Keep a convention",
    },
    {
      command: 'vespin memory save --replaces <memory> "Tests run on Postgres."',
      description: "Correct a memory in place",
    },
  ]),
);

const forgetCommand = Command.make(
  "forget",
  {
    memory: Argument.String("memory").pipe(
      Argument.withDescription("The memory's id, as memory list prints it"),
    ),
  },
  ({ memory }) =>
    Effect.gen(function* () {
      const { workspace } = yield* resolveWorkspace;
      const { hosted } = yield* session;
      const left = yield* askService(hosted.account.forgetMemory, {
        query: { workspaceId: workspace.id, id: memory },
      });
      yield* answer({
        json: { forgotten: memory, total: left.memories.length },
        lines: [`Forgot ${memory}.`],
        ids: [memory],
      });
    }),
).pipe(
  Command.withDescription(
    "Forget a memory for good: your own, or any where you own or administer the workspace",
  ),
  Command.withExamples([{ command: "vespin memory forget <memory>", description: "Forget one" }]),
);

export const memoryCommand = Command.make("memory").pipe(
  Command.withDescription("Read and keep the workspace's shared memory of settled facts"),
  Command.withSubcommands([listCommand, searchCommand, saveCommand, forgetCommand]),
  Command.withExamples([
    { command: "vespin memory search deploy", description: "What the workspace keeps on deploys" },
  ]),
);
