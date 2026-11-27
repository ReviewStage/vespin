/**
 * usage-limit-words.ts -- what the notice an agent's transcript keeps where it reached its usage limit says, and the reset credit its pause offers.
 *
 * The panel's card (`@repo/ui`'s `usage-limit-notice.tsx`, offered its
 * Use reset by `@repo/panel`'s `reset-credit.tsx`) and the iOS app's
 * transcript both say them through this, so a limit reads the same, and is
 * offered a reset in the same place, wherever it is drawn.
 */
import { USAGE_LIMIT_AGENT, type UsageLimitNotice } from "@repo/wire/ui-messages";
import { PROVIDER_KEY_KIND, type SubscriptionKeySummary } from "./provider-key-wire.js";
import { dueText } from "./time-format.js";

/** What a reset credit's press, its question, and its refusals say. */
export const RESET_CREDIT_WORDS = {
  VERB: "Use reset",
  RUNNING: "Using reset",
  NOT_SPENT: "Couldn't use a reset. Try again.",
  NO_CREDIT: "That reset is no longer available.",
} as const;

/** What the notice's title says: the agent's limit reached, on the plan or key it ran out on where it moved on. */
export function usageLimitTitle(notice: UsageLimitNotice): string {
  const on = notice.moved === undefined ? "" : ` on ${notice.moved.from}`;

  return `${notice.agent} usage limit reached${on}`;
}

/** What the notice's muted line says: the payer the turn went on with, when it resumes, or that it waits on the reader. */
export function usageLimitNext(notice: UsageLimitNotice, now: number = Date.now()): string {
  if (notice.moved !== undefined) return `Continuing on ${notice.moved.to}`;

  if (notice.resetsAt === null) return "Send a message to continue";

  return `Resumes at ${dueText(notice.resetsAt, now)}`;
}

/** Whether the notice is a Codex pause still standing, the one a reset credit on its plan is offered on. */
export function usageLimitPauseStanding(
  notice: UsageLimitNotice,
  now: number = Date.now(),
): boolean {
  return (
    notice.agent === USAGE_LIMIT_AGENT.CODEX && notice.resetsAt !== null && notice.resetsAt > now
  );
}

/** Whether the plan offers a reset credit: a ChatGPT plan that holds one. */
export function offersResetCredit(
  plan: SubscriptionKeySummary | undefined,
): plan is SubscriptionKeySummary {
  return (
    plan !== undefined &&
    plan.kind === PROVIDER_KEY_KIND.CHATGPT_OAUTH &&
    (plan.resetCredits ?? 0) > 0
  );
}

/** The press, and the question it asks: "Use reset" for one, "Use 1 of 3 resets" for more. */
export function resetCreditPressWords(credits: number): string {
  return credits === 1 ? RESET_CREDIT_WORDS.VERB : `Use 1 of ${credits} resets`;
}

/** What the question a reset credit's press asks first says under its title. */
export function resetCreditQuestionBody(plan: SubscriptionKeySummary): string {
  return `Resets the 5-hour and weekly limits on ${plan.label ?? plan.email ?? "this plan"}.`;
}
