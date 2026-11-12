/**
 * reset-credit.tsx -- one of a ChatGPT plan's rate-limit reset credits spent, asked first, from Settings or from a Codex agent's limit notice.
 *
 * Settings › Agents offers a plan's credits under its usage as one press,
 * Use reset, or Use 1 of 3 resets where it holds more, at any usage, as
 * Codex's own `/usage` offers them; its card lists when each expires, the
 * one used next first. A Codex agent's pause on that plan offers the same
 * press on its notice. A spent credit is not given back, so either press
 * asks first, in red, through the one dialog here, which lists them too. Its
 * yes spends the soonest (`PROVIDER_KEYS_USE_RESET_CREDIT`) under a key
 * minted for the press and sent again on a retry, so ChatGPT spends one
 * credit for it; the keys it answers lift the plan's limit everywhere, and
 * the agents it pays for carry on.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import {
  PROVIDER_KEY_KIND,
  RESET_CREDIT_OUTCOME,
  type SubscriptionKeySummary,
} from "@repo/features/provider-key-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { dateOfText } from "@repo/features/time-format";
import { ACT_KIND } from "@repo/host/acts";
import {
  CONFIRM_LOSS,
  ConfirmDialog,
  HoverCard,
  HoverCardHead,
  HoverCardList,
  HoverCardNote,
  HoverCardRow,
  HoverCardRule,
  UsageLimitNotice,
  useConfirmDialog,
} from "@repo/ui";
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
  VERB: "Use reset",
  RUNNING: "Using reset",
  NOT_SPENT: "Couldn't use a reset. Try again.",
  NO_CREDIT: "That reset is no longer available.",
  EACH: "Each resets your 5-hour and weekly limits.",
  USED_NEXT: "Used next",
  NO_EXPIRY: "Doesn't expire",
  LISTED: "Resets",
} as const;

/** The press, and the question it asks: "Use reset" for one, "Use 1 of 3 resets" for more. */
function pressWords(credits: number): string {
  return credits === 1 ? WORDS.VERB : `Use 1 of ${credits} resets`;
}

/** Whether the plan offers a credit: a ChatGPT plan that holds one. */
function offers(plan: SubscriptionKeySummary | undefined): plan is SubscriptionKeySummary {
  return (
    plan !== undefined &&
    plan.kind === PROVIDER_KEY_KIND.CHATGPT_OAUTH &&
    (plan.resetCredits ?? 0) > 0
  );
}

/** The plan's listed credits, each by when it expires, the one a spend uses first; nothing where ChatGPT listed none. */
function ResetCreditRows({ plan }: { plan: SubscriptionKeySummary }): React.JSX.Element | null {
  const expiries = plan.resetCreditExpiries;

  if (expiries === undefined || expiries.length === 0) return null;
  const now = Date.now();

  return (
    <HoverCardList label={WORDS.LISTED}>
      {expiries.map((at, index) => (
        // Note that two credits may expire at once, so a row is keyed by its place.
        <li key={index}>
          <HoverCardRow
            label={at === null ? WORDS.NO_EXPIRY : `Expires ${dateOfText(at, now)}`}
            end={index === 0 && expiries.length > 1 ? WORDS.USED_NEXT : undefined}
          />
        </li>
      ))}
    </HoverCardList>
  );
}

/** What a plan's Use reset hangs: how many it holds, on which account, what one does, and when each expires. */
export function ResetCreditCard({ plan }: { plan: SubscriptionKeySummary }): React.JSX.Element {
  const credits = plan.resetCredits ?? 0;
  const listed = (plan.resetCreditExpiries?.length ?? 0) > 0;

  return (
    <HoverCard>
      <HoverCardHead
        name={credits === 1 ? "1 reset" : `${credits} resets`}
        sub={plan.label ?? plan.email}
      />
      <HoverCardNote>{WORDS.EACH}</HoverCardNote>
      {listed ? <HoverCardRule /> : null}
      <ResetCreditRows plan={plan} />
    </HoverCard>
  );
}

/** A credit offered on a plan: the press's words, the press that asks, and the dialog that asks it, which its caller draws. */
export interface ResetCreditOffer {
  readonly words: string;
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
  const words = pressWords(plan.resetCredits ?? 0);

  return {
    words,
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
          title: `${words}?`,
          replayUnmasked: true,
          body: `Resets the 5-hour and weekly limits on ${plan.label ?? plan.email ?? "this plan"}.`,
          bodyReplayMasked: true,
          verb: WORDS.VERB,
          running: WORDS.RUNNING,
          loss: CONFIRM_LOSS.IRREVERSIBLE,
        }}
      >
        <ResetCreditRows plan={plan} />
      </ConfirmDialog>
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
