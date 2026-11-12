/**
 * workspace-memories.ts -- a workspace's shared memories as one member reads and forgets them from Settings.
 *
 * Every member of a workspace reads its shared memories, each named by the
 * member whose words it holds. Forgetting follows the workspace automations' rule
 * (`automation-store.ts`'s `allowedTo`): the member whose words a memory
 * holds may forget it, and so may the workspace's owners and admins, the
 * only ones who may forget one whose member's account is gone; every other
 * member reads it and may correct it only on a call, where the conversation
 * wins. An account that is not a member reads and forgets
 * nothing, and is answered exactly as a workspace that names nothing.
 *
 * A keep and a search here are the one operation behind every surface that
 * keeps or searches a memory: a member's own client, such as the
 * command-line tool, the member MCP server's `save_memory` and
 * `search_memory`, and a coding agent's (`../agents/memory-tools.ts`), each
 * answering the outcome in its own words. Words that look like a credential
 * are never kept, and a search ranks the memories by how many of its words
 * each holds (`rankMemories`); a coding agent's first turn is handed the
 * ones its task and words find by the same ranking (`matchWorkspaceMemories`).
 * Whether the member has Memory on is the
 * caller's to check, as each tool and procedure does before it calls here.
 *
 * Each memory is answered with where its words came from, the agent and its
 * task, only where the reader may open that task (`readMemorySources`), and
 * how often agents were handed it in the last thirty days and when last
 * (`tallyMemoryRecalls`). A keep is counted, by what it came to and whether
 * an agent or a member kept it, and never by its words.
 */

import {
  type MemoryRecallTally,
  tallyMemoryRecalls,
} from "@repo/database/models/memory-recall-store";
import {
  forgetMemory,
  listMemories,
  MEMORY_FORGET,
  MEMORY_OUTCOME,
  type MemorySource,
  type MemorySourceRead,
  readMemorySources,
  rememberMemory,
  type StoredMemory,
} from "@repo/database/models/memory-store";
import {
  readAccountNames,
  type WorkspaceStoreEffect,
  workspaceOf,
} from "@repo/database/models/workspace-store";
import type { MemorySaveAnswer, MemorySummary } from "@repo/features/memory-wire";
import { WORKSPACE_ROLE, type WorkspaceRole } from "@repo/features/workspace-wire";
import { Effect, Option } from "effect";
import { recordServerEvent, SERVER_EVENT, SERVER_MEMORY_KEEPER } from "../events/server-events.js";

/** What a member's read or forget came to. */
export const WORKSPACE_MEMORY = {
  /** The workspace's memories as they stand now. */
  READ: "read",
  /** The account is no member of the workspace, or the workspace names nothing. */
  NOT_MEMBER: "not_member",
  /** The memory stands and the member may not forget it; nothing was deleted. */
  NOT_PERMITTED: "not_permitted",
} as const;

export type WorkspaceMemoryAnswer =
  | {
      readonly kind: typeof WORKSPACE_MEMORY.READ;
      readonly memories: readonly MemorySummary[];
      /** The transaction a forget deleted its memory in; none for a read, or a forget of one already gone. */
      readonly txid?: string;
    }
  | {
      readonly kind: typeof WORKSPACE_MEMORY.NOT_MEMBER | typeof WORKSPACE_MEMORY.NOT_PERMITTED;
    };

/** The roles that manage a workspace's memories beyond their own. */
const MANAGING_ROLES: ReadonlySet<WorkspaceRole> = new Set([
  WORKSPACE_ROLE.OWNER,
  WORKSPACE_ROLE.ADMIN,
]);

const MEMORY_SEARCH_BOUNDS = {
  /** The most memories one search hands back. */
  RECALL_RESULTS: 8,
  /** The most distinct words of a query matched. */
  QUERY_WORDS: 16,
  /** The most memories a coding agent's first turn is handed. */
  TURN_RESULTS: 5,
  /** The most distinct words of a first turn's task and words matched, which run longer than a search's few. */
  TURN_QUERY_WORDS: 64,
  /** The shortest word of a first turn's text matched: a lone letter, as "agent's" leaves, would match every word it begins. */
  TURN_SHORTEST_WORD: 2,
} as const;

/** Words too common to tell one memory from another. */
const COMMON_WORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "do",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "our",
  "the",
  "to",
  "use",
  "we",
  "what",
  "with",
]);

/**
 * Shapes a credential takes: a private key block, a provider's token by its
 * prefix, a signed token, a URL carrying a password, a secret assigned to a
 * name, and a long opaque run mixing cases and digits as generated keys do.
 * A commit hash or a UUID, all lower case, is none of them.
 */
