/**
 * cursor-sdk.ts -- the one door to Cursor's SDK: an agent made or resumed in the runner's own process, its runs, whether the SDK holds a sign-in of its own, and the process's environment its shell inherits.
 *
 * The SDK is imported from where the image installs it, or a Mac's host
 * keeps it (the config's `sdk`, `CURSOR_SDK_ENTRY` in the cloud), never bundled, so it finds its platform package
 * beside itself as it looks for it. The handles are the part of the SDK's
 * `SDKAgent` and `Run` the runner uses, so a test hands scripted ones where
 * production hands the SDK's.
 */

import { pathToFileURL } from "node:url";
import type {
  AgentOptions,
  RunResult,
  SDKAgent,
  SDKMessage,
  SDKUserMessage,
  SendOptions,
  SteerAckOutcome,
} from "@cursor/sdk";
import { Context } from "effect";

/** One run of the agent, as the runner drives it: its messages, its outcome, and the requests it takes while it runs. */
export interface CursorRun {
  readonly stream: () => AsyncIterable<SDKMessage>;
  readonly wait: () => Promise<RunResult>;
  readonly cancel: () => Promise<void>;
  /** Hands the run a message while it runs; absent where the run takes none. */
  readonly steer?: ((text: string) => Promise<SteerAckOutcome>) | undefined;
}

/** The agent as the runner drives it: a message sent as a run, its conversation summarized as one, and the agent let go. */
export interface CursorAgentHandle {
  readonly send: (message: SDKUserMessage, options: SendOptions) => Promise<CursorRun>;
  readonly summarize: () => Promise<CursorRun>;
  readonly close: () => void;
}

/** What the launch reaches Cursor's SDK through. */
export interface CursorService {
  /** The agent made anew under the options' `agentId`, with the SDK at `sdk`. */
  readonly create: (sdk: string, options: AgentOptions) => Promise<CursorAgentHandle>;
  /** The agent the store given in the options holds, resumed. */
  readonly resume: (
    sdk: string,
    agentId: string,
    options: AgentOptions,
  ) => Promise<CursorAgentHandle>;
  /** Whether the SDK at `sdk` holds a sign-in of its own that stands (`Cursor.auth.status()`), the one it runs on where it is handed no key. */
  readonly signedIn: (sdk: string) => Promise<boolean>;
  /**
   * The runner's own environment changed as given, a variable set to none
   * taken out: the one the agent's shell inherits, since the SDK runs it
   * from this process. Note that it changes what a command inherits, never
   * `/proc/<pid>/environ`, which keeps the environment the process started
   * with.
   */
  readonly setEnvironment: (changes: Readonly<Record<string, string | undefined>>) => void;
}

type CursorModule = typeof import("@cursor/sdk");

/** The SDK's word for a sign-in of its own that stands. */
const SIGNED_IN = "logged-in";

/** The SDK's agent as the runner's handle of it. */
function handleOf(agent: SDKAgent): CursorAgentHandle {
  return {
    send: (message, options) => agent.send(message, options),
    summarize: () => agent.summarize(),
    close: () => agent.close(),
  };
}

/** The SDK as the image installs it, imported once per entry. */
function liveCursor(): CursorService {
  const modules = new Map<string, Promise<CursorModule>>();

  const load = (sdk: string): Promise<CursorModule> => {
    const loaded = modules.get(sdk) ?? import(pathToFileURL(sdk).href);
    modules.set(sdk, loaded);

    return loaded;
  };

  return {
    create: async (sdk, options) => handleOf(await (await load(sdk)).Agent.create(options)),
    resume: async (sdk, agentId, options) =>
      handleOf(await (await load(sdk)).Agent.resume(agentId, options)),
    signedIn: async (sdk) => (await (await load(sdk)).Cursor.auth.status()).status === SIGNED_IN,
    setEnvironment: (changes) => {
      for (const [name, value] of Object.entries(changes)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    },
  };
}

/** Cursor's SDK: the image's, or one a test stands in. */
export const CursorSdk = Context.Reference<CursorService>("@repo/agent-runner/CursorSdk", {
  defaultValue: liveCursor,
});
