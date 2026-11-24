/**
 * cursor-store.ts -- the store a Cursor agent is kept in: the SDK's `LocalAgentStore` held in the runner's memory, its agent rows and checkpoint blobs mirrored to the service, and read back from there as a launch opens the agent.
 *
 * Cursor's SDK keeps an agent in a store it is handed: its row, which names
 * the latest checkpoint, the checkpoints' content-addressed blobs, which
 * hold the whole conversation, and its runs and their streamed events. A
 * row and its blobs are all a resume needs (the spike's finding): runs and
 * their events are made again as the agent runs. So only those are kept at
 * the service, in the same store as Claude Code's transcript and Codex's
 * rollout (`transcripts.ts`), under the project `cursor` and the agent's id
 * as its session, one entry for each row or blob as it was written, the
 * newest standing for each. Everything else stays in memory for the
 * launch's life.
 *
 * Beside them the launch keeps a cut mark for each line that opens a run:
 * the line's id and the checkpoint the agent stood at just before it (none
 * for its first), written once and never moved. A rewind or a fork at that
 * line points the agent's row back at the mark's checkpoint (`cutBefore`),
 * its later blobs left in place, since each blob is named for its content;
 * a line with no mark (one steered into a run going, or one from before
 * marks were kept) is no cut the store can make.
 *
 * A checkpoint whose blob is too large for one call to the service is kept
 * as parts, each in a call of its own, and joined again as the store is read
 * back. The store keeps too whether the agent's next message leads with our
 * instructions, which a summary drops from what the model reads, so a launch
 * that ends before that message leaves it to the next.
 *
 * Note that the SDK reads an agent only where its row names the checkout it
 * runs in (`scopedWorkspaceRef`), and a sandbox made anew may hold the
 * checkout at another path, so a row is answered with the launch's own
 * checkout whatever it was written with. Nothing of the store is logged,
 * since a blob holds the conversation.
 */

import type {
  LocalAgentCheckpointFilter,
  LocalAgentDocument,
  LocalAgentRunDocument,
  LocalAgentRunEventDocument,
  LocalAgentStore,
  LocalAgentStoreListResult,
} from "@cursor/sdk";
import { Data, Duration, Effect, Option, Schema, Semaphore } from "effect";
import { RUNNER_TRANSCRIPTS } from "./protocol.js";
import type { transcriptStore } from "./transcripts.js";

type TranscriptStore = Pick<ReturnType<typeof transcriptStore>, "append" | "load">;

/** The kinds of entry the service keeps of a Cursor agent. */
const CURSOR_ENTRY = {
  AGENT: "agent",
  CHECKPOINT: "checkpoint",
  CHECKPOINT_PART: "checkpoint_part",
  CUT: "cut",
  INSTRUCTIONS: "instructions",
} as const;

/** An agent's row as the pinned SDK writes it (`LocalAgentDocument`). */
const AgentRowSchema = Schema.Struct({
  agentId: Schema.String,
  cwd: Schema.String,
  status: Schema.Literals(["idle", "running", "error", "archived"]),
  activeRunId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  latestCheckpoint: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ schemaVersion: Schema.Literal(1), rootBlobId: Schema.String })),
  ),
  sdkMetadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

/** One entry the service keeps: an agent's row as the SDK wrote it, one checkpoint blob, base64, whole or a part of it, whether our instructions are due, or a cut mark. */
const CursorEntrySchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal(CURSOR_ENTRY.AGENT), agent: AgentRowSchema }),
  Schema.Struct({
    type: Schema.Literal(CURSOR_ENTRY.CHECKPOINT),
    agentId: Schema.String,
    blobId: Schema.String,
    data: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal(CURSOR_ENTRY.CHECKPOINT_PART),
    agentId: Schema.String,
    blobId: Schema.String,
    /** The part's place among the blob's parts, from 0. */
    part: Schema.Int,
    parts: Schema.Int,
    data: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal(CURSOR_ENTRY.INSTRUCTIONS),
    agentId: Schema.String,
    /** Whether the agent's next message leads with our instructions. */
    due: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal(CURSOR_ENTRY.CUT),
    agentId: Schema.String,
    /** The service's id of the line whose run the mark stands before. */
    before: Schema.String,
    /** The checkpoint the agent stood at just before that run; none where it was the agent's first. */
    root: Schema.NullOr(Schema.String),
  }),
]);

