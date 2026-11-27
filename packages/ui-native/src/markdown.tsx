// markdown.tsx -- a message's Markdown drawn in React Native views, since SwiftUI has no piece for the panel's: headings, lists, task lists, quotes, tables, code, drafts to send elsewhere, links, mention chips, and pictures that open full screen and zoom.

import { CODE_ROW, type CodeRow, type FenceRow } from "@repo/features/code-fence";
import { readerZone } from "@repo/features/date-mention";
import { ENTITY_KIND, entityWordHeard } from "@repo/features/entity-kind";
import { LINK_MENU_WORDS } from "@repo/features/link-menu-words";
import type { LinkStanding } from "@repo/features/link-standing-model";
import { MEDIA_READ_WORDS } from "@repo/features/media-read-words";
import { pullRequestMarkState } from "@repo/features/pull-request-model";
import type { ReplyButtonLink } from "@repo/features/reply-button-wire";
import { SymbolView } from "expo-symbols";
import { type ComponentRef, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  type AccessibilityActionEvent,
  ActivityIndicator,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  type TextLayoutEvent,
  type TextStyle,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { AudioClip } from "./audio-clip.js";
import { ChipMarkView, ChipSymbol, useChipMarkOf } from "./chip-mark.js";
import type { ChipMarkOf } from "./chip-mark-model.js";
import { ContextMenu } from "./context-menu.js";
import { DiagramBlock, DiagramRenderer } from "./diagram.js";
import { DraftCard } from "./draft-card.js";
import { ENTITY_GLYPH } from "./entity-glyph.js";
import { FileChip } from "./file-chip.js";
import { GLYPH, type Glyph, glyphSymbol } from "./glyph.js";
import {
  HeldMenu,
  PictureSetProvider,
  useKeeping,
  useKeptActs,
  usePicturesView,
  usePictureView,
} from "./held-menu.js";
import { ISSUE_LOOK, PULL_REQUEST_LOOK } from "./inbox-line-model.js";
import { KEPT_KIND, type Kept } from "./keep-model.js";
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
import { MediaBox } from "./media-box.js";
import { MediaFailed } from "./media-failed.js";
import { COLUMN_BOUNDS, type MediaBounds, type MediaSize, mediaFrame } from "./media-frame.js";
import {
  LoaderImage,
  PICTURE_FIT,
  type PictureRef,
  peekPicture,
  pictureUri,
  usePictureRef,
} from "./picture-source.js";
import { Press } from "./press.js";
import { type LongPressGroup, ROW_ACTION_TONE } from "./row-menu-model.js";
import {
  SUGGESTION_LOOK,
  SUGGESTION_SENT_WORDS,
  type SuggestionLook,
  suggestionHeard,
} from "./suggestion-look.js";
import { type BrandColors, type StatusTone, toneColor, useColors } from "./tokens/colors.js";
import { RADIUS, SPACE } from "./tokens/space.js";
import { MONOSPACE_FONT, PROSE_SIZE, ROLE_SIZE, TEXT_SIZE } from "./tokens/type.js";
import { Video } from "./video.js";

/** Each heading level's size and weight, a step above the body's words, never past a page's own heading. */
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

/** How wide the fade at a sideways scroller's edge stands, in points, where more stands past it. */
const EDGE_FADE = 24;

/** How far, in points, a scroller must stand from its edge before that edge counts as having more past it. */
const EDGE_SLACK = 1;

/** The edge of a sideways scroller a fade stands at, as a gradient's direction names it. */
const SCROLL_EDGE = { START: "left", END: "right" } as const;

type ScrollEdge = (typeof SCROLL_EDGE)[keyof typeof SCROLL_EDGE];

/** The share of a line's size an inline chip sits below the baseline by, so it centers on the words rather than standing on them. */
const CHIP_DROP = 0.22;

/** How much taller a picture chip's thumbnail stands than its words' glyph, in points, as the panel's thumbnail stands a hair taller than the words (`AttachmentRef`). */
const THUMBNAIL_LIFT = 2;

/** How round a picture chip's thumbnail is cut. */
const THUMBNAIL_CORNER = 4;

/** What a press on a picture chip is heard to do: open it, or read it again where it could not be read. */
const PICTURE_CHIP_HINT = {
  OPENS: "Opens full screen",
  READS_AGAIN: "Reads the picture again",
} as const;

/** How wide a list's marker column stands, in body sizes. */
const MARKER_WIDTH = 1.4;

/**
 * A bullet's dot, in body sizes: its width, how far below the line's top its
 * middle stands, which is the middle of the first line's lowercase letters,
 * as the panel's disc sits, and how far it stands in from the marker column's
 * edge, where an ordered list's number ends.
 */
const BULLET = { SIZE: 0.34, MIDDLE: 0.69, INSET: 0.2 } as const;

/**
 * How far apart a flow's blocks stand, in body sizes, as the panel's
 * Markdown flow sets them (`prose.css`'s `.ui-markdown-flow`): a paragraph's
 * gap between blocks, a heading close over what it names, a rule a gap and a
 * half from what it divides, and a list's items close together. Note that
 * these scale with the reader's text size, as the words do.
 */
const BLOCK_GAP = { BLOCK: 1, UNDER_HEADING: 0.25, RULE: 1.5, ITEM: 0.25 } as const;

/** How far apart the blocks inside one list item or one quote stand, in body sizes, as the panel's `li > * + *` and quote's own set them. */
const NESTED_GAP = 0.5;

/**
 * Where a list item's first line of words stands, in points from the item's
 * top, as the line was laid out: its baseline and its face's lowercase and
 * capital heights. Note that an inline chip makes its line taller and sets
 * the words lower in it, so a marker placed by the body size alone stood
 * high beside such a line; one placed on the measured baseline does not.
 */
type FirstLine = {
  readonly baseline: number;
  readonly xHeight: number;
  readonly capHeight: number;
};

/** Reports a list item's first line once it is laid out; none where nothing asks. */
type OnFirstLine = ((line: FirstLine) => void) | undefined;

/** How strongly a suggestion's or a diff's row is tinted, as a hex alpha: 14%, as the panel mixes `bg-code-added`. */
const ROW_TINT_ALPHA = "24";

/** A quote's rule, the line down its left. */
const QUOTE_RULE = 3;

/** How far a quote's words stand in from the column: its rule and its padding. */
const QUOTE_INSET = QUOTE_RULE + SPACE.ROW;

const styles = StyleSheet.create({
  marker: { position: "absolute", left: 0, top: 0 },
  quote: { borderLeftWidth: QUOTE_RULE, paddingLeft: SPACE.ROW },
  well: { borderRadius: RADIUS.BLOCK, paddingVertical: SPACE.ROW, overflow: "hidden" },
  wellLines: { paddingHorizontal: SPACE.ROW },
  wellTitle: { paddingHorizontal: SPACE.ROW, paddingBottom: SPACE.TIGHT },
  rows: { alignSelf: "flex-start", minWidth: "100%" },
  codeRow: { paddingHorizontal: SPACE.ROW },
  table: {
    alignSelf: "stretch",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.BLOCK,
    overflow: "hidden",
  },
  fade: { position: "absolute", top: 0, bottom: 0, width: EDGE_FADE, pointerEvents: "none" },
  row: { flexDirection: "row" },
  cell: { paddingHorizontal: SPACE.ROW, paddingVertical: 6 },
  // Note that a chip is the panel's pill (`InlineRef`'s `PILL`): a rounded fill with no edge, a little more room after its name than before its mark, and no height past the line's words, so no edge of it is cut where the line holds it.
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: RADIUS.TAG,
    paddingLeft: 4,
    paddingRight: 6,
  },
  picture: { width: "100%", borderRadius: RADIUS.BLOCK },
  pending: { alignItems: "center", justifyContent: "center" },
  pictureChip: { paddingLeft: 2, borderWidth: StyleSheet.hairlineWidth },
  measured: { alignSelf: "stretch" },
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
  /** Reads a picture that could not be read again, by the address its words name it by; none offers nothing. */
  readonly onRetryPicture: ((written: string) => void) | undefined;
  /** The video a picture's address names, played in its place; none where the address names a picture. */
  readonly videoAt: (written: string) => MarkdownVideo | undefined;
  /** The file a picture's address names, such as a PDF a description keeps as it keeps a picture, drawn as its chip in its place; none where the address names a picture. */
  readonly fileAt: (written: string) => MarkdownFile | undefined;
  /** Whether a heading is heard as one, on a page of words alone, where VoiceOver's Headings rotor walks its sections. */
  readonly headings: boolean;
  /** What GitHub holds of the pull request or issue a chip's page names, as the host read it; none while unread or unanswered. */
  readonly linkStanding: (page: string) => LinkStanding | undefined;
  /** The mark the app holds for the entity a chip names (`ChipMarkProvider`); none where it holds nothing. */
  readonly markOf: ChipMarkOf;
  /** How a suggestion's link stands, by its button and the words it was written with; none where it is drawn as the plain link it is. */
  readonly suggestion: (link: ReplyButtonLink, words: string) => SuggestionLook | undefined;
  /** The picture the words name by its marker, by its name, which its chip draws; none for a marker of no picture the message carries. */
  readonly wordPicture: (name: string) => MarkdownWordPicture | undefined;
  /** Opens pictures full screen where no thumbnail stands for them, as VoiceOver's action on a chip opens its picture; none where no app answers it. */
  readonly viewPictures: ReturnType<typeof usePicturesView>;
  /** How many lists stand around the words, which a bullet's mark follows as a browser's does: a disc, then a ring, then a square; none outside a list. */
  readonly listDepth?: number | undefined;
}

/** A chip of a GitHub page as its standing draws it: its mark, its name, and its state's words after it. */
type StandingLook = {
  readonly glyph: Glyph;
  readonly tone: StatusTone;
  readonly name: string;
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
 * its state's mark, its words heard alone; an issue by its number and
 * title, likewise; none where GitHub has answered nothing of it.
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
      heard: standingHeard(chip, name, standing.state),
    };
  }

  if (standing?.issue !== undefined) {
    const look = ISSUE_LOOK[standing.issue.state];
    const name = `#${standing.issue.number} ${standing.title}`;
    const heard = standingHeard(chip, name, standing.state);

    return { ...look, glyph: look.symbol, name, heard };
  }

  return undefined;
}

