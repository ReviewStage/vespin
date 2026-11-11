// markdown.tsx -- a message's Markdown drawn in React Native views, since SwiftUI has no piece for the panel's: headings, lists, task lists, quotes, tables, code, links, mention chips, and pictures that open full screen and zoom.

import { Host, Image as SwiftUIImage } from "@expo/ui/swift-ui";
import { accessibilityHidden, frame } from "@expo/ui/swift-ui/modifiers";
import { readerZone } from "@repo/features/date-mention";
import { ENTITY_KIND, type EntityKind } from "@repo/features/entity-kind";
import { SymbolView } from "expo-symbols";
import { type ReactNode, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
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
  heardLine,
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
import { MONOSPACE_FONT, PROSE_SIZE, TEXT_SIZE } from "./tokens/type.js";
import { Video } from "./video.js";

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

/**
 * The font size a chip's custom symbol is set at, as a share of its square.
 * Note that a symbol set at the square's own size overflows it, since its
 * template stands at one and a half cap heights, so it is set smaller and
 * centered in the square rather than hung from its baseline.
 */
const CHIP_SYMBOL_SCALE = 0.85;

/** Each heading level's size and weight, a step above the 15 pt words as the denser scale reads, never past a page's own heading. */
const HEADING_LOOK: { readonly [Level in 1 | 2 | 3 | 4 | 5 | 6]: TextStyle } = {
  1: { fontSize: TEXT_SIZE.TITLE_3, fontWeight: "600" },
  2: { fontSize: TEXT_SIZE.HEADLINE, fontWeight: "600" },
  3: { fontSize: PROSE_SIZE, fontWeight: "600" },
  4: { fontSize: PROSE_SIZE, fontWeight: "600" },
  5: { fontSize: PROSE_SIZE, fontWeight: "600" },
  6: { fontSize: PROSE_SIZE, fontWeight: "600" },
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
  pending: { alignItems: "center", justifyContent: "center" },
  viewer: { flex: 1, backgroundColor: "black", justifyContent: "center" },
  viewerClose: { position: "absolute", padding: SPACE.ROW },
});

/** What drawing a run needs beyond the run: the colors, the reader's text scale, and the doors a press opens. */
interface Drawing {
  readonly colors: BrandColors;
  readonly fontScale: number;
  /** The widest a chip may stand, the window's width, which a chip's name is cut to. */
  readonly lineWidth: number;
  readonly openLink: (address: string) => void;
  /** The address a picture is drawn from, by the address its words name it by; none while it is on its way. */
  readonly pictureSource: (written: string) => string | undefined;
  /** The video a picture's address names, played in its place; none where the address names a picture. */
  readonly videoAt: (written: string) => MarkdownVideo | undefined;
  /** Whether a heading is heard as one, on a page of words alone, where VoiceOver's Headings rotor walks its sections. */
  readonly headings: boolean;
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
 * A chip's glyph in a `size`-point square in `color`: an SF Symbol through
 * the system's symbol view, or one of Lucide's custom symbols through
 * SwiftUI's own image in a host of that square. Note that React Native's
 * image draws a symbol set blank, since it reads only image sets by name.
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
    <Host style={{ width: size, height: size }}>
      <SwiftUIImage
        assetName={glyph}
        size={size * CHIP_SYMBOL_SCALE}
        color={color}
        modifiers={[frame({ width: size, height: size }), accessibilityHidden()]}
      />
    </Host>
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
  return (
    <View style={{ transform: [{ translateY: PROSE_SIZE * CHIP_DROP * fontScale }] }}>
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
  heading,
}: {
  readonly runs: readonly MarkdownRun[];
  readonly drawing: Drawing;
  readonly style?: TextStyle | undefined;
  /** Whether the line is heard as a heading. */
  readonly heading?: boolean | undefined;
}) {
  return (
    <Text
      accessibilityLabel={heardLine(runs)}
      {...(heading === true ? { accessibilityRole: "header" as const } : {})}
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
          name={checked ? "checkmark.square.fill" : "square"}
          size={PROSE_SIZE * fontScale}
          tintColor={checked ? colors.ACCENT : colors.TEXT_MUTED}
        />
      </View>
    );
  }
  // Note that a bullet is never heard, while an ordered list's number is, since its order is part of what it says.
  return (
    <Text
      style={{ width, fontSize: PROSE_SIZE, color: colors.TEXT_MUTED, textAlign: "right" }}
      accessibilityElementsHidden={number === undefined}
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
                    fontSize: TEXT_SIZE.FOOTNOTE,
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

type PictureProps = {
  /** The address the picture is drawn from; none while its bytes are still on their way, which stands its well alone. */
  readonly source: string | undefined;
  /** What the picture shows, heard in its place. */
  readonly alt: string;
  /** A tile's fixed shape, width over height, the picture standing whole inside it; the picture's own shape where none is given. */
  readonly shape?: number | undefined;
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
export function Picture({ source, alt, shape }: PictureProps) {
  const colors = useColors();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [aspect, setAspect] = useState<number | undefined>(undefined);
  const [full, setFull] = useState(false);
  const heard = alt === "" ? "Picture" : alt;
  const well = [
    styles.picture,
    { aspectRatio: shape ?? aspect ?? 16 / 9, backgroundColor: colors.WELL },
  ];
  if (source === undefined) {
    return (
      <View style={[well, styles.pending]} accessible accessibilityLabel={heard}>
        <ActivityIndicator color={colors.TEXT_MUTED} />
      </View>
    );
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
  /** The address a picture is drawn from, by the address its words name it by, such as a `data:` address of a thread's own file; none while it is on its way. Each is drawn from the address it names where none is given. */
  readonly pictureSource?: ((written: string) => string | undefined) | undefined;
  /** The video a picture's address names, such as a recording a thread carried, played in its place; every address names a picture where none is given. */
  readonly videoAt?: ((written: string) => MarkdownVideo | undefined) | undefined;
  /** Whether its headings are heard as headings, on a page of words alone; a message's are styled alone. */
  readonly headings?: boolean | undefined;
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
  onOpenLink,
  typed,
  pictureSource = namedSource,
  videoAt = noVideo,
  headings = false,
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
  };
  return (
    <View style={styles.flow}>
      <Blocks blocks={blocks} drawing={drawing} />
    </View>
  );
}
