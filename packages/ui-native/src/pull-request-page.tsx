// pull-request-page.tsx -- a pull request's page: its heading with where it stands and its branches, the rows of its checks and reviews, the line a change GitHub refused leaves, and the question an act asks first.

import { HStack, Menu, Button as SwiftUIButton, Text, Toggle, VStack } from "@expo/ui/swift-ui";
import {
  buttonStyle,
  controlSize,
  disabled,
  font,
  foregroundStyle,
  lineLimit,
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  menuIndicator,
  monospacedDigit,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { PullRequestState } from "@repo/features/agent-wire";
import { pullRequestMarkState } from "@repo/features/pull-request-model";
import type { ReactElement } from "react";
import { FieldChip } from "./button.js";
import { GLYPH, type MarkLook } from "./glyph.js";
import { PULL_REQUEST_LOOK } from "./inbox-line-model.js";
import { RowFrame, RowHead } from "./list-row.js";
import { ToneGlyph } from "./marks.js";
import { STATUS_TONE, useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** What joins a pull request's branches, the one it merges from after the one it merges into, as GitHub writes it. */
const BRANCH_ARROW = "←";

type PullRequestHeadProps = {
  readonly title: string;
  readonly number: number;
  readonly state: PullRequestState;
  /** Whether GitHub's merge queue holds it, which its mark says in the merge's glyph. */
  readonly queued: boolean;
  /** Where it stands in a word, as the panel's pill says it: "Open", "Queued #2", "Merged". */
  readonly stateLabel: string;
  /** The branch it merges into and the one it merges from; none until its read lands. */
  readonly branches?: { readonly base: string; readonly head: string } | undefined;
  /** Whether it would merge as it stands, in GitHub's sentence: "Ready to merge". */
  readonly sentence?: string | undefined;
};

/** One branch, as the panel's header names it: Lucide's branch glyph, then its name in the monospaced face. */
function Branch({ name }: { readonly name: string }) {
  const colors = useColors();

  return (
    <HStack spacing={SPACE.TIGHT}>
      <ToneGlyph
        glyph={GLYPH.BRANCH}
        tone={STATUS_TONE.NEUTRAL}
        textStyle={TYPE_ROLE.ROW_LINE}
        hidden
      />
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_LINE, design: "monospaced" }),
          foregroundStyle(colors.TEXT_BODY),
          lineLimit(1),
        ]}
      >
        {name}
      </Text>
    </HStack>
  );
}

/**
 * A pull request's heading, as a list's first row: its title in 20 pt
 * semibold with its number muted after it, then where it stands as a chip,
 * its state's glyph in GitHub's color and its word, then its branches on a
 * line of their own, the one it merges into first, then GitHub's sentence of
 * whether it would merge, in the body's ink.
 */
export function PullRequestHead({
  title,
  number,
  state,
  queued,
  stateLabel,
  branches,
  sentence,
}: PullRequestHeadProps) {
  const colors = useColors();
  const look = PULL_REQUEST_LOOK[pullRequestMarkState({ state, queued })];

  return (
    <VStack
      alignment="leading"
      spacing={SPACE.ROW}
      modifiers={[
        listRowBackground("clear"),
        listRowSeparator("hidden"),
        listRowInsets({ leading: SPACE.EDGE, trailing: SPACE.EDGE, top: SPACE.TIGHT, bottom: 0 }),
      ]}
    >
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.PAGE_HEADING, weight: "semibold" }),
          foregroundStyle(colors.TEXT),
        ]}
      >
        <Text>{title}</Text>
        <Text modifiers={[foregroundStyle(colors.TEXT_MUTED), monospacedDigit()]}>
          {` #${number}`}
        </Text>
      </Text>
      <HStack spacing={SPACE.TIGHT + 2}>
        <FieldChip label={stateLabel} mark={{ glyph: look.symbol, tone: look.tone }} />
      </HStack>
      {branches === undefined ? null : (
        <HStack spacing={SPACE.TIGHT + 2}>
          <Branch name={branches.base} />
          <Text
            modifiers={[
              font({ textStyle: TYPE_ROLE.ROW_LINE }),
              foregroundStyle(colors.TEXT_MUTED),
            ]}
          >
            {BRANCH_ARROW}
          </Text>
          <Branch name={branches.head} />
        </HStack>
      )}
      {sentence === undefined ? null : (
        <Text
          modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_BODY)]}
        >
          {sentence}
        </Text>
      )}
    </VStack>
  );
}

type MarkRowProps = {
  /** The row's id, which its list's `onSelect` is called with. */
  readonly id: string;
  /** Its leading mark: where the thing it names stands, in that tone. */
  readonly mark: MarkLook;
  readonly title: string;
  /** What ends its line, muted: where it stands in words, or how long it ran. */
  readonly detail?: string | undefined;
};

