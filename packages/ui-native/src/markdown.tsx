// markdown.tsx -- a message's Markdown drawn in React Native views, since SwiftUI has no piece for the panel's: headings, lists, task lists, quotes, tables, code, links, mention chips, and pictures that open full screen and zoom.

import { readerZone } from "@repo/features/date-mention";
import { ENTITY_KIND, type EntityKind } from "@repo/features/entity-kind";
import type { LinkPlace } from "@repo/features/link-grammar";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type Glyph, isLucideSymbol } from "./glyph.js";
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
import { type BrandColors, useColors } from "./tokens/colors.js";
import { LUCIDE_SYMBOL } from "./tokens/lucide-symbols.js";
import { SPACE } from "./tokens/space.js";
import { MONOSPACE_FONT, TEXT_SIZE } from "./tokens/type.js";
import { Video } from "./video.js";

/** A place in the app a link names, as `@repo/features/link-grammar` reads it, and the address it was written as. */
export interface MarkdownPlace {
  readonly workspace: string;
  readonly place: LinkPlace;
  readonly href: string;
}

/**
 * The glyph each kind of entity leads its chip with, as the panel's
 * `entity-mark.tsx` gives each kind its own: a pull request's is Lucide's
 * own, as the panel's chip draws it before GitHub has said where the pull
 * request stands, and the rest the SF Symbol closest to the panel's.
 */
const ENTITY_SYMBOL: { readonly [K in EntityKind]: Glyph } = {
  [ENTITY_KIND.PLAN]: "checklist",
  [ENTITY_KIND.SECTION]: "number",
  [ENTITY_KIND.VERSION]: "clock.arrow.circlepath",
  [ENTITY_KIND.COMMENT]: "text.bubble",
  [ENTITY_KIND.PAGE]: "doc.richtext",
  [ENTITY_KIND.AGENT]: "sparkles",
  [ENTITY_KIND.WORKER]: "gearshape.2",
  [ENTITY_KIND.APP]: "app",
  [ENTITY_KIND.CHANGES]: "plusminus",
  [ENTITY_KIND.PULL_REQUEST]: LUCIDE_SYMBOL.GIT_PULL_REQUEST,
  [ENTITY_KIND.PULL_REQUEST_THREAD]: "text.bubble",
  [ENTITY_KIND.ISSUE]: "smallcircle.filled.circle",
  [ENTITY_KIND.LINK]: "link",
  [ENTITY_KIND.MESSAGE]: "message",
  [ENTITY_KIND.HOME]: "house",
  [ENTITY_KIND.BOARD]: "checklist",
  [ENTITY_KIND.INBOX]: "tray",
  [ENTITY_KIND.INBOX_ITEM]: "tray.full",
  [ENTITY_KIND.AUTOMATIONS]: "bolt",
  [ENTITY_KIND.AUTOMATION]: "bolt",
  [ENTITY_KIND.AUTOMATION_RUN]: "bolt.circle",
  [ENTITY_KIND.SETTINGS]: "gearshape",
  [ENTITY_KIND.PERSON]: "person.crop.circle",
  [ENTITY_KIND.ADMIN]: "person.badge.shield.checkmark",
  [ENTITY_KIND.FILE]: "doc",
  [ENTITY_KIND.FOLDER]: "folder",
  [ENTITY_KIND.SERVER]: "server.rack",
  [ENTITY_KIND.TOOL]: "wrench.and.screwdriver",
  [ENTITY_KIND.SKILL]: "wand.and.stars",
  [ENTITY_KIND.REPOSITORY]: "book.closed",
  [ENTITY_KIND.WORKSPACE]: "building.2",
  [ENTITY_KIND.DATE]: "calendar",
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
  viewerClose: { position: "absolute", padding: SPACE.ROW },
});

