import { type ReactNode, useId, useState } from "react";
import { GLYPH } from "../../icons/glyph-registry.js";
import { AskFirstIcon } from "../../icons/lucide-glyphs.js";
import type { ShownError } from "../../reported-failure.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { CARD_CORNER, CARD_LOOK, CARD_PADDING, Card } from "../card/card.js";
import { ErrorLine } from "../error-line/error-line.js";
import { FILE_TEXT_EXTENT, FileText } from "../file-text/file-text.js";
import { ALIGN, GAP, Inline, Stack } from "../layout/layout.js";
import { NOTE_LINE_LOOK, NoteLine } from "../note-line/note-line.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { TextButton } from "../text-button/text-button.js";
import { TextArea } from "../text-field/text-field.js";

/**
 * approval-card.tsx -- a tool call an agent holds for a member's answer: what it asks, the command or file it would touch, and Allow, Always allow for this agent, and Deny…, settling into one line once answered.
 *
 * The card stands where the call it holds stands, under the call in a
 * transcript, and asks nothing of its place, so a dock over a composer can
 * draw it as well. It heads with the ask's own sentence, the CLI's, after
 * the ask's shield, with the subtitle the CLI gave under it, and which
 * subagent asks where one does, so a member answering knows who wants it.
 * What the call would do stands under that compactly (`detail`): a shell
 * command or a file's path and words, mono and wrapped, scrolling within a
 * few lines, with Show all to stand it whole and Show less to cut it again,
 * so a long payload never buries the answers.
 *
 * The answers stand in one row that wraps on a narrow column: Allow, in the
 * accent, which lets this call through; Always allow for this agent, which
 * lets every call like it through while the agent's runner runs; and Deny…,
 * which opens a small note under the row for the words that tell the agent
 * why, optional, with Deny to send it and Cancel to close it again. Enter
 * in the note denies, Escape cancels. Each is a control's height, a
 * finger's on a coarse pointer, as every button is. While an answer is out
 * (`answering`), its press stands busy and the others take nothing, and a
 * failure to send it says why under the row (`error`), the answers offered
 * again.
 *
 * Once the ask is settled (`settled`), by this card's answer or anywhere
 * else, the card folds into one quiet line that says how it stands,
 * "Allowed", "Denied by you", "Expired", after a glyph of its outcome, so
 * the transcript keeps a record of it without the controls.
 */

/** The answers a card offers, which the press that is out names while its answer is. */
export const APPROVAL_CARD_ANSWER = {
  ALLOW: "allow",
  ALLOW_FOR_AGENT: "allow_for_agent",
  DENY: "deny",
} as const;

export type ApprovalCardAnswer = (typeof APPROVAL_CARD_ANSWER)[keyof typeof APPROVAL_CARD_ANSWER];

/** How a settled ask came out, which its line's glyph says. */
export const APPROVAL_OUTCOME = {
  ALLOWED: "allowed",
  DENIED: "denied",
  EXPIRED: "expired",
} as const;

export type ApprovalOutcome = (typeof APPROVAL_OUTCOME)[keyof typeof APPROVAL_OUTCOME];

/** The glyph each outcome's line leads with. */
const OUTCOME_GLYPH = {
  [APPROVAL_OUTCOME.ALLOWED]: <GLYPH.DONE />,
  [APPROVAL_OUTCOME.DENIED]: <GLYPH.CLOSE />,
  [APPROVAL_OUTCOME.EXPIRED]: <GLYPH.TIME />,
} as const satisfies Record<ApprovalOutcome, ReactNode>;

/** The card's own words. */
const WORDS = {
  ALLOW: "Allow",
  ALLOWING: "Allowing",
  ALLOW_FOR_AGENT: "Always allow for this agent",
  DENY_OPEN: "Deny…",
  DENY: "Deny",
  DENYING: "Denying",
  CANCEL: "Cancel",
  NOTE_LABEL: "Why you denied it",
  NOTE_PLACEHOLDER: "Tell the agent why (optional)",
  SHOW_ALL: "Show all",
  SHOW_LESS: "Show less",
} as const;

/** How long a detail runs, in lines or characters, before it is cut to a few lines with Show all. */
const DETAIL_CUT = {
  LINES: 6,
  CHARS: 360,
} as const;

/** What the call would touch, drawn compactly under the ask: a command, or a file's path and words. */
export interface ApprovalDetail {
  /** What the words are, for a reader and over them: "Command", or the file's path. */
  readonly label: string;
  /** The words as the call would use them. */
  readonly text: string;
}

/** How a settled ask stands: its outcome and the line that says it. */
export interface ApprovalSettled {
  readonly outcome: ApprovalOutcome;
  readonly words: string;
}

/** Whether a detail is long enough to be cut to a few lines. */
function runsLong(text: string): boolean {
  return text.length > DETAIL_CUT.CHARS || text.split("\n").length > DETAIL_CUT.LINES;
}