const CREDENTIAL_SHAPES: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/u,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/u,
  /\bglpat-[A-Za-z0-9_-]{20,}/u,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bAIza[A-Za-z0-9_-]{30,}/u,
  /\bnpm_[A-Za-z0-9]{30,}/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/u,
  /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/iu,
  /\b(?:password|passwd|passphrase|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)\b\s*[:=]\s*\S{6,}/iu,
];

/** A run long and mixed enough to be a generated secret rather than a word. */
const OPAQUE_RUN = /[A-Za-z0-9+/=_-]{32,}/gu;

/** The member's role in the workspace, where they are one. */
function roleIn(
  userId: string,
  workspaceId: string,
): WorkspaceStoreEffect<Option.Option<WorkspaceRole>> {
  return Effect.map(
    workspaceOf(userId, workspaceId),
    Option.map((workspace) => workspace.role),
  );
}

/** The member whose words a memory holds, as the reader is told; nobody for an account that is gone. */
function keeperOf(
  userId: string | null,
  names: ReadonlyMap<string, string>,
): MemorySummary["keptBy"] {
  if (userId === null) return null;
  const name = names.get(userId);

  return name === undefined ? null : { userId, name };
}

/** Whether words look like they hold a credential, so they are never kept. */
function looksLikeCredential(text: string): boolean {
  if (CREDENTIAL_SHAPES.some((shape) => shape.test(text))) return true;

  return (text.match(OPAQUE_RUN) ?? []).some(
    (run) => /[a-z]/u.test(run) && /[A-Z]/u.test(run) && /[0-9]/u.test(run),
  );
}

/** A text's words as a search compares them: lower case, letters and digits alone. */
function wordsOf(text: string): readonly string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** A query's distinct telling words, none of the common ones, at most the number given, each at least as long as the length given. */
function askedWords(query: string, most: number, shortest = 1): readonly string[] {
  return [...new Set(wordsOf(query))]
    .filter((word) => word.length >= shortest && !COMMON_WORDS.has(word))
    .slice(0, most);
}

/**
 * The memories that hold any of the words asked, best first: each scored by
 * how many of them begin one of its own, so "deploy" finds "deployment",
 * ties going to the one kept most recently; at most the number given.
 */
function matchingMemories(
  memories: readonly StoredMemory[],
  asked: readonly string[],
  most: number,
): readonly StoredMemory[] {
  return memories
    .map((memory, recency) => {
      const own = wordsOf(memory.text);
      const score = asked.filter((word) => own.some((held) => held.startsWith(word))).length;

      return { memory, score, recency };
    })
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score || a.recency - b.recency)
    .slice(0, most)
    .map((scored) => scored.memory);
}

/**
 * The memories a query finds, best first (`matchingMemories`). A query with
 * no telling word answers the most recent; one that finds nothing answers none.
 */
function rankMemories(
  memories: readonly StoredMemory[],
  query: string | undefined,
): readonly StoredMemory[] {
  const asked = askedWords(query ?? "", MEMORY_SEARCH_BOUNDS.QUERY_WORDS);

  if (asked.length === 0) return memories.slice(0, MEMORY_SEARCH_BOUNDS.RECALL_RESULTS);

  return matchingMemories(memories, asked, MEMORY_SEARCH_BOUNDS.RECALL_RESULTS);
}

/** What a reader is told of memories beside their words: their members' names, where they came from as the reader may see it, and their recalls. */
interface MemoryReadings {
  readonly names: ReadonlyMap<string, string>;
  readonly sources: ReadonlyMap<string, MemorySourceRead>;
  readonly tallies: ReadonlyMap<string, MemoryRecallTally>;
}

/** What the reader is told beside the workspace's memories named, each read once for them all. */
function readingsOf(
  userId: string,
  workspaceId: string,
  stored: readonly StoredMemory[],
): WorkspaceStoreEffect<MemoryReadings> {
  const members = stored.flatMap((kept) => (kept.userId === null ? [] : [kept.userId]));
  const ids = stored.map((kept) => kept.id);

  return Effect.all(
    {
      names: readAccountNames(members),
      sources: readMemorySources(userId, workspaceId, ids),
      tallies: tallyMemoryRecalls(workspaceId, ids),
    },
    { concurrency: "unbounded" },
  );
}

/** The workspace's memories as the reader sees them: each named by its member, forgettable where the reader may, with where it came from and its recalls. */
function summariesFor(
  userId: string,
  workspaceId: string,
  manages: boolean,
  stored: readonly StoredMemory[],
): WorkspaceStoreEffect<readonly MemorySummary[]> {
  return Effect.map(readingsOf(userId, workspaceId, stored), (readings) =>
    stored.map((kept) => summaryOf(userId, manages, readings, kept)),
  );
}

