// markdown.tsx -- a message's Markdown drawn in React Native views, since SwiftUI has no piece for the panel's: headings, lists, task lists, quotes, tables, code, links, mention chips, and pictures that open full screen.

import { readerZone } from "@repo/features/date-mention";
import type { LinkPlace } from "@repo/features/link-grammar";
import { THING_KIND, type ThingKind } from "@repo/features/thing-kind";
import { SymbolView } from "expo-symbols";
import { type ReactNode, useMemo, useState } from "react";
import {
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type TextStyle,
  useWindowDimensions,
  View,
} from "react-native";
import {
  COLUMN_ALIGN,
  type ColumnAlign,
  LINK_TARGET,
  type LinkTarget,
  MARKDOWN_BLOCK,
  MARKDOWN_RUN,
  type MarkdownBlock,
  type MarkdownChip,
  type MarkdownRun,
  markdownBlocks,
} from "./markdown-model.js";
import type { SfSymbol } from "./sf-symbol.js";
import { type BrandColors, useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";
import { MONOSPACE_FONT, TEXT_SIZE } from "./tokens/type.js";

/** A place in the app a link names, as `@repo/features/link-grammar` reads it, and the address it was written as. */
export interface MarkdownPlace {
  readonly workspace: string;
  readonly place: LinkPlace;
  readonly href: string;
}

/** The glyph each kind of thing leads its chip with, as the panel's `thing-mark.tsx` gives each kind its own. */
const THING_SYMBOL: { readonly [K in ThingKind]: SfSymbol } = {
  [THING_KIND.PLAN]: "checklist",
  [THING_KIND.SECTION]: "number",
  [THING_KIND.VERSION]: "clock.arrow.circlepath",
  [THING_KIND.COMMENT]: "text.bubble",
  [THING_KIND.PAGE]: "doc.richtext",
  [THING_KIND.AGENT]: "sparkles",
  [THING_KIND.WORKER]: "gearshape.2",
  [THING_KIND.APP]: "app",
  [THING_KIND.CHANGES]: "plusminus",
  [THING_KIND.PULL_REQUEST]: "arrow.triangle.pull",
  [THING_KIND.PULL_REQUEST_THREAD]: "text.bubble",
  [THING_KIND.ISSUE]: "smallcircle.filled.circle",
  [THING_KIND.LINK]: "link",
  [THING_KIND.MESSAGE]: "message",
  [THING_KIND.HOME]: "house",
  [THING_KIND.BOARD]: "checklist",
  [THING_KIND.INBOX]: "tray",
  [THING_KIND.INBOX_ITEM]: "tray.full",
  [THING_KIND.AUTOMATIONS]: "bolt",
  [THING_KIND.AUTOMATION]: "bolt",
  [THING_KIND.AUTOMATION_RUN]: "bolt.circle",
  [THING_KIND.SETTINGS]: "gearshape",
  [THING_KIND.PERSON]: "person.crop.circle",
  [THING_KIND.ADMIN]: "person.badge.shield.checkmark",
  [THING_KIND.FILE]: "doc",
  [THING_KIND.FOLDER]: "folder",
  [THING_KIND.SERVER]: "server.rack",
  [THING_KIND.TOOL]: "wrench.and.screwdriver",
  [THING_KIND.SKILL]: "wand.and.stars",
  [THING_KIND.REPOSITORY]: "book.closed",
  [THING_KIND.WORKSPACE]: "building.2",
  [THING_KIND.DATE]: "calendar",
};

/** Each heading level's size and weight, a step above the words as the panel draws a message's headings. */
const HEADING_LOOK: { readonly [Level in 1 | 2 | 3 | 4 | 5 | 6]: TextStyle } = {
  1: { fontSize: TEXT_SIZE.TITLE_2, fontWeight: "700" },
  2: { fontSize: TEXT_SIZE.TITLE_3, fontWeight: "600" },
  3: { fontSize: TEXT_SIZE.HEADLINE, fontWeight: "600" },
  4: { fontSize: TEXT_SIZE.SUBHEADLINE, fontWeight: "600" },
  5: { fontSize: TEXT_SIZE.SUBHEADLINE, fontWeight: "600" },
  6: { fontSize: TEXT_SIZE.SUBHEADLINE, fontWeight: "600" },
};

const TEXT_ALIGN: { readonly [A in ColumnAlign]: TextStyle["textAlign"] } = {
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

/** How far below the screen's top the full-screen picture's Done stands, clear of the status bar and the Dynamic Island. */
const VIEWER_CLOSE_TOP = 60;

const styles = StyleSheet.create({
  flow: { gap: SPACE.ROW },
  item: { flexDirection: "row", gap: SPACE.TIGHT },
  itemBody: { flex: 1, gap: SPACE.TIGHT },
  quote: { borderLeftWidth: 3, paddingLeft: SPACE.ROW, gap: SPACE.ROW },
  well: { borderRadius: 8, padding: SPACE.ROW },
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
  viewer: { flex: 1, backgroundColor: "black", justifyContent: "center" },
  viewerPicture: { width: "100%", height: "100%" },
  viewerClose: {
    position: "absolute",
    top: VIEWER_CLOSE_TOP,
    right: SPACE.PAGE,
    padding: SPACE.ROW,
  },
});

/** What drawing a run needs beyond the run: the colors, the reader's text scale, and the doors a press opens. */
interface Drawing {
  readonly colors: BrandColors;
  readonly fontScale: number;
  /** The widest a chip may stand, the window's width, which a chip's name is cut to. */
  readonly lineWidth: number;
  readonly openPlace: (place: MarkdownPlace) => void;
}

function open(target: LinkTarget, drawing: Drawing): (() => void) | undefined {
  switch (target.kind) {
    case LINK_TARGET.PLACE:
      return () => drawing.openPlace(target);
    case LINK_TARGET.WEB:
      // Note that the system opens a web address in Safari, its own handler for the scheme.
      return () => void Linking.openURL(target.href);
    case LINK_TARGET.NONE:
      return undefined;
  }
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
  const size = TEXT_SIZE.SUBHEADLINE;
  return (
    <View style={{ transform: [{ translateY: TEXT_SIZE.BODY * CHIP_DROP * fontScale }] }}>
      <Pressable
        onPress={onPress}
        disabled={onPress === undefined}
        accessibilityRole={onPress === undefined ? "text" : "link"}
        accessibilityLabel={chip.heard}
        style={[
          styles.chip,
          {
            maxWidth: drawing.lineWidth,
            backgroundColor: colors.WELL,
            borderColor: colors.CHIP_EDGE,
          },
        ]}
      >
        <SymbolView
          name={THING_SYMBOL[chip.thing]}
          size={size * fontScale}
          tintColor={colors.TEXT_MUTED}
          accessibilityElementsHidden
        />
        <Text
          numberOfLines={1}
          style={{ flexShrink: 1, fontSize: size, color: colors.TEXT, fontWeight: "500" }}
        >
          {chip.name}
        </Text>
      </Pressable>
    </View>
  );
}

function wordStyle(run: Extract<MarkdownRun, { kind: typeof MARKDOWN_RUN.WORDS }>): TextStyle {
  return {
    ...(run.strong ? { fontWeight: "600" } : {}),
    ...(run.emphasis ? { fontStyle: "italic" } : {}),
    ...(run.struck ? { textDecorationLine: "line-through" } : {}),
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
            fontSize: TEXT_SIZE.SUBHEADLINE,
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
          style={{ color: colors.ACCENT_TEXT, textDecorationLine: "underline" }}
        >
          <Runs runs={run.runs} drawing={drawing} />
        </Text>
      );
    }
    case MARKDOWN_RUN.CHIP:
      return <MentionChip chip={run.chip} drawing={drawing} />;
    case MARKDOWN_RUN.BREAK:
      return <Text>{"\n"}</Text>;
  }
}

