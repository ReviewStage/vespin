/**
 * agent-end-row.tsx -- the line a transcript ends on once its turn was stopped or failed, said once as it lands, and the Try again its row may offer.
 */

import {
  type EndLineParts,
  TRY_AGAIN_LABEL,
  TRYING_AGAIN_LABEL,
} from "@repo/features/agent-end-line";
import { AGENT_FAILURE, type AgentFailure } from "@repo/features/agent-wire";
import { FAILURE_REASON, type FailureReason, remedyLabel } from "@repo/features/failure-remedy";
import type { ModelProvider } from "@repo/features/models-wire";
import {
  FAILURE_CONDITION,
  FAILURE_SURFACE,
  type FailureAbout,
} from "@repo/features/shown-failure";
import { ANNOUNCE, BUTTON_VARIANT, Button, TurnEnd, useAnnounce } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { rejectionWords, useAsyncAction } from "@repo/ui/use-async-action";
import { type ReactNode, useRef, useState } from "react";
import { failureShown } from "../failure-report.js";

/**
 * The cause a failed turn is reported under, one per failure word, so a tab
 * drawn again finds the report it made rather than making another.
 */
const TURN_FAILURE_CAUSE: ReadonlyMap<AgentFailure, { readonly code: AgentFailure }> = new Map(
  Object.values(AGENT_FAILURE).map((failure) => [failure, { code: failure }]),
);

/**
 * The failures a turn ends on that something outside named as a refusal,
 * reported as one: the account's own API key, which its provider refused and
 * the reader mends in Settings, and a local agent's machine's own sign-in,
 * which the reader mends on that machine.
 */
const REFUSED_TURN_FAILURES: ReadonlySet<AgentFailure> = new Set([
  AGENT_FAILURE.PROVIDER_KEY,
  AGENT_FAILURE.MACHINE_SIGN_IN,
]);

/**
 * Says the turn's end, a stop or a failure, once, as it lands. Note that it
 * is said by the transcript rather than its end line, because the line
 * mounts with its words and its failure is history, no alert; and that only
 * an end that follows the tab seeing the agent work is said, so the end a
 * tab opens on is history too, while a turn that fails before writing a
 * word is still heard.
 */
export function useTurnEndSaid(ended: EndLineParts | undefined, working: boolean): void {
  const [sawRunning, setSawRunning] = useState(false);

  if (!sawRunning && working && ended === undefined) setSawRunning(true);
  useAnnounce(ANNOUNCE.POLITE, sawRunning ? (ended?.words ?? "") : "");
}

/**
 * The line a transcript ends on once its turn was stopped or failed, and
 * the press on its row (`TurnEnd`): a failure reported under its cause, a
 * stop's words alone. A turn failed on the reader's own refused key offers
 * its harness's row in Settings as the row's press, where no other press
 * stands, since a key the reader mends offers neither Continue nor Try
 * again.
 */
export function AgentEndRow({
  ended,
  endReason,
  keyProvider,
  onOpenApiKeys,
  about,
  press,
  centered = false,
}: {
  ended: EndLineParts;
  endReason: FailureReason | undefined;
  keyProvider: ModelProvider | undefined;
  onOpenApiKeys: (() => void) | undefined;
  /** The agent and task the failure is about, which its copied details name. */
  about: FailureAbout;
  press: ReactNode;
  /** Whether it stands in the empty state's own centered column, centered as its column is. */
  centered?: boolean;
}): React.JSX.Element {
  // Note that a key refused is mended at its harness's row in Settings, so its row offers that row as its press.
  const remedy =
    endReason === FAILURE_REASON.API_KEY
      ? remedyLabel({ reason: FAILURE_REASON.API_KEY, text: ended.words, provider: keyProvider })
      : undefined;

  const failure = ended.failed
    ? failureShown({
        surface: FAILURE_SURFACE.AGENT_TURN,
        // Note that the service's word for the failure is its code, so a report names what failed rather than what mends it.
        cause:
          (ended.failure === undefined ? undefined : TURN_FAILURE_CAUSE.get(ended.failure)) ??
          FAILURE_CONDITION.UNREAD,
        about,
        ...(ended.failure !== undefined &&
          REFUSED_TURN_FAILURES.has(ended.failure) && { refused: true }),
      })
    : undefined;

  return (
    <TurnEnd
      failure={failure}
      press={
        remedy === undefined ? (
          press
        ) : (
          <Button variant={BUTTON_VARIANT.OUTLINE} onClick={onOpenApiKeys}>
            {remedy}
          </Button>
        )
      }
      centered={centered}
    >
      {ended.words}
    </TurnEnd>
  );
}

/** The end line's Try again: sends the line that carries the agent on, once, its press disabled once the service took it. */
export function TryAgainPress({ onPress }: { onPress: () => Promise<boolean> }): React.JSX.Element {
  // Note that a press taken is kept in a ref as well as drawn, so a press before the draw sends nothing.
  const taken = useRef(false);
  const [sent, setSent] = useState(false);
  const press = useAsyncAction(rejectionWords);

  const tryAgain = () => {
    if (taken.current) return;
    void press.run(() =>
      onPress().then((took) => {
        taken.current = took;
        setSent(took);
      }),
    );
  };

  return (
    <Button
      variant={BUTTON_VARIANT.OUTLINE}
      icon={<GLYPH.RETRY />}
      busy={press.running}
      busyLabel={TRYING_AGAIN_LABEL}
      disabled={sent}
      onClick={tryAgain}
    >
      {TRY_AGAIN_LABEL}
    </Button>
  );
}
