import { formatCount } from "@repo/features/number-format";
import type { ReactNode } from "react";
import { Badge } from "../badge/badge.js";
import { CHIP_LOOK, CHIP_SIZE, Chip } from "../chip/chip.js";
import { GAP, Inline, LAYOUT_ELEMENT } from "../layout/layout.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * reaction-chip.tsx -- the reactions something wears, under its words: each its emoji and how many gave it, lit where the reader did, a press that gives the reader's own or takes it back.
 *
 * A reaction is a compact chip (`CHIP_LOOK.REACTION`): on the chip's
 * face at rest, in a soft accent tint, outline, and words where the reader gave it (`aria-pressed`), as a
 * pull request's and a Manager chat's reactions both stand. Its emoji and
 * count are drawn alone, and what it says to a reader and in its tooltip
 * is its caller's words (`label`), who gave it. One that may not be pressed
 * is a `Badge` in the same box, lit where it is the reader's. A busy one,
 * whose change is out, pulses until it is answered (`Chip`'s `busy`).
 *
 * The chips stand in one row of their own (`ReactionRow`), a list named
 * Reactions, each chip its item; a control the row ends in, such as Add
 * reaction, stands in an item of its own beside them.
 */

/** What a reaction row is named, to a reader. */
const REACTIONS_WORDS = "Reactions";

export interface ReactionChipProps {
  /** The reaction's emoji, drawn alone. */
  emoji: string;
  /** How many gave it. */
  count: number;
  /** Who gave it, in words, said to a reader and in its tooltip: "You and Release manager reacted with thumbs up". */
  label: string;
  /** Whether the reader gave it, which lights it. */
  reacted: boolean;
  /** Gives the reader's own or takes it back; none where it may not be pressed. */
  onPress?: (() => void) | undefined;
  /** Whether its change is out, which it pulses for. */
  busy?: boolean | undefined;
  /** Whether it waits on another change before it may be pressed. */
  disabled?: boolean | undefined;
}

/** One reaction, an item of its `ReactionRow`: a press where it may be changed, a badge where it may not. */
export function ReactionChip({
  emoji,
  count,
  label,
  reacted,
  onPress,
  busy = false,
  disabled = false,
}: ReactionChipProps): React.JSX.Element {
  const face = (
    <>
      <span aria-hidden="true">{emoji}</span>
      <span className="tabular-nums" aria-hidden="true">
        {formatCount(count)}
      </span>
    </>
  );

  return (
    <li>
      <Tooltip label={label}>
        {onPress === undefined ? (
          <span className="flex" role="img" aria-label={label}>
            <Badge lit={reacted}>{face}</Badge>
          </span>
        ) : (
          <Chip
            look={CHIP_LOOK.REACTION}
            size={CHIP_SIZE.COMPACT}
            aria-label={label}
            aria-pressed={reacted}
            busy={busy}
            disabled={disabled}
            onClick={onPress}
          >
            {face}
          </Chip>
        )}
      </Tooltip>
    </li>
  );
}

/** The row a thing's reactions stand in, under its words: a list named Reactions of `ReactionChip`s, and any control it ends in, each in an item of its own. */
export function ReactionRow({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <Inline
      as={LAYOUT_ELEMENT.UL}
      gap={GAP.TIGHT}
      className="ui-reactions"
      aria-label={REACTIONS_WORDS}
    >
      {children}
    </Inline>
  );
}
