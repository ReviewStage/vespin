// transcript.tsx -- an agent's transcript as the iPhone draws it: the app's one React Native list, lazy, anchored at its newest row, its rows the panel's anatomy in the brand's inks.

import type { AgentStatus } from "@repo/features/agent-wire";
import { agentGlyphState, agentStateWords, GLYPH_STATE } from "@repo/features/glyph-state";
import type { TaskStatus } from "@repo/features/task-wire";
import { SymbolView } from "expo-symbols";
import { type ReactNode, useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Markdown, type MarkdownPlace, Picture } from "./markdown.js";
import { STATUS_MARK_LABEL, STATUS_MARK_LOOK } from "./status-mark-model.js";
import { type BrandColors, toneColor, useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { MONOSPACE_FONT, TEXT_SIZE } from "./tokens/type.js";
import { CALL_SYMBOL } from "./transcript-look.js";
import {
  CALL_STANDING,
  TRANSCRIPT_ITEM,
  type TranscriptItem,
  type TranscriptPlace,
} from "./transcript-model.js";
import { Video } from "./video.js";

/** How far a row a fold or a group holds stands in, for each step it is held. */
const DEPTH_INSET = 18;

/** How far the list stands from its newest row before Jump to latest is offered, in points. */
const LATEST_REACH = 240;

/** How near its newest row the list stands to keep it in view as rows land, in points. */
const ANCHOR_REACH = 48;

/**
 * The room the system's tab bar floats over at the screen's foot, past the
 * safe area, which the newest row and Jump to latest stand clear of. Note
 * that the list keeps it at its own end, because a scroll to the end reaches
 * the end of the rows alone and not the room the system keeps for the bar.
 */
const TAB_BAR_ROOM = 64;

/** What the control that brings the newest row into view says. */
const JUMP_TO_LATEST = "Jump to latest";

/** What a page's card says it opens. */
const PAGE_WORD = "Page";

/** What a row says of a video the system's player cannot play, read as a recording. */
const RECORDING_LABEL = "Recording";

const styles = StyleSheet.create({
  list: { flex: 1 },
  content: { paddingVertical: SPACE.ROW },
  row: { paddingHorizontal: SPACE.PAGE, paddingVertical: SPACE.TIGHT },
  saidRow: { alignItems: "flex-end", gap: SPACE.TIGHT + 2, paddingVertical: SPACE.ROW },
  said: {
    maxWidth: "82%",
    borderRadius: 18,
    paddingHorizontal: SPACE.ROW + 4,
    paddingVertical: SPACE.ROW,
  },
  callLine: { flexDirection: "row", alignItems: "center", gap: SPACE.ROW - 2, minHeight: 28 },
  callWords: { flex: 1, flexDirection: "row", alignItems: "center", gap: 5, minWidth: 0 },
  chip: {
    flexShrink: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  body: {
    marginLeft: MARK_SIZE.GLYPH + SPACE.ROW - 2,
    gap: SPACE.TIGHT + 2,
    paddingTop: SPACE.TIGHT,
  },
  block: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, overflow: "hidden" },
  blockTitle: { paddingHorizontal: SPACE.ROW, paddingTop: 6 },
  blockText: { padding: SPACE.ROW, paddingTop: SPACE.TIGHT },
  media: { gap: SPACE.ROW },
  page: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.ROW,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: SPACE.ROW + 2,
  },
  head: { paddingHorizontal: SPACE.PAGE, paddingTop: SPACE.ROW, paddingBottom: SPACE.PAGE, gap: 6 },
  headLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  jump: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
});

/** How far the list stands from its newest row's end, in points. */
function fromEnd({
  contentOffset,
  contentSize,
  layoutMeasurement,
  contentInset,
}: NativeScrollEvent): number {
  return contentSize.height + contentInset.bottom - (contentOffset.y + layoutMeasurement.height);
}

/** An item's key in the list: its place, written out whole, since the list keys each row by a string. */
function itemKey(item: TranscriptItem): string {
  return JSON.stringify(item.place satisfies TranscriptPlace);
}

/** The step a row stands in by, for the folds that hold it. */
function inset(depth: number): { readonly paddingLeft: number } {
  return { paddingLeft: SPACE.PAGE + depth * DEPTH_INSET };
}

