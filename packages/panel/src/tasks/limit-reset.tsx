/**
 * limit-reset.tsx -- the usage-limit notice in an agent's transcript, offering a rate-limit reset credit where its Codex agent waits on its ChatGPT plan's limit.
 *
 * The notice a turn its plan's limit cut short leaves is drawn as every limit
 * notice is (`@repo/ui`'s `UsageLimitNotice`). The one the agent's turn
 * still waits on, a Codex agent's pause until its reset, also asks the
 * service how many reset credits the plan holds (`AGENTS_RESET_CREDITS`) and,
 * where it holds one, offers Use reset with the count. A credit spent is
 * not given back, so a press asks first, in red, as every act that cannot be
 * undone does, and the question goes with the offer. Its yes spends one
 * (`AGENTS_USE_RESET_CREDIT`) on the limit whose reset the notice shows,
 * which the service keys by that limit, so a retry spends no second credit,
 * and the agent carries on as at its reset: its turn's wait clears and the
 * notice gives way to its work. The press stays busy until then, so it is
 * never pressed twice. What spent nothing is said in a toast, and a spend the
 * service did not take in the dialog that asked. The count is asked again
 * each minute the offer stands, so one a read failed to answer comes back
 * without a press. The service offers credits to the agent's starter alone,
 * so a teammate's transcript draws the notice bare.
 */

import { RESET_CREDIT_OUTCOME } from "@repo/features/reset-credit-wire";
import { FAILURE_SURFACE, failureAboutOf } from "@repo/features/shown-failure";
import { ACT_KIND } from "@repo/host/acts";
import {
  CONFIRM_LOSS,
  ConfirmDialog,
  STATUS_TONE,
  UsageLimitNotice,
  useConfirmDialog,
} from "@repo/ui";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { type UsageLimitNotice as Notice, USAGE_LIMIT_AGENT } from "@repo/wire/ui-messages";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Duration } from "effect";
import { createContext, useContext } from "react";
import { askAct } from "../act.js";
import { ANSWER_ACCEPTED, refusedWith, useConfirmAct } from "../confirm-act.js";
import { confirmFailure } from "../failure-report.js";
import { QUERY_ROOT } from "../query-keys.js";
import { showToast } from "../toast.js";

/** How long a count read stands before the notice asks again while it stays on screen, so a read that failed is asked again too. */
const COUNT_STANDS_FOR = Duration.minutes(1);

/** What a spend the service could not take says; a retry sends the same key, so it spends no second credit. */
const NOT_SPENT_WORDS = "Couldn't use a reset credit. Try again.";

/** What the question before a spend says. */
const ASK_WORDS = {
  TITLE: "Use a reset credit?",
  VERB: "Use reset",
  RUNNING: "Using reset",
} as const;

/** What the question's body says the spend takes, by the credits the plan holds. */
function askBody(credits: number): string {
  const of =
    credits === 1 ? "the plan's last reset credit" : `1 of the plan's ${credits} reset credits`;
  return `This spends ${of} to lift the Codex usage limit now, and the agent carries on. A spent credit can't be given back.`;
}

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
    refetchInterval: offered ? Duration.toMillis(COUNT_STANDS_FOR) : false,
    retry: false,
  }).data;
  const spend = useMutation({
    mutationFn: (resetsAt: number) =>
      askAct(ACT_KIND.AGENTS_USE_RESET_CREDIT, { agentId, resetsAt }),
  });
  const available = counted === undefined || "failure" in counted ? 0 : counted.available;
  const resetsAt = notice.resetsAt;
  const spendAct = useConfirmAct(spend, {
    send: () =>
      resetsAt === null
        ? Promise.resolve()
        : spend.mutateAsync(resetsAt).then((answer) => {
            if ("failure" in answer || answer.resumed) return;
            if (answer.outcome in SPENT_NOTHING_WORDS) {
              const outcome = answer.outcome as keyof typeof SPENT_NOTHING_WORDS;
              showToast({
                words: SPENT_NOTHING_WORDS[outcome],
                replayUnmasked: true,
                tone: STATUS_TONE.ATTENTION,
              });
            }
          }),
    answered: (answer) =>
      "failure" in answer
        ? { status: ACTION_RESULT_STATUS.REJECTED, reason: NOT_SPENT_WORDS }
        : ANSWER_ACCEPTED,
    failed: refusedWith,
  });
  const asked = useConfirmDialog(
    { subject: offered && available > 0, surfaceOpen: true },
    spendAct,
    confirmFailure(FAILURE_SURFACE.ACT, failureAboutOf({ agentId })),
  );
  // Note that a spend that carried the agent on stays busy until the notice gives way, so a second press never lands on a lifted limit.
  const carried = spend.data !== undefined && !("failure" in spend.data) && spend.data.resumed;
  const reset =
    offered && available > 0
      ? { credits: available, use: asked.ask, busy: spend.isPending || carried }
      : undefined;
  return (
    <>
      <UsageLimitNotice notice={notice} reset={reset} />
      <ConfirmDialog
        open
        confirm={asked}
        question={{
          title: ASK_WORDS.TITLE,
          replayUnmasked: true,
          body: askBody(available),
          verb: ASK_WORDS.VERB,
          running: ASK_WORDS.RUNNING,
          loss: CONFIRM_LOSS.IRREVERSIBLE,
        }}
      />
    </>
  );
}
