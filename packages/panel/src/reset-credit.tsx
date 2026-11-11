/**
 * reset-credit.tsx -- one of a ChatGPT plan's rate-limit reset credits spent, asked first, from Settings or from a Codex agent's limit notice.
 *
 * Settings › Agents counts a plan's credits under its usage, and offers Use
 * reset while the plan is at its limit; a Codex agent's pause on that plan
 * offers the same press on its notice. A spent credit is not given back, so
 * either press asks first, in red, through the one dialog here. Its yes
 * spends one (`PROVIDER_KEYS_USE_RESET_CREDIT`) under a key minted for the
 * press and sent again on a retry, so ChatGPT spends one credit for it; the
 * keys it answers lift the plan's limit everywhere, and the agents it pays
 * for carry on.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_STATUS,
  RESET_CREDIT_OUTCOME,
  type SubscriptionKeySummary,
} from "@repo/features/provider-key-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { ACT_KIND } from "@repo/host/acts";
import { CONFIRM_LOSS, ConfirmDialog, UsageLimitNotice, useConfirmDialog } from "@repo/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { type UsageLimitNotice as Notice, USAGE_LIMIT_AGENT } from "@repo/wire/ui-messages";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useRef } from "react";
import { askAct } from "./act.js";
import { ANSWER_ACCEPTED, refusedWith, useConfirmAct } from "./confirm-act.js";
import { confirmFailure } from "./failure-report.js";
import { providerKeysQuery } from "./live-reads.js";
import { TranscriptAgent } from "./tasks/line-cards.js";
import { appStateQuery, selectAccount } from "./use-app-state.js";

const WORDS = {
  TITLE: "Use a reset credit?",
  VERB: "Use reset",
  RUNNING: "Using reset",
  NOT_SPENT: "Couldn't use a reset credit. Try again.",
  NO_CREDIT: "No reset credits left on this plan.",
} as const;

/** How a plan's credits are counted. */
export function resetCreditWords(credits: number): string {
  return credits === 1 ? "1 reset credit" : `${credits} reset credits`;
}

/** What the question says the spend takes. */
function askBody(credits: number): string {
  const of =
    credits === 1 ? "the plan's last reset credit" : `1 of the plan's ${credits} reset credits`;
  return `This spends ${of} to lift the Codex usage limit now, and its agents carry on. A spent credit can't be given back.`;
}

/** Whether the plan offers a credit: a ChatGPT plan at its limit that holds one. */
function offers(plan: SubscriptionKeySummary | undefined): plan is SubscriptionKeySummary {
  return (
    plan !== undefined &&
    plan.kind === PROVIDER_KEY_KIND.CHATGPT_OAUTH &&
    plan.status === PROVIDER_KEY_STATUS.LIMIT_REACHED &&
    (plan.resetCredits ?? 0) > 0
  );
}

/** A credit offered on a plan: the press that asks, and the dialog that asks it, which its caller draws. */
export interface ResetCreditOffer {
  readonly credits: number;
  readonly use: () => void;
  readonly busy: boolean;
  readonly dialog: ReactNode;
}

/** The plan's credit offered, asked first, and spent under one key a press; none where it offers none. */
export function useResetCreditOffer(
  plan: SubscriptionKeySummary | undefined,
): ResetCreditOffer | undefined {
  const offered = offers(plan);
  const key = useRef("");
  const spend = useMutation({
    mutationFn: (subscriptionId: string) =>
      askAct(ACT_KIND.PROVIDER_KEYS_USE_RESET_CREDIT, {
        subscriptionId,
        idempotencyKey: key.current,
      }),
  });
  const act = useConfirmAct(spend, {
    send: () => (plan?.id === undefined ? Promise.resolve() : spend.mutateAsync(plan.id)),
    answered: (answer): ActionResult =>
      "failure" in answer || answer.resetCredit === undefined
        ? { status: ACTION_RESULT_STATUS.REJECTED, reason: WORDS.NOT_SPENT }
        : answer.resetCredit === RESET_CREDIT_OUTCOME.NO_CREDIT
          ? { status: ACTION_RESULT_STATUS.REJECTED, reason: WORDS.NO_CREDIT }
          : ANSWER_ACCEPTED,
    failed: refusedWith,
  });
  const asked = useConfirmDialog(
    { subject: offered, surfaceOpen: true },
    act,
    confirmFailure(FAILURE_SURFACE.ACT),
  );
  if (!offered) return undefined;
  const credits = plan.resetCredits ?? 0;
  return {
    credits,
    busy: asked.busy,
    use: () => {
      // Note that the key is minted once a press, so the dialog's retry sends the same one.
      key.current = crypto.randomUUID();
      asked.ask();
    },
    dialog: (
      <ConfirmDialog
        open
        confirm={asked}
        question={{
          title: WORDS.TITLE,
          replayUnmasked: true,
          body: askBody(credits),
          verb: WORDS.VERB,
          running: WORDS.RUNNING,
          loss: CONFIRM_LOSS.IRREVERSIBLE,
        }}
      />
    ),
  };
}

/** The reader's own plan of this id, from their keys; none for another's. */
function useOwnPlan(planId: string | undefined): SubscriptionKeySummary | undefined {
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const keys = useQuery(providerKeysQuery(accountId)).data;
  return planId === undefined ? undefined : keys?.subscriptions?.find((one) => one.id === planId);
}

/** The plan the drawn agent runs on, which its pause's notice offers a credit on. */
const TranscriptPlan = createContext<string | undefined>(undefined);

/** A transcript's agent and the plan it runs on, for the rows drawn under it. */
export function TranscriptAgentOn({
  agentId,
  planId,
  children,
}: {
  agentId: string | undefined;
  planId: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <TranscriptAgent value={agentId}>
      <TranscriptPlan value={planId}>{children}</TranscriptPlan>
    </TranscriptAgent>
  );
}

/** A limit notice in a transcript, offering a credit where it is a Codex pause still standing on the reader's own plan. */
export function TranscriptUsageLimitNotice({ notice }: { notice: Notice }): React.JSX.Element {
  const plan = useOwnPlan(useContext(TranscriptPlan));
  const pause =
    notice.agent === USAGE_LIMIT_AGENT.CODEX &&
    notice.resetsAt !== null &&
    notice.resetsAt > Date.now();
  const offer = useResetCreditOffer(pause ? plan : undefined);
  return (
    <>
      <UsageLimitNotice notice={notice} reset={offer} />
      {offer?.dialog}
    </>
  );
}
