// merge-queue-row.tsx -- a pull request a merge queue holds, on one line, as the panel's Merge queue page draws its row: the queued mark, its title, how its merge group's checks stand, who opened it, when it should merge, and its number.

import { HStack, Text } from "@expo/ui/swift-ui";
import { fixedSize, font, foregroundStyle, monospacedDigit } from "@expo/ui/swift-ui/modifiers";
import type { CheckSummary } from "@repo/features/agent-wire";
import { PULL_REQUEST_MARK_QUEUED } from "@repo/features/pull-request-model";
import { untilText } from "@repo/features/time-format";
import type { ReactElement } from "react";
import { PULL_REQUEST_LOOK } from "./inbox-line-model.js";
import { type LongPressGroup, RowFrame, RowHead } from "./list-row.js";
import { Avatar, type FaceKind, ToneGlyph } from "./marks.js";
import { useMinute } from "./minute.js";
import { CHECK_SUMMARY_LOOK } from "./pull-request-look.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** The room between the marks at the line's end, as a task's row stands its own. */
const END_GAP = SPACE.TIGHT + 2;

/** The queued mark every row leads with: the merge's glyph in the attention ink, as a queued pull request's capsule wears it. */
const QUEUED_LOOK = PULL_REQUEST_LOOK[PULL_REQUEST_MARK_QUEUED];

/** What a row says of when it should merge, heard after the rest. */
const MERGES = "merges";

type MergeQueueRowProps = {
  /** The row's id, its pull request's GitHub address, which its list's `onSelect` is called with. */
  readonly id: string;
  readonly number: number;
  readonly title: string;
  /** How its merge group's checks stand (`mergeQueueChecksStanding`): their glyph, and how many beside it where GitHub counted any. */
  readonly checks: { readonly summary: CheckSummary; readonly count: number | undefined };
  /** Who opened it, by their face; none for a deleted account. */
  readonly author?:
    | {
        readonly name: string;
        readonly picture?: string | undefined;
        readonly kind?: FaceKind | undefined;
      }
    | undefined;
  /** When GitHub estimates it merges, in milliseconds since the epoch; none where it gives no estimate. */
  readonly estimatedMergeAt?: number | undefined;
  /** What a reader hears after its title (`mergeQueueHeard`): its number, its stage, its checks, and who opened it. */
  readonly heard: readonly string[];
  /** Its long press menu, in the panel's groups: Open on GitHub and Copy link. */
  readonly menu?: readonly LongPressGroup[] | undefined;
};

/** How its merge group's checks stand: their glyph in its tone, and the count beside it; nothing while it waits its turn. */
function ChecksMark({ checks }: { readonly checks: MergeQueueRowProps["checks"] }) {
  const colors = useColors();
  const look = CHECK_SUMMARY_LOOK[checks.summary];

  if (look === undefined && checks.count === undefined) return null;

  return (
    <HStack spacing={SPACE.TIGHT}>
      {look === undefined ? null : <ToneGlyph glyph={look.symbol} tone={look.tone} hidden />}
      {checks.count === undefined ? null : (
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.TIME }),
            monospacedDigit(),
            foregroundStyle(colors.TEXT_MUTED),
            fixedSize(),
          ]}
        >
          {String(checks.count)}
        </Text>
      )}
    </HStack>
  );
}

/** Muted words at the line's end in the time's style, with tabular figures. */
function EndText({ words }: { readonly words: string }) {
  const colors = useColors();

  return (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.TIME }),
        monospacedDigit(),
        foregroundStyle(colors.TEXT_MUTED),
        fixedSize(),
      ]}
    >
      {words}
    </Text>
  );
}

/**
 * One pull request in its queue, on a task's row's line: the queued mark
 * where a task's ring stands, its title, then at the line's end how its
 * merge group's checks stand, as its Checks count them, who opened it by
 * their face, when GitHub estimates it merges counted down ("in 8m"), and
 * its number where a search's task row ends in its key. A tap opens it,
 * through its list's `onSelect`; a long press opens its menu. It is heard as
 * one element: its title, then its number, stage, checks, author, and when
 * it should merge.
 */
export function MergeQueueRow({
  id,
  number,
  title,
  checks,
  author,
  estimatedMergeAt,
  heard,
  menu,
}: MergeQueueRowProps) {
  const colors = useColors();
  const minute = useMinute();
  const until = estimatedMergeAt === undefined ? undefined : untilText(estimatedMergeAt, minute);

  const row: ReactElement = (
    <RowHead
      dot={false}
      unread={false}
      faded={false}
      lead={<ToneGlyph glyph={QUEUED_LOOK.symbol} tone={QUEUED_LOOK.tone} hidden />}
      title={title}
      ink={colors.TEXT_BODY}
      end={
        <HStack spacing={END_GAP}>
          <ChecksMark checks={checks} />
          {author === undefined ? null : (
            <Avatar
              name={author.name}
              picture={author.picture}
              kind={author.kind}
              size={MARK_SIZE.FACE}
            />
          )}
          {until === undefined ? null : <EndText words={until} />}
          <EndText words={`#${number}`} />
        </HStack>
      }
    />
  );

  return (
    <RowFrame
      id={id}
      row={row}
      dot={false}
      menu={menu}
      heard={{
        label: title,
        value: [...heard, until !== undefined && `${MERGES} ${until}`],
      }}
      now={minute}
    />
  );
}
