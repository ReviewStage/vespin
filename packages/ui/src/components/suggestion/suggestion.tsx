import type { ReactNode } from "react";
import { GLYPH } from "../../icons/glyph-registry.js";
import { ReplayUnmask } from "../../session-replay-marks.js";
import {
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  HoverCardRule,
} from "../hover-card/hover-card.js";
import { INLINE_REF_LOOK, INLINE_REF_NAME, InlineRef } from "../inline-ref/inline-ref.js";

/**
 * suggestion.tsx -- a suggestion an agent put in its reply, beside the line it is about, of a new agent or of a message to a running one, which a press opens filled in for the reader to edit and send.
 *
 * It stands inline in the reply's words as a pill led by the steer arrow,
 * the same shape as the agent chip it becomes once sent, so it reads as part
 * of the sentence. Resting on it hangs a card saying what it suggests, as a
 * byline says it: a new agent, over where it would run (`where`, rows its
 * owner draws with their marks), or a message to the running agent's own
 * chip (`target`); then the brief, cut at three lines; then what a press
 * does, which is never to run it: it opens the draft, a new agent's or that
 * agent's box, filled in. A finger has no pointer to rest, so a tap opens
 * the draft at once, which is where the brief is read whole. What it
 * becomes once sent, the agent's chip saying it was started or sent to, is
 * its owner's to draw.
 */

/** What a suggestion sets off once sent: a new agent, or a message to one running. */
export const SUGGESTION_KIND = {
  START: "start",
  SEND: "send",
} as const;

export type SuggestionKind = (typeof SUGGESTION_KIND)[keyof typeof SUGGESTION_KIND];

/** What a screen reader hears it is, before its label. */
const HEARD_KIND = "suggestion";

/** What the card says a press does, by what the suggestion sets off: it fills a draft in, and nothing runs until that is sent. */
const PRESS_WORDS = {
  [SUGGESTION_KIND.START]:
    "Opens a new agent with this filled in. Nothing starts until you send it.",
  [SUGGESTION_KIND.SEND]:
    "Opens the agent's box with this filled in. Nothing is sent until you send it.",
} as const satisfies Record<SuggestionKind, string>;

/** The card's head, as a byline says it. */
const HEAD_WORDS = {
  START: "Suggests a new agent",
  SEND: "Suggests a message to",
} as const;

/** What the suggestion sets off, where, the brief, and what a press does. */
function SuggestionCard({
  kind,
  target,
  where,
  brief,
}: {
  kind: SuggestionKind;
  target: ReactNode;
  where: ReactNode;
  brief: string;
}): React.JSX.Element {
  return (
    <HoverCard>
      <HoverCardHead
        glyph={<GLYPH.STEER />}
        name={
          kind === SUGGESTION_KIND.START ? (
            <ReplayUnmask>{HEAD_WORDS.START}</ReplayUnmask>
          ) : (
            <span className="inline-flex flex-wrap items-center gap-ui-4">
              <ReplayUnmask>{HEAD_WORDS.SEND}</ReplayUnmask>
              {target}
            </span>
          )
        }
      />
      {kind === SUGGESTION_KIND.START ? where : null}
      <HoverCardRule />
      <HoverCardNote>{brief}</HoverCardNote>
      <HoverCardRule />
      <ReplayUnmask>
        <HoverCardNote>{PRESS_WORDS[kind]}</HoverCardNote>
      </ReplayUnmask>
    </HoverCard>
  );
}

export function Suggestion({
  label,
  kind,
  target,
  where,
  brief,
  onPress,
}: {
  /** The suggestion's words, as the agent labeled it. */
  label: string;
  kind: SuggestionKind;
  /** The running agent a message goes to, as its chip; nothing for a new agent. */
  target?: ReactNode;
  /** Where a new agent would run, as rows of its card with their marks: its repository, branch, and model; nothing for a message. */
  where?: ReactNode;
  /** The brief a new agent is handed, or the words a message sends, whole. */
  brief: string;
  /** Opens the draft it fills in. */
  onPress: () => void;
}): React.JSX.Element {
  return (
    <InlineRef
      look={INLINE_REF_LOOK.PILL}
      glyph={<GLYPH.STEER />}
      kind={HEARD_KIND}
      label={label}
      name={INLINE_REF_NAME.WHOLE}
      card={<SuggestionCard kind={kind} target={target} where={where} brief={brief} />}
      onPress={onPress}
    />
  );
}

/** What a sent suggestion says it did to the agent it reached, after that agent's name. */
const SENT_WORDS = {
  [SUGGESTION_KIND.START]: "Started",
  [SUGGESTION_KIND.SEND]: "Sent",
} as const satisfies Record<SuggestionKind, string>;

/**
 * What stands after the name of the agent a sent suggestion reached, in its
 * chip's standing: the steer arrow, a line of words tall, and Started or
 * Sent, so the chip reads as the suggestion it was rather than a mention.
 */
export function SuggestionSent({ kind }: { kind: SuggestionKind }): React.JSX.Element {
  return (
    <ReplayUnmask>
      <span className="ui-suggestion-sent inline-flex items-baseline gap-ui-4 [&>svg]:size-[1em] [&>svg]:self-center">
        <GLYPH.STEER />
        {SENT_WORDS[kind]}
      </span>
    </ReplayUnmask>
  );
}