/** What drawing a run needs beyond the run: the colors, the reader's text scale, and the doors a press opens. */
interface Drawing {
  readonly colors: BrandColors;
  readonly fontScale: number;
  /** The widest a chip may stand, the window's width, which a chip's name is cut to. */
  readonly lineWidth: number;
  readonly openPlace: (place: MarkdownPlace) => void;
  /** The address a picture is drawn from, by the address its words name it by; none while it is on its way. */
  readonly pictureSource: (written: string) => string | undefined;
  /** The video a picture's address names, played in its place; none where the address names a picture. */
  readonly videoAt: (written: string) => MarkdownVideo | undefined;
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

/**
 * A chip's glyph at `size` points in `color`: an SF Symbol through the
 * system's symbol view, or one of Lucide's from the asset catalog, which
 * React Native's image reads by its name and tints as a template.
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
  if (!isLucideSymbol(glyph)) {
    return <SymbolView name={glyph} size={size} tintColor={color} accessibilityElementsHidden />;
  }
  return (
    <Image
      source={{ uri: glyph }}
      resizeMode="contain"
      style={{ width: size, height: size, tintColor: color }}
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
        <ChipGlyph
          glyph={ENTITY_SYMBOL[chip.entity]}
          size={size * fontScale}
          color={colors.TEXT_MUTED}
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

/** The most a full-screen picture zooms in to, as a pinch takes it. */
const VIEWER_MAX_ZOOM = 4;

type PictureProps = {
  /** The address the picture is drawn from; none while its bytes are still on their way, which stands its well alone. */
  readonly source: string | undefined;
  /** What the picture shows, heard in its place. */
  readonly alt: string;
};

/**
 * A picture at its message's width, which a press opens full screen over
 * everything, where a pinch zooms it and Done closes it. Done stands at the
 * leading top corner inside the safe area, as Quick Look's does, clear of
 * what the system draws at the trailing corner: the clock of the folded
 * iPhone Duo's outer display, beside its rail. Note that a picture
 * still on its way stands as its well at the shape a picture most often
 * is, so the words under it do not jump twice.
 */
export function Picture({ source, alt }: PictureProps) {
  const colors = useColors();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [aspect, setAspect] = useState<number | undefined>(undefined);
  const [full, setFull] = useState(false);
  const heard = alt === "" ? "Picture" : alt;
  const well = [styles.picture, { aspectRatio: aspect ?? 16 / 9, backgroundColor: colors.WELL }];
  if (source === undefined) {
    return <View style={well} accessible accessibilityLabel={heard} />;
  }
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
            const loaded = event.nativeEvent.source;
            if (loaded.width > 0 && loaded.height > 0) setAspect(loaded.width / loaded.height);
          }}
          style={well}
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
          <Pressable
            onPress={() => setFull(false)}
            accessibilityRole="button"
            accessibilityLabel="Done"
            testID="markdown-picture-done"
            style={[styles.viewerClose, { top: insets.top, left: insets.left + SPACE.ROW }]}
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
    <Video source={video.source} label={video.label} onOpenElsewhere={video.onOpenElsewhere} />
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
  /** Routes a link or a chip naming a place in the app, a `vespin.dev` address; every other link opens in Safari. */
  readonly onOpenPlace: (place: MarkdownPlace) => void;
  /** Whether a person typed the words line by line, whose line breaks are kept; an agent's join as Markdown reads them. */
  readonly typed?: boolean | undefined;
  /** The address a picture is drawn from, by the address its words name it by, such as a `data:` address of a thread's own file; none while it is on its way. Each is drawn from the address it names where none is given. */
  readonly pictureSource?: ((written: string) => string | undefined) | undefined;
  /** The video a picture's address names, such as a recording a thread carried, played in its place; every address names a picture where none is given. */
  readonly videoAt?: ((written: string) => MarkdownVideo | undefined) | undefined;
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
  onOpenPlace,
  typed,
  pictureSource = namedSource,
  videoAt = noVideo,
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
    openPlace: onOpenPlace,
    pictureSource,
    videoAt,
  };
  return (
    <View style={styles.flow}>
      <Blocks blocks={blocks} drawing={drawing} />
    </View>
  );
}
