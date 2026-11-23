// changed-file-row.tsx -- one file a pull request changes, as its Files list draws it: the letter of what became of it in its tone, its name, and the lines it adds and removes at the line's end.

import { HStack, Text } from "@expo/ui/swift-ui";
import { font, foregroundStyle, lineLimit, monospacedDigit } from "@expo/ui/swift-ui/modifiers";
import type { AgentChangedFile, ChangedFileStatus } from "@repo/features/agent-wire";
import { CHANGED_FILE_STATUS } from "@repo/features/agent-wire";
import { STATUS_LETTER, STATUS_WORDS } from "@repo/features/changed-files";
import type { ReactElement } from "react";
import { RowFrame, RowHead } from "./list-row.js";
import { lineCount } from "./pull-request-card.js";
import { STATUS_TONE, type StatusTone, toneColor, useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** The tone each letter is inked in: green for a file added, red for one deleted, purple for one moved, and the working blue for one changed in place, as GitHub and an editor's source control color them. */
const STATUS_TONE_OF = {
  [CHANGED_FILE_STATUS.ADDED]: STATUS_TONE.COMPLETE,
  [CHANGED_FILE_STATUS.MODIFIED]: STATUS_TONE.WORKING,
  [CHANGED_FILE_STATUS.DELETED]: STATUS_TONE.DANGER,
  [CHANGED_FILE_STATUS.RENAMED]: STATUS_TONE.MERGED,
} as const satisfies Record<ChangedFileStatus, StatusTone>;

/** What a file's counts are heard as. */
function countsHeard(file: AgentChangedFile): string {
  return `${file.additions} added, ${file.deletions} removed`;
}

/**
 * A changed file's row: the letter of what became of it (A, M, D, R) in
 * its tone in the lead column, its name in the row title's style, and at
 * the line's end the lines it adds, in green, and removes, in red, each
 * left out where it is none, as GitHub's file list counts them. Its folder
 * is the section it stands in, so the row names the file alone. The row is
 * heard as one element: the file's path, what became of it, its counts,
 * and whether it is viewed.
 */
export function ChangedFileRow({
  file,
  name,
  viewed = false,
}: {
  readonly file: AgentChangedFile;
  /** The file's name as its section lists it: its path past the section's folder. */
  readonly name: string;
  /** Whether the member marked the file viewed, which fades its name. */
  readonly viewed?: boolean | undefined;
}) {
  const colors = useColors();

  // Note that the counts are inked as the pull request card inks its own, removed lines in danger's words ink so they hold their contrast.
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

  const row: ReactElement = (
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
          {count(file.additions, "+", colors.COMPLETE)}
          {count(file.deletions, "−", colors.DANGER_TEXT)}
        </HStack>
      }
    />
  );

  return (
    <RowFrame
      id={file.path}
      row={row}
      heard={{
        label: file.path,
        value: [STATUS_WORDS[file.status], countsHeard(file), viewed && "Viewed"],
      }}
    />
  );
}
