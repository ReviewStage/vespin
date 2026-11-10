/**
 * agent-browser-tabs.ts -- the one operation behind a member's Browser tabs: list one agent's or a task's, open one in an agent's browser, and take one over and hand it back.
 *
 * The hosted `agentBrowserTabs` procedures (`agent-browser-tabs-procedures.ts`)
 * and the member MCP server's browser tab tools (`../member-mcp/tools.ts`)
 * are doors over these calls, each acting as the member it names. A tab is
 * read under the rule a whole agent is read by: a member who sees the coding
 * agent whose browser holds it and, for one on a task, that task too
 * (`agentVisibleTo`, `@repo/database/models/agent-browser-tabs`), whether the
 * place names the agent or the task; any other reads as not found. Driving a
 * tab acts in the agent's browser, so it is held to who controls the agent
 * (`controlsAgent`): its starter alone for one on the starter's own GitHub
 * token.
 *
 * A takeover stands for `BROWSER_TAKEOVER_HOLD_MS` past the member's last
 * take or renewal, as the Browser tab's live view writes it
 * (`../browser-live/relay.ts`), so a member who went away leaves the tab to
 * its agent once that passes; a hand-back gives it back at once. Each write
 * answers the tab as it then stands, so a tab another member drives answers
 * them as its driver rather than a refusal.
 *
 * An open reaches the agent's browser through `connectRestoring`, which
 * resumes a stopped sandbox and reopens its kept tabs, keeps the tab with
 * the member as its opener, and takes it over for them at once, so the agent
 * does not act on it until they hand it back. An agent that has opened no
 * sandbox yet is refused as not ready, as is one whose sandbox is made again
 * on an image Vercel still prepares; a browser that could not be reached is
 * the upstream's refusal; the address is never logged, a failure only by
 * its kind.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  handBackBrowserTab,
  listBrowserTabs,
  type ReachedBrowserTab,
  readBrowserTab,
  recordMemberOpenedBrowserTab,
  takeOverBrowserTab,
} from "@repo/database/models/agent-browser-tabs";
import { readVisibleAgentWorkspace } from "@repo/database/models/agent-store";
import { standingSessionsOf } from "@repo/database/models/recorded-session";
import {
  type AgentBrowserTab,
  agentBrowserTabOf,
  type BrowserTabsPlace,
} from "@repo/features/agent-browser-tab-wire";
import { isBrowserAddress } from "@repo/features/browser-acts";
import { DateTime, Effect, Option } from "effect";
import {
  recordServerEventIn,
  SERVER_AGENT_TOOL,
  SERVER_EVENT,
  type ServerAgentTool,
} from "../events/server-events.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import { controlsAgent, reachedAgentById } from "./agent-reach.js";
import { BROWSER_UNREACHABLE } from "./browser/agent-browser.js";
import { connectRestoring } from "./browser/restore-tabs.js";

/** How long a takeover stands past the member's last take or renewal: long enough for a window's renewals to miss one, short enough that a closed one hands the tab back soon. */
export const BROWSER_TAKEOVER_HOLD_MS = 60_000;

/** A reached tab as the wire carries it, its driver only while their takeover stands at `now`, its cursor once its agent pointed at it. */
function browserTabOf({ tab, agent }: ReachedBrowserTab, now: Date): AgentBrowserTab {
  return agentBrowserTabOf(
    {
      id: tab.id,
      agentId: agent.id,
      address: tab.address,
      title: tab.title,
      openedBy: tab.openedBy,
      openedByUserId: tab.openedByUserId,
      driverUserId: tab.driverUserId,
      heldUntil: tab.heldUntil?.getTime() ?? null,
      createdAt: tab.createdAt.getTime(),
      lastActedAt: tab.lastActedAt.getTime(),
      cursorX: tab.cursorX,
      cursorY: tab.cursorY,
      cursorKind: tab.cursorKind,
      cursorViewportW: tab.cursorViewportW,
      cursorViewportH: tab.cursorViewportH,
      cursorAt: tab.cursorAt?.getTime() ?? null,
    },
    now.getTime(),
  );
}

/** The tab of the place named, where the member reaches it; not found otherwise. */
const reachedTab = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  place: BrowserTabsPlace,
  tabId: string,
): Effect.fn.Return<ReachedBrowserTab, HostedRefusal, DatabaseServices> {
  const reached = yield* hostedStoreOrUnavailable(readBrowserTab(userId, place, tabId));
  if (Option.isNone(reached)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return reached.value;
});

/** The tab as it stands after a write, read again under the member's reach; not found where it closed meanwhile. */
const tabAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  place: BrowserTabsPlace,
  tabId: string,
) {
  const reached = yield* reachedTab(userId, place, tabId);
  return { tab: browserTabOf(reached, yield* DateTime.nowAsDate) };
});

/**
 * The coding agent an open names, where the member sees it whole, its task
 * included where it is on one (`agentVisibleTo`), and controls it, and
 * where a task is named, it is on that task, with the session
 * its sandbox is tagged with; not found for an agent of another task, and
 * not ready for one that has run no sandbox yet.
 */
const openedAgent = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agentId: string,
  taskId: string | undefined,
): Effect.fn.Return<
  { readonly conversationId: string; readonly sessionId: string },
  HostedRefusal,
  DatabaseServices