/** A chip as VoiceOver hears it: as its standing shows it once GitHub has answered, else by its kind and written name. */
function chipHeard(chip: MarkdownChip, drawing: Drawing): string {
  return standingLook(chip, drawing)?.heard ?? chip.heard;
}

/**
 * A chip's long press menu, as the panel's right-click on a link offers it
 * (`link-menu.tsx`): Open link, where a press on it would open it, and Copy
 * link, its address as written, in the system's own menu under the chip's
 * name (`ContextMenu`). None for a chip that goes nowhere, or where no app
 * copies.
 */
function useChipMenu(
  target: LinkTarget,
  onOpen: (() => void) | undefined,
): readonly LongPressGroup[] {
  const keeping = useKeeping();

  if (target.kind === LINK_TARGET.NONE || onOpen === undefined || keeping === undefined) return [];

  const { href } = target;

  return [
    [
      {
        label: LINK_MENU_WORDS.OPEN,
        symbol: GLYPH.OPEN_EXTERNALLY,
        tone: ROW_ACTION_TONE.NEUTRAL,
        onPress: onOpen,
      },
      {
        label: LINK_MENU_WORDS.COPY,
        symbol: GLYPH.LINK,
        tone: ROW_ACTION_TONE.NEUTRAL,
        onPress: () => keeping.copyWords(href),
      },
    ],
  ];
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

/** A mention as its chip, standing in the line of words: its kind's glyph and its name, pressed open where it goes anywhere, and held for Open link and Copy link (`useChipMenu`). */
function MentionChip({
  chip,
  drawing,
}: {
  readonly chip: MarkdownChip;
  readonly drawing: Drawing;
}) {
  const { colors, fontScale } = drawing;
  const onPress = open(chip.target, drawing);
  const size = ROLE_SIZE.ROW_LINE;
  const standing = standingLook(chip, drawing);
  const heard = standing?.heard ?? chip.heard;
  const name = standing?.name ?? chip.name;
  const menu = useChipMenu(chip.target, onPress);

  // Note that a GitHub page's standing wins over the entity's mark, since only the provider's answer says where it stands.
  const mark =
    standing === undefined && chip.of !== undefined ? drawing.markOf(chip.of) : undefined;

  const markSize = size * fontScale;

  return (
    <View style={{ transform: [{ translateY: PROSE_SIZE * CHIP_DROP * fontScale }] }}>
      <ContextMenu groups={menu} title={name}>
        <Press
          onPress={onPress}
          disabled={onPress === undefined}
          accessibilityRole={onPress === undefined ? "text" : "link"}
          accessibilityLabel={heard}
          style={[
            styles.chip,
            {
              maxWidth: drawing.lineWidth,
              backgroundColor: colors.FILL_STRONG,
            },
          ]}
        >
          {mark === undefined ? (
            <ChipSymbol
              glyph={standing?.glyph ?? ENTITY_GLYPH[chip.entity]}
              size={markSize}
              color={standing === undefined ? colors.TEXT_MUTED : toneColor(colors, standing.tone)}
            />
          ) : (
            <ChipMarkView mark={mark} size={markSize} colors={colors} />
          )}
          <Text
            numberOfLines={1}
            style={{ flexShrink: 1, fontSize: size, color: colors.TEXT, fontWeight: "500" }}
          >
            {name}
          </Text>
        </Press>
      </ContextMenu>
    </View>
  );
}

/**
 * A picture the words name by its marker, "[Picture 1]", as its chip
 * standing in the line where the marker was written, as the panel's
 * message draws it (`AttachmentRef`): the picture's thumbnail, a square cut
 * from it a hair taller than the words, then its name, in a mention chip's
 * shape inside a hairline, so it reads on a bubble's fill as on the page. A
 * press opens the picture full screen in the app's viewer, grown out of the
 * thumbnail, as a message's own picture opens; a picture still on its way
 * wears the picture glyph in the thumbnail's box, so the chip keeps its
 * width as the bytes land, and one that could not be read wears the failed
 * glyph and reads it again on a press. Note that the thumbnail is React
 * Native's image at the chip's size, which decodes the picture down to the
 * pixels it stands at and keeps that small bitmap in its cache, so a long
 * transcript's chips scroll without decoding each full-size picture again.
 */
function PictureChip({ name, drawing }: { readonly name: string; readonly drawing: Drawing }) {
  const { colors, fontScale } = drawing;
  const picture = drawing.wordPicture(name);
  const source = usePictureRef(picture?.source);
  const drawn = useRef<ComponentRef<typeof View>>(null);
  const show = usePictureView(source == null ? source : pictureUri(source), name, drawn);
  const unread = source === null;
  const onPress = unread ? picture?.onRetry : show;
  const markSize = ROLE_SIZE.ROW_LINE * fontScale;
  const side = Math.ceil(markSize) + THUMBNAIL_LIFT;
  const thumbnail = { width: side, height: side, borderRadius: THUMBNAIL_CORNER };

  return (
    <View style={{ transform: [{ translateY: PROSE_SIZE * CHIP_DROP * fontScale }] }}>
      <Press
        onPress={onPress}
        disabled={onPress === undefined}
        accessibilityRole="imagebutton"
        accessibilityLabel={unread ? unreadWords(name) : name}
        accessibilityHint={
          onPress === undefined
            ? undefined
            : unread
              ? PICTURE_CHIP_HINT.READS_AGAIN
              : PICTURE_CHIP_HINT.OPENS
        }
        testID="markdown-picture-chip"
        style={[
          styles.chip,
          styles.pictureChip,
          {
            maxWidth: drawing.lineWidth,
            backgroundColor: colors.FILL_STRONG,
            borderColor: colors.CHIP_EDGE,
          },
        ]}
      >
        {source != null ? (
          <LoaderImage drawn={drawn} source={source} fit={PICTURE_FIT.COVER} style={thumbnail} />
        ) : (
          <View style={[thumbnail, styles.pending]}>
            <ChipSymbol
              glyph={unread ? GLYPH.FAILED : GLYPH.IMAGE}
              size={markSize}
              color={colors.TEXT_MUTED}
            />
          </View>
        )}
        <Text
          numberOfLines={1}
          style={{
            flexShrink: 1,
            fontSize: ROLE_SIZE.ROW_LINE,
            color: colors.TEXT,
            fontWeight: "500",
          }}
        >
          {name}
        </Text>
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
  const size = ROLE_SIZE.ROW_LINE;
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
            backgroundColor: colors.FILL_STRONG,
          },
        ]}
      >
        <ChipSymbol
          glyph={offered ? SUGGESTION_SYMBOL : ENTITY_GLYPH[ENTITY_KIND.AGENT]}
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
            <ChipSymbol
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
            fontSize: ROLE_SIZE.ROW_LINE,
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
    case MARKDOWN_RUN.PICTURE:
      return <PictureChip name={run.name} drawing={drawing} />;
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
    } else if (run.kind === MARKDOWN_RUN.PICTURE) {
      const ref = drawing.wordPicture(run.name)?.source;
      const view = drawing.viewPictures;

      if (ref != null && view !== undefined) {
        openings.push({
          name: `open-${openings.length}`,
          label: `${OPEN_WORD} ${run.name}`,
          // Note that what the picture is drawn from is read as the action runs, since a picture kept by its id lands after the line is drawn.
          onOpen: () => {
            const source = peekPicture(ref);

            if (source != null) {
              view([{ source: pictureUri(source), title: run.name, subtitle: undefined }], 0);
            }
          },
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
    case MARKDOWN_RUN.PICTURE:
      return run.name;
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

/** Reads a laid-out line's first line for `onFirstLine`. Note that iOS reports each line's `ascender` as its baseline's offset from the line's top, measured, so a chip's height is in it. */
function firstLineOf(onFirstLine: (line: FirstLine) => void) {
  return (event: TextLayoutEvent) => {
    const first = event.nativeEvent.lines[0];

    if (first === undefined) return;

    onFirstLine({
      baseline: first.y + first.ascender,
      xHeight: first.xHeight,
      capHeight: first.capHeight,
    });
  };
}

/** A line of words: a paragraph's, a heading's, or a table cell's. */
function Line({
  runs,
  drawing,
  style,
  heading,
  onFirstLine,
  after,
}: {
  readonly runs: readonly MarkdownRun[];
  readonly drawing: Drawing;
  readonly style?: TextStyle | undefined;
  /** Whether the line is heard as a heading. */
  readonly heading?: boolean | undefined;
  readonly onFirstLine?: OnFirstLine;
  /** Muted words that run on after the line's own, as an edited message's mark; none on most lines. */
  readonly after?: string | undefined;
}) {
  const openings = lineOpenings(runs, drawing);
  const heard = lineHeard(runs, drawing);

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
      // Note that a line of words alone is heard from its words and the mark after them as they stand, so only a line heard by a label of its own takes the mark into it.
      accessibilityLabel={heard === undefined || after === undefined ? heard : `${heard} ${after}`}
      {...(heading === true ? { accessibilityRole: "header" as const } : {})}
      {...actions}
      {...(onFirstLine === undefined ? {} : { onTextLayout: firstLineOf(onFirstLine) })}
      style={[{ fontSize: PROSE_SIZE, color: drawing.colors.TEXT_BODY }, style]}
    >
      <Runs runs={runs} drawing={drawing} />
      {after === undefined ? null : (
        <Text style={{ fontSize: ROLE_SIZE.TIME, color: drawing.colors.TEXT_MUTED }}>
          {` ${after}`}
        </Text>
      )}
    </Text>
  );
}

/** What a task box in a list is heard as, ticked or not. */
const TASK_BOX_HEARD = { DONE: "Done", OPEN: "Not done" } as const;

/** A bullet's mark at each depth, as the desktop's browser marks nested lists: a disc, a ring, a square, then round again. */
const BULLET_MARK = { DISC: "disc", RING: "ring", SQUARE: "square" } as const;

type BulletMark = (typeof BULLET_MARK)[keyof typeof BULLET_MARK];

const BULLET_MARKS: readonly BulletMark[] = [
  BULLET_MARK.DISC,
  BULLET_MARK.RING,
  BULLET_MARK.SQUARE,
];

/** The ring's line, a share of the bullet's width, as the field draws it. */
const RING_LINE = 0.16;

/** A square's side, a share of the bullet's width, so it reads no heavier than the disc, as the field draws it. */
const SQUARE_SHARE = 0.84;

/** A list item's marker: its task box, its number, or its bullet. */
function Marker({
  checked,
  number,
  firstLine,
  drawing,
}: {
  readonly checked: boolean | undefined;
  readonly number: number | undefined;
  /** The item's first line as laid out; none until it is, or where the item opens with no line of words. */
  readonly firstLine: FirstLine | undefined;
  readonly drawing: Drawing;
}) {
  const { colors, fontScale } = drawing;
  const width = PROSE_SIZE * MARKER_WIDTH * fontScale;
  const size = PROSE_SIZE * fontScale;

  // Note that each marker centers on the first line as measured, a box on its capitals and a bullet on its lowercase letters, and falls back to the body size's own place until the line is laid out.
  const centerOn = (height: number, middle: (line: FirstLine) => number, fallback: number) =>
    firstLine === undefined ? fallback : Math.max(0, middle(firstLine) - height / 2);

  if (checked !== undefined) {
    return (
      <View
        style={{
          width,
          paddingTop: centerOn(size, (line) => line.baseline - line.capHeight / 2, 2 * fontScale),
        }}
        accessible
        accessibilityRole="checkbox"
        accessibilityLabel={checked ? TASK_BOX_HEARD.DONE : TASK_BOX_HEARD.OPEN}
        accessibilityState={{ checked }}
      >
        <SymbolView
          name={glyphSymbol(checked ? GLYPH.BOX_TICKED : GLYPH.BOX)}
          size={size}
          tintColor={checked ? colors.ACCENT : colors.TEXT_MUTED}
        />
      </View>
    );
  }

  // Note that a bullet is a dot drawn at the panel's disc's size on the first line's lowercase letters, since the bullet character stands small and high in the system face; it is never heard, while an ordered list's number is, since its order is part of what it says.
  if (number === undefined) {
    const dot = size * BULLET.SIZE;
    const mark = BULLET_MARKS[(drawing.listDepth ?? 0) % BULLET_MARKS.length] ?? BULLET_MARK.DISC;
    const ring = Math.max(1, dot * RING_LINE);

    return (
      <View
        style={{
          width,
          alignItems: "flex-end",
          paddingTop: centerOn(
            dot,
            (line) => line.baseline - line.xHeight / 2,
            size * BULLET.MIDDLE - dot / 2,
          ),
          paddingRight: size * BULLET.INSET,
        }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View
          style={
            mark === BULLET_MARK.RING
              ? {
                  width: dot,
                  height: dot,
                  borderRadius: dot / 2,
                  borderWidth: ring,
                  borderColor: colors.TEXT_MUTED,
                }
              : mark === BULLET_MARK.SQUARE
                ? {
                    width: dot * SQUARE_SHARE,
                    height: dot * SQUARE_SHARE,
                    margin: (dot * (1 - SQUARE_SHARE)) / 2,
                    backgroundColor: colors.TEXT_MUTED,
                  }
                : {
                    width: dot,
                    height: dot,
                    borderRadius: dot / 2,
                    backgroundColor: colors.TEXT_MUTED,
                  }
          }
        />
      </View>
    );
  }

  return <ItemNumber number={number} width={width} firstLine={firstLine} drawing={drawing} />;
}

/** An ordered item's number, set on the item's first line's baseline: it measures its own and stands lower by however far the item's line sets its words lower. */
function ItemNumber({
  number,
  width,
  firstLine,
  drawing,
}: {
  readonly number: number;
  readonly width: number;
  readonly firstLine: FirstLine | undefined;
  readonly drawing: Drawing;
}) {
  const [own, setOwn] = useState<number | undefined>(undefined);

  const drop =
    firstLine === undefined || own === undefined ? 0 : Math.max(0, firstLine.baseline - own);

  // Note that the drop stands on a box around the number rather than on its words, so the number's own measured baseline never moves with it.
  return (
    <View style={{ paddingTop: drop }}>
      <Text
        onTextLayout={firstLineOf((line) => setOwn(line.baseline))}
        style={{
          width,
          fontSize: PROSE_SIZE,
          color: drawing.colors.TEXT_MUTED,
          textAlign: "right",
        }}
      >
        {`${number}.`}
      </Text>
    </View>
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

  const itemGap = PROSE_SIZE * BLOCK_GAP.ITEM * drawing.fontScale;

  return (
    <View style={{ gap: itemGap }}>
      {block.items.map((item, at) => (
        <ListItem
          key={at}
          item={item}
          number={block.start === undefined ? undefined : block.start + at}
          indent={indent}
          drawing={drawing}
        />
      ))}
    </View>
  );
}

/** One list item: its marker in the margin, placed on the item's first line as laid out, beside its blocks. */
function ListItem({
  item,
  number,
  indent,
  drawing,
}: {
  readonly item: Extract<MarkdownBlock, { kind: typeof MARKDOWN_BLOCK.LIST }>["items"][number];
  readonly number: number | undefined;
  readonly indent: number;
  readonly drawing: Drawing;
}) {
  const [firstLine, setFirstLine] = useState<FirstLine | undefined>(undefined);

  // Note that a layout reporting the same line keeps the state as it stands, so a redraw of the words never draws the item again.
  const onFirstLine = (line: FirstLine) =>
    setFirstLine((held) =>
      held !== undefined &&
      held.baseline === line.baseline &&
      held.xHeight === line.xHeight &&
      held.capHeight === line.capHeight
        ? held
        : line,
    );

  return (
    <View style={{ paddingLeft: indent }}>
      {/* Note that an empty item's marker stands in the flow, pulled back into the margin, since an item with no words would otherwise take no height and the next item would draw over its marker. */}
      <View style={item.blocks.length === 0 ? { marginLeft: -indent } : styles.marker}>
        <Marker checked={item.checked} number={number} firstLine={firstLine} drawing={drawing} />
      </View>
      {/* Note that the item's chips are held to the width left beside its marker, so one in a list never runs past the column. */}
      <Blocks
        blocks={item.blocks}
        drawing={{
          ...drawing,
          lineWidth: drawing.lineWidth - indent,
          listDepth: (drawing.listDepth ?? 0) + 1,
        }}
        gap={NESTED_GAP}
        onFirstLine={onFirstLine}
      />
    </View>
  );
}

/** A color with none of it showing, the clear end of a fade into it. */
function clearOf(color: string): string {
  return /^#[\da-f]{6}$/iu.test(color) ? `${color}00` : "transparent";
}

/** A fade over a sideways scroller's edge into its card's fill, toward the edge it stands at. */
function EdgeFade({ ground, side }: { readonly ground: string; readonly side: ScrollEdge }) {
  return (
    <View
      style={[
        styles.fade,
        side === SCROLL_EDGE.START ? { left: 0 } : { right: 0 },
        { backgroundImage: `linear-gradient(to ${side}, ${clearOf(ground)}, ${ground})` },
      ]}
    />
  );
}

/**
 * What stands wider than its card scrolls sideways inside it, as the
 * desktop's card scrolls a block of code or a table: the system's scroll
 * indicator at its foot, flashed once as it first stands wider than the
 * card, as iOS hints at more past a scroller's edge, and, given the card's
 * fill as `ground`, a fade at each edge more stands past, so a line cut at
 * the card's edge reads as one that goes on rather than one the screen
 * cut. Note that it takes a pan only once the pan moves sideways, as UIKit
 * settles a pan between two scrollers crossing, so the page still scrolls
 * up and down over it.
 */
function SidewaysScroll({
  ground,
  lines,
  children,
}: {
  readonly ground?: string | undefined;
  /** The inset its content stands in from its own edges, which the content scrolls through. */
  readonly lines?: ViewStyle | undefined;
  readonly children: ReactNode;
}) {
  const scroller = useRef<ScrollViewInstance>(null);
  const [card, setCard] = useState(0);
  const [content, setContent] = useState(0);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const wider = card > 0 && content > card + EDGE_SLACK;

  // Note that the hint flashes once, as the block first stands wider than its card.
  useEffect(() => {
    if (wider) scroller.current?.flashScrollIndicators();
  }, [wider]);

  return (
    <View>
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator
        scrollEventThrottle={32}
        contentContainerStyle={lines}
        onLayout={(event) => setCard(event.nativeEvent.layout.width)}
        onContentSizeChange={(width) => setContent(width)}
        onScroll={(event) => {
          const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
          setAtStart(contentOffset.x <= EDGE_SLACK);
          setAtEnd(contentOffset.x + layoutMeasurement.width >= contentSize.width - EDGE_SLACK);
        }}
      >
        {children}
      </ScrollView>
      {ground === undefined || !wider || atStart ? null : (
        <EdgeFade ground={ground} side={SCROLL_EDGE.START} />
      )}
      {ground === undefined || !wider || atEnd ? null : (
        <EdgeFade ground={ground} side={SCROLL_EDGE.END} />
      )}
    </View>
  );
}

/**
 * A table, scrolling sideways inside its own bordered box, which stands
 * still at the words' width while its columns move inside it, as a code
 * block's well does, so a table wider than the page scrolls within the
 * page's inset rather than running past its edge, its border showing where
 * the box ends. Note that React Native has
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
    <View style={[styles.table, { borderColor: colors.CHIP_EDGE }]}>
      <SidewaysScroll>
        <View>
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
                      fontSize: ROLE_SIZE.ROW_LINE,
                      textAlign: TEXT_ALIGN[block.align[columnAt] ?? COLUMN_ALIGN.START],
                      ...(rowAt === 0 && { fontWeight: "600", color: colors.TEXT }),
                    }}
                  />
                </View>
              ))}
            </View>
          ))}
        </View>
      </SidewaysScroll>
    </View>
  );
}

/** The tint each row of a suggestion or a diff stands on, by what it does: the done tone for a line added and the danger tone for one removed, faint, as the panel's `bg-code-added` and `bg-code-removed` mix them at 14%, and none for a line as it stood. */
function rowTint(kind: CodeRow, colors: BrandColors): string | undefined {
  if (kind === CODE_ROW.ADDED) return `${colors.COMPLETE}${ROW_TINT_ALPHA}`;

  return kind === CODE_ROW.REMOVED ? `${colors.DANGER}${ROW_TINT_ALPHA}` : undefined;
}

/**
 * A block of code, in the monospaced face on a well, scrolling sideways
 * rather than wrapping its lines, which run under the well's edge into a
 * fade where more of them stands past it. A fence that names its language
 * is headed by it, muted, as the panel's code card heads one ("TypeScript",
 * "Suggested change"), and a suggestion's or a diff's lines stand as rows on
 * the added and removed lines' tints, each as wide as the widest, edge to
 * edge.
 */
function CodeView({
  text,
  title,
  rows,
  drawing,
}: {
  readonly text: string;
  readonly title?: string | undefined;
  readonly rows?: readonly FenceRow[] | undefined;
  readonly drawing: Drawing;
}) {
  const { colors } = drawing;
  const face = { fontFamily: MONOSPACE_FONT, fontSize: ROLE_SIZE.TIME, color: colors.TEXT };

  return (
    <View style={[styles.well, { backgroundColor: colors.WELL }]}>
      {title === undefined ? null : (
        <Text style={[styles.wellTitle, { fontSize: ROLE_SIZE.TIME, color: colors.TEXT_MUTED }]}>
          {title}
        </Text>
      )}
      {rows === undefined ? (
        <SidewaysScroll ground={colors.WELL} lines={styles.wellLines}>
          <Text selectable style={face}>
            {text}
          </Text>
        </SidewaysScroll>
      ) : (
        <SidewaysScroll ground={colors.WELL}>
          <View style={styles.rows}>
            {rows.map((row, at) => (
              // Note that two rows may hold the same words, so each is keyed by its place.
              <Text
                key={`${at}`}
                selectable
                style={[face, styles.codeRow, { backgroundColor: rowTint(row.kind, colors) }]}
              >
                {row.text === "" ? " " : row.text}
              </Text>
            ))}
          </View>
        </SidewaysScroll>
      )}
    </View>
  );
}

/** What a picture that could not be read is heard as, its own words first, as the panel's stand-in says it. */
function unreadWords(alt: string): string {
  return `${alt.trim() === "" ? "This picture" : alt} ${MEDIA_READ_WORDS.COULD_NOT_READ}`;
}

type PictureProps = {
  /** What the picture is drawn from, a file's or the service's address, or its id for the page to read here (`usePictureRef`); none while it is still on its way, which stands its well alone, and `null` where it could not be read, which says so in its well. */
  readonly source: PictureRef | null | undefined;
  /** What the picture shows, heard in its place. */
  readonly alt: string;
  /** A tile's fixed shape, width over height, the picture standing whole inside it, as wide as its tile; the picture's own shape and size, held to `MEDIA_BOUNDS`, where none is given. */
  readonly tileAspect?: number | undefined;
  /** Reads the picture again where it could not be read; none offers nothing. */
  readonly onRetry?: (() => void) | undefined;
  /** Whether it fills its tile, cropped as a set's tiles stand, rather than standing whole inside it. */
  readonly fill?: boolean | undefined;
  /** Its own size in points where it is known before it loads, as a diagram drawn at the screen's scale is, whose pixels would read as three times its size; the pixels it reports, one to a point, where none is given. */
  readonly size?: MediaSize | undefined;
  /** The most it stands at, a message's `MEDIA_BOUNDS` where none is given; a diagram's is its column's width alone (`COLUMN_BOUNDS`). */
  readonly bounds?: MediaBounds | undefined;
};

/**
 * A picture at its message's width, which a press opens full screen in the
 * app's viewer, grown out of the thumbnail and drawn at once from the bitmap
 * the thumbnail shows, as Photos opens one, where a drag down closes it, a
 * double tap or a pinch zooms it, and its share button copies, saves or
 * shares it. A long press offers the same
 * acts in place. Note that a picture still on its way stands as its well at
 * the shape a picture most often is, the system's spinner in it as Photos
 * stands one, so the words under it do not jump twice and it never reads as
 * an empty box.
 */
export function Picture({
  source: ref,
  alt,
  tileAspect,
  onRetry,
  fill = false,
  size,
  bounds,
}: PictureProps) {
  const colors = useColors();
  // Note that a picture kept by its id is read here, so its landing draws this picture again and never its row, which may hold an open long-press menu.
  const source = usePictureRef(ref);
  const [natural, setNatural] = useState<MediaSize | undefined>(undefined);
  const [boxWidth, setBoxWidth] = useState<number | undefined>(undefined);
  const heard = alt === "" ? "Picture" : alt;

  const uri = source == null ? source : pictureUri(source);

  const kept: Kept | undefined =
    uri == null ? undefined : { kind: KEPT_KIND.PICTURE, source: uri, name: heard };

  const acts = useKeptActs(kept);
  const drawn = useRef<ComponentRef<typeof View>>(null);
  const show = usePictureView(uri, heard, drawn);

  // Note that a tile fills its tile at the tile's shape, and any other picture stands at its own shape and size, held to the one rule every message's media keeps (`mediaFrame`) in its box (`MediaBox`).
  const frame = tileAspect === undefined ? mediaFrame(size ?? natural, bounds) : undefined;

  const well = [
    styles.picture,
    { aspectRatio: tileAspect ?? frame?.aspectRatio, backgroundColor: colors.WELL },
  ];

  if (source === undefined) {
    return (
      <MediaBox frame={frame}>
        <View style={[well, styles.pending]} accessible accessibilityLabel={heard}>
          <ActivityIndicator color={colors.TEXT_MUTED} />
        </View>
      </MediaBox>
    );
  }

  // Note that a picture that could not be read says so in its well, as the panel's stand-in does, rather than spin as one still on its way.
  if (source === null) {
    return (
      <MediaBox frame={frame}>
        <MediaFailed
          line={MEDIA_READ_WORDS.PICTURE_FAILED}
          heard={unreadWords(alt)}
          onRetry={onRetry}
          style={well}
        />
      </MediaBox>
    );
  }

  // Note that the picture stands as its well until the width its box gives it is known, and is then held to that width from its first frame in its menu's host, since a host that measures its own width a frame later laid the picture out with none, at no height, and its message stood collapsed until the picture drew. The box keeps measuring, so a turn of the screen bounds it anew.
  return (
    <MediaBox frame={frame}>
      <View
        style={styles.measured}
        onLayout={(event) => setBoxWidth(event.nativeEvent.layout.width)}
      >
        {boxWidth === undefined ? (
          <View style={well} accessible accessibilityLabel={heard} />
        ) : (
          <HeldMenu acts={acts} width={boxWidth}>
            <Press
              onPress={show}
              disabled={source == null}
              accessibilityRole="imagebutton"
              accessibilityLabel={heard}
              accessibilityHint="Opens full screen"
              testID="markdown-picture"
            >
              <LoaderImage
                drawn={drawn}
                source={source}
                fit={fill ? PICTURE_FIT.COVER : PICTURE_FIT.CONTAIN}
                onSize={(width, height) => {
                  if (width > 0 && height > 0) setNatural({ width, height });
                }}
                style={well}
              />
            </Press>
          </HeldMenu>
        )}
      </View>
    </MediaBox>
  );
}

/** What a file's chip is named where its words gave it no name. */
const UNNAMED_FILE = "Attachment";

/** A picture's block: the file its address names, as its chip, the video or sound clip, played in its place, or the picture. */
function PictureBlock({
  source,
  alt,
  drawing,
}: {
  readonly source: string;
  readonly alt: string;
  readonly drawing: Drawing;
}) {
  const file = drawing.fileAt(source);

  // Note that a file is named by the words naming it, as the panel's chip is, since its address names no file.
  if (file !== undefined) {
    return (
      <FileChip
        name={alt.trim() === "" ? UNNAMED_FILE : alt.trim()}
        mediaType={file.mediaType}
        source={file.source}
        size={file.size}
      />
    );
  }

  const video = drawing.videoAt(source);

  if (video === undefined) {
    const retry = drawing.onRetryPicture;

    return (
      <Picture
        source={drawing.pictureSource(source)}
        alt={alt}
        onRetry={retry === undefined ? undefined : () => retry(source)}
      />
    );
  }

  const label = alt.trim() === "" ? video.label : alt;

  if (video.audio === true) {
    return <AudioClip source={video.source} label={label} onRetry={video.onRetry} />;
  }

  return (
    <Video
      source={video.source}
      label={label}
      onOpenElsewhere={video.onOpenElsewhere}
      onRetry={video.onRetry}
    />
  );
}

function BlockView({
  block,
  drawing,
  onFirstLine,
  after,
}: {
  readonly block: MarkdownBlock;
  readonly drawing: Drawing;
  /** Reports a heading's or a paragraph's first line, where a list item opens with it. */
  readonly onFirstLine?: OnFirstLine;
  /** Muted words a paragraph runs on into after its own (`Line`'s `after`). */
  readonly after?: string | undefined;
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
          onFirstLine={onFirstLine}
        />
      );
    case MARKDOWN_BLOCK.PARAGRAPH:
      return <Line runs={block.runs} drawing={drawing} onFirstLine={onFirstLine} after={after} />;
    case MARKDOWN_BLOCK.LIST:
      return <ListView block={block} drawing={drawing} />;
    case MARKDOWN_BLOCK.QUOTE:
      return (
        <View style={[styles.quote, { borderColor: colors.CHIP_EDGE }]}>
          {/* Note that a quote's chips are held to the width inside its rule and padding. */}
          <Blocks
            blocks={block.blocks}
            drawing={{ ...drawing, lineWidth: drawing.lineWidth - QUOTE_INSET }}
            gap={NESTED_GAP}
          />
        </View>
      );
    case MARKDOWN_BLOCK.TABLE:
      return <TableView key={drawing.fontScale} block={block} drawing={drawing} />;
    case MARKDOWN_BLOCK.CODE:
      return <CodeView text={block.text} title={block.title} rows={block.rows} drawing={drawing} />;
    case MARKDOWN_BLOCK.DIAGRAM:
      return (
        <DiagramBlock
          code={block.code}
          codeView={<CodeView text={block.code} drawing={drawing} />}
          picture={(picture, alt) => (
            <Picture
              source={picture?.source}
              alt={alt}
              size={picture?.size}
              bounds={COLUMN_BOUNDS}
            />
          )}
        />
      );
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

/** The space over a block, in body sizes, by what stands before it: none over the first, a heading's close gap under a heading, a rule's wider gap around a rule, and `gap` otherwise. */
function gapOver(block: MarkdownBlock, before: MarkdownBlock | undefined, gap: number): number {
  if (before === undefined) return 0;

  if (block.kind === MARKDOWN_BLOCK.RULE || before.kind === MARKDOWN_BLOCK.RULE) {
    return BLOCK_GAP.RULE;
  }

  return before.kind === MARKDOWN_BLOCK.HEADING ? BLOCK_GAP.UNDER_HEADING : gap;
}

/** A run of blocks, each set its gap below the one before it, as the panel's flow spaces them; `gap` is the plain gap, a page's or a list item's. */
function Blocks({
  blocks,
  drawing,
  gap = BLOCK_GAP.BLOCK,
  onFirstLine,
  after,
}: {
  readonly blocks: readonly MarkdownBlock[];
  readonly drawing: Drawing;
  readonly gap?: number;
  /** Reports the first block's first line, a list item's, which its marker stands on. */
  readonly onFirstLine?: OnFirstLine;
  /** Muted words the last block, a paragraph, runs on into after its own. */
  readonly after?: string | undefined;
}): ReactNode {
  return blocks.map((block, at) => (
    <View
      key={at}
      style={{ marginTop: PROSE_SIZE * gapOver(block, blocks[at - 1], gap) * drawing.fontScale }}
    >
      <BlockView
        block={block}
        drawing={drawing}
        onFirstLine={at === 0 ? onFirstLine : undefined}
        after={at === blocks.length - 1 ? after : undefined}
      />
    </View>
  ));
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
  /** Whether raw HTML in the words stays unseen, as GitHub's page hides a pull request body's comments and tags; it is drawn as written where none is given. */
  readonly hidesHtml?: boolean | undefined;
  /** The address a picture is drawn from, by the address its words name it by, such as a `data:` address of a thread's own file; none while it is on its way, and `null` where it could not be read. Each is drawn from the address it names where none is given. */
  readonly pictureSource?: ((written: string) => string | null | undefined) | undefined;
  /** Reads a picture that could not be read again, by the address its words name it by; a picture that could not be read offers nothing where none is given. */
  readonly onRetryPicture?: ((written: string) => void) | undefined;
  /** The video a picture's address names, such as a recording a thread carried, played in its place; every address names a picture where none is given. */
  readonly videoAt?: ((written: string) => MarkdownVideo | undefined) | undefined;
  /** The file a picture's address names, such as a PDF a description keeps, drawn as its chip in its place; every address names a picture where none is given. */
  readonly fileAt?: ((written: string) => MarkdownFile | undefined) | undefined;
  /** Whether its headings are heard as headings, on a page of words alone; a message's are styled alone. */
  readonly headings?: boolean | undefined;
  /** What GitHub holds of a pull request or issue a chip names, by its page (`markdownGithubPages`), which the chip says where it stands; every chip says what its link says where none is given. */
  readonly linkStanding?: ((page: string) => LinkStanding | undefined) | undefined;
  /** How a suggestion an agent wrote into its reply stands, by its button (`markdownReplyButtons`) and its words; every suggestion is drawn as its plain link where none is given. */
  readonly suggestion?:
    | ((link: ReplyButtonLink, words: string) => SuggestionLook | undefined)
    | undefined;
  /** The widest the words stand where the caller knows it before they are laid out, as a transcript's row does, which holds a chip until they are measured; the window's width less a page's margins where none is given. */
  readonly width?: number | undefined;
  /** Whether a Mermaid fence is drawn as its diagram, as a description's are (`DiagramBlock`); it stands as its code where none is given, as a transcript still being written keeps it. */
  readonly diagrams?: boolean | undefined;
  /** The names of the pictures the message carries that its words name by their markers ("Picture 1"), each marker drawn as its chip (`PictureChip`); every marker stays its words where none is given. Note that the words are read again only when this changes, so a caller hands the same one while the names stand. */
  readonly wordPictures?: Pick<ReadonlySet<string>, "has"> | undefined;
  /** The picture a marker names, by its name, which its chip is drawn from. */
  readonly wordPicture?: ((name: string) => MarkdownWordPicture | undefined) | undefined;
  /** Muted words standing right after the words, run on after the last paragraph's, as an edited message's "(edited)"; none on most words. */
  readonly after?: string | undefined;
};

/** A picture the words name by its marker, as its chip draws it: the address it is drawn from, none while its bytes are on their way and `null` where they could not be read, and what reads it again. */
export interface MarkdownWordPicture {
  readonly source: PictureRef | null | undefined;
  readonly onRetry?: (() => void) | undefined;
}

/** A video or a sound clip the words name as a picture, played in its place: the file it plays from, none while it is on its way and `null` where it could not be read, its name, whether it is a sound clip, where a video opens where the player cannot read it, and what reads it again. */
export interface MarkdownVideo {
  readonly source: string | null | undefined;
  readonly label: string;
  /** Whether it is a sound clip, played in its strip (`AudioClip`) rather than a film's player. */
  readonly audio?: boolean | undefined;
  readonly onOpenElsewhere?: (() => void) | undefined;
  readonly onRetry?: (() => void) | undefined;
}

/** A file the words name as a picture, drawn as its chip in its place: the file of the app's caches it opens from, its type, and its size in words. One that could not be read stands as a picture that could not be. */
export interface MarkdownFile {
  readonly source: string;
  readonly mediaType: string;
  readonly size: string | undefined;
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

/** No address naming a file. */
function noFile(): undefined {
  return undefined;
}

/** No picture named by a marker. */
function noWordPicture(): undefined {
  return undefined;
}

/**
 * Words drawn as the Markdown they were written in, as the panel draws a
 * message: the panel's parse (`@repo/features/markdown-tree`), read into
 * blocks by `markdown-model.ts`, in the brand's colors for the window's
 * scheme and at the reader's Dynamic Type size. It draws no scroller of its
 * own, so a screen stands it in its own. Note that a chip is held to the
 * width the words stand in, measured once they are laid out, since an open
 * iPhone Duo's or an iPad's detail column is far narrower than the window;
 * until then, to the width its caller knows they stand in, else the window's
 * width less a page's margins.
 */
export function Markdown({
  words,
  repository = null,
  onOpenLink,
  typed,
  hidesHtml,
  pictureSource = namedSource,
  onRetryPicture,
  videoAt = noVideo,
  fileAt = noFile,
  headings = false,
  linkStanding = noStanding,
  suggestion = noSuggestion,
  width: known,
  diagrams = false,
  wordPictures,
  wordPicture = noWordPicture,
  after,
}: MarkdownProps) {
  const colors = useColors();
  const { fontScale, width } = useWindowDimensions();
  const markOf = useChipMarkOf();
  const viewPictures = usePicturesView();
  const [measured, setMeasured] = useState<number | undefined>(undefined);
  const [measuredAt, setMeasuredAt] = useState(width);

  // Note that a change of the window's width, a fold, an unfold, or a turn, forgets the width measured, since words in a bubble that wraps its words are measured no wider than they stood and would hold their chips there for good.
  if (measuredAt !== width) {
    setMeasuredAt(width);
    setMeasured(undefined);
  }

  const blocks = useMemo(
    () =>
      markdownBlocks(words, {
        repository,
        now: Date.now(),
        zone: readerZone(),
        typed,
        hidesHtml,
        diagrams,
        pictures: wordPictures,
      }),
    [words, repository, typed, hidesHtml, diagrams, wordPictures],
  );

  const drawing: Drawing = {
    colors,
    fontScale,
    lineWidth: measured ?? known ?? width - SPACE.PAGE * 2,
    openLink: onOpenLink,
    pictureSource,
    onRetryPicture,
    videoAt,
    fileAt,
    headings,
    linkStanding,
    markOf,
    suggestion,
    wordPicture,
    viewPictures,
  };

  // Note that muted words after the words run on after the last paragraph's, as Slack's "(edited)" does, and stand on a line of their own after any other block.
  const runsOn = blocks.at(-1)?.kind === MARKDOWN_BLOCK.PARAGRAPH;

  // Note that the words' pictures are one set a viewer swipes through, as a description's are, or join the set of the thread or message around them.
  return (
    <PictureSetProvider>
      <View
        onLayout={(event) => {
          // Note that a width of none, as a view hidden behind another lays out, keeps the last, so no chip is held to nothing.
          const laid = event.nativeEvent.layout.width;

          if (laid > 0) setMeasured(laid);
        }}
      >
        {diagrams ? (
          <DiagramRenderer>
            <Blocks blocks={blocks} drawing={drawing} after={runsOn ? after : undefined} />
          </DiagramRenderer>
        ) : (
          <Blocks blocks={blocks} drawing={drawing} after={runsOn ? after : undefined} />
        )}
        {after === undefined || runsOn ? null : (
          <Text style={{ fontSize: ROLE_SIZE.TIME, color: colors.TEXT_MUTED }}>{after}</Text>
        )}
      </View>
    </PictureSetProvider>
  );
}
