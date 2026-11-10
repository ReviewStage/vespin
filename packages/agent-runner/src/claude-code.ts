/**
 * claude-code.ts -- the one door to the Agent SDK: the CLI spawned and initialized by `startup()` before its first prompt, then driven in streaming input mode through the session handle, and a stored session's chain read back.
 *
 * The handle is the part of the SDK's `Query` the runner uses, so a test
 * hands a scripted session where production hands the CLI.
 */

import {
  getSessionMessages,
  type Options,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type SessionStore,
  startup,
} from "@anthropic-ai/claude-agent-sdk";
import { Context, Layer } from "effect";

/**
 * A running session of the CLI, as the runner drives it: its messages, and
 * the control requests the runner sends. `close` ends the CLI process and
 * whatever it still had running.
 */
export type ClaudeCodeSession = AsyncIterable<SDKMessage> &
  Pick<Query, "interrupt" | "setModel" | "applyFlagSettings" | "close">;

/** The CLI spawned and past its initialize handshake, waiting for the prompt stream it runs on; handed one stream, once. */
export interface StartedClaudeCode {
  readonly query: (prompt: AsyncIterable<SDKUserMessage>) => ClaudeCodeSession;
}

export interface ClaudeCodeShape {
  /** The CLI started on the options given, answered once it has initialized; rejected where it could not start or initialize. */
  readonly startup: (options: Options) => Promise<StartedClaudeCode>;
  /**
   * The ids of a stored session's chain entries, oldest first, as the
   * checkout's project holds it: read from the store where one is given,
   * since the CLI resumes from the store alone where it keeps the
   * transcript, and a session forked from another agent's stands on no
   * disk; none where it holds no such session.
   */
  readonly sessionChain: (
    sessionId: string,
    cwd: string,
    store: SessionStore | undefined,
  ) => Promise<readonly string[]>;
}

export class ClaudeCode extends Context.Service<ClaudeCode, ClaudeCodeShape>()(
  "@repo/agent-runner/ClaudeCode",
) {}

/** The CLI itself, through the pinned SDK. */
export const claudeCodeLive: Layer.Layer<ClaudeCode> = Layer.succeed(ClaudeCode, {
  startup: (options) => startup({ options }),
  sessionChain: async (sessionId, cwd, store) =>
    (
      await getSessionMessages(sessionId, {
        dir: cwd,
        includeSystemMessages: true,
        ...(store === undefined ? undefined : { sessionStore: store }),
      })
    ).map((message) => message.uuid),
});
