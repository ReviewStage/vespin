import { APPROVAL_PRESS_WORDS } from "@repo/features/agent-approval-model";
import { type ReactNode, useState } from "react";
import type { ShownError } from "../../reported-failure.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { ErrorLine } from "../error-line/error-line.js";
import { GAP, Inline, Stack } from "../layout/layout.js";
import { dropBelow, Menu, useMenu } from "../menu/menu.js";
import { SplitButton } from "../split-button/split-button.js";
import { TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
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
 * canceling. An owner that writes to its agent in a box of its own draws
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

/** One place a kept rule may apply, as Always allow's menu offers it (prototype). */
export interface AlwaysAllowScope {
  readonly label: string;
  readonly detail?: string | undefined;
  readonly onSelect: () => void;
}

/** What Always allow keeps, said before it is pressed (prototype): a line under the presses, and the places its chevron offers where the place is chosen. */
export interface AlwaysAllowKeeps {
  readonly line?: ReactNode;
  readonly scopes?: readonly AlwaysAllowScope[] | undefined;
  /** The press's words where they differ from Always allow's. */
  readonly label?: string | undefined;
}

/** Always allow with its chevron of places (prototype). */
function AlwaysAllowSplit({
  label,
  scopes,
  disabled,
  busy,
  onAllow,
}: {
  label: string;
  scopes: readonly AlwaysAllowScope[];
  disabled: boolean;
  busy: boolean;
  onAllow: () => void;
}): React.JSX.Element {
  const menu = useMenu(true);
  return (
    <>
      <SplitButton
        variant={BUTTON_VARIANT.OUTLINE}
        disabled={disabled}
        busy={busy}
        busyLabel={WORDS.ALLOWING}
        onClick={onAllow}
        menu={{ label: "Where to always allow", ...menu.trigger(dropBelow) }}
      >
        {label}
      </SplitButton>
      {menu.drawn === undefined ? null : (
        <Menu
          label="Always allow"
          heading="Don't ask again for this"
          menu={menu.drawn}
          onClose={menu.close}
          replayUnmasked
          groups={[
            scopes.map((scope) => ({
              label: scope.label,
              detail: scope.detail,
              onSelect: scope.onSelect,
            })),
          ]}
        />
      )}
    </>
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
  keeps,
  onAnswer,
}: {
  /** What Always allow keeps, said before it is pressed (prototype); nothing where none is given. */
  keeps?: AlwaysAllowKeeps | undefined;
  /** The answer that is out, whose press stands busy while the others take nothing; none while none is. */
  answering?: ApprovalAction | undefined;
  /** Why the last answer did not go, said under the presses; none while nothing went wrong. */
  error?: ShownError | undefined;
  /** The most characters a denial's words take, which its field stops at; no bound where none is named. */
  noteMaxLength?: number | undefined;
  /** Draws the denial's field the owner writes to its agent in; a plain text field where none is given. */
  note?: ((doors: DenyNoteDoors) => ReactNode) | undefined;
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
          {keeps?.scopes === undefined ? (
            <Button
              variant={BUTTON_VARIANT.OUTLINE}
              disabled={out && answering !== APPROVAL_ACTION.ALLOW_FOR_AGENT}
              busy={answering === APPROVAL_ACTION.ALLOW_FOR_AGENT}
              busyLabel={WORDS.ALLOWING}
              onClick={() => onAnswer(APPROVAL_ACTION.ALLOW_FOR_AGENT)}
            >
              {keeps?.label ?? WORDS.ALLOW_FOR_AGENT}
            </Button>
          ) : (
            <AlwaysAllowSplit
              label={keeps.label ?? WORDS.ALLOW_FOR_AGENT}
              scopes={keeps.scopes}
              disabled={out && answering !== APPROVAL_ACTION.ALLOW_FOR_AGENT}
              busy={answering === APPROVAL_ACTION.ALLOW_FOR_AGENT}
              onAllow={() => onAnswer(APPROVAL_ACTION.ALLOW_FOR_AGENT)}
            />
          )}
          <Button variant={BUTTON_VARIANT.QUIET} disabled={out} onClick={() => setDenying(true)}>
            {WORDS.DENY}
          </Button>
        </Inline>
      )}
      {keeps?.line === undefined || denying ? null : (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {keeps.line}
        </Text>
      )}
      <ErrorLine error={error} />
    </Stack>
  );
}