type CursorEntry = typeof CursorEntrySchema.Type;

const decodeEntry = Schema.decodeUnknownOption(CursorEntrySchema);

/**
 * How much one mirror's call carries at most, counted as the entries' JSON
 * in bytes: well under the platform's 4.5 MB bound on a function's request,
 * so a turn that wrote much is sent over several calls.
 */
const APPEND_BYTES = 3 * 1024 * 1024;

/** How much of a blob's base64 one entry carries at most, so every part fits a call under `APPEND_BYTES`. */
const PART_CHARS = 2 * 1024 * 1024;

/** How long one call of a mirror waits on the service before it counts as not taken. */
const APPEND_TIMEOUT = Duration.seconds(30);

/** How many items a listing answers where the SDK asks no bound. */
const LIST_DEFAULT = 100;

/** A store's agent as the service keeps it: under the project `cursor`, its id as the session. */
function keyOf(agentId: string) {
  return { projectKey: RUNNER_TRANSCRIPTS.CURSOR_PROJECT, sessionId: agentId };
}

/** One page of items from the place a cursor names, the cursor being the index of the page's first item. */
function page<T>(
  items: readonly T[],
  cursor: string | undefined,
  limit: number | undefined,
): LocalAgentStoreListResult<T> {
  const from = cursor === undefined ? 0 : Number.parseInt(cursor, 10);
  const until = from + (limit ?? LIST_DEFAULT);
  const slice = items.slice(from, until);

  return until < items.length ? { items: slice, nextCursor: String(until) } : { items: slice };
}

/** Whether a blob is among those a filter names; every blob where it names none. */
function blobMatches(
  key: { readonly agentId: string; readonly blobId: string },
  filter: LocalAgentCheckpointFilter | undefined,
): boolean {
  const agents = filter?.agentIds ?? [];
  const blobs = filter?.blobIds ?? [];

  return (
    (agents.length === 0 || agents.includes(key.agentId)) &&
    (blobs.length === 0 || blobs.includes(key.blobId))
  );
}

/** The service did not take every row and blob the store wrote; what it did not take stays to be sent again. */
export class StoreUnkept extends Data.TaggedError("StoreUnkept") {}

/** A Cursor agent's store, as the launch hands it the SDK and mirrors it to the service. */
export interface CursorStore {
  readonly store: LocalAgentStore;
  /** Whether the store holds the agent's row, so the launch resumes it rather than making it. */
  readonly holds: (agentId: string) => boolean;
  /** Marks the checkpoint the agent stands at as the one before the line given, which opens its next run. */
  readonly markCut: (agentId: string, before: string) => void;
  /**
   * Points the agent back at the checkpoint marked before the line given,
   * its row let go where the line was its first so the launch makes it
   * anew; the agent is left as it is where no mark stands.
   */
  readonly cutBefore: (agentId: string, before: string) => void;
  /** Whether the agent's next message leads with our instructions. */
  readonly instructionsDue: (agentId: string) => boolean;
  /** Notes whether the agent's next message leads with our instructions, kept at the service with the rest. */
  readonly dueInstructions: (agentId: string, due: boolean) => void;
  /**
   * The entries written since the last mirror, sent to the service in order,
   * one mirror at a time; fails where the service did not take them all
   * within `APPEND_TIMEOUT` a call, what it did not take going with the next.
   */
  readonly mirror: Effect.Effect<void, StoreUnkept>;
}