/** A line of words: a paragraph's, a heading's, or a table cell's. */
function Line({
  runs,
  drawing,
  style,
}: {
  readonly runs: readonly MarkdownRun[];
  readonly drawing: Drawing;
  readonly style?: TextStyle | undefined;
}) {
  return (
    <Text style={[{ fontSize: TEXT_SIZE.BODY, color: drawing.colors.TEXT_BODY }, style]}>
      <Runs runs={runs} drawing={drawing} />
    </Text>
  );
}

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
  const width = TEXT_SIZE.BODY * MARKER_WIDTH * fontScale;
  if (checked !== undefined) {
    return (
      <View
        style={{ width, paddingTop: 2 * fontScale }}
        accessible
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
      >
        <SymbolView
          name={checked ? "checkmark.square.fill" : "square"}
          size={TEXT_SIZE.BODY * fontScale}
          tintColor={checked ? colors.ACCENT : colors.TEXT_MUTED}
        />
      </View>
    );
  }
  return (
    <Text
      style={{ width, fontSize: TEXT_SIZE.BODY, color: colors.TEXT_MUTED, textAlign: "right" }}
      accessibilityElementsHidden
    >
      {number === undefined ? "•" : `${number}.`}
    </Text>
  );
}

function ListView({
  block,
  drawing,
}: {
  readonly block: Extract<MarkdownBlock, { kind: typeof MARKDOWN_BLOCK.LIST }>;
  readonly drawing: Drawing;
}) {
  return (
    <View style={styles.flow}>
      {block.items.map((item, at) => (
        <View key={at} style={styles.item}>
          <Marker
            checked={item.checked}
            number={block.start === undefined ? undefined : block.start + at}
            drawing={drawing}
          />
          <View style={styles.itemBody}>
            <Blocks blocks={item.blocks} drawing={drawing} />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * A table, scrolling sideways inside its own box. Note that React Native has
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
                    fontSize: TEXT_SIZE.SUBHEADLINE,
                    textAlign: TEXT_ALIGN[block.align[columnAt] ?? COLUMN_ALIGN.START],
                    ...(rowAt === 0 ? { fontWeight: "600", color: colors.TEXT } : {}),
                  }}
                />
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
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
          style={{ fontFamily: MONOSPACE_FONT, fontSize: TEXT_SIZE.FOOTNOTE, color: colors.TEXT }}
        >
          {text}
        </Text>
      </ScrollView>
    </View>
  );
}

/** A picture at the message's width, which a press opens full screen over everything, closed by Done. */
function PictureView({
  source,
  alt,
  drawing,
}: {
  readonly source: string;
  readonly alt: string;
  readonly drawing: Drawing;
}) {
  const [aspect, setAspect] = useState<number | undefined>(undefined);
  const [full, setFull] = useState(false);
  const heard = alt === "" ? "Picture" : alt;
  return (
    <>
      <Pressable
        onPress={() => setFull(true)}
        accessibilityRole="imagebutton"
        accessibilityLabel={heard}
        accessibilityHint="Opens full screen"
      >
        <Image
          source={{ uri: source }}
          resizeMode="contain"
          onLoad={(event) => {
            const { width, height } = event.nativeEvent.source;
            if (width > 0 && height > 0) setAspect(width / height);
          }}
          style={[
            styles.picture,
            { aspectRatio: aspect ?? 16 / 9, backgroundColor: drawing.colors.WELL },
          ]}
        />
      </Pressable>
      <Modal
        visible={full}
        animationType="fade"
        presentationStyle="overFullScreen"
        supportedOrientations={["portrait", "landscape"]}
        onRequestClose={() => setFull(false)}
      >
        <View style={styles.viewer} accessibilityViewIsModal>
          <Image
            source={{ uri: source }}
            resizeMode="contain"
            accessibilityLabel={heard}
            style={styles.viewerPicture}
          />
          <Pressable
            onPress={() => setFull(false)}
            accessibilityRole="button"
            accessibilityLabel="Done"
            testID="markdown-picture-done"
            style={styles.viewerClose}
          >
            <Text style={{ fontSize: TEXT_SIZE.BODY, fontWeight: "600", color: "white" }}>
              Done
            </Text>
          </Pressable>
        </View>
      </Modal>
    </>
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
      // Note that a heading is styled, never announced as one, as the panel's are: a reader walking the screen's headings meets the screen's, not a message's.
      return (
        <Line
          runs={block.runs}
          drawing={drawing}
          style={{ ...HEADING_LOOK[block.level], color: colors.TEXT }}
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
    case MARKDOWN_BLOCK.RULE:
      return (
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.CHIP_EDGE }} />
      );
    case MARKDOWN_BLOCK.PICTURE:
      return <PictureView source={block.source} alt={block.alt} drawing={drawing} />;
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
  /** Routes a link or a chip naming a place in the app, a `vespin.dev` address; every other link opens in Safari. */
  readonly onOpenPlace: (place: MarkdownPlace) => void;
  /** The moment a date's chip counts from; now where none is given. */
  readonly now?: number | undefined;
};

/**
 * Words drawn as the Markdown they were written in, as the panel draws a
 * message: the panel's parse (`@repo/features/markdown-tree`), read into
 * blocks by `markdown-model.ts`, in the brand's colors for the window's
 * scheme and at the reader's Dynamic Type size. It draws no scroller of its
 * own, so a screen stands it in its own.
 */
export function Markdown({ words, repository = null, onOpenPlace, now }: MarkdownProps) {
  const colors = useColors();
  const { fontScale, width } = useWindowDimensions();
  const blocks = useMemo(
    () => markdownBlocks(words, { repository, now: now ?? Date.now(), zone: readerZone() }),
    [words, repository, now],
  );
  const drawing: Drawing = {
    colors,
    fontScale,
    lineWidth: width - SPACE.PAGE * 2,
    openPlace: onOpenPlace,
  };
  return (
    <View style={styles.flow}>
      <Blocks blocks={blocks} drawing={drawing} />
    </View>
  );
}
