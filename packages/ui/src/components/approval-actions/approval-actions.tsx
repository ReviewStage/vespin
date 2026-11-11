import { APPROVAL_PRESS_WORDS } from "@repo/features/agent-approval-model";
import { type ReactNode, useState } from "react";
import type { ShownError } from "../../reported-failure.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { ErrorLine } from "../error-line/error-line.js";
import { GAP, Inline, Stack } from "../layout/layout.js";
import { TEXT_FONT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { TextField } from "../text-field/text-field.js";

/**
 * approval-actions.tsx -- the answers to a tool call an agent holds for a member: Allow, Always allow, and Deny, under the call's row.
 *
 * A held call is drawn as the call's own row, open while it waits so what
 * it would do stands above these, and says it waits; these are the presses
 * that answer it, the window's own buttons as an ask to run a command
 * draws them (`CommandAsk`), wrapping onto a second line where the column
 * is narrow. Allow, in the accent, lets this call through; Always allow,
 * outlined, lets every call like it through while the agent's runner runs,
 * or, where the owner names the command it keeps (`command`), every command
 * starting with those words for every agent of the member's, the command
 * drawn monospace in the press or on a muted line under the presses as
 * `commandPlace` chooses; Deny, outlined as Always allow is, so the presses
 * read as one set however they wrap, opens one field in their place for the
 * words that tell the agent why, optional and held to the bound its owner
 * names, with Deny to send it and Cancel to close it again, Enter denying
 * and Escape canceling. An owner that writes to its agent in a box of its own draws
 * that field itself (`note`), so the words to the agent are written as
 * every other message to it is; a plain text field stands where it does
 * not. They ask nothing of their place, so a dock over a composer can draw
 * them as well.
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

/** What the denial's field and its presses say, wherever its field is drawn. */
export const DENY_NOTE_WORDS = {
  DENY: APPROVAL_PRESS_WORDS.DENY,
  DENYING: APPROVAL_PRESS_WORDS.DENYING,
  CANCEL: "Cancel",
  LABEL: "Why you denied it",
  PLACEHOLDER: "Tell the agent why (optional)",
} as const;

/** Where Always allow names the command it keeps: in its press, or on a muted line under the presses. */
export const APPROVAL_COMMAND_PLACE = {
  IN_PRESS: "in-press",
  UNDER: "under",
} as const;

export type ApprovalCommandPlace =
  (typeof APPROVAL_COMMAND_PLACE)[keyof typeof APPROVAL_COMMAND_PLACE];

/** The presses' words. */
const WORDS = {
  ALLOW: APPROVAL_PRESS_WORDS.ALLOW,
  ALLOW_FOR_AGENT: APPROVAL_PRESS_WORDS.ALLOW_FOR_AGENT,
  ALLOWING: APPROVAL_PRESS_WORDS.ALLOWING,
  ...DENY_NOTE_WORDS,
} as const;

/** What the denial's field is handed, by `ApprovalActions` or by an owner drawing its own (`note`). */
export interface DenyNoteDoors {
  /** Whether the denial is on its way, which holds the field and its presses. */
  readonly busy: boolean;
  /** The most characters the words take; no bound where none is named. */
  readonly maxLength: number | undefined;
  /** Denies the call, with the words where some were written. */
  readonly onDeny: (message: string | undefined) => void;
  /** Closes the field, the answers offered again. */
  readonly onCancel: () => void;
}

/** A command's words in the monospace face, at the size of the words around it. */
function CommandWords({
  variant,
  children,
}: {
  variant: typeof TEXT_VARIANT.LABEL | typeof TEXT_VARIANT.CAPTION;
  children: string;
}): React.JSX.Element {
  return (
    <Text as="span" variant={variant} font={TEXT_FONT.MONO}>
      {children}
    </Text>
  );
}

/** The denial's field, with Deny and Cancel after it. */
function DenyNote({ busy, maxLength, onDeny, onCancel }: DenyNoteDoors): React.JSX.Element {
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
          label={WORDS.LABEL}
          placeholder={WORDS.PLACEHOLDER}
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
  note,
  command,
  commandPlace = APPROVAL_COMMAND_PLACE.IN_PRESS,
  onAnswer,
}: {
  /** The answer that is out, whose press stands busy while the others take nothing; none while none is. */
  answering?: ApprovalAction | undefined;
  /** Why the last answer did not go, said under the presses; none while nothing went wrong. */
  error?: ShownError | undefined;
  /** The most characters a denial's words take, which its field stops at; no bound where none is named. */
  noteMaxLength?: number | undefined;
  /** Draws the denial's field the owner writes to its agent in; a plain text field where none is given. */
  note?: ((doors: DenyNoteDoors) => ReactNode) | undefined;
  /** The command Always allow keeps for every agent of the member's, as it reads (`pnpm test *`); none where it lasts for the agent's session alone. */
  command?: string | undefined;
  /** Where the command is named: in Always allow's press, or on a muted line under the presses. */
  commandPlace?: ApprovalCommandPlace | undefined;
  /** Answers the call, a denial with its words where it has some. */
  onAnswer: (action: ApprovalAction, message?: string) => void;
}): React.JSX.Element {
  const [denying, setDenying] = useState(false);
  const out = answering !== undefined;
  const doors: DenyNoteDoors = {
    busy: answering === APPROVAL_ACTION.DENY,
    maxLength: noteMaxLength,
    onDeny: (message) => onAnswer(APPROVAL_ACTION.DENY, message),
    onCancel: () => setDenying(false),
  };
  return (
    <Stack gap={GAP.TIGHT}>
      {denying ? (
        note === undefined ? (
          <DenyNote {...doors} />
        ) : (
          note(doors)
        )
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
            {command === undefined || commandPlace !== APPROVAL_COMMAND_PLACE.IN_PRESS ? (
              WORDS.ALLOW_FOR_AGENT
            ) : (
              <>
                {`${WORDS.ALLOW_FOR_AGENT} `}
                <CommandWords variant={TEXT_VARIANT.LABEL}>{command}</CommandWords>
              </>
            )}
          </Button>
          <Button variant={BUTTON_VARIANT.OUTLINE} disabled={out} onClick={() => setDenying(true)}>
            {WORDS.DENY}
          </Button>
        </Inline>
      )}
      {command === undefined || commandPlace !== APPROVAL_COMMAND_PLACE.UNDER || denying ? null : (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {`${WORDS.ALLOW_FOR_AGENT} won't ask again for `}
          <CommandWords variant={TEXT_VARIANT.CAPTION}>{command}</CommandWords>
          {" in any of your agents."}
        </Text>
      )}
      <ErrorLine error={error} />
    </Stack>
  );
}