/**
 * The store for a launch whose checkout is `cwd`, holding the entries given,
 * the service's for the agent; mirrored to `transcripts` where the launch
 * keeps its store there. A fork holds them as the agent `forkAs` names,
 * every one mirrored again under it, so the fork resumes as its own.
 */
export function cursorStore(
  cwd: string,
  held: readonly CursorEntry[],
  transcripts: TranscriptStore | undefined,
  forkAs?: string,
): CursorStore {
  const agents = new Map<string, LocalAgentDocument>();
  const blobs = new Map<string, { readonly agentId: string; readonly data: Uint8Array }>();
  const runs = new Map<string, LocalAgentRunDocument>();
  const events = new Map<string, LocalAgentRunEventDocument[]>();
  const cuts = new Map<string, Map<string, string | null>>();
  const due = new Map<string, boolean>();
  const entries = forkAs === undefined ? held : held.map((entry) => ownedBy(entry, forkAs));
  const unsent: CursorEntry[] = forkAs === undefined ? [] : [...entries];

  const keepCut = (agentId: string, before: string, root: string | null) => {
    const marks = cuts.get(agentId) ?? new Map<string, string | null>();
    marks.set(before, root);
    cuts.set(agentId, marks);
  };

  for (const entry of entries) {
    if (entry.type === CURSOR_ENTRY.AGENT) {
      agents.set(entry.agent.agentId, entry.agent);
    } else if (entry.type === CURSOR_ENTRY.CHECKPOINT) {
      blobs.set(entry.blobId, { agentId: entry.agentId, data: Buffer.from(entry.data, "base64") });
    } else if (entry.type === CURSOR_ENTRY.INSTRUCTIONS) {
      due.set(entry.agentId, entry.due);
    } else if (entry.type === CURSOR_ENTRY.CUT) {
      keepCut(entry.agentId, entry.before, entry.root);
    }
  }

  for (const [blobId, blob] of joinedParts(entries)) blobs.set(blobId, blob);

  const keepAgent = (agent: LocalAgentDocument) => {
    agents.set(agent.agentId, agent);
    unsent.push({ type: CURSOR_ENTRY.AGENT, agent: { ...agent } });

    return { ...agent, cwd };
  };

  const keepBlob = (agentId: string, blobId: string, data: Uint8Array) => {
    blobs.set(blobId, { agentId, data });
    unsent.push(...blobEntries(agentId, blobId, Buffer.from(data).toString("base64")));
  };

  const dueInstructions = (agentId: string, value: boolean) => {
    if (due.get(agentId) === value) return;
    due.set(agentId, value);
    unsent.push({ type: CURSOR_ENTRY.INSTRUCTIONS, agentId, due: value });
  };

  const markCut = (agentId: string, before: string) => {
    // A mark is never moved, so a line sent again after a relaunch keeps the checkpoint it first stood after.
    if (cuts.get(agentId)?.has(before) === true) return;
    const root = agents.get(agentId)?.latestCheckpoint?.rootBlobId ?? null;
    keepCut(agentId, before, root);
    unsent.push({ type: CURSOR_ENTRY.CUT, agentId, before, root });
  };

  const cutBefore = (agentId: string, before: string) => {
    const marks = cuts.get(agentId);
    const agent = agents.get(agentId);

    if (marks === undefined || !marks.has(before) || agent === undefined) return;
    const root = marks.get(before) ?? null;

    // Note that the row let go is never mirrored as gone: the one the launch makes anew stands newest.
    if (root === null) agents.delete(agentId);
    else keepAgent({ ...agent, latestCheckpoint: { schemaVersion: 1, rootBlobId: root } });
  };

  // Note that a row is answered with the launch's checkout, since the SDK reads only the rows naming it.
  const here = (agent: LocalAgentDocument): LocalAgentDocument => ({ ...agent, cwd });

  const store: LocalAgentStore = {
    agents: {
      get: async ({ agentId }) => {
        const agent = agents.get(agentId);

        return agent === undefined ? null : here(agent);
      },
      create: async ({ agent }) => keepAgent(agent),
      update: async ({ agent }) => keepAgent(agent),
      delete: async ({ filter }) => {
        for (const agentId of filter.agentIds ?? [...agents.keys()]) agents.delete(agentId);
      },
      list: async (input) =>
        page(
          [...agents.values()].map(here).sort((left, right) => right.updatedAt - left.updatedAt),
          input?.filter?.cursor,
          input?.filter?.limit,
        ),
    },
    checkpoints: {
      get: async ({ blobId }) => blobs.get(blobId)?.data ?? null,
      create: async ({ agentId, blobId, data }) => keepBlob(agentId, blobId, data),
      update: async ({ agentId, blobId, data }) => keepBlob(agentId, blobId, data),
      delete: async ({ filter }) => {
        for (const [blobId, blob] of blobs) {
          if (blobMatches({ agentId: blob.agentId, blobId }, filter)) blobs.delete(blobId);
        }
      },
      list: async (input) =>
        page(
          [...blobs.entries()]
            .flatMap(([blobId, blob]) =>
              blobMatches({ agentId: blob.agentId, blobId }, input?.filter) ? [blobId] : [],
            )
            .sort(),
          input?.filter?.cursor,
          input?.filter?.limit,
        ),
    },
    runs: {
      get: async ({ runId }) => runs.get(runId) ?? null,
      create: async ({ run }) => {
        runs.set(run.runId, run);

        return run;
      },
      update: async ({ run }) => {
        runs.set(run.runId, run);

        return run;
      },
      delete: async ({ filter }) => {
        for (const run of [...runs.values()]) {
          const byAgent = filter.agentIds === undefined || filter.agentIds.includes(run.agentId);
          const byRun = filter.runIds === undefined || filter.runIds.includes(run.runId);

          if (byAgent && byRun) {
            runs.delete(run.runId);
            events.delete(run.runId);
          }
        }
      },
      list: async (input) => {
        const filter = input?.filter;

        const matching = [...runs.values()]
          .filter(
            (run) =>
              (filter?.agentIds === undefined || filter.agentIds.includes(run.agentId)) &&
              (filter?.runIds === undefined || filter.runIds.includes(run.runId)),
          )
          .sort((left, right) => left.turnNumber - right.turnNumber);

        return page(matching, filter?.cursor, filter?.limit);
      },
    },
    runEvents: {
      append: async (input) => {
        const stream = events.get(input.runId) ?? [];

        const keyed =
          input.idempotencyKey === undefined || input.idempotencyKey === null
            ? undefined
            : stream.find((event) => event.idempotencyKey === input.idempotencyKey);

        if (keyed !== undefined) return keyed;
        const seq = stream.length + 1;

        const event: LocalAgentRunEventDocument = {
          runId: input.runId,
          seq,
          offset: String(seq),
          eventType: input.eventType,
          payload: input.payload ?? null,
          payloadRef: input.payloadRef ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          createdAt: Date.now(),
        };

        events.set(input.runId, [...stream, event]);

        return event;
      },
      list: async ({ runId, afterOffset, limit }) => {
        const after = afterOffset === undefined || afterOffset === null ? 0 : Number(afterOffset);
        const later = (events.get(runId) ?? []).filter((event) => event.seq > after);
        const items = later.slice(0, limit ?? LIST_DEFAULT);
        const last = items.at(-1);

        return later.length > items.length && last !== undefined
          ? { items, nextOffset: last.offset }
          : { items };
      },
      delete: async ({ filter }) => {
        for (const runId of filter.runIds ?? [...events.keys()]) events.delete(runId);
      },
    },
  };

  // Note that mirrors run one at a time, because each sends the front of `unsent` and takes it off once the service took it.
  const sending = Semaphore.makeUnsafe(1);

  const mirror = Effect.gen(function* () {
    if (transcripts === undefined) return;

    while (unsent.length > 0) {
      const batch = batchOf(unsent);
      const agentId = agentOf(batch[0]);

      // A batch the service did not take stays at the front, for the next mirror.
      yield* Effect.tryPromise(() => transcripts.append(keyOf(agentId), batch)).pipe(
        Effect.timeout(APPEND_TIMEOUT),
      );
      unsent.splice(0, batch.length);
    }
  }).pipe(
    Effect.mapError(() => new StoreUnkept()),
    sending.withPermit,
  );

  return {
    store,
    holds: (agentId) => agents.has(agentId),
    markCut,
    cutBefore,
    instructionsDue: (agentId) => due.get(agentId) === true,
    dueInstructions,
    mirror,
  };
}

