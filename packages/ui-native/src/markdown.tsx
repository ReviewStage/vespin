// markdown.tsx -- a message's Markdown drawn in React Native views, since SwiftUI has no piece for the panel's: headings, lists, task lists, quotes, tables, code, drafts to send elsewhere, links, mention chips, and pictures that open full screen and zoom.

import { readerZone } from "@repo/features/date-mention";
import { ENTITY_KIND, type EntityKind, entityWordHeard } from "@repo/features/entity-kind";
import type { LinkStanding } from "@repo/features/link-standing-model";
import { pullRequestMarkState } from "@repo/features/pull-request-model";
import type { ReplyButtonLink } from "@repo/features/reply-button-wire";
import { SymbolView } from "expo-symbols";
import { type ReactNode, useMemo, useState } from "react";
import {
  type AccessibilityActionEvent,
  ActivityIndicator,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  type TextStyle,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DraftCard } from "./draft-card.js";
import { GLYPH, type Glyph, glyphSymbol } from "./glyph.js";
import { HeldActsButton, HeldMenu, useKeptActs } from "./held-menu.js";
import { ISSUE_LOOK, PULL_REQUEST_LOOK } from "./inbox-line-model.js";
import { KEPT_KIND } from "./keep-model.js";
import {
  COLUMN_ALIGN,
  type ColumnAlign,
  heardLine,
  LINK_TARGET,
  type LinkTarget,
  MARKDOWN_BLOCK,
  MARKDOWN_RUN,
  type MarkdownBlock,
  type MarkdownChip,
  type MarkdownRun,
  type MarkdownSuggestion,
  markdownBlocks,
} from "./markdown-model.js";
import { Press } from "./press.js";
import {
  SUGGESTION_LOOK,
  SUGGESTION_SENT_WORDS,
  type SuggestionLook,
  suggestionHeard,
} from "./suggestion-look.js";
import { type BrandColors, type StatusTone, toneColor, useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";
import { MONOSPACE_FONT, PROSE_SIZE, TEXT_SIZE } from "./tokens/type.js";
import { Video } from "./video.js";

/**
 * The glyph each kind of entity leads its chip with, as the panel's
 * `entity-mark.tsx` gives each kind its own Lucide glyph; a person, the app,
 * and an MCP server or tool, which the panel marks with a face or a mark of
 * its own, lead with SF Symbols' nearest.
 */
const ENTITY_SYMBOL: Readonly<Record<EntityKind, Glyph>> = {
  [ENTITY_KIND.PLAN]: GLYPH.TASK,
  [ENTITY_KIND.SECTION]: GLYPH.HEADING,
  [ENTITY_KIND.VERSION]: GLYPH.TASK,
  [ENTITY_KIND.COMMENT]: GLYPH.COMMENT,
  [ENTITY_KIND.PAGE]: GLYPH.PAGE,
  [ENTITY_KIND.AGENT]: GLYPH.AGENT,
  [ENTITY_KIND.WORKER]: GLYPH.AGENT,
  [ENTITY_KIND.APP]: GLYPH.APP,
  [ENTITY_KIND.CHANGES]: GLYPH.CHANGES,
  [ENTITY_KIND.PULL_REQUEST]: GLYPH.PULL_REQUEST,
  [ENTITY_KIND.PULL_REQUEST_THREAD]: GLYPH.COMMENT,
  [ENTITY_KIND.ISSUE]: GLYPH.ISSUE,
  [ENTITY_KIND.LINK]: GLYPH.GLOBE,
  [ENTITY_KIND.MESSAGE]: GLYPH.COMMENT,
  [ENTITY_KIND.HOME]: GLYPH.HOME,
  [ENTITY_KIND.BOARD]: GLYPH.TASK,
  [ENTITY_KIND.INBOX]: GLYPH.INBOX,
  [ENTITY_KIND.INBOX_ITEM]: GLYPH.THREAD,
  [ENTITY_KIND.AUTOMATIONS]: GLYPH.AUTOMATION,
  [ENTITY_KIND.AUTOMATION]: GLYPH.AUTOMATION,
  [ENTITY_KIND.AUTOMATION_RUN]: GLYPH.AUTOMATION,
  [ENTITY_KIND.SETTINGS]: GLYPH.SETTINGS,
  [ENTITY_KIND.PERSON]: GLYPH.FACE,
  [ENTITY_KIND.ADMIN]: GLYPH.ADMIN,
  [ENTITY_KIND.FILE]: GLYPH.FILE,
  [ENTITY_KIND.FOLDER]: GLYPH.FOLDER,
  [ENTITY_KIND.SERVER]: GLYPH.MCP_SERVER,
  [ENTITY_KIND.TOOL]: GLYPH.MCP_TOOL,
  [ENTITY_KIND.SKILL]: GLYPH.SKILL,
  [ENTITY_KIND.REPOSITORY]: GLYPH.REPOSITORY,
  [ENTITY_KIND.WORKSPACE]: GLYPH.WORKSPACE,
  [ENTITY_KIND.DATE]: GLYPH.DATE,
  // Note that an app on a Mac is never read from the phone, so it wears an app's shape rather than its icon.
  [ENTITY_KIND.MAC_APP]: GLYPH.APP,
  [ENTITY_KIND.COMPUTER]: GLYPH.COMPUTER,
};

/** Each heading level's size and weight, a step above the 15 pt words as the denser scale reads, never past a page's own heading. */
const HEADING_LOOK: Readonly<Record<1 | 2 | 3 | 4 | 5 | 6, TextStyle>> = {
  1: { fontSize: TEXT_SIZE.TITLE_3, fontWeight: "600" },
  2: { fontSize: TEXT_SIZE.HEADLINE, fontWeight: "600" },
  3: { fontSize: PROSE_SIZE, fontWeight: "600" },
  4: { fontSize: PROSE_SIZE, fontWeight: "600" },
  5: { fontSize: PROSE_SIZE, fontWeight: "600" },
  6: { fontSize: PROSE_SIZE, fontWeight: "600" },
};

const TEXT_ALIGN: Readonly<Record<ColumnAlign, TextStyle["textAlign"]>> = {
  [COLUMN_ALIGN.START]: "left",
  [COLUMN_ALIGN.CENTER]: "center",
  [COLUMN_ALIGN.END]: "right",
};

/** The bounds a table's column is laid out within, in points, before the reader's Dynamic Type scales its words. */
const COLUMN_WIDTH = { MIN: 48, MAX: 260 } as const;

/** The share of a line's size an inline chip sits below the baseline by, so it centers on the words rather than standing on them. */
const CHIP_DROP = 0.22;

/** How wide a list's marker column stands, in body sizes. */
const MARKER_WIDTH = 1.4;

/**
 * A bullet's dot, in body sizes: its width, how far below the line's top its
 * middle stands, which is the middle of the first line's lowercase letters,
 * as the panel's disc sits, and how far it stands in from the marker column's
 * edge, where an ordered list's number ends.
 */
const BULLET = { SIZE: 0.34, MIDDLE: 0.69, INSET: 0.2 } as const;

const styles = StyleSheet.create({
  flow: { gap: SPACE.ROW },
  itemBody: { gap: SPACE.TIGHT },
  marker: { position: "absolute", left: 0, top: 0 },
  quote: { borderLeftWidth: 3, paddingLeft: SPACE.ROW, gap: SPACE.ROW },
  well: { borderRadius: 8, padding: SPACE.ROW },
  tableBox: { alignSelf: "stretch", overflow: "hidden" },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, overflow: "hidden" },
  row: { flexDirection: "row" },
  cell: { paddingHorizontal: SPACE.ROW, paddingVertical: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  picture: { width: "100%", borderRadius: 8 },
  pending: { alignItems: "center", justifyContent: "center" },
  viewer: { flex: 1, backgroundColor: "black", justifyContent: "center" },
  viewerClose: { position: "absolute", padding: SPACE.ROW },
  viewerKeep: { position: "absolute", padding: SPACE.ROW },
});

/** What drawing a run needs beyond the run: the colors, the reader's text scale, and the doors a press opens. */
interface Drawing {
  readonly colors: BrandColors;
  readonly fontScale: number;
  /** The widest a chip may stand, the window's width, which a chip's name is cut to. */
  readonly lineWidth: number;
  readonly openLink: (address: string) => void;
  /** The address a picture is drawn from, by the address its words name it by; none while it is on its way. */
  readonly pictureSource: (written: string) => string | null | undefined;
  /** The video a picture's address names, played in its place; none where the address names a picture. */
  readonly videoAt: (written: string) => MarkdownVideo | undefined;
  /** Whether a heading is heard as one, on a page of words alone, where VoiceOver's Headings rotor walks its sections. */
  readonly headings: boolean;
  /** What GitHub holds of the pull request or issue a chip's page names, as the host read it; none while unread or unanswered. */
  readonly linkStanding: (page: string) => LinkStanding | undefined;
  /** How a suggestion's link stands, by its button and the words it was written with; none where it is drawn as the plain link it is. */
  readonly suggestion: (link: ReplyButtonLink, words: string) => SuggestionLook | undefined;
}

/** A chip of a GitHub page as its standing draws it: its mark, its name, and its state's words after it. */
type StandingLook = {
  readonly glyph: Glyph;
  readonly tone: StatusTone;
  readonly name: string;
  readonly state: string | undefined;
  /** What VoiceOver hears: its kind, the name it now shows, and its state. */
  readonly heard: string;
};

/** A GitHub chip's words as VoiceOver hears them once its standing is read, as the panel hears the label it shows: its kind and the name it shows, then its state. */
function standingHeard(chip: MarkdownChip, name: string, state: string | undefined): string {
  const word = entityWordHeard(chip.entity, name);
  const named = word === undefined ? name : `${word} ${name}`;

  return state === undefined ? named : `${named}, ${state}`;
}

/**
 * How a chip of a GitHub page stands, as the panel's chip draws it: a pull
 * request by its number alone, its title fading mid-word in a chip, with
 * its state's mark and words; an issue by its number and title, with its
 * state's mark and words; none where GitHub has answered nothing of it.
 */
function standingLook(chip: MarkdownChip, drawing: Drawing): StandingLook | undefined {
  const standing = chip.github === undefined ? undefined : drawing.linkStanding(chip.github);

  if (standing?.pullRequest !== undefined) {
    const look = PULL_REQUEST_LOOK[pullRequestMarkState(standing.pullRequest)];
    const name = `#${standing.pullRequest.number}`;

    return {
      ...look,
      glyph: look.symbol,
      name,
      state: standing.state,
      heard: standingHeard(chip, name, standing.state),
    };
  }

  if (standing?.issue !== undefined) {
    const look = ISSUE_LOOK[standing.issue.state];
    const name = `#${standing.issue.number} ${standing.title}`;
    const heard = standingHeard(chip, name, standing.state);

    return { ...look, glyph: look.symbol, name, state: standing.state, heard };
  }

  return undefined;
}

/** A chip as VoiceOver hears it: as its standing shows it once GitHub has answered, else by its kind and written name. */
function chipHeard(chip: MarkdownChip, drawing: Drawing): string {
  return standingLook(chip, drawing)?.heard ?? chip.heard;
}

function open(target: LinkTarget, drawing: Drawing): (() => void) | undefined {
  switch (target.kind) {
    case LINK_TARGET.PLACE:
    case LINK_TARGET.WEB:
      return () => drawing.openLink(target.href);
    case LINK_TARGET.NONE:
      return undefined;
  }
}

/**
 * A chip's glyph in a `size`-point square in `color`, through the system's
 * symbol view, which the app's patch (`patches/expo-symbols@58.0.4.patch`)
 * lets read Lucide's custom symbols from the asset catalog as well as SF
 * Symbols, so a chip costs no SwiftUI host of its own.
 */
function ChipGlyph({
  glyph,
  size,
  color,
}: {
  readonly glyph: Glyph;
  readonly size: number;
  readonly color: string;
}) {
  return (
    <SymbolView
      name={glyphSymbol(glyph)}
      size={size}
      tintColor={color}
      accessibilityElementsHidden
    />
  );
}

/** A mention as its chip, standing in the line of words: its kind's glyph and its name, pressed open where it goes anywhere. */
function MentionChip({
  chip,
  drawing,
}: {
  readonly chip: MarkdownChip;
  readonly drawing: Drawing;
}) {
  const { colors, fontScale } = drawing;
  const onPress = open(chip.target, drawing);
  const size = TEXT_SIZE.FOOTNOTE;
  const standing = standingLook(chip, drawing);
  const heard = standing?.heard ?? chip.heard;

  return (
    <View style={{ transform: [{ translateY: PROSE_SIZE * CHIP_DROP * fontScale }] }}>
      <Press
        onPress={onPress}
        disabled={onPress === undefined}
        accessibilityRole={onPress === undefined ? "text" : "link"}
        accessibilityLabel={heard}
        style={[
          styles.chip,
          {
            maxWidth: drawing.lineWidth,
            backgroundColor: colors.WELL,
            borderColor: colors.CHIP_EDGE,
          },
        ]}
      >
        <ChipGlyph
          glyph={standing?.glyph ?? ENTITY_SYMBOL[chip.entity]}
          size={size * fontScale}
          color={standing === undefined ? colors.TEXT_MUTED : toneColor(colors, standing.tone)}
        />
        <Text
          numberOfLines={1}
          style={{ flexShrink: 1, fontSize: size, color: colors.TEXT, fontWeight: "500" }}
        >
          {standing?.name ?? chip.name}
        </Text>
        {standing?.state === undefined ? null : (
          <Text numberOfLines={1} style={{ fontSize: size, color: colors.TEXT_MUTED }}>
            {standing.state}
          </Text>
        )}
      </Press>
    </View>
  );
}

/** The steer arrow a suggestion leads with, as the panel's pill and its Started or Sent do. */
const SUGGESTION_SYMBOL = GLYPH.SUGGEST;

/**
 * A suggestion as its chip, standing in the line of words in the mention
 * chip's shape: offered, the steer arrow and its label, which a press opens
 * filled in; or reached, the agent's chip with Started or Sent after it,
 * which a press opens.
 */
function SuggestionChip({
  look,
  drawing,
}: {
  readonly look: SuggestionLook;
  readonly drawing: Drawing;
}) {
  const { colors, fontScale } = drawing;
  const size = TEXT_SIZE.FOOTNOTE;
  const offered = look.look === SUGGESTION_LOOK.OFFERED;

  return (
    <View style={{ transform: [{ translateY: PROSE_SIZE * CHIP_DROP * fontScale }] }}>
      <Press
        onPress={look.onPress}
        accessibilityRole="button"
        accessibilityLabel={suggestionHeard(look)}
        style={[
          styles.chip,
          {
            maxWidth: drawing.lineWidth,
            backgroundColor: colors.WELL,
            borderColor: colors.CHIP_EDGE,
          },
        ]}
      >
        <ChipGlyph
          glyph={offered ? SUGGESTION_SYMBOL : ENTITY_SYMBOL[ENTITY_KIND.AGENT]}
          size={size * fontScale}
          color={colors.TEXT_MUTED}
        />
        <Text
          numberOfLines={1}
          style={{ flexShrink: 1, fontSize: size, color: colors.TEXT, fontWeight: "500" }}
        >
          {offered ? look.label : look.name}
        </Text>
        {offered ? null : (
          <>
            <ChipGlyph
              glyph={SUGGESTION_SYMBOL}
              size={size * fontScale}
              color={colors.TEXT_MUTED}
            />
            <Text numberOfLines={1} style={{ fontSize: size, color: colors.TEXT_MUTED }}>
              {SUGGESTION_SENT_WORDS[look.suggests]}
            </Text>
          </>
        )}
      </Press>
    </View>
  );
}

/** A suggestion's link where no suggestion stands, as the plain link to the agent whose reply holds it. */
function SuggestionLink({
  suggestion,
  drawing,
}: {
  readonly suggestion: MarkdownSuggestion;
  readonly drawing: Drawing;
}) {
  const onPress = open(suggestion.target, drawing);

  return (
    <Text
      onPress={onPress}
      accessibilityRole={onPress === undefined ? "text" : "link"}
      style={{ color: drawing.colors.TEXT_BODY, textDecorationLine: "underline" }}
    >
      {suggestion.words}
    </Text>
  );
}

function wordStyle(run: Extract<MarkdownRun, { kind: typeof MARKDOWN_RUN.WORDS }>): TextStyle {
  return {
    ...(run.strong && { fontWeight: "600" }),
    ...(run.emphasis && { fontStyle: "italic" }),
    ...(run.struck && { textDecorationLine: "line-through" }),
  };
}

function Runs({
  runs,
  drawing,
}: {
  readonly runs: readonly MarkdownRun[];
  readonly drawing: Drawing;
}) {
  return runs.map((run, at) => <RunView key={at} run={run} drawing={drawing} />);
}

function RunView({ run, drawing }: { readonly run: MarkdownRun; readonly drawing: Drawing }) {
  const { colors } = drawing;

  switch (run.kind) {
    case MARKDOWN_RUN.WORDS:
      return <Text style={wordStyle(run)}>{run.text}</Text>;
    case MARKDOWN_RUN.CODE:
      return (
        <Text
          style={{
            fontFamily: MONOSPACE_FONT,
            fontSize: TEXT_SIZE.FOOTNOTE,
            backgroundColor: colors.WELL,
          }}
        >
          {run.text}
        </Text>
      );
    case MARKDOWN_RUN.LINK: {
      const onPress = open(run.target, drawing);

      return (
        <Text
          onPress={onPress}
          accessibilityRole={onPress === undefined ? "text" : "link"}
          style={{ color: colors.TEXT_BODY, textDecorationLine: "underline" }}
        >
          <Runs runs={run.runs} drawing={drawing} />
        </Text>
      );
    }

    case MARKDOWN_RUN.CHIP:
      return <MentionChip chip={run.chip} drawing={drawing} />;
    case MARKDOWN_RUN.SUGGESTION: {
      const look = drawing.suggestion(run.suggestion.link, run.suggestion.words);

      return look === undefined ? (
        <SuggestionLink suggestion={run.suggestion} drawing={drawing} />
      ) : (
        <SuggestionChip look={look} drawing={drawing} />
      );
    }

    case MARKDOWN_RUN.BREAK:
      return <Text>{"\n"}</Text>;
  }
}

/** A suggestion as VoiceOver hears it: as its chip stands once its button is read, else by the words it was written with. */
function suggestionRunHeard(suggestion: MarkdownSuggestion, drawing: Drawing): string {
  const look = drawing.suggestion(suggestion.link, suggestion.words);

  return look === undefined ? suggestion.words : suggestionHeard(look);
}

/** A line's words as VoiceOver hears them, each chip and suggestion as it now stands; none where the line holds neither. */
function lineHeard(runs: readonly MarkdownRun[], drawing: Drawing): string | undefined {
  return heardLine(
    runs,
    (chip) => chipHeard(chip, drawing),
    (suggestion) => suggestionRunHeard(suggestion, drawing),
  );
}

/** What opens from a line of words: each chip and link that goes anywhere, by the words it is heard as. */
type LineOpening = { readonly name: string; readonly label: string; readonly onOpen: () => void };

/** What a line's custom action says before what it opens. */
const OPEN_WORD = "Open";

/**
 * Each chip and link in a line that opens somewhere, in the order they
 * stand. Note that iOS lists only a paragraph's words to VoiceOver, never a
 * view standing in it, so a chip is never its own element; it is offered as
 * one of the line's actions instead, named by what it opens.
 */
function lineOpenings(runs: readonly MarkdownRun[], drawing: Drawing): readonly LineOpening[] {
  const openings: LineOpening[] = [];
  collectOpenings(runs, drawing, openings);

  return openings;
}

/** Adds each chip and link in `runs` that opens somewhere to `openings`, a link's own first and then any its words hold. */
function collectOpenings(
  runs: readonly MarkdownRun[],
  drawing: Drawing,
  openings: LineOpening[],
): void {
  for (const run of runs) {
    if (run.kind === MARKDOWN_RUN.CHIP) {
      const onOpen = open(run.chip.target, drawing);

      if (onOpen !== undefined) {
        openings.push({
          name: `open-${openings.length}`,
          label: `${OPEN_WORD} ${chipHeard(run.chip, drawing)}`,
          onOpen,
        });
      }
    } else if (run.kind === MARKDOWN_RUN.SUGGESTION) {
      const look = drawing.suggestion(run.suggestion.link, run.suggestion.words);
      const onOpen = look === undefined ? open(run.suggestion.target, drawing) : look.onPress;
      const label = suggestionRunHeard(run.suggestion, drawing);

      if (onOpen !== undefined && label !== "") {
        openings.push({ name: `open-${openings.length}`, label: `${OPEN_WORD} ${label}`, onOpen });
      }
    } else if (run.kind === MARKDOWN_RUN.LINK) {
      const onOpen = open(run.target, drawing);
      const heard = lineHeard(run.runs, drawing);
      const words = heard ?? runsText(run.runs, drawing);

      if (onOpen !== undefined && words !== "") {
        openings.push({ name: `open-${openings.length}`, label: `${OPEN_WORD} ${words}`, onOpen });
      }

      collectOpenings(run.runs, drawing, openings);
    }
  }
}

/** A run's plain words, as a link's text is heard. */
function runText(run: MarkdownRun, drawing: Drawing): string {
  switch (run.kind) {
    case MARKDOWN_RUN.WORDS:
    case MARKDOWN_RUN.CODE:
      return run.text;
    case MARKDOWN_RUN.LINK:
      return runsText(run.runs, drawing);
    case MARKDOWN_RUN.CHIP:
      return chipHeard(run.chip, drawing);
    case MARKDOWN_RUN.SUGGESTION:
      return suggestionRunHeard(run.suggestion, drawing);
    case MARKDOWN_RUN.BREAK:
      return " ";
    default: {
      const unknown: never = run;
      throw new Error(`A run of no kind a line draws: ${JSON.stringify(unknown)}`);
    }
  }
}

/** Runs' plain words, joined. */
function runsText(runs: readonly MarkdownRun[], drawing: Drawing): string {
  return runs.map((run) => runText(run, drawing)).join("");
}

/** A line of words: a paragraph's, a heading's, or a table cell's. */
function Line({
  runs,
  drawing,
  style,
  heading,
}: {
  readonly runs: readonly MarkdownRun[];
  readonly drawing: Drawing;
  readonly style?: TextStyle | undefined;
  /** Whether the line is heard as a heading. */
  readonly heading?: boolean | undefined;
}) {
  const openings = lineOpenings(runs, drawing);

  const actions =
    openings.length === 0
      ? {}
      : {
          accessibilityActions: openings.map(({ name, label }) => ({ name, label })),
          onAccessibilityAction: (event: AccessibilityActionEvent) =>
            openings.find((opening) => opening.name === event.nativeEvent.actionName)?.onOpen(),
        };

  return (
    <Text
      accessibilityLabel={lineHeard(runs, drawing)}
      {...(heading === true ? { accessibilityRole: "header" as const } : {})}
      {...actions}
      style={[{ fontSize: PROSE_SIZE, color: drawing.colors.TEXT_BODY }, style]}
    >
      <Runs runs={runs} drawing={drawing} />
    </Text>
  );
}

/** What a task box in a list is heard as, ticked or not. */
const TASK_BOX_HEARD = { DONE: "Done", OPEN: "Not done" } as const;

/** A list item's marker: its task box, its number, or its bullet. */
function Marker({
  checked,
  number,
  drawing,
}: {
  readonly checked: boolean | undefined;
  readonly number: number | undefined;
  readonly drawing: Drawing;
}) {
  const { colors, fontScale } = drawing;
  const width = PROSE_SIZE * MARKER_WIDTH * fontScale;

  if (checked !== undefined) {
    return (
      <View
        style={{ width, paddingTop: 2 * fontScale }}
        accessible
        accessibilityRole="checkbox"
        accessibilityLabel={checked ? TASK_BOX_HEARD.DONE : TASK_BOX_HEARD.OPEN}
        accessibilityState={{ checked }}
      >
        <SymbolView
          name={glyphSymbol(checked ? GLYPH.BOX_TICKED : GLYPH.BOX)}
          size={PROSE_SIZE * fontScale}
          tintColor={checked ? colors.ACCENT : colors.TEXT_MUTED}
        />
      </View>
    );
  }

  // Note that a bullet is a dot drawn at the panel's disc's size on the first line's lowercase letters, since the bullet character stands small and high in the system face; it is never heard, while an ordered list's number is, since its order is part of what it says.
  if (number === undefined) {
    const size = PROSE_SIZE * fontScale;
    const dot = size * BULLET.SIZE;

    return (
      <View
        style={{
          width,
          alignItems: "flex-end",
          paddingTop: size * BULLET.MIDDLE - dot / 2,
          paddingRight: size * BULLET.INSET,
        }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View
          style={{
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            backgroundColor: colors.TEXT_MUTED,
          }}
        />
      </View>
    );
  }

  return (
    <Text style={{ width, fontSize: PROSE_SIZE, color: colors.TEXT_MUTED, textAlign: "right" }}>
      {`${number}.`}
    </Text>
  );
}

/**
 * A list's items, each its marker in the margin beside its blocks. Note that
 * an item is a column indented by the marker's width, the marker standing in
 * that margin, rather than a row of the marker and a growing body, because
 * a hosted page (`RNHostView`) measures a row's growing child at its
 * unwrapped width, so a long item ran past the edge rather than wrapping,
 * as a quote, a column with padding, never did.
 */
function ListView({
  block,
  drawing,
}: {
  readonly block: Extract<MarkdownBlock, { kind: typeof MARKDOWN_BLOCK.LIST }>;
  readonly drawing: Drawing;
}) {
  const indent = PROSE_SIZE * MARKER_WIDTH * drawing.fontScale + SPACE.TIGHT;

  return (
    <View style={styles.flow}>
      {block.items.map((item, at) => (
        <View key={at} style={[styles.itemBody, { paddingLeft: indent }]}>
          {/* Note that an empty item's marker stands in the flow, pulled back into the margin, since an item with no words would otherwise take no height and the next item would draw over its marker. */}
          <View style={item.blocks.length === 0 ? { marginLeft: -indent } : styles.marker}>
            <Marker
              checked={item.checked}
              number={block.start === undefined ? undefined : block.start + at}
              drawing={drawing}
            />
          </View>
          <Blocks blocks={item.blocks} drawing={drawing} />
        </View>
      ))}
    </View>
  );
}

/**
 * A table, scrolling sideways inside its own box, which stands at the
 * words' width as a code block's well does, so a table wider than the page
 * scrolls within the page's inset rather than running past its edge. Note that React Native has
 * no table layout, so every cell is first drawn at its own width, held
 * between the column's bounds, and each column then stands at its widest
 * cell's; the table is laid out afresh when the reader's text size changes.
 */
function TableView({
  block,
  drawing,
}: {
  readonly block: Extract<MarkdownBlock, { kind: typeof MARKDOWN_BLOCK.TABLE }>;
  readonly drawing: Drawing;
}) {
  const { colors, fontScale } = drawing;
  const [widths, setWidths] = useState<readonly number[]>([]);

  const measured = (column: number, width: number) =>
    setWidths((held) => {
      if ((held[column] ?? 0) >= width) return held;
      const wider = [...held];
      wider[column] = width;

      return wider;
    });

  return (
    <View style={styles.tableBox}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={[styles.table, { borderColor: colors.CHIP_EDGE }]}>
          {block.rows.map((row, rowAt) => (
            <View
              key={rowAt}
              style={[
                styles.row,
                rowAt === 0
                  ? { backgroundColor: colors.WELL }
                  : { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.CHIP_EDGE },
              ]}
            >
              {row.map((cell, columnAt) => (
                <View
                  key={columnAt}
                  onLayout={(event) => measured(columnAt, event.nativeEvent.layout.width)}
                  style={[
                    styles.cell,
                    {
                      minWidth: COLUMN_WIDTH.MIN * fontScale,
                      maxWidth: COLUMN_WIDTH.MAX * fontScale,
                    },
                    (widths[columnAt] ?? 0) > 0 ? { width: widths[columnAt] } : {},
                  ]}
                >
                  <Line
                    runs={cell}
                    drawing={drawing}
                    style={{
                      fontSize: TEXT_SIZE.FOOTNOTE,
                      textAlign: TEXT_ALIGN[block.align[columnAt] ?? COLUMN_ALIGN.START],
                      ...(rowAt === 0 && { fontWeight: "600", color: colors.TEXT }),
                    }}
                  />
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

/** A block of code, in the monospaced face on a well, scrolling sideways rather than wrapping its lines. */
function CodeView({ text, drawing }: { readonly text: string; readonly drawing: Drawing }) {
  const { colors } = drawing;

  return (
    <View style={[styles.well, { backgroundColor: colors.WELL }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text
          selectable
          style={{ fontFamily: MONOSPACE_FONT, fontSize: TEXT_SIZE.CAPTION, color: colors.TEXT }}
        >
          {text}
        </Text>
      </ScrollView>
    </View>
  );
}

/** The most a full-screen picture zooms in to, as a pinch takes it. */
const VIEWER_MAX_ZOOM = 4;

/** What a picture that could not be read says in its well, its own words first, as the panel's stand-in says it. */
function unreadWords(alt: string): string {
  return alt.trim() === "" ? "This picture could not be read." : `${alt} · could not be read.`;
}

type PictureProps = {
  /** The address the picture is drawn from; none while its bytes are still on their way, which stands its well alone, and `null` where it could not be read, which says so in its well. */
  readonly source: string | null | undefined;
  /** What the picture shows, heard in its place. */
  readonly alt: string;
  /** A tile's fixed shape, width over height, the picture standing whole inside it; the picture's own shape where none is given. */
  readonly tileAspect?: number | undefined;
};

/**
 * A picture at its message's width, which a press opens full screen over
 * everything, where a pinch zooms it and Done closes it. Done stands at the
 * leading top corner inside the safe area, as Quick Look's does, clear of
 * what the system draws at the trailing corner: the clock of the folded
 * iPhone Duo's outer display, beside its rail. Note that a picture
 * still on its way stands as its well at the shape a picture most often
 * is, the system's spinner in it as Photos stands one, so the words under
 * it do not jump twice and it never reads as an empty box.
 */
export function Picture({ source, alt, tileAspect }: PictureProps) {
  const colors = useColors();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [aspect, setAspect] = useState<number | undefined>(undefined);
  const [full, setFull] = useState(false);
  const heard = alt === "" ? "Picture" : alt;

  const acts = useKeptActs(
    source == null ? undefined : { kind: KEPT_KIND.PICTURE, source, name: heard },
  );

  const well = [
    styles.picture,
    { aspectRatio: tileAspect ?? aspect ?? 16 / 9, backgroundColor: colors.WELL },
  ];

  if (source === undefined) {
    return (
      <View style={[well, styles.pending]} accessible accessibilityLabel={heard}>
        <ActivityIndicator color={colors.TEXT_MUTED} />
      </View>
    );
  }

  // Note that a picture that could not be read says so in its well, as the panel's stand-in does, rather than spin as one still on its way.
  if (source === null) {
    const words = unreadWords(alt);

    return (
      <View style={[well, styles.pending]} accessible accessibilityLabel={words}>
        <Text style={{ fontSize: PROSE_SIZE, color: colors.TEXT_MUTED, textAlign: "center" }}>
          {words}
        </Text>
      </View>
    );
  }

  return (
    <>
      <HeldMenu acts={acts}>
        <Press
          onPress={() => setFull(true)}
          accessibilityRole="imagebutton"
          accessibilityLabel={heard}
          accessibilityHint="Opens full screen"
        >
          <Image
            source={{ uri: source }}
            resizeMode="contain"
            onLoad={(event) => {
              const loaded = event.nativeEvent.source;

              if (loaded.width > 0 && loaded.height > 0) setAspect(loaded.width / loaded.height);
            }}
            style={well}
          />
        </Press>
      </HeldMenu>
      <Modal
        visible={full}
        animationType="fade"
        presentationStyle="overFullScreen"
        supportedOrientations={["portrait", "landscape"]}
        onRequestClose={() => setFull(false)}
      >
        <View style={styles.viewer} accessibilityViewIsModal>
          <ScrollView
            maximumZoomScale={VIEWER_MAX_ZOOM}
            minimumZoomScale={1}
            bouncesZoom
            centerContent
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          >
            <Image
              source={{ uri: source }}
              resizeMode="contain"
              accessibilityLabel={heard}
              style={{ width, height }}
            />
          </ScrollView>
          <Press
            onPress={() => setFull(false)}
            accessibilityRole="button"
            accessibilityLabel="Done"
            testID="markdown-picture-done"
            style={[styles.viewerClose, { top: insets.top, left: insets.left + SPACE.ROW }]}
          >
            <Text style={{ fontSize: TEXT_SIZE.BODY, fontWeight: "600", color: "white" }}>
              Done
            </Text>
          </Press>
          <View
            style={[
              styles.viewerKeep,
              { bottom: insets.bottom + SPACE.ROW, left: insets.left + SPACE.ROW },
            ]}
          >
            <HeldActsButton acts={acts} />
          </View>
        </View>
      </Modal>
    </>
  );
}

/** A picture's block: the video its address names, played in its place, or the picture. */
function PictureBlock({
  source,
  alt,
  drawing,
}: {
  readonly source: string;
  readonly alt: string;
  readonly drawing: Drawing;
}) {
  const video = drawing.videoAt(source);

  if (video === undefined) return <Picture source={drawing.pictureSource(source)} alt={alt} />;

  return (
    <Video
      source={video.source}
      label={alt.trim() === "" ? video.label : alt}
      onOpenElsewhere={video.onOpenElsewhere}
    />
  );
}

function BlockView({
  block,
  drawing,
}: {
  readonly block: MarkdownBlock;
  readonly drawing: Drawing;
}) {
  const { colors } = drawing;

  switch (block.kind) {
    case MARKDOWN_BLOCK.HEADING:
      // Note that a message's heading is styled, never announced as one, as the panel's are: a reader walking the screen's headings meets the screen's, not a message's. A page of words alone, such as a task's description opened whole, announces its own.
      return (
        <Line
          runs={block.runs}
          drawing={drawing}
          style={{ ...HEADING_LOOK[block.level], color: colors.TEXT }}
          heading={drawing.headings}
        />
      );
    case MARKDOWN_BLOCK.PARAGRAPH:
      return <Line runs={block.runs} drawing={drawing} />;
    case MARKDOWN_BLOCK.LIST:
      return <ListView block={block} drawing={drawing} />;
    case MARKDOWN_BLOCK.QUOTE:
      return (
        <View style={[styles.quote, { borderColor: colors.CHIP_EDGE }]}>
          <Blocks blocks={block.blocks} drawing={drawing} />
        </View>
      );
    case MARKDOWN_BLOCK.TABLE:
      return <TableView key={drawing.fontScale} block={block} drawing={drawing} />;
    case MARKDOWN_BLOCK.CODE:
      return <CodeView text={block.text} drawing={drawing} />;
    case MARKDOWN_BLOCK.DRAFT:
      return <DraftCard draft={block.draft} onOpenLink={drawing.openLink} />;
    case MARKDOWN_BLOCK.RULE:
      return (
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.CHIP_EDGE }} />
      );
    case MARKDOWN_BLOCK.PICTURE:
      return <PictureBlock source={block.source} alt={block.alt} drawing={drawing} />;
  }
}

function Blocks({
  blocks,
  drawing,
}: {
  readonly blocks: readonly MarkdownBlock[];
  readonly drawing: Drawing;
}): ReactNode {
  return blocks.map((block, at) => <BlockView key={at} block={block} drawing={drawing} />);
}

type MarkdownProps = {
  /** The words, as written. */
  readonly words: string;
  /** The task's repository, `owner/name`, whose GitHub pages are its files' chips; none where it has none. */
  readonly repository?: string | null | undefined;
  /** Opens a link or a chip pressed, by the address it was written as: on the app's own screen where it draws one, such as a `vespin.dev` place or a pull request, and in Safari otherwise. */
  readonly onOpenLink: (address: string) => void;
  /** Whether a person typed the words line by line, whose line breaks are kept; an agent's join as Markdown reads them. */
  readonly typed?: boolean | undefined;
  /** The address a picture is drawn from, by the address its words name it by, such as a `data:` address of a thread's own file; none while it is on its way, and `null` where it could not be read. Each is drawn from the address it names where none is given. */
  readonly pictureSource?: ((written: string) => string | null | undefined) | undefined;
  /** The video a picture's address names, such as a recording a thread carried, played in its place; every address names a picture where none is given. */
  readonly videoAt?: ((written: string) => MarkdownVideo | undefined) | undefined;
  /** Whether its headings are heard as headings, on a page of words alone; a message's are styled alone. */
  readonly headings?: boolean | undefined;
  /** What GitHub holds of a pull request or issue a chip names, by its page (`markdownGithubPages`), which the chip says where it stands; every chip says what its link says where none is given. */
  readonly linkStanding?: ((page: string) => LinkStanding | undefined) | undefined;
  /** How a suggestion an agent wrote into its reply stands, by its button (`markdownReplyButtons`) and its words; every suggestion is drawn as its plain link where none is given. */
  readonly suggestion?:
    | ((link: ReplyButtonLink, words: string) => SuggestionLook | undefined)
    | undefined;
};

/** A video the words name as a picture, played in its place: the file it plays from, none while it is on its way, its name, and where it opens where the player cannot read it. */
export interface MarkdownVideo {
  readonly source: string | undefined;
  readonly label: string;
  readonly onOpenElsewhere?: (() => void) | undefined;
}

/** Each picture drawn from the address its words name it by. */
function namedSource(written: string): string {
  return written;
}

/** No standing read for any page. */
function noStanding(): undefined {
  return undefined;
}

/** No suggestion standing for any link. */
function noSuggestion(): undefined {
  return undefined;
}

/** No address naming a video. */
function noVideo(): undefined {
  return undefined;
}

/**
 * Words drawn as the Markdown they were written in, as the panel draws a
 * message: the panel's parse (`@repo/features/markdown-tree`), read into
 * blocks by `markdown-model.ts`, in the brand's colors for the window's
 * scheme and at the reader's Dynamic Type size. It draws no scroller of its
 * own, so a screen stands it in its own.
 */
export function Markdown({
  words,
  repository = null,
  onOpenLink,
  typed,
  pictureSource = namedSource,
  videoAt = noVideo,
  headings = false,
  linkStanding = noStanding,
  suggestion = noSuggestion,
}: MarkdownProps) {
  const colors = useColors();
  const { fontScale, width } = useWindowDimensions();

  const blocks = useMemo(
    () => markdownBlocks(words, { repository, now: Date.now(), zone: readerZone(), typed }),
    [words, repository, typed],
  );

  const drawing: Drawing = {
    colors,
    fontScale,
    lineWidth: width - SPACE.PAGE * 2,
    openLink: onOpenLink,
    pictureSource,
    videoAt,
    headings,
    linkStanding,
    suggestion,
  };

  return (
    <View style={styles.flow}>
      <Blocks blocks={blocks} drawing={drawing} />
    </View>
  );
}