/** What the call would touch, a few lines of it with Show all where it runs longer. */
function ApprovalDetailText({ detail }: { detail: ApprovalDetail }): React.JSX.Element {
  const [whole, setWhole] = useState(false);
  const id = useId();
  const long = runsLong(detail.text);
  return (
    <Stack gap={GAP.TIGHT}>
      <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} truncate>
        {detail.label}
      </Text>
      <div id={id}>
        <FileText
          text={detail.text}
          label={detail.label}
          extent={whole || !long ? FILE_TEXT_EXTENT.WHOLE : FILE_TEXT_EXTENT.BRIEF}
        />
      </div>
      {long ? (
        <div>
          <TextButton aria-expanded={whole} aria-controls={id} onClick={() => setWhole(!whole)}>
            {whole ? WORDS.SHOW_LESS : WORDS.SHOW_ALL}
          </TextButton>
        </div>
      ) : null}
    </Stack>
  );
}

/** The note a denial opens: the words that tell the agent why, then Cancel and Deny. */
function DenyNote({
  busy,
  onDeny,
  onCancel,
}: {
  busy: boolean;
  onDeny: (message: string | undefined) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [words, setWords] = useState("");
  const deny = () => {
    const message = words.trim();
    onDeny(message === "" ? undefined : message);
  };
  return (
    <Stack gap={GAP.CONTROL}>
      <TextArea
        label={WORDS.NOTE_LABEL}
        placeholder={WORDS.NOTE_PLACEHOLDER}
        value={words}
        onChange={setWords}
        rows={2}
        grow
        autoFocus
        busy={busy}
        onSubmit={deny}
        onEscape={busy ? undefined : onCancel}
      />
      <Inline gap={GAP.CONTROL}>
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
    </Stack>
  );
}

export function ApprovalCard({
  title,
  description,
  asker,
  detail,
  answering,
  error,
  settled,
  onAnswer,
}: {
  /** The ask's sentence, the CLI's: "Claude wants to run a command". */
  title: string;
  /** Its subtitle, where the CLI gave one. */
  description?: string | undefined;
  /** Who asks where it is not the agent itself: "Asked by subagent Explore". */
  asker?: string | undefined;
  /** What the call would touch, drawn compactly; none where it names nothing to show. */
  detail?: ApprovalDetail | undefined;
  /** The answer that is out, whose press stands busy while the others take nothing; none while none is. */
  answering?: ApprovalCardAnswer | undefined;
  /** Why the last answer did not go, said under the row; none while nothing went wrong. */
  error?: ShownError | undefined;
  /** How the ask stands once settled, which folds the card into its line; none while it waits. */
  settled?: ApprovalSettled | undefined;
  /** Answers the ask, a denial with the note's words where it has some. */
  onAnswer: (answer: ApprovalCardAnswer, message?: string) => void;
}): React.JSX.Element {
  const titleId = useId();
  const [denying, setDenying] = useState(false);
  if (settled !== undefined) {
    return (
      <NoteLine look={NOTE_LINE_LOOK.TRAIL} glyph={OUTCOME_GLYPH[settled.outcome]} status>
        {settled.words}
      </NoteLine>
    );
  }
  const out = answering !== undefined;
  return (
    <Card
      look={CARD_LOOK.RAISED}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.COMPACT}
      role="group"
      aria-labelledby={titleId}
      className="ui-approval-card"
    >
      <Stack gap={GAP.FIELD}>
        <Stack gap={GAP.TIGHT}>
          <Inline gap={GAP.ICON} wrap={false} align={ALIGN.START}>
            <AskFirstIcon />
            <Text id={titleId} as={TEXT_ELEMENT.H3} variant={TEXT_VARIANT.LABEL}>
              {title}
            </Text>
          </Inline>
          {description === undefined ? null : (
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {description}
            </Text>
          )}
          {asker === undefined ? null : (
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {asker}
            </Text>
          )}
        </Stack>
        {detail === undefined ? null : <ApprovalDetailText detail={detail} />}
        {denying ? (
          <DenyNote
            busy={answering === APPROVAL_CARD_ANSWER.DENY}
            onDeny={(message) => onAnswer(APPROVAL_CARD_ANSWER.DENY, message)}
            onCancel={() => setDenying(false)}
          />
        ) : (
          <Inline gap={GAP.CONTROL}>
            <Button
              variant={BUTTON_VARIANT.PRIMARY}
              disabled={out && answering !== APPROVAL_CARD_ANSWER.ALLOW}
              busy={answering === APPROVAL_CARD_ANSWER.ALLOW}
              busyLabel={WORDS.ALLOWING}
              onClick={() => onAnswer(APPROVAL_CARD_ANSWER.ALLOW)}
            >
              {WORDS.ALLOW}
            </Button>
            <Button
              variant={BUTTON_VARIANT.OUTLINE}
              disabled={out && answering !== APPROVAL_CARD_ANSWER.ALLOW_FOR_AGENT}
              busy={answering === APPROVAL_CARD_ANSWER.ALLOW_FOR_AGENT}
              busyLabel={WORDS.ALLOWING}
              onClick={() => onAnswer(APPROVAL_CARD_ANSWER.ALLOW_FOR_AGENT)}
            >
              {WORDS.ALLOW_FOR_AGENT}
            </Button>
            <Button variant={BUTTON_VARIANT.QUIET} disabled={out} onClick={() => setDenying(true)}>
              {WORDS.DENY_OPEN}
            </Button>
          </Inline>
        )}
        <ErrorLine error={error} />
      </Stack>
    </Card>
  );
}