/** Where a call or a group stands, at its line's end: the working mark while it runs, the failed mark once it failed, and nothing once it ended well. */
function StandingMark({
  running,
  failed,
}: {
  readonly running: boolean;
  readonly failed: boolean;
}) {
  const colors = useColors();
  if (running)
    return (
      <ActivityIndicator size="small" color={colors.TEXT_MUTED} accessibilityLabel="Working" />
    );
  if (!failed) return null;
  return (
    <SymbolView
      name="xmark.circle.fill"
      size={MARK_SIZE.GLYPH}
      tintColor={colors.DANGER}
      accessibilityLabel="Failed"
    />
  );
}

/** One block of an open call's body, as its card draws it: its title, then its words in the code face, scrolling sideways. */
function BodyBlock({
  title,
  text,
  colors,
}: {
  readonly title: string;
  readonly text: string;
  readonly colors: BrandColors;
}) {
  return (
    <View style={[styles.block, { backgroundColor: colors.WELL, borderColor: colors.CHIP_EDGE }]}>
      <Text style={[styles.blockTitle, { fontSize: TEXT_SIZE.FOOTNOTE, color: colors.TEXT_MUTED }]}>
        {title}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text
          selectable
          style={[
            styles.blockText,
            { fontFamily: MONOSPACE_FONT, fontSize: TEXT_SIZE.FOOTNOTE, color: colors.TEXT_BODY },
          ]}
        >
          {text}
        </Text>
      </ScrollView>
    </View>
  );
}

