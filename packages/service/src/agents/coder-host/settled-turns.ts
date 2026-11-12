/**
 * settled-turns.ts -- what hears of each coding agent turn the store writer settles, wherever it was settled: the deployment's count of it, the report to the agent's starter, the turn on Slack, an automation run's result or a reply in its agent's thread, the push of a failed one to its member's phone, their Live Activity, the archive of a finished automation run, and the agent's queue handed on.
 *
 * The writer tells its `SettledTurnListener` once the settle's transaction
 * is done (`@repo/database/models/writer`), whichever path settled the turn:
 * the relay's or a runner's own end, a Stop, a lost session's, or the
 * sweep's abandon. This is the one listener the deployment provides
 * (`../../runtime.ts`), and it does seven things with each turn: counts it
 * (`../../events/server-events.ts`), hands its final message to the agent
 * that started it, where one did (`starter-report.ts`), and posts it on
 * Slack, as a DM of an automation run's result to its owner where the run's
 * automation asks for it, or else in the agent's current Slack thread,
 * where one speaks for it (`../../slack/slack-agent-starts.ts`), pushes a
 * failed one to the phones of the member who started the agent
 * (`../../push/inbox-pushes.ts`), refreshes that member's Live Activity,
 * which ends once none of their agents runs (`../../push/live-activities.ts`), and archives the automation run the agent belongs to where its last agent
 * finished well (`../../automations/run-archive.ts`), and hands on the
 * agent's queue, or pauses it where the turn failed (`agent-queue.ts`), so a
 * queue goes on however its turn ended. Each runs
 * once the request has answered, where the runtime runs work past the
 * answer, since none is the settle's to wait on; and the report, the
 * Slack message, the push, and the archive run on the pool rather than on a
 * transaction the settle may have run inside, so their sends hold no
 * transaction open over a harness or Slack. Note that the work may start
 * before such a transaction commits, so
 * a caller that runs the writer inside its own tells this listener only once
 * it has (`../native-events/runner-events-app.ts`), and the reads here see
 * the settle committed. The queue's hand-on reads the turn's row again
 * rather than the status heard, so a settle rolled back hands on nothing.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { type SettledAgentTurn, SettledTurnListener } from "@repo/database/models/writer";
import type { Sandbox } from "@repo/sandbox";
import { Context, Effect, Layer, Option } from "effect";
import type { HttpClient } from "effect/http";
import { SqlClient } from "effect/sql";
import { reconsiderRunArchiveAfterTurn } from "../../automations/run-archive.js";
import type { HostedEnvironment } from "../../environment.js";
import { turnEndCounted } from "../../events/server-events.js";
import type { GitHubApp } from "../../github/github-app.js";
import { afterResponse } from "../../http/after-response.js";
import { ApnsSender } from "../../push/apns.js";
import { pushFailedTurn } from "../../push/inbox-pushes.js";
import { LIVE_ACTIVITY_CAUSE, refreshLiveActivity } from "../../push/live-activities.js";
import { postTurnToSlack } from "../../slack/slack-agent-starts.js";
import type { SlackBot } from "../../slack/slack-bot.js";
import { queueAfterSettle } from "./agent-queue.js";
import { routedSessions } from "./runtime-sessions.js";
import { reportToStarter } from "./starter-report.js";

/** The work run on the pool rather than on a transaction the settle ran inside, which has ended by the time the answer has left. */
export const outsideTransaction = <A, E>(
  work: Effect.Effect<A, E, DatabaseServices>,
): Effect.Effect<A, E, DatabaseServices> =>
  Effect.flatMap(SqlClient.SqlClient, (client) =>
    Effect.updateContext(work, (context: Context.Context<DatabaseServices>) =>
      Context.omit(client.transactionService)(context),
    ),
  );

/**
 * The deployment's listener over the services the report sends through,
 * read once as the layer is built: the agents' sessions as the deployment acting for the
 * agent's account, GitHub, which a send to an agent on a repository asks
 * whether its starter still reaches it, and the workspace's Slack bot; and
 * the deployment's APNs sender where the layer is built over one, read
 * optionally, so a runtime without one pushes nothing.
 */
export const settledTurnListener: Layer.Layer<
  SettledTurnListener,
  never,
  HttpClient.HttpClient | GitHubApp | HostedEnvironment | SlackBot | Sandbox
> = Layer.effect(
  SettledTurnListener,
  Effect.gen(function* () {
    const reach = yield* Effect.context<
      HttpClient.HttpClient | GitHubApp | HostedEnvironment | SlackBot | Sandbox
    >();

    const apns = yield* Effect.serviceOption(ApnsSender);

    const reported = (turn: SettledAgentTurn) =>
      afterResponse(
        "a started agent's final message",
        reportToStarter(routedSessions, turn).pipe(
          Effect.provideContext(reach),
          outsideTransaction,
        ),
      );

    const posted = (turn: SettledAgentTurn) =>
      afterResponse(
        "an agent's turn on Slack",
        postTurnToSlack(turn).pipe(Effect.provideContext(reach), outsideTransaction),
      );

    const pushed = (turn: SettledAgentTurn) =>
      afterResponse(
        "a failed turn's push",
        Option.match(apns, {
          onNone: () => Effect.void,
          onSome: (sender) =>
            outsideTransaction(
              pushFailedTurn(turn).pipe(Effect.provideService(ApnsSender, sender)),
            ),
        }),
      );

    const refreshed = (turn: SettledAgentTurn) =>
      afterResponse(
        "a settled turn's live activity",
        Option.match(apns, {
          onNone: () => Effect.void,
          onSome: (sender) =>
            outsideTransaction(
              refreshLiveActivity(turn.userId, LIVE_ACTIVITY_CAUSE.ROUTINE).pipe(
                Effect.provideService(ApnsSender, sender),
              ),
            ),
        }),
      );

    const archived = (turn: SettledAgentTurn) =>
      afterResponse(
        "a finished automation run's archive",
        outsideTransaction(reconsiderRunArchiveAfterTurn(turn)),
      );

    const handedOn = (turn: SettledAgentTurn) =>
      afterResponse(
        "a coding agent's queue",
        queueAfterSettle(turn).pipe(Effect.provideContext(reach), outsideTransaction),
      );

    return {
      heard: (turn) =>
        Effect.all(
          [
            turnEndCounted(turn),
            reported(turn),
            posted(turn),
            pushed(turn),
            refreshed(turn),
            archived(turn),
            handedOn(turn),
          ],
          { discard: true },
        ),
    };
  }),
);