/**
 * A row of a pull request's page, such as a check or a reviewer: its mark
 * in the lead column, its name in 15 pt, and what ends its line, 12 pt and
 * muted, standing as every list row does, plain and edge to edge with a
 * hairline under the words.
 */
export function MarkRow({ id, mark, title, detail }: MarkRowProps) {
  const colors = useColors();

  const row: ReactElement = (
    <RowHead
      unread={false}
      faded={false}
      lead={<ToneGlyph glyph={mark.symbol} tone={mark.tone} textStyle={TYPE_ROLE.ROW_TITLE} />}
      title={title}
      ink={colors.TEXT_BODY}
      end={
        detail === undefined ? null : (
          <Text
            modifiers={[
              font({ textStyle: TYPE_ROLE.TIME }),
              monospacedDigit(),
              foregroundStyle(colors.TEXT_MUTED),
              lineLimit(1),
            ]}
          >
            {detail}
          </Text>
        )
      }
    />
  );

  return <RowFrame id={id} row={row} />;
}

/**
 * What a change GitHub did not make leaves to say, as a list's row: our
 * sentence by a warning in the danger ink, and GitHub's own words quoted
 * under it where it said some.
 */
export function WriteNoteRow({
  words,
  said,
}: {
  readonly words: string;
  readonly said?: string | undefined;
}) {
  const colors = useColors();

  return (
    <HStack
      alignment="top"
      spacing={SPACE.ROW}
      modifiers={[
        listRowBackground("clear"),
        listRowInsets({
          leading: SPACE.EDGE,
          trailing: SPACE.EDGE,
          top: SPACE.TIGHT,
          bottom: SPACE.TIGHT,
        }),
      ]}
    >
      <ToneGlyph
        glyph={GLYPH.FAILED}
        tone={STATUS_TONE.DANGER}
        textStyle={TYPE_ROLE.ROW_LINE}
        hidden
      />
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT)]}>
          {words}
        </Text>
        {said === undefined ? null : (
          <Text
            modifiers={[
              font({ textStyle: TYPE_ROLE.ROW_LINE }),
              foregroundStyle(colors.TEXT_MUTED),
            ]}
          >
            {said}
          </Text>
        )}
      </VStack>
    </HStack>
  );
}

/** A way to merge the merge's menu offers, such as Squash and merge, checked where it is the one a tap uses. */
export interface MergeMethodChoice {
  readonly label: string;
  readonly on: boolean;
  readonly onPress: () => void;
}

/**
 * The merge's one press as a row of the page, where a regular window's bar
 * folds its acts out of sight, as GitHub's own app stands Merge under a
 * pull request's checks: the system's large button, as wide as its words,
 * filled in the accent with its words in the brand's ink where it is the
 * page's one act, such as Squash and merge, and outlined in it otherwise,
 * such as Remove from queue. Where the repository merges more than one way
 * it is a split button, as the panel's merge box is: a tap merges the way
 * chosen, and a long press or its chevron opens the ways, the chosen one
 * checked. It is dimmed while a change is out, its words then saying what
 * is under way.
 */
export function MergeActRow({
  label,
  prominent,
  disabled: dimmed,
  methods = [],
  onPress,
}: {
  readonly label: string;
  readonly prominent: boolean;
  readonly disabled: boolean;
  /** The ways to merge, offered behind the chevron where there is more than one. */
  readonly methods?: readonly MergeMethodChoice[];
  readonly onPress: () => void;
}) {
  const colors = useColors();

  const words = (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.ROW_TITLE, weight: "semibold" }),
        foregroundStyle(prominent ? colors.ON_ACCENT : colors.TEXT),
      ]}
    >
      {label}
    </Text>
  );

  const look = [
    buttonStyle(prominent ? "borderedProminent" : "bordered"),
    controlSize("large"),
    tint(prominent ? colors.ACCENT : colors.TEXT),
    disabled(dimmed),
    listRowBackground("clear"),
    listRowSeparator("hidden"),
    listRowInsets({
      leading: SPACE.EDGE,
      trailing: SPACE.EDGE,
      top: SPACE.TIGHT,
      bottom: SPACE.TIGHT,
    }),
  ];

  // Note that a single way to merge leaves nothing to choose, so the press stands as a plain button with no chevron.
  if (methods.length < 2) {
    return (
      <SwiftUIButton onPress={onPress} modifiers={look}>
        {words}
      </SwiftUIButton>
    );
  }

  return (
    <Menu label={words} onPrimaryAction={onPress} modifiers={[...look, menuIndicator("visible")]}>
      {methods.map((method) => (
        <Toggle
          key={method.label}
          label={method.label}
          isOn={method.on}
          onIsOnChange={() => method.onPress()}
        />
      ))}
    </Menu>
  );
}
