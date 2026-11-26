// changed-file-row.tsx -- one file a pull request changes, as its Files list draws it: the letter of what became of it in its tone, its name, the lines it adds and removes at the line's end, and the folder it stands in muted under its name; and the Files bar's subtitle, its counts inked as the rows ink theirs.

import { HStack, Text, VStack } from "@expo/ui/swift-ui";
import {
  font,
  foregroundStyle,
  frame,
  lineLimit,
  monospacedDigit,
  truncationMode,
} from "@expo/ui/swift-ui/modifiers";
import type { AgentChangedFile, ChangedFileStatus } from "@repo/features/agent-wire";
import { CHANGED_FILE_STATUS } from "@repo/features/agent-wire";
import {
  CHANGES_COUNT,
  type ChangesCount,
  type ChangesTally,
  changesRuns,
  folderAndName,
  STATUS_LETTER,
  STATUS_WORDS,
} from "@repo/features/changed-files";
import type { ReactElement } from "react";
import { useScaledSize } from "./accessibility.js";
import type { InkedWords } from "./interactions.js";
import { RowFrame, RowHead } from "./list-row.js";
import { UnreadDot } from "./marks.js";
import { lineCount } from "./pull-request-card.js";
import {
  type BrandColors,
  STATUS_TONE,
  type StatusTone,
  toneColor,
  useColors,
} from "./tokens/colors.js";
import { MARK_SIZE, ROW_INSET, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** The tone each letter is inked in: green for a file added, red for one deleted, purple for one moved, and the working blue for one changed in place, as GitHub and an editor's source control color them. */
const STATUS_TONE_OF = {
  [CHANGED_FILE_STATUS.ADDED]: STATUS_TONE.COMPLETE,
  [CHANGED_FILE_STATUS.MODIFIED]: STATUS_TONE.WORKING,
  [CHANGED_FILE_STATUS.DELETED]: STATUS_TONE.DANGER,
  [CHANGED_FILE_STATUS.RENAMED]: STATUS_TONE.MERGED,
} as const satisfies Record<ChangedFileStatus, StatusTone>;

/** The ink a count of lines takes: green for those added, and danger's words ink for those removed, so they hold their contrast, as the pull request card inks its own. */
function countInk(colors: BrandColors, count: ChangesCount): string {
  return count === CHANGES_COUNT.ADDED ? colors.COMPLETE : colors.DANGER_TEXT;
}

/** What a file's counts are heard as. */
function countsHeard(file: AgentChangedFile): string {
  return `${file.additions} added, ${file.deletions} removed`;
}

/**
 * A changed file's row: the letter of what became of it (A, M, D, R) in
 * its tone in the lead column, its name in the row title's style, and at
 * the line's end the lines it adds, in green, and removes, in red, each
 * left out where it is none, as GitHub's file list counts them. The folder
 * it stands in is a muted line under its name, in the name's column, cut
 * from its start where it is long, so the folder nearest the file stays;
 * a file at the root has none. The row is heard as one element: the file's
 * name, as its title reads, then its folder, what became of it, its counts,
 * and whether it is viewed.
 */
export function ChangedFileRow({
  file,
  viewed = false,
}: {
  readonly file: AgentChangedFile;
  /** Whether the member marked the file viewed, which fades its name. */
  readonly viewed?: boolean | undefined;
}) {
  const colors = useColors();
  const leadWidth = useScaledSize(MARK_SIZE.LEAD);
  const { folder, name } = folderAndName(file.path);

  const count = (amount: number, sign: string, ink: string) =>
    amount === 0 ? null : (
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.TIME }),
          monospacedDigit(),
          foregroundStyle(ink),
          lineLimit(1),
        ]}
      >
        {lineCount(sign, amount)}
      </Text>
    );

  const head = (
    <RowHead
      unread={false}
      faded={viewed}
      lead={
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_LINE, weight: "semibold", design: "monospaced" }),
            foregroundStyle(toneColor(colors, STATUS_TONE_OF[file.status])),
          ]}
        >
          {STATUS_LETTER[file.status]}
        </Text>
      }
      title={name}
      ink={viewed ? colors.TEXT_MUTED : colors.TEXT_BODY}
      end={
        <HStack spacing={SPACE.TIGHT}>
          {count(file.additions, "+", countInk(colors, CHANGES_COUNT.ADDED))}
          {count(file.deletions, "−", countInk(colors, CHANGES_COUNT.REMOVED))}
        </HStack>
      }
    />
  );

  // Note that the folder's line keeps the unread dot's margin and the lead's column empty, as an Inbox thread's lines under its task's do, so it starts where the name does.
  const row: ReactElement =
    folder === "" ? (
      head
    ) : (
      <VStack alignment="leading" spacing={2}>
        {head}
        <HStack spacing={ROW_INSET.GUTTER}>
          <UnreadDot unread={false} />
          <HStack spacing={SPACE.ROW}>
            <HStack modifiers={[frame({ width: leadWidth })]}>{null}</HStack>
            <Text
              modifiers={[
                font({ textStyle: TYPE_ROLE.TIME }),
                foregroundStyle(colors.TEXT_MUTED),
                lineLimit(1),
                truncationMode("head"),
              ]}
            >
              {folder}
            </Text>
          </HStack>
        </HStack>
      </VStack>
    );

  return (
    <RowFrame
      id={file.path}
      row={row}
      heard={{
        label: name,
        value: [folder, STATUS_WORDS[file.status], countsHeard(file), viewed && "Viewed"],
      }}
    />
  );
}

/**
 * A pull request's Files changed subtitle, "43 files · +235 −58", as runs
 * for `StackSubtitle`: the count of files in the bar's own gray, and the
 * lines added and removed in the inks each file's row gives its own.
 */
export function changesSubtitle(colors: BrandColors, changed: ChangesTally): readonly InkedWords[] {
  return changesRuns(changed).map((run) =>
    run.count === undefined
      ? { words: run.words }
      : { words: run.words, ink: countInk(colors, run.count) },
  );
}