/** One memory as the reader sees it, what is read beside it filled in. */
function summaryOf(
  userId: string,
  manages: boolean,
  readings: MemoryReadings,
  kept: StoredMemory,
): MemorySummary {
  const tally = readings.tallies.get(kept.id);

  return {
    id: kept.id,
    text: kept.text,
    keptBy: keeperOf(kept.userId, readings.names),
    forgettable: manages || kept.userId === userId,
    createdAt: kept.createdAt,
    updatedAt: kept.updatedAt,
    source: readings.sources.get(kept.id) ?? null,
    recalls30d: tally?.recalls30d ?? 0,
    lastRecalledAt: tally?.lastRecalledAt ?? null,
  };
}

/** The workspace's memories, to a member of it. */
export function readWorkspaceMemories(
  userId: string,
  workspaceId: string,
): WorkspaceStoreEffect<WorkspaceMemoryAnswer> {
  return Effect.gen(function* () {
    const role = yield* roleIn(userId, workspaceId);

    if (Option.isNone(role)) return { kind: WORKSPACE_MEMORY.NOT_MEMBER } as const;
    const stored = yield* listMemories(workspaceId);

    const memories = yield* summariesFor(
      userId,
      workspaceId,
      MANAGING_ROLES.has(role.value),
      stored,
    );

    return { kind: WORKSPACE_MEMORY.READ, memories } as const;
  });
}

/**
 * Forgets one of the workspace's memories, where the member may, and answers
 * the memories as they then stand, with the transaction it was deleted in. A
 * memory already gone answers the same as one forgotten now, with no
 * transaction, so a forget retried after it landed answers the same.
 */
export function forgetWorkspaceMemory(
  userId: string,
  workspaceId: string,
  id: string,
): WorkspaceStoreEffect<WorkspaceMemoryAnswer> {
  return Effect.gen(function* () {
    const role = yield* roleIn(userId, workspaceId);

    if (Option.isNone(role)) return { kind: WORKSPACE_MEMORY.NOT_MEMBER } as const;
    const manages = MANAGING_ROLES.has(role.value);
    const forgot = yield* forgetMemory(workspaceId, id, { userId, manages });

    if (forgot.outcome === MEMORY_FORGET.NOT_PERMITTED)
      return { kind: WORKSPACE_MEMORY.NOT_PERMITTED } as const;

    const memories = yield* summariesFor(
      userId,
      workspaceId,
      manages,
      yield* listMemories(workspaceId),
    );

    return {
      kind: WORKSPACE_MEMORY.READ,
      memories,
      ...(forgot.txid === undefined ? undefined : { txid: forgot.txid }),
    } as const;
  });
}

/** What a member's keep came to. */
export const WORKSPACE_MEMORY_SAVE = {
  /** The memory was kept, was already kept, or corrected the one it replaces. */
  SAVED: "saved",
  /** The account is no member of the workspace, or the workspace names nothing. */
  NOT_MEMBER: "not_member",
  /** The words look like they hold a credential; nothing was written. */
  CREDENTIAL: "credential",
  /** The memory it replaces is not the workspace's, or was forgotten; nothing was written. */
  NOT_FOUND: "not_found",
  /** The workspace holds as many memories as it may; nothing was written. */
  FULL: "full",
} as const;

export type WorkspaceMemorySaveAnswer =
  | ({ readonly kind: typeof WORKSPACE_MEMORY_SAVE.SAVED } & MemorySaveAnswer)
  | {
      readonly kind: Exclude<
        (typeof WORKSPACE_MEMORY_SAVE)[keyof typeof WORKSPACE_MEMORY_SAVE],
        typeof WORKSPACE_MEMORY_SAVE.SAVED
      >;
    };

export type WorkspaceMemoryPageAnswer =
  | {
      readonly kind: typeof WORKSPACE_MEMORY.READ;
      readonly memories: readonly MemorySummary[];
      /** How many memories were kept or corrected since the time, across every page. */
      readonly total: number;
    }
  | { readonly kind: typeof WORKSPACE_MEMORY.NOT_MEMBER };

export type WorkspaceMemorySearchAnswer =
  | {
      readonly kind: typeof WORKSPACE_MEMORY.READ;
      readonly memories: readonly MemorySummary[];
      readonly total: number;
    }
  | { readonly kind: typeof WORKSPACE_MEMORY.NOT_MEMBER };

/**
 * Keeps a memory in the member's words, in a workspace they are a member
 * of, or corrects the one `replaces` names, and answers what that came to
 * with the memory as the member then sees it. Words that look like a
 * credential are refused before the store is reached. `source` is the
 * coding agent keeping them and its turn's line; a member's own keep hands
 * none. Each keep is counted once the request has answered.
 */
