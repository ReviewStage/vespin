// use-reset-credit.tsx -- a Codex agent's usage-limit pause offering a rate-limit reset credit on the plan it runs on, asked first and spent under one key a press, as the panel's notice offers it (`@repo/panel`'s `reset-credit.tsx`).

import { RESET_CREDIT_OUTCOME } from "@repo/features/provider-key-wire";
import {
  offersResetCredit,
  RESET_CREDIT_WORDS,
  resetCreditPressWords,
  resetCreditQuestionBody,
} from "@repo/features/usage-limit-words";
import { ACT_KIND } from "@repo/host/acts";
import { BUZZ, ConfirmAsk, type UsageLimitReset } from "@repo/ui-native";
import { randomUUID } from "expo-crypto";
import { type ReactElement, useState } from "react";
import { useAgentKeys } from "../agent-keys/agent-keys.js";
import { useHostActs } from "../host/host-provider.js";
import { useWrite } from "../use-write.js";

/** The press a pause's notice draws, and the question it asks first, which the screen draws beside its page. */
interface ResetCreditOffer {
  readonly reset: UsageLimitReset | undefined;
  readonly ask: ReactElement | null;
}

/** The question a press opened, bound to the plan it names, so a payer that moves while it stands never has its yes spend another plan's credit. */
interface AskedSpend {
  readonly subscriptionId: string;
  readonly words: string;
  readonly body: string;
  /** Minted once a press, so the notice's Try again sends the same one and ChatGPT spends one credit for it. */
  readonly idempotencyKey: string;
}

/**
 * The reset credit the agent's plan offers, by the plan's id, read only
 * while the transcript holds a pause that could offer it (`wanted`): the
 * reader's own ChatGPT plan of that id, holding one. Its press asks first,
 * in red, since a credit spent is not given back, naming the plan as it
 * stood at the press; its yes spends the soonest credit of that plan.
 */
export function useResetCredit(planId: string | undefined, wanted: boolean): ResetCreditOffer {
  const acts = useHostActs();
  const write = useWrite();
  const keys = useAgentKeys(wanted && planId !== undefined).answer;

  const plan =
    planId === undefined ? undefined : keys?.subscriptions?.find((one) => one.id === planId);

  const [asked, setAsked] = useState<AskedSpend | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const spend = ({ subscriptionId, idempotencyKey }: AskedSpend) => {
    setBusy(true);
    void write(
      () => acts[ACT_KIND.PROVIDER_KEYS_USE_RESET_CREDIT]({ subscriptionId, idempotencyKey }),
      {
        refused: (answer) =>
          "failure" in answer || answer.resetCredit === undefined
            ? RESET_CREDIT_WORDS.NOT_SPENT
            : answer.resetCredit === RESET_CREDIT_OUTCOME.NO_CREDIT
              ? RESET_CREDIT_WORDS.NO_CREDIT
              : undefined,
        retry: (answer) =>
          !("resetCredit" in answer) || answer.resetCredit !== RESET_CREDIT_OUTCOME.NO_CREDIT,
        went: BUZZ.SUCCESS,
      },
    ).finally(() => setBusy(false));
  };

  // Note that a question already open stands on the plan it named, whatever the offer reads since.
  const ask =
    asked === undefined ? null : (
      <ConfirmAsk
        title={`${asked.words}?`}
        message={asked.body}
        act={RESET_CREDIT_WORDS.VERB}
        destructive
        presented
        onAct={() => {
          setAsked(undefined);
          spend(asked);
        }}
        onDismiss={() => setAsked(undefined)}
      />
    );

  if (!wanted || !offersResetCredit(plan)) return { reset: undefined, ask };
  const words = resetCreditPressWords(plan.resetCredits ?? 0);

  return {
    reset: {
      words,
      running: RESET_CREDIT_WORDS.RUNNING,
      busy,
      use: () =>
        setAsked({
          subscriptionId: plan.id,
          words,
          body: resetCreditQuestionBody(plan),
          idempotencyKey: randomUUID(),
        }),
    },
    ask,
  };
}
