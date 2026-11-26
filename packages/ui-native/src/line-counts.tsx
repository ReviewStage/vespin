// line-counts.tsx -- the lines a pull request or a change adds and removes, as every place draws them: "+32" in the complete green and "−2" in the danger red, a Files bar's subtitle among them.

import { HStack } from "@expo/ui/swift-ui";
import { font, foregroundStyle, lineLimit, monospacedDigit } from "@expo/ui/swift-ui/modifiers";
import {
  CHANGES_COUNT,
  type ChangesCount,
  type ChangesTally,
  changesRuns,
} from "@repo/features/changed-files";
import type { InkedWords } from "./interactions.js";
import { Text } from "./text.js";
import { type BrandColors, useColors } from "./tokens/colors.js";
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

/** The ink a count of lines takes: the complete green for those added, and danger's words ink for those removed, which holds its contrast on either ground. */
export function lineCountInk(colors: BrandColors, count: ChangesCount): string {
  return count === CHANGES_COUNT.ADDED ? colors.COMPLETE : colors.DANGER_TEXT;
}

/**
 * A pull request's Files changed subtitle, "43 files · +235 −58", as runs
 * for `StackSubtitle`: the count of files in the bar's own gray, and the
 * lines added and removed in the inks every count of lines takes.
 */
export function changesSubtitle(colors: BrandColors, changed: ChangesTally): readonly InkedWords[] {
  return changesRuns(changed).map((run) =>
    run.count === undefined
      ? { words: run.words }
      : { words: run.words, ink: lineCountInk(colors, run.count) },
  );
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
 * Note that it is never heard on its own, since the row or the card it
 * ends says it in words (`lineCountsHeard`).
 */
export function LineCounts({
  additions,
  deletions,
  hidesNone = false,
}: {
  readonly additions: number;
  readonly deletions: number;
  readonly hidesNone?: boolean | undefined;
}) {
  const colors = useColors();
  const look = [font({ textStyle: TYPE_ROLE.TIME }), monospacedDigit(), lineLimit(1)];

  return (
    <HStack spacing={SPACE.TIGHT}>
      {hidesNone && additions === 0 ? null : (
        <Text modifiers={[...look, foregroundStyle(lineCountInk(colors, CHANGES_COUNT.ADDED))]}>
          {lineCount(LINE_SIGN.ADDED, additions)}
        </Text>
      )}
      {hidesNone && deletions === 0 ? null : (
        <Text modifiers={[...look, foregroundStyle(lineCountInk(colors, CHANGES_COUNT.REMOVED))]}>
          {lineCount(LINE_SIGN.REMOVED, deletions)}
        </Text>
      )}
    </HStack>
  );
}
