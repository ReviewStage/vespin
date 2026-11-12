/**
 * production.ts -- the live view's dependencies as the deployment stands them: the tab read and taken over in the store by the tabs contract's rules, the agent's sandbox session from its conversation, and its browser through `Sandbox` and the sandbox's PTY.
 *
 * Each dependency answers over the services the function's runtime holds,
 * captured once as the service stands, so the relay itself requires none.
 * Nothing a tab shows is logged.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  handBackBrowserTab,
  noteBrowserTabPage,
  readBrowserTab,
  renewBrowserTabTakeover,
  takeOverBrowserTab,
} from "@repo/database/models/agent-browser-tabs";
import { readVisibleAgentWorkspace } from "@repo/database/models/agent-store";
import { standingSessionsNamed } from "@repo/database/models/recorded-session";
import { Sandbox } from "@repo/sandbox";
import { Effect, Option } from "effect";
import type { HttpClient } from "effect/http";
import { AgentBrowser, agentBrowserOver } from "../agents/browser/agent-browser.js";
import { connectRestoring } from "../agents/browser/restore-tabs.js";
import { AgentImage } from "../agents/coder-host/agent-image.js";
import { sandboxPtyOf } from "../agents/sandbox-pty.js";
import { recordServerEventIn, SERVER_EVENT } from "../events/server-events.js";
import type { BrowserLiveDependencies } from "./relay.js";

/** What the live view's dependencies answer over: the agents' image among it, which a sandbox is made again from. */
export type BrowserLiveServices = DatabaseServices | HttpClient.HttpClient | AgentImage | Sandbox;

/** The live view's dependencies over the services the runtime holds now. */
export const browserLiveDependencies: Effect.Effect<
  BrowserLiveDependencies,
  never,
  BrowserLiveServices
> = Effect.gen(function* () {
  const context = yield* Effect.context<BrowserLiveServices>();

  const run = <A, E>(effect: Effect.Effect<A, E, BrowserLiveServices>) =>
    Effect.provideContext(effect, context);

  const sandbox = yield* Sandbox;
  const browser = agentBrowserOver(sandbox, sandboxPtyOf(sandbox), yield* AgentImage);

  return {
    readTab: (userId, place, tabId) => run(readBrowserTab(userId, place, tabId)),
    // Note that the tab was read under the member's reach first, so its agent's conversation is read whoever started it.
    sessionOf: (conversationId) =>
      run(
        Effect.map(standingSessionsNamed([conversationId]), ([session]) =>
          Option.fromUndefinedOr(session?.sessionId),
        ),
      ),
    // Note that a connection reopens the agent's kept tabs where its browser started afresh.
    browser: {
      connect: (sessionId, conversationId) =>
        connectRestoring(sessionId, conversationId).pipe(
          Effect.provideService(AgentBrowser, browser),
          Effect.provide(context),
        ),
    },
    takeOver: (tabId, userId, heldUntil, now) =>
      run(takeOverBrowserTab(tabId, userId, heldUntil, now)),
    renew: (tabId, userId, heldUntil, now) =>
      run(renewBrowserTabTakeover(tabId, userId, heldUntil, now)),
    handBack: (tabId, userId) => run(handBackBrowserTab(tabId, userId)),
    counted: (userId, agentId, tool) =>
      run(
        recordServerEventIn(
          SERVER_EVENT.AGENT_TOOL_OPEN,
          userId,
          readVisibleAgentWorkspace(userId, agentId),
          { tool },
        ),
      ),
    notePage: (tabId, targetId, page) =>
      run(noteBrowserTabPage(tabId, targetId, page)).pipe(
        Effect.catch(() => Effect.logWarning("a watched tab's page was not kept")),
        Effect.asVoid,
      ),
  };
});
