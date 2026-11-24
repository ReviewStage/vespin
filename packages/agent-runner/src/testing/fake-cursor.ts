/**
 * fake-cursor.ts -- a scripted Cursor SDK for the runner's tests: each run plays the messages it is scripted with, and the fake keeps what the runner handed the SDK.
 *
 * It stands at the one door the runner reaches Cursor's SDK through
 * (`cursor-sdk.ts`'s `CursorSdk`), so a test sees what the SDK would: the
 * options each agent was made or resumed with, every message sent and
 * steered in order, each cancel, and the changes to the process's
 * environment. As the SDK does, it keeps the agent in the store it was
 * handed: a row as the agent is made, and a checkpoint blob and the row
 * naming it as each run ends, and it resumes only an agent whose row the
 * store answers for the checkout it was asked in.
 */

import type {
  AgentOptions,
  LocalAgentDocument,
  LocalAgentStore,
  RunResultStatus,
  SDKMessage,
  SDKUserMessage,
  SendOptions,
  SteerAckOutcome,
} from "@cursor/sdk";
import { Layer } from "effect";
import { type CursorAgentHandle, type CursorRun, CursorSdk } from "../cursor-sdk.js";

/** One run as the fake plays it: its messages, how it ends, and what it answers a steer. */
export interface FakeRun {
  readonly messages: readonly SDKMessage[];
  readonly status?: RunResultStatus;
  readonly error?: string;
  /** Holds the run open past its messages until the test releases it or a cancel ends it. */
  readonly held?: boolean;
  /** What a steer into the run is answered; delivered where unscripted. */
  readonly steered?: SteerAckOutcome;
  /** How many bytes the checkpoint the run ends on holds; a few where unscripted. */
  readonly checkpointBytes?: number;
}

/** What the fake SDK was handed, in the order it was handed it. */
interface CursorRecord {
  readonly created: AgentOptions[];
  readonly resumed: {
    readonly agentId: string;
    readonly options: AgentOptions;
    /** The checkpoint the agent's row names, as the store answered it. */
    readonly checkpoint: Uint8Array | null;
  }[];
  readonly sent: { readonly message: SDKUserMessage; readonly options: SendOptions }[];
  readonly steers: string[];
  readonly summaries: number[];
  cancels: number;
  readonly environment: Readonly<Record<string, string | undefined>>[];
  closed: boolean;
}

/** The blob a run's end checkpoints, named for the run, `bytes` long where given. */
export function fakeBlobOf(run: number, bytes?: number) {
  const words = new TextEncoder().encode(`conversation through run ${run}`);

  return {
    blobId: `blob-${run}`,
    data: bytes === undefined ? words : new Uint8Array(bytes).map((_, at) => at % 251),
  };
}

/** A promise and the function that settles it. */
function settler() {
  let settle = () => {};

  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });

  return { settled, settle };
}

/**
 * A fake SDK that plays `runs` in order, one for each message sent or
 * summary asked. `release` lets the held run going end as scripted.
 */
export function fakeCursor(
  runs: readonly FakeRun[],
  options: { readonly signedIn?: boolean } = {},
) {
  const record: CursorRecord = {
    created: [],
    resumed: [],
    sent: [],
    steers: [],
    summaries: [],
    cancels: 0,
    environment: [],
    closed: false,
  };

  let played = 0;
  let release = () => {};

  const runOf = (store: LocalAgentStore | undefined, agentId: string): CursorRun => {
    const script = runs[played] ?? { messages: [] };
    played += 1;
    const number = played;
    const held = settler();
    let canceled = false;
    release = held.settle;

    if (script.held !== true) held.settle();

    // The run checkpoints the conversation as it ends, as the SDK does, and names the blob in the agent's row.
    const checkpoint = async () => {
      const row = await store?.agents.get({ agentId });

      if (store === undefined || row === null || row === undefined) return;
      const blob = fakeBlobOf(number, script.checkpointBytes);
      await store.checkpoints.create({ agentId, ...blob });
      await store.agents.update({
        agent: { ...row, latestCheckpoint: { schemaVersion: 1, rootBlobId: blob.blobId } },
      });
    };

    const ended = (async () => {
      await held.settled;
      await checkpoint();
    })();

    return {
      stream: async function* () {
        yield* script.messages;
        await ended;
      },
      wait: async () => {
        await ended;

        return {
          id: `run-${number}`,
          status: canceled ? "cancelled" : (script.status ?? "finished"),
          ...(script.error === undefined ? undefined : { error: { message: script.error } }),
        };
      },
      cancel: async () => {
        record.cancels += 1;
        canceled = true;
        held.settle();
      },
      steer: async (text) => {
        record.steers.push(text);

        return script.steered ?? "complete_delivered";
      },
    };
  };

  const agentOf = (options: AgentOptions, agentId: string): CursorAgentHandle => ({
    send: async (message, sendOptions) => {
      record.sent.push({ message, options: sendOptions });

      return runOf(options.local?.store, agentId);
    },
    summarize: async () => {
      record.summaries.push(played);

      return runOf(options.local?.store, agentId);
    },
    close: () => {
      record.closed = true;
    },
  });

  const layer = Layer.succeed(CursorSdk, {
    create: async (_sdk, options) => {
      record.created.push(options);
      const agentId = options.agentId ?? "agent-made";
      const now = 0;

      const row: LocalAgentDocument = {
        agentId,
        cwd: options.local?.cwd ?? "",
        status: "idle",
        createdAt: now,
        updatedAt: now,
      };

      await options.local?.store?.agents.create({ agent: row });

      return agentOf(options, agentId);
    },
    resume: async (_sdk, agentId, options) => {
      const store = options.local?.store;
      const row = await store?.agents.get({ agentId });
      const root = row?.latestCheckpoint?.rootBlobId;

      const checkpoint =
        root === undefined
          ? null
          : ((await store?.checkpoints.get({ agentId, blobId: root })) ?? null);

      record.resumed.push({ agentId, options, checkpoint });

      // The SDK reads only the rows naming the checkout it was asked in.
      if (row === null || row === undefined || row.cwd !== options.local?.cwd) {
        throw new Error(`Agent ${agentId} not found`);
      }

      return agentOf(options, agentId);
    },
    signedIn: async () => options.signedIn ?? true,
    setEnvironment: (changes) => {
      record.environment.push(changes);
    },
  });

  return { layer, record, release: () => release() };
}
