/**
 * agent-browser-tabs-procedures.ts -- the Browser tabs open in coding agents' browsers, for a member's window: list one agent's or a task's, open one in an agent's browser, and take one over and hand it back.
 *
 * Each procedure is a door over the one operation (`agent-browser-tabs.ts`),
 * which the member MCP server's browser tab tools run too.
 * `GET /api/agents/{id}/browser-tabs` lists one agent's tabs, and
 * `GET /api/plans/{id}/browser-tabs` a task's, every one of
 * its agents' together, each with the coding agent whose browser holds it,
 * and the member driving it while their takeover stands. `POST
 * /api/agents/{id}/browser-tabs/{tab}/driver`, or the same under
 * `/api/plans/{id}`, takes the tab over for `BROWSER_TAKEOVER_HOLD_MS`, or
 * moves the member's own takeover on by as much, so a window that went away
 * leaves the tab to its agent once that passes; `DELETE` hands it back. Each
 * answers the tab as it then stands, so a tab another member drives answers
 * them as its driver.
 *
 * `POST /api/agents/{id}/browser-tabs` opens a page at an http or https
 * address in the agent's browser, and `POST /api/plans/{id}/browser-tabs`
 * in the browser of a coding agent on the task, as a member does to
 * sign in somewhere for it: the browser is reached through
 * `connectRestoring`, which resumes a stopped sandbox and reopens its kept
 * tabs; and the tab is kept with the member as its opener and taken over
 * for them at once, so the agent does not act on it until they hand it
 * back. An agent that has opened no sandbox yet is refused as not ready, as
 * is one whose sandbox is made again on an image Vercel still prepares,
 * which opens after the answer rather than holding it past its client's
 * deadline; a browser that could not be reached is the upstream's refusal; the
 * address is never logged, a failure only by its kind.
 *
 * Who reaches a tab is the rule a whole agent is read by: a member who sees
 * the coding agent whose browser holds it and, for one on a task, that task
 * too (`agentVisibleTo`, `@repo/database/models/agent-browser-tabs`),
 * whether the path names the agent or the task; any other reads as not
 * found. A desktop built
 * before the agent's paths still names the task, which answers as it did. Driving a tab acts in the agent's browser, so it is held to who
 * controls the agent (`controlsAgent`): its starter alone for one on the
 * starter's own GitHub token. The agents' own writes go through the store
 * from inside the service and have no route here.
 */

import type { BrowserTabsPlace } from "@repo/features/agent-browser-tab-wire";
import type { Sandbox } from "@repo/sandbox";
import { Effect, type Layer } from "effect";
import type { HttpClient } from "effect/http";
import { pathUuid, type UserIdResolver } from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import {
  handBackAgentBrowserTab,
  listAgentBrowserTabs,
  openAgentBrowserTab,
  takeOverAgentBrowserTab,
} from "./agent-browser-tabs.js";
import type { AgentBrowser } from "./browser/agent-browser.js";

export interface AgentBrowserTabsProcedureSeams {
  resolveUserId: UserIdResolver;
  /** The agents' browsers as an open reaches them: Vercel's sandboxes in production, a script's in a test. */
  readonly agentBrowser: Layer.Layer<AgentBrowser, never, HttpClient.HttpClient | Sandbox>;
}

/** The holder and the tab a driver's path names, read as ids, the holder as the place given; not found for one that is no UUID. */
const tabPath = /* @__PURE__ */ Effect.fnUntraced(function* (
  params: { readonly id: string; readonly tab: string },
  placeOf: (id: string) => BrowserTabsPlace,
) {
  return { place: placeOf(yield* pathUuid(params.id)), tabId: yield* pathUuid(params.tab) };
});

const taskPlace = (taskId: string): BrowserTabsPlace => ({ taskId });

const agentPlace = (agentId: string): BrowserTabsPlace => ({ agentId });

/** The Browser tabs resource: an agent's or a task's tabs, an open, a takeover, and a hand-back, each to a signed-in member who reaches them. */
export function agentBrowserTabsProcedures(seams: AgentBrowserTabsProcedureSeams) {
  const member = hosted.agentBrowserTabs.use(accountMiddleware(seams.resolveUserId));
  return {
    agentList: member.agentList.effect(function* ({ input, context }) {
      return yield* listAgentBrowserTabs(context.userId, agentPlace(yield* pathUuid(input.id)));
    }),
    list: member.list.effect(function* ({ input, context }) {
      return yield* listAgentBrowserTabs(context.userId, taskPlace(yield* pathUuid(input.id)));
    }),
    agentOpen: member.agentOpen.effect(function* ({ input, context }) {
      const agentId = yield* pathUuid(input.params.id);
      return yield* Effect.provide(
        openAgentBrowserTab(context.userId, { agentId, address: input.body.address }),
        seams.agentBrowser,
      );
    }),
    open: member.open.effect(function* ({ input, context }) {
      const taskId = yield* pathUuid(input.params.id);
      return yield* Effect.provide(
        openAgentBrowserTab(context.userId, { ...input.body, taskId }),
        seams.agentBrowser,
      );
    }),
    agentTakeOver: member.agentTakeOver.effect(function* ({ input, context }) {
      const { place, tabId } = yield* tabPath(input, agentPlace);
      return yield* takeOverAgentBrowserTab(context.userId, place, tabId);
    }),
    takeOver: member.takeOver.effect(function* ({ input, context }) {
      const { place, tabId } = yield* tabPath(input, taskPlace);
      return yield* takeOverAgentBrowserTab(context.userId, place, tabId);
    }),
    agentHandBack: member.agentHandBack.effect(function* ({ input, context }) {
      const { place, tabId } = yield* tabPath(input, agentPlace);
      return yield* handBackAgentBrowserTab(context.userId, place, tabId);
    }),
    handBack: member.handBack.effect(function* ({ input, context }) {
      const { place, tabId } = yield* tabPath(input, taskPlace);
      return yield* handBackAgentBrowserTab(context.userId, place, tabId);
    }),
  };
}
