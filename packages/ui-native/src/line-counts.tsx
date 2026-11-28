// line-counts.tsx -- the lines a pull request or a change adds and removes, as every place draws them: "+32" in the complete green and "−2" in the danger red.

import { HStack } from "@expo/ui/swift-ui";
import {
  accessibilityElement,
  accessibilityLabel,
  font,
  foregroundStyle,
  lineLimit,
  monospacedDigit,
} from "@expo/ui/swift-ui/modifiers";
import { Text } from "./text.js";
import { useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** The signs a count of lines wears, as GitHub writes them. */
const LINE_SIGN = {
  ADDED: "+",
  REMOVED: "−",
} as const;

/** A line count drawn short: "+1.9k", "−312". */
export function lineCount(sign: string, count: number): string {
  const short = count >= 1000 ? `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(count);

  return `${sign}${short}`;
}

/** What a pair of counts is heard as. */
export function lineCountsHeard(additions: number, deletions: number): string {
  return `${additions} added, ${deletions} removed`;
}

/**
 * The lines a pull request or a change adds and removes, as GitHub and the
 * panel ink them: the added in the complete green and the removed in
 * danger's words ink, which holds its contrast on either ground, in the
 * time's style and figures of one width, drawn short past a thousand. A
 * count of none is left out where `hidesNone`, as a file's row leaves it.
 * It takes the time's style unless it stands among a page's lines, as a
 * pull request's heading counts them after its branches. Note that it is
 * heard on its own only where `heard`, since a row or a card it ends says
 * it in words (`lineCountsHeard`).
 */
export function LineCounts({
  additions,
  deletions,
  hidesNone = false,
  textStyle = TYPE_ROLE.TIME,
  heard = false,
}: {
  readonly additions: number;
  readonly deletions: number;
  readonly hidesNone?: boolean | undefined;
  /** The text style it stands in; the time's where none is given. */
  readonly textStyle?: (typeof TYPE_ROLE)[keyof typeof TYPE_ROLE] | undefined;
  /** Whether it is heard as one element of its own, "32 added, 2 removed", where nothing around it says the counts. */
  readonly heard?: boolean | undefined;
}) {
  const colors = useColors();
  const look = [font({ textStyle }), monospacedDigit(), lineLimit(1)];

  return (
    <HStack
      spacing={SPACE.TIGHT}
      modifiers={
        heard
          ? [
              accessibilityElement("ignore"),
              accessibilityLabel(lineCountsHeard(additions, deletions)),
            ]
          : []
      }
    >
      {hidesNone && additions === 0 ? null : (
        <Text modifiers={[...look, foregroundStyle(colors.COMPLETE)]}>
          {lineCount(LINE_SIGN.ADDED, additions)}
        </Text>
      )}
      {hidesNone && deletions === 0 ? null : (
        <Text modifiers={[...look, foregroundStyle(colors.DANGER_TEXT)]}>
          {lineCount(LINE_SIGN.REMOVED, deletions)}
        </Text>
      )}
    </HStack>
  );
}