> {
  const { agent } = yield* reachedAgentById(userId, agentId);
  if (taskId !== undefined && agent.taskId !== taskId) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
  // Note that an agent on a task is opened in only by a member who reaches the task too, as its tabs are listed.
  const visible = yield* hostedStoreOrUnavailable(readVisibleAgentWorkspace(userId, agent.id));
  if (Option.isNone(visible)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  if (!controlsAgent(userId, agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  if (agent.archivedAt !== null) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
  const [session] = yield* hostedStoreOrUnavailable(
    standingSessionsOf(agent.userId, [agent.conversationId]),
  );
  if (session === undefined) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
  return { conversationId: agent.conversationId, sessionId: session.sessionId };
});

/**
 * Opens the page in the agent's browser, reached through `connectRestoring`
 * for this call alone, and answers its target. A browser whose agent has
 * opened no sandbox is not ready; one that could not be reached, or that
 * would not open the page, is the upstream's refusal, logged by its kind.
 */
function openedPage(sessionId: string, conversationId: string, address: string) {
  return Effect.scoped(
    Effect.flatMap(connectRestoring(sessionId, conversationId), (cdp) => cdp.openPage(address)),
  ).pipe(
    Effect.catchTags({
      BrowserUnreachable: (unreachable) =>
        unreachable.reason === BROWSER_UNREACHABLE.NOT_OPENED ||
        unreachable.reason === BROWSER_UNREACHABLE.STARTING
          ? Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY)
          : Effect.andThen(
              Effect.logWarning(`a member's Browser tab did not open: ${unreachable.reason}`),
              Effect.fail(HOSTED_REFUSAL.UPSTREAM_ERROR),
            ),
      CdpFailure: (failure) =>
        Effect.andThen(
          Effect.logWarning(`a member's Browser tab did not open: ${failure.kind}`),
          Effect.fail(HOSTED_REFUSAL.UPSTREAM_ERROR),
        ),
    }),
  );
}

/** A browser act of the member's counted in the agent's workspace, as the member's own. */
function browserActed(userId: string, agentId: string, tool: ServerAgentTool) {
  return recordServerEventIn(
    SERVER_EVENT.AGENT_TOOL_OPEN,
    userId,
    readVisibleAgentWorkspace(userId, agentId),
    { tool },
  );
}

/** The place's tabs, the oldest first, as the wire carries them; not found where the member reaches no such agent or task. */
export const listAgentBrowserTabs = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  place: BrowserTabsPlace,
) {
  const listed = yield* hostedStoreOrUnavailable(listBrowserTabs(userId, place));
  if (Option.isNone(listed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const now = yield* DateTime.nowAsDate;
  return { tabs: listed.value.map((reached) => browserTabOf(reached, now)) };
});

/**
 * The member's open: the agent reached, on the task named where one is, the
 * page opened, kept with the member as its opener,
 * and taken over for them, then answered as it stands under their reach.
 */
export const openAgentBrowserTab = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  open: { readonly agentId: string; readonly taskId?: string; readonly address: string },
) {
  if (!isBrowserAddress(open.address)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { conversationId, sessionId } = yield* openedAgent(userId, open.agentId, open.taskId);
  const targetId = yield* openedPage(sessionId, conversationId, open.address);
  // Note that the page is kept at the address asked, its title too, until the agent's next look at it
  // reads the page's own, and the member stands as its opener though the agent's `list` wrote it first.
  const tab = yield* hostedStoreOrUnavailable(
    recordMemberOpenedBrowserTab({
      conversationId,
      targetId,
      address: open.address,
      title: open.address,
      userId,
    }),
  );
  const now = yield* DateTime.nowAsDate;
  const heldUntil = new Date(now.getTime() + BROWSER_TAKEOVER_HOLD_MS);
  yield* hostedStoreOrUnavailable(takeOverBrowserTab(tab.id, userId, heldUntil, now));
  yield* browserActed(userId, open.agentId, SERVER_AGENT_TOOL.BROWSER);
  return yield* tabAnswer(userId, { agentId: open.agentId }, tab.id);
});

/** The member takes the tab over for the hold, or moves their own takeover on, where they control its agent; a tab another member drives answers them as its driver. */
export const takeOverAgentBrowserTab = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  place: BrowserTabsPlace,
  tabId: string,
) {
  const { tab, agent } = yield* reachedTab(userId, place, tabId);
  if (!controlsAgent(userId, agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  const now = yield* DateTime.nowAsDate;
  const heldUntil = new Date(now.getTime() + BROWSER_TAKEOVER_HOLD_MS);
  // Note that a tab another member drives is answered as it stands, their takeover named, rather than refused.
  const taken = yield* hostedStoreOrUnavailable(takeOverBrowserTab(tab.id, userId, heldUntil, now));
  if (taken) yield* browserActed(userId, agent.id, SERVER_AGENT_TOOL.BROWSER_TAKEOVER);
  return yield* tabAnswer(userId, place, tabId);
});

/** The member hands the tab they drive back to its agent; a tab they do not drive answers as it stands. */
export const handBackAgentBrowserTab = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  place: BrowserTabsPlace,
  tabId: string,
) {
  const { tab, agent } = yield* reachedTab(userId, place, tabId);
  const released = yield* hostedStoreOrUnavailable(handBackBrowserTab(tab.id, userId));
  if (released) yield* browserActed(userId, agent.id, SERVER_AGENT_TOOL.BROWSER_HANDBACK);
  return yield* tabAnswer(userId, place, tabId);
});
