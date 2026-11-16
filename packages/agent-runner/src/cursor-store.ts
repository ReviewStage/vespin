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
import { Effect, Option, Schema } from "effect";
import { RUNNER_TRANSCRIPTS } from "./protocol.js";
import type { transcriptStore } from "./transcripts.js";

type TranscriptStore = Pick<ReturnType<typeof transcriptStore>, "append" | "load">;

/** The kinds of entry the service keeps of a Cursor agent. */
const CURSOR_ENTRY = {
  AGENT: "agent",
  CHECKPOINT: "checkpoint",
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

/** One entry the service keeps: an agent's row as the SDK wrote it, or one checkpoint blob, base64. */
const CursorEntrySchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal(CURSOR_ENTRY.AGENT), agent: AgentRowSchema }),
  Schema.Struct({
    type: Schema.Literal(CURSOR_ENTRY.CHECKPOINT),
    agentId: Schema.String,
    blobId: Schema.String,
    data: Schema.String,
  }),
]);

type CursorEntry = typeof CursorEntrySchema.Type;

const decodeEntry = Schema.decodeUnknownOption(CursorEntrySchema);

/**
 * How much one mirror's call carries at most, counted as the entries' JSON:
 * well under the platform's 4.5 MB bound on a function's request, so a turn
 * that wrote much is sent over several calls.
 */
const APPEND_BYTES = 3 * 1024 * 1024;

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

/** A Cursor agent's store, as the launch hands it the SDK and mirrors it to the service. */
export interface CursorStore {
  readonly store: LocalAgentStore;
  /** Whether the store holds the agent's row, so the launch resumes it rather than making it. */
  readonly holds: (agentId: string) => boolean;
  /** The rows and blobs written since the last mirror, sent to the service in order; what it did not take goes with the next. */
  readonly mirror: Effect.Effect<void>;
}

/**
 * The store for a launch whose checkout is `cwd`, holding the entries given,
 * the service's for the agent; mirrored to `transcripts` where the launch
 * keeps its store there.
 */
export function cursorStore(
  cwd: string,
  entries: readonly CursorEntry[],
  transcripts: TranscriptStore | undefined,
): CursorStore {
  const agents = new Map<string, LocalAgentDocument>();
  const blobs = new Map<string, { readonly agentId: string; readonly data: Uint8Array }>();
  const runs = new Map<string, LocalAgentRunDocument>();
  const events = new Map<string, LocalAgentRunEventDocument[]>();
  const unsent: CursorEntry[] = [];

  for (const entry of entries) {
    if (entry.type === CURSOR_ENTRY.AGENT) {
      agents.set(entry.agent.agentId, entry.agent);
    } else {
      blobs.set(entry.blobId, { agentId: entry.agentId, data: Buffer.from(entry.data, "base64") });
    }
  }

  const keepAgent = (agent: LocalAgentDocument) => {
    agents.set(agent.agentId, agent);
    unsent.push({ type: CURSOR_ENTRY.AGENT, agent: { ...agent } });

    return { ...agent, cwd };
  };

  const keepBlob = (agentId: string, blobId: string, data: Uint8Array) => {
    blobs.set(blobId, { agentId, data });
    unsent.push({
      type: CURSOR_ENTRY.CHECKPOINT,
      agentId,
      blobId,
      data: Buffer.from(data).toString("base64"),
    });
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

  const mirror = Effect.gen(function* () {
    if (transcripts === undefined) return;

    while (unsent.length > 0) {
      const batch = batchOf(unsent);
      const agentId = agentOf(batch[0]);

      // A batch the service did not take stays at the front, for the next mirror.
      yield* Effect.tryPromise(() => transcripts.append(keyOf(agentId), batch));
      unsent.splice(0, batch.length);
    }
  }).pipe(
    Effect.catch(() =>
      Effect.logWarning("agent-runner: the Cursor agent's store was not mirrored"),
    ),
  );

  return { store, holds: (agentId) => agents.has(agentId), mirror };
}

/** The agent an entry belongs to. */
function agentOf(entry: CursorEntry | undefined): string {
  if (entry === undefined) return "";

  return entry.type === CURSOR_ENTRY.AGENT ? entry.agent.agentId : entry.agentId;
}

/** The entries one call carries: the first's agent's alone, from the front, up to `APPEND_BYTES`, and at least one. */
function batchOf(unsent: readonly CursorEntry[]): CursorEntry[] {
  const agentId = agentOf(unsent[0]);
  const batch: CursorEntry[] = [];
  let bytes = 0;

  for (const entry of unsent) {
    const size = JSON.stringify(entry).length;

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
