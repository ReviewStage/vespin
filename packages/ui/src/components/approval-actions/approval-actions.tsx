import { useState } from "react";
import type { ShownError } from "../../reported-failure.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { ErrorLine } from "../error-line/error-line.js";
import { GAP, Inline, Stack } from "../layout/layout.js";
import { TextField } from "../text-field/text-field.js";

/**
 * approval-actions.tsx -- the answers to a tool call an agent holds for a member: Allow, Always allow, and Deny, under the call's row.
 *
 * A held call is drawn as the call's own row, open while it waits so what
 * it would do stands above these, and says it waits; these are the presses
 * that answer it, the window's own buttons as an ask to run a command
 * draws them (`CommandAsk`), wrapping onto a second line where the column
 * is narrow. Allow, in the accent, lets this call through; Always allow,
 * outlined, lets every call like it through while the agent's runner runs;
 * Deny, quiet, opens one field in their place for the words that tell the
 * agent why, optional and held to the bound its owner names, with Deny to
 * send it and Cancel to close it again, Enter denying and Escape
 * canceling. They ask nothing of their place, so a dock over a composer
 * can draw them as well.
 *
 * While an answer is out (`answering`) its press stands busy and the
 * others take nothing, and a failure to send it says why under them
 * (`error`), the answers offered again. Once the call is answered its owner
 * draws them no longer: the row itself says how it came out.
 */

/** The answers the presses give, which the one out names while its answer is. */
export const APPROVAL_ACTION = {
  ALLOW: "allow",
  ALLOW_FOR_AGENT: "allow_for_agent",
  DENY: "deny",
} as const;

export type ApprovalAction = (typeof APPROVAL_ACTION)[keyof typeof APPROVAL_ACTION];

/** The presses' words. */
const WORDS = {
  ALLOW: "Allow",
  ALLOW_FOR_AGENT: "Always allow",
  DENY: "Deny",
  ALLOWING: "Allowing",
  DENYING: "Denying",
  CANCEL: "Cancel",
  NOTE_LABEL: "Why you denied it",
  NOTE_PLACEHOLDER: "Tell the agent why (optional)",
} as const;

/** The denial's field, with Deny and Cancel after it. */
function DenyNote({
  busy,
  maxLength,
  onDeny,
  onCancel,
}: {
  busy: boolean;
  maxLength: number | undefined;
  onDeny: (message: string | undefined) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [words, setWords] = useState("");
  const deny = () => {
    if (busy) return;
    const message = words.trim();
    onDeny(message === "" ? undefined : message);
  };
  return (
    <Inline gap={GAP.CONTROL} grow>
      <Inline gap={GAP.CONTROL} grow>
        <TextField
          label={WORDS.NOTE_LABEL}
          placeholder={WORDS.NOTE_PLACEHOLDER}
          value={words}
          onChange={setWords}
          maxLength={maxLength}
          autoFocus
          readOnly={busy}
          onEnter={deny}
          onEscape={busy ? undefined : onCancel}
        />
      </Inline>
      <Inline gap={GAP.CONTROL} wrap={false}>
        <Button
          variant={BUTTON_VARIANT.DANGER}
          busy={busy}
          busyLabel={WORDS.DENYING}
          onClick={deny}
        >
          {WORDS.DENY}
        </Button>
        <Button variant={BUTTON_VARIANT.QUIET} disabled={busy} onClick={onCancel}>
          {WORDS.CANCEL}
        </Button>
      </Inline>
    </Inline>
  );
}

export function ApprovalActions({
  answering,
  error,
  noteMaxLength,
  onAnswer,
}: {
  /** The answer that is out, whose press stands busy while the others take nothing; none while none is. */
  answering?: ApprovalAction | undefined;
  /** Why the last answer did not go, said under the presses; none while nothing went wrong. */
  error?: ShownError | undefined;
  /** The most characters a denial's words take, which its field stops at; no bound where none is named. */
  noteMaxLength?: number | undefined;
  /** Answers the call, a denial with its words where it has some. */
  onAnswer: (action: ApprovalAction, message?: string) => void;
}): React.JSX.Element {
  const [denying, setDenying] = useState(false);
  const out = answering !== undefined;
  return (
    <Stack gap={GAP.TIGHT}>
      {denying ? (
        <DenyNote
          busy={answering === APPROVAL_ACTION.DENY}
          maxLength={noteMaxLength}
          onDeny={(message) => onAnswer(APPROVAL_ACTION.DENY, message)}
          onCancel={() => setDenying(false)}
        />
      ) : (
        <Inline gap={GAP.CONTROL}>
          <Button
            variant={BUTTON_VARIANT.PRIMARY}
            disabled={out && answering !== APPROVAL_ACTION.ALLOW}
            busy={answering === APPROVAL_ACTION.ALLOW}
            busyLabel={WORDS.ALLOWING}
            onClick={() => onAnswer(APPROVAL_ACTION.ALLOW)}
          >
            {WORDS.ALLOW}
          </Button>
          <Button
            variant={BUTTON_VARIANT.OUTLINE}
            disabled={out && answering !== APPROVAL_ACTION.ALLOW_FOR_AGENT}
            busy={answering === APPROVAL_ACTION.ALLOW_FOR_AGENT}
            busyLabel={WORDS.ALLOWING}
            onClick={() => onAnswer(APPROVAL_ACTION.ALLOW_FOR_AGENT)}
          >
            {WORDS.ALLOW_FOR_AGENT}
          </Button>
          <Button variant={BUTTON_VARIANT.QUIET} disabled={out} onClick={() => setDenying(true)}>
            {WORDS.DENY}
          </Button>
        </Inline>
      )}
      <ErrorLine error={error} />
    </Stack>
  );
}