/** A call's row: its kind's glyph, its verb in the full ink, what it was done to in the muted one, where it ran, and where it stands; pressed, it opens on its body. */
function CallRow({
  item,
  onToggle,
}: {
  readonly item: Extract<TranscriptItem, { kind: typeof TRANSCRIPT_ITEM.CALL }>;
  readonly onToggle: (item: TranscriptItem) => void;
}) {
  const colors = useColors();
  const { line, chip } = item;
  const subject = line.subject === undefined || line.subject === "" ? undefined : line.subject;
  return (
    <View style={[styles.row, inset(item.depth)]}>
      <Pressable
        onPress={() => onToggle(item)}
        accessibilityRole="button"
        accessibilityState={{ expanded: item.open }}
        accessibilityLabel={[line.verb, chip, subject, item.runOn].filter(Boolean).join(" ")}
        style={styles.callLine}
      >
        <SymbolView
          name={CALL_SYMBOL[item.callKind]}
          size={MARK_SIZE.GLYPH}
          tintColor={colors.TEXT_MUTED}
          accessibilityElementsHidden
        />
        <View style={styles.callWords}>
          <Text
            numberOfLines={1}
            style={{
              flexShrink: 0,
              maxWidth: "70%",
              fontSize: TEXT_SIZE.SUBHEADLINE,
              color: colors.TEXT,
            }}
          >
            {line.verb}
          </Text>
          {chip === undefined ? null : (
            <View
              style={[styles.chip, { backgroundColor: colors.WELL, borderColor: colors.CHIP_EDGE }]}
            >
              <Text
                numberOfLines={1}
                style={{ fontSize: TEXT_SIZE.FOOTNOTE, color: colors.TEXT, fontWeight: "500" }}
              >
                {chip}
              </Text>
            </View>
          )}
          {subject === undefined || item.open ? null : (
            <Text
              numberOfLines={1}
              style={{
                flexShrink: 1,
                fontSize: line.code ? TEXT_SIZE.FOOTNOTE : TEXT_SIZE.SUBHEADLINE,
                fontFamily: line.code ? MONOSPACE_FONT : undefined,
                color: colors.TEXT_MUTED,
              }}
            >
              {subject}
            </Text>
          )}
        </View>
        {item.runOn === undefined ? null : (
          <Text
            numberOfLines={1}
            style={{ fontSize: TEXT_SIZE.FOOTNOTE, color: colors.TEXT_MUTED }}
          >
            {item.runOn}
          </Text>
        )}
        <StandingMark
          running={item.standing === CALL_STANDING.RUNNING}
          failed={item.standing === CALL_STANDING.FAILED}
        />
      </Pressable>
      {item.open ? (
        <View style={styles.body}>
          {item.body.map((block) => (
            <BodyBlock key={block.title} title={block.title} text={block.text} colors={colors} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** A fold's or a group's line: what it holds, counted, with the disclosure chevron iOS opens a row by. */
function FoldRow({
  item,
  onToggle,
}: {
  readonly item: Extract<TranscriptItem, { kind: typeof TRANSCRIPT_ITEM.FOLD }>;
  readonly onToggle: (item: TranscriptItem) => void;
}) {
  const colors = useColors();
  return (
    <View style={[styles.row, inset(item.depth)]}>
      <Pressable
        onPress={() => onToggle(item)}
        accessibilityRole="button"
        accessibilityState={{ expanded: item.open }}
        accessibilityLabel={item.summary}
        style={styles.callLine}
      >
        <SymbolView
          name={item.open ? "chevron.down" : "chevron.right"}
          size={MARK_SIZE.GLYPH - 3}
          tintColor={colors.TEXT_MUTED}
          style={{ width: MARK_SIZE.GLYPH, height: MARK_SIZE.GLYPH }}
          accessibilityElementsHidden
        />
        <Text
          numberOfLines={1}
          style={{ flex: 1, fontSize: TEXT_SIZE.SUBHEADLINE, color: colors.TEXT_MUTED }}
        >
          {item.summary}
        </Text>
        <StandingMark running={item.running} failed={false} />
      </Pressable>
    </View>
  );
}

/** What drawing the list's rows needs beyond the rows. */
interface RowDrawing {
  readonly repository: string | null | undefined;
  readonly now: number;
  readonly onOpenPlace: (place: MarkdownPlace) => void;
  readonly onToggle: (item: TranscriptItem) => void;
  /** Opens a page the agent showed whole, by the item that names it. */
  readonly onOpenPage: (
    item: Extract<TranscriptItem, { kind: typeof TRANSCRIPT_ITEM.PAGE }>,
  ) => void;
  /** The address a picture or a recording is drawn from, by its id; none while its bytes are on their way. */
  readonly mediaSource: (id: string) => string | undefined;
  /** Opens a recording the system's player cannot play where it plays. */
  readonly onOpenElsewhere?: (() => void) | undefined;
}

/** One of the transcript's rows, as its kind draws it. */
function TranscriptRow({
  item,
  drawing,
}: {
  readonly item: TranscriptItem;
  readonly drawing: RowDrawing;
}) {
  const colors = useColors();
  switch (item.kind) {
    case TRANSCRIPT_ITEM.SAID:
      return (
        <View style={[styles.row, styles.saidRow]}>
          {item.sender === undefined ? null : (
            <Text style={{ fontSize: TEXT_SIZE.FOOTNOTE, fontWeight: "600", color: colors.TEXT }}>
              {item.sender}
            </Text>
          )}
          <View style={[styles.said, { backgroundColor: colors.SIDEBAR }]}>
            <Markdown
              words={item.words}
              typed
              repository={drawing.repository}
              onOpenPlace={drawing.onOpenPlace}
            />
          </View>
          {item.sent === undefined ? null : (
            <Text style={{ fontSize: TEXT_SIZE.FOOTNOTE, color: colors.TEXT_MUTED }}>
              {item.sent}
            </Text>
          )}
        </View>
      );
    case TRANSCRIPT_ITEM.FOOT:
      return (
        <View style={[styles.row, { paddingBottom: SPACE.ROW }]}>
          <Text selectable style={{ fontSize: TEXT_SIZE.FOOTNOTE, color: colors.TEXT_MUTED }}>
            {item.words}
          </Text>
        </View>
      );
    case TRANSCRIPT_ITEM.WORKING:
      return (
        <View style={[styles.row, styles.headLine, { paddingVertical: SPACE.ROW }]}>
          <ActivityIndicator size="small" color={colors.TEXT_MUTED} />
          <Text style={{ fontSize: TEXT_SIZE.SUBHEADLINE, color: colors.TEXT_MUTED }}>
            {item.words}
          </Text>
        </View>
      );
    case TRANSCRIPT_ITEM.WORDS:
      return (
        <View style={[styles.row, inset(item.depth), { paddingVertical: SPACE.TIGHT + 2 }]}>
          <Markdown
            words={item.words}
            repository={drawing.repository}
            onOpenPlace={drawing.onOpenPlace}
          />
        </View>
      );
    case TRANSCRIPT_ITEM.CALL:
      return <CallRow item={item} onToggle={drawing.onToggle} />;
    case TRANSCRIPT_ITEM.FOLD:
      return <FoldRow item={item} onToggle={drawing.onToggle} />;
    case TRANSCRIPT_ITEM.MEDIA:
      return (
        <View style={[styles.row, inset(item.depth), styles.media]}>
          {item.media.map((shown) => (
            <View key={shown.id} style={{ gap: SPACE.TIGHT }}>
              {shown.video ? (
                <Video
                  source={drawing.mediaSource(shown.id)}
                  label={shown.caption === "" ? RECORDING_LABEL : shown.caption}
                  onOpenElsewhere={drawing.onOpenElsewhere}
                />
              ) : (
                <Picture source={drawing.mediaSource(shown.id)} alt={shown.caption} />
              )}
              {shown.caption === "" ? null : (
                <Text style={{ fontSize: TEXT_SIZE.FOOTNOTE, color: colors.TEXT_MUTED }}>
                  {shown.caption}
                </Text>
              )}
            </View>
          ))}
        </View>
      );
    case TRANSCRIPT_ITEM.PAGE:
      return (
        <View style={[styles.row, inset(item.depth)]}>
          <Pressable
            onPress={() => drawing.onOpenPage(item)}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}, ${PAGE_WORD}`}
            accessibilityHint="Opens the page"
            style={[
              styles.page,
              { backgroundColor: colors.SURFACE, borderColor: colors.CHIP_EDGE },
            ]}
          >
            <SymbolView
              name="macwindow"
              size={MARK_SIZE.AVATAR - 6}
              tintColor={colors.ACCENT}
              accessibilityElementsHidden
            />
            <View style={{ flex: 1, gap: 2 }}>
              <Text
                numberOfLines={2}
                style={{ fontSize: TEXT_SIZE.SUBHEADLINE, fontWeight: "600", color: colors.TEXT }}
              >
                {item.title}
              </Text>
              <Text style={{ fontSize: TEXT_SIZE.FOOTNOTE, color: colors.TEXT_MUTED }}>
                {PAGE_WORD}
              </Text>
            </View>
            <SymbolView
              name="chevron.right"
              size={MARK_SIZE.GLYPH - 3}
              tintColor={colors.TEXT_MUTED}
              accessibilityElementsHidden
            />
          </Pressable>
        </View>
      );
  }
}

type AgentHeadProps = {
  /** The task the agent works on, its ring and its name; none for an agent on no task. */
  readonly task?: { readonly name: string; readonly status: TaskStatus | undefined } | undefined;
  /** The model the agent runs on, as the panel's chip names it. */
  readonly model: string | undefined;
  readonly status: AgentStatus | undefined;
};

/**
 * The head over the transcript, the agent's own title standing in the
 * system's bar over it: the task it works on, by its ring and name as the
 * panel's crumbs name it, then where the agent stands and the model it runs
 * on, as the panel's tab and its model chip say them.
 */
export function AgentHead({ task, model, status }: AgentHeadProps) {
  const colors = useColors();
  const state = status === undefined ? undefined : agentGlyphState(status);
  const words = status === undefined ? undefined : agentStateWords(status);
  const said = [words, model].filter((each) => each !== undefined && each !== "").join(" · ");
  return (
    <View style={styles.head}>
      {task === undefined ? null : (
        <View style={styles.headLine}>
          {task.status === undefined ? null : (
            <SymbolView
              name={STATUS_MARK_LOOK[task.status].symbol}
              size={MARK_SIZE.GLYPH}
              tintColor={toneColor(colors, STATUS_MARK_LOOK[task.status].tone)}
              accessibilityLabel={STATUS_MARK_LABEL[task.status]}
            />
          )}
          <Text
            numberOfLines={1}
            style={{ flexShrink: 1, fontSize: TEXT_SIZE.SUBHEADLINE, color: colors.TEXT_MUTED }}
          >
            {task.name}
          </Text>
        </View>
      )}
      {said === "" ? null : (
        <View style={styles.headLine}>
          {state === GLYPH_STATE.WORKING ? (
            <ActivityIndicator size="small" color={colors.WORKING} />
          ) : state === GLYPH_STATE.FAILED ? (
            <SymbolView name="xmark.circle.fill" size={MARK_SIZE.GLYPH} tintColor={colors.DANGER} />
          ) : null}
          <Text style={{ fontSize: TEXT_SIZE.SUBHEADLINE, color: colors.TEXT_MUTED }}>{said}</Text>
        </View>
      )}
    </View>
  );
}

type AgentTranscriptProps = Omit<RowDrawing, "now"> & {
  /** The rows, oldest first (`transcriptItems`). */
  readonly items: readonly TranscriptItem[];
  /** What stands over the oldest row, such as the agent's head. */
  readonly head: ReactNode;
  /** What stands in the rows' place while there are none, such as a read under way. */
  readonly empty?: ReactNode;
  /** What the times count from; now where none is given. */
  readonly now?: number | undefined;
};

/**
 * An agent's transcript as one lazy list, the app's one React Native list,
 * since SwiftUI has no piece for its rows: it opens at its newest row and
 * stays anchored there, so a row that lands while the reader stands at the
 * newest comes into view, and one that lands while they read back holds
 * their place; a reader scrolled back is offered Jump to latest. Only the rows near the
 * screen are drawn, however long the transcript runs.
 */
export function AgentTranscript({ items, head, empty, now, ...drawing }: AgentTranscriptProps) {
  const colors = useColors();
  const { bottom } = useSafeAreaInsets();
  const list = useRef<FlatList<TranscriptItem>>(null);
  // Whether the reader stands at the newest row, which the list keeps in view as rows land; it opens there.
  const anchored = useRef(true);
  const [away, setAway] = useState(false);
  const rowDrawing: RowDrawing = { ...drawing, now: now ?? Date.now() };
  // Note that only the reader's own scroll moves the anchor, never the list's own scroll to its end as rows render in.
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setAway(fromEnd(event.nativeEvent) > LATEST_REACH);
  }, []);
  const onScrollSettled = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    anchored.current = fromEnd(event.nativeEvent) < ANCHOR_REACH;
  }, []);
  // Note that a row landing, or a fold opened, at the newest row keeps it in view, while one landing as the reader reads back leaves their place.
  const onContentSizeChange = useCallback(() => {
    // Note that the scroller itself is asked, since the list's own end is an estimate until every row has been measured.
    if (anchored.current) list.current?.getScrollResponder()?.scrollToEnd({ animated: false });
  }, []);
  return (
    <View style={[styles.list, { backgroundColor: colors.GROUND }]}>
      <FlatList
        ref={list}
        data={items}
        keyExtractor={itemKey}
        renderItem={({ item }) => <TranscriptRow item={item} drawing={rowDrawing} />}
        ListHeaderComponent={<>{head}</>}
        ListEmptyComponent={<>{empty}</>}
        ListFooterComponent={<View style={{ height: bottom + TAB_BAR_ROOM }} />}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        onContentSizeChange={onContentSizeChange}
        onScroll={onScroll}
        onScrollEndDrag={onScrollSettled}
        onMomentumScrollEnd={onScrollSettled}
        scrollEventThrottle={64}
        initialNumToRender={16}
        windowSize={9}
        accessibilityLabel="Transcript"
      />
      {away ? (
        <Pressable
          onPress={() => {
            anchored.current = true;
            list.current?.getScrollResponder()?.scrollToEnd({ animated: true });
          }}
          accessibilityRole="button"
          accessibilityLabel={JUMP_TO_LATEST}
          style={[
            styles.jump,
            {
              bottom: bottom + TAB_BAR_ROOM,
              backgroundColor: colors.SURFACE,
              borderColor: colors.CHIP_EDGE,
            },
          ]}
        >
          <SymbolView
            name="arrow.down"
            size={MARK_SIZE.GLYPH - 2}
            tintColor={colors.ACCENT}
            accessibilityElementsHidden
          />
          <Text
            style={{ fontSize: TEXT_SIZE.FOOTNOTE, fontWeight: "600", color: colors.ACCENT_TEXT }}
          >
            {JUMP_TO_LATEST}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
