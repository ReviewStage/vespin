/**
 * limit-reset.tsx -- the usage-limit notice in an agent's transcript, offering a rate-limit reset credit where its Codex agent waits on its ChatGPT plan's limit.
 *
 * The notice a turn its plan's limit cut short leaves is drawn as every limit
 * notice is (`@repo/ui`'s `UsageLimitNotice`). The one the agent's turn
 * still waits on, a Codex agent's pause until its reset, also asks the
 * service how many reset credits the plan holds (`AGENTS_RESET_CREDITS`) and,
 * where it holds one, offers Use reset with the count. A press spends one
 * (`AGENTS_USE_RESET_CREDIT`), which the service keys by the limit, so a
 * retry spends no second credit, and the agent carries on as at its reset:
 * its turn's wait clears and the notice gives way to its work. The press stays
 * busy until then, so it is never pressed twice. What spent nothing is said
 * in a toast. The service offers credits to the agent's starter alone, so a
 * teammate's transcript draws the notice bare.
 */

import { RESET_CREDIT_OUTCOME } from "@repo/features/reset-credit-wire";
import { FAILURE_SURFACE, failureAboutOf } from "@repo/features/shown-failure";
import { ACT_KIND } from "@repo/host/acts";
import { STATUS_TONE, UsageLimitNotice } from "@repo/ui";
import { type UsageLimitNotice as Notice, USAGE_LIMIT_AGENT } from "@repo/wire/ui-messages";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Duration } from "effect";
import { createContext, useContext } from "react";
import { askAct, toastActFailure } from "../act.js";
import { QUERY_ROOT } from "../query-keys.js";
import { showToast } from "../toast.js";

/** How long a count read stands before the notice asks again, while it stays on screen. */
const COUNT_STANDS_FOR = Duration.minutes(1);

/** What a spend the service could not take says; a retry sends the same key, so it spends no second credit. */
const NOT_SPENT_WORDS = "Couldn't use a reset credit. Try again.";

/** What a spend that lifted nothing says. */
const SPENT_NOTHING_WORDS = {
  [RESET_CREDIT_OUTCOME.NO_CREDIT]: "No reset credits left on this plan",
  [RESET_CREDIT_OUTCOME.NOTHING_TO_RESET]: "Nothing to reset right now",
} as const;

/** The agent whose transcript is drawn and the reset its turn waits on, where it waits on one; none otherwise. */
export interface WaitingLimit {
  readonly agentId: string;
  readonly waitsUntil: number;
}

/** The limit the drawn agent's turn waits on, which the transcript's root provides. */
export const WaitingLimitContext = createContext<WaitingLimit | undefined>(undefined);

/** The limit notice a transcript part draws, offering a reset credit where it is the Codex pause the agent waits on. */
export function TranscriptUsageLimitNotice({ notice }: { notice: Notice }): React.JSX.Element {
  const waiting = useContext(WaitingLimitContext);
  const agentId = waiting?.agentId ?? "";
  const offered =
    waiting !== undefined &&
    notice.agent === USAGE_LIMIT_AGENT.CODEX &&
    notice.resetsAt !== null &&
    notice.resetsAt === waiting.waitsUntil;
  const counted = useQuery({
    queryKey: [QUERY_ROOT.AGENT_RESET_CREDITS, agentId, notice.resetsAt],
    queryFn: () => askAct(ACT_KIND.AGENTS_RESET_CREDITS, { agentId }),
    enabled: offered,
    staleTime: Duration.toMillis(COUNT_STANDS_FOR),
    retry: false,
  }).data;
  const spend = useMutation({
    mutationFn: () => askAct(ACT_KIND.AGENTS_USE_RESET_CREDIT, { agentId }),
    onSuccess: (answer) => {
      if ("failure" in answer) {
        showToast({
          words: NOT_SPENT_WORDS,
          replayUnmasked: true,
          tone: STATUS_TONE.DANGER,
          failure: {
            surface: FAILURE_SURFACE.ACT,
            act: ACT_KIND.AGENTS_USE_RESET_CREDIT,
            cause: answer,
            about: failureAboutOf({ agentId }),
          },
        });
        return;
      }
      if (answer.resumed) return;
      if (answer.outcome in SPENT_NOTHING_WORDS) {
        const outcome = answer.outcome as keyof typeof SPENT_NOTHING_WORDS;
        showToast({
          words: SPENT_NOTHING_WORDS[outcome],
          replayUnmasked: true,
          tone: STATUS_TONE.ATTENTION,
        });
      }
    },
    onError: (cause: unknown) =>
      toastActFailure({
        surface: FAILURE_SURFACE.ACT,
        act: ACT_KIND.AGENTS_USE_RESET_CREDIT,
        cause,
        about: failureAboutOf({ agentId }),
      }),
  });
  const available = counted === undefined || "failure" in counted ? 0 : counted.available;
  // Note that a spend that carried the agent on stays busy until the notice gives way, so a second press never lands on a lifted limit.
  const carried = spend.data !== undefined && !("failure" in spend.data) && spend.data.resumed;
  const reset =
    offered && available > 0
      ? { credits: available, use: () => spend.mutate(), busy: spend.isPending || carried }
      : undefined;
  return <UsageLimitNotice notice={notice} reset={reset} />;
}