/** The agent an entry belongs to. */
function agentOf(entry: CursorEntry | undefined): string {
  if (entry === undefined) return "";

  return entry.type === CURSOR_ENTRY.AGENT ? entry.agent.agentId : entry.agentId;
}

/** The entry as the agent given's own. */
function ownedBy(entry: CursorEntry, agentId: string): CursorEntry {
  return entry.type === CURSOR_ENTRY.AGENT
    ? { ...entry, agent: { ...entry.agent, agentId } }
    : { ...entry, agentId };
}

/** The entries a blob is kept as, its base64 given: one where it fits a part, and its parts in order otherwise. */
function blobEntries(agentId: string, blobId: string, data: string): CursorEntry[] {
  if (data.length <= PART_CHARS) return [{ type: CURSOR_ENTRY.CHECKPOINT, agentId, blobId, data }];
  const parts = Math.ceil(data.length / PART_CHARS);

  return Array.from({ length: parts }, (_, part) => ({
    type: CURSOR_ENTRY.CHECKPOINT_PART,
    agentId,
    blobId,
    part,
    parts,
    data: data.slice(part * PART_CHARS, (part + 1) * PART_CHARS),
  }));
}

/** The blobs the entries hold as parts, each joined from its parts; a blob missing a part is none. */
function joinedParts(entries: readonly CursorEntry[]) {
  const held = new Map<
    string,
    { readonly agentId: string; readonly parts: (string | undefined)[] }
  >();

  for (const entry of entries) {
    if (entry.type !== CURSOR_ENTRY.CHECKPOINT_PART) continue;

    const blob = held.get(entry.blobId) ?? {
      agentId: entry.agentId,
      parts: Array.from({ length: entry.parts }, () => undefined),
    };

    blob.parts[entry.part] = entry.data;
    held.set(entry.blobId, blob);
  }

  return [...held].flatMap(([blobId, { agentId, parts }]) =>
    parts.every((part) => part !== undefined)
      ? [[blobId, { agentId, data: Buffer.from(parts.join(""), "base64") }] as const]
      : [],
  );
}

/** The entries one call carries: the first's agent's alone, from the front, up to `APPEND_BYTES`, and at least one. */
function batchOf(unsent: readonly CursorEntry[]): CursorEntry[] {
  const agentId = agentOf(unsent[0]);
  const batch: CursorEntry[] = [];
  let bytes = 0;

  for (const entry of unsent) {
    const size = Buffer.byteLength(JSON.stringify(entry));

    if (agentOf(entry) !== agentId || (batch.length > 0 && bytes + size > APPEND_BYTES)) break;
    batch.push(entry);
    bytes += size;
  }

  return batch;
}

/** The entries the service keeps for the agent, each it can read; none where it keeps none. */
export const restoredEntries = Effect.fn("agent-runner/cursor/restoredEntries")(function* (
  transcripts: TranscriptStore,
  agentId: string,
) {
  const entries = yield* Effect.tryPromise(() => transcripts.load(keyOf(agentId)));

  return (entries ?? []).flatMap((entry) => Option.toArray(decodeEntry(entry)));
});
