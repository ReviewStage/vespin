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
import { type ReactElement, useRef, useState } from "react";
import { useAgentKeys } from "../agent-keys/agent-keys.js";
import { useHostActs } from "../host/host-provider.js";
import { useWrite } from "../use-write.js";

/** The press a pause's notice draws, and the question it asks first, which the screen draws beside its page. */
interface ResetCreditOffer {
  readonly reset: UsageLimitReset | undefined;
  readonly ask: ReactElement | null;
}

/**
 * The reset credit the agent's plan offers, by the plan's id, read only
 * while the transcript holds a pause that could offer it (`wanted`): the
 * reader's own ChatGPT plan of that id, holding one. Its press asks first,
 * in red, since a credit spent is not given back; its yes spends the
 * soonest under a key minted for the press, which a Try again sends again,
 * so ChatGPT spends one credit for it.
 */
export function useResetCredit(planId: string | undefined, wanted: boolean): ResetCreditOffer {
  const acts = useHostActs();
  const write = useWrite();
  const keys = useAgentKeys(wanted && planId !== undefined).answer;

  const plan =
    planId === undefined ? undefined : keys?.subscriptions?.find((one) => one.id === planId);

  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = useRef("");

  if (!wanted || !offersResetCredit(plan)) return { reset: undefined, ask: null };
  const words = resetCreditPressWords(plan.resetCredits ?? 0);
  const subscriptionId = plan.id;

  const spend = () => {
    const idempotencyKey = key.current;
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

  return {
    reset: {
      words,
      running: RESET_CREDIT_WORDS.RUNNING,
      busy,
      use: () => {
        // Note that the key is minted once a press, so the notice's Try again sends the same one.
        key.current = randomUUID();
        setAsking(true);
      },
    },
    ask: (
      <ConfirmAsk
        title={`${words}?`}
        message={resetCreditQuestionBody(plan)}
        act={RESET_CREDIT_WORDS.VERB}
        destructive
        presented={asking}
        onAct={() => {
          setAsking(false);
          spend();
        }}
        onDismiss={() => setAsking(false)}
      />
    ),
  };
}