export function saveWorkspaceMemory(
  userId: string,
  workspaceId: string,
  text: string,
  replaces: string | undefined,
  source?: MemorySource,
): WorkspaceStoreEffect<WorkspaceMemorySaveAnswer> {
  return Effect.gen(function* () {
    const role = yield* roleIn(userId, workspaceId);

    if (Option.isNone(role)) return { kind: WORKSPACE_MEMORY_SAVE.NOT_MEMBER } as const;

    if (looksLikeCredential(text)) return { kind: WORKSPACE_MEMORY_SAVE.CREDENTIAL } as const;
    const outcome = yield* rememberMemory(workspaceId, userId, text, replaces, source);

    switch (outcome.kind) {
      case MEMORY_OUTCOME.NOT_FOUND:
        return { kind: WORKSPACE_MEMORY_SAVE.NOT_FOUND } as const;
      case MEMORY_OUTCOME.FULL:
        return { kind: WORKSPACE_MEMORY_SAVE.FULL } as const;
      default: {
        const kept = outcome.memory;
        const readings = yield* readingsOf(userId, workspaceId, [kept]);
        const memory = summaryOf(userId, MANAGING_ROLES.has(role.value), readings, kept);
        yield* recordServerEvent(
          SERVER_EVENT.MEMORY_SAVE,
          { userId, workspaceId },
          {
            outcome: outcome.kind,
            by: source === undefined ? SERVER_MEMORY_KEEPER.MEMBER : SERVER_MEMORY_KEEPER.AGENT,
          },
        );

        return { kind: WORKSPACE_MEMORY_SAVE.SAVED, outcome: outcome.kind, memory } as const;
      }
    }
  });
}

/** The workspace's memories a search's words find, best first, as recall ranks them, and how many it holds, to a member of it. */
export function searchWorkspaceMemories(
  userId: string,
  workspaceId: string,
  query: string | undefined,
): WorkspaceStoreEffect<WorkspaceMemorySearchAnswer> {
  return Effect.gen(function* () {
    const role = yield* roleIn(userId, workspaceId);

    if (Option.isNone(role)) return { kind: WORKSPACE_MEMORY.NOT_MEMBER } as const;
    const stored = yield* listMemories(workspaceId);
    const found = rankMemories(stored, query);

    const memories = yield* summariesFor(
      userId,
      workspaceId,
      MANAGING_ROLES.has(role.value),
      found,
    );

    return { kind: WORKSPACE_MEMORY.READ, memories, total: stored.length } as const;
  });
}

/**
 * The workspace's memories a coding agent's first turn is handed, to a member
 * of it: the few its task and words find, ranked as a search ranks them
 * (`matchingMemories`) over more of the text, since a turn's opening runs
 * longer than a search's few words. Unlike a search, text with no telling
 * word, or a workspace whose memories hold none of its words, answers none
 * rather than the most recent, so a turn is handed only what bears on it;
 * and an account no member of the workspace is answered none.
 */
export function matchWorkspaceMemories(
  userId: string,
  workspaceId: string,
  text: string,
): WorkspaceStoreEffect<readonly StoredMemory[]> {
  return Effect.gen(function* () {
    const asked = askedWords(
      text,
      MEMORY_SEARCH_BOUNDS.TURN_QUERY_WORDS,
      MEMORY_SEARCH_BOUNDS.TURN_SHORTEST_WORD,
    );

    if (asked.length === 0) return [];

    if (Option.isNone(yield* roleIn(userId, workspaceId))) return [];

    return matchingMemories(
      yield* listMemories(workspaceId),
      asked,
      MEMORY_SEARCH_BOUNDS.TURN_RESULTS,
    );
  });
}

/**
 * One page of the workspace's memories kept or corrected at or after
 * `since` (epoch milliseconds), most recent first, to a member of it, and
 * how many there are across every page. Unlike a search, nothing is ranked
 * or capped past the page, and only the page's memories are read beside
 * their words.
 */
export function listWorkspaceMemoriesSince(
  userId: string,
  workspaceId: string,
  since: number,
  page: { readonly offset: number; readonly limit: number },
): WorkspaceStoreEffect<WorkspaceMemoryPageAnswer> {
  return Effect.gen(function* () {
    const role = yield* roleIn(userId, workspaceId);

    if (Option.isNone(role)) return { kind: WORKSPACE_MEMORY.NOT_MEMBER } as const;
    const recent = (yield* listMemories(workspaceId)).filter((kept) => kept.updatedAt >= since);

    const memories = yield* summariesFor(
      userId,
      workspaceId,
      MANAGING_ROLES.has(role.value),
      recent.slice(page.offset, page.offset + page.limit),
    );

    return { kind: WORKSPACE_MEMORY.READ, memories, total: recent.length } as const;
  });
}
