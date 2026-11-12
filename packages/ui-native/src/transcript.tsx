// transcript.tsx -- an agent's transcript as the iPhone draws it: the app's one React Native list, lazy, anchored at its newest row, its rows the panel's anatomy in the brand's inks.

import { Host } from "@expo/ui/swift-ui";
import type { AgentStatus } from "@repo/features/agent-wire";
import { agentGlyphState, agentStateWords, GLYPH_STATE } from "@repo/features/glyph-state";
import type { CallKind } from "@repo/features/turn-rows";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { SymbolView } from "expo-symbols";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
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
import {
  useAccessibilitySize,
  useAnnounced,
  useReduceMotion,
  useReduceTransparency,
  useScaledSize,
} from "./accessibility.js";
import { BUTTON_LOOK, Button } from "./button.js";
import { EmptyState, type EmptyStateProps } from "./empty-state.js";
import { useDockRoom } from "./glass-bar.js";
import { isLucideSymbol } from "./glyph.js";
import { type HeldCall, HeldCallBody } from "./held-call.js";
import { CopyWordsMenu } from "./held-menu.js";
import { Markdown, Picture } from "./markdown.js";
import { ToneGlyph } from "./marks.js";
import { type PullRequestAct, PullRequestCard } from "./pull-request-card.js";
import { type BrandColors, STATUS_TONE, useColors } from "./tokens/colors.js";
import { MARK_SIZE, RADIUS, READING_WIDTH, SPACE } from "./tokens/space.js";
import { MONOSPACE_FONT, TEXT_SIZE, TYPE_ROLE } from "./tokens/type.js";
import { CALL_SYMBOL } from "./transcript-look.js";
import {
  CALL_STANDING,
  type CallStanding,
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

/** How wide the round control that brings the newest row into view stands, in points: the system's least target. */
const JUMP_SIZE = 44;

/** What the control that brings the newest row into view says. */
const JUMP_TO_LATEST = "Jump to latest";

/** Where a call stands, as VoiceOver hears it after the call's line, its mark saying it on screen. */
const CALL_STANDING_HEARD = {
  [CALL_STANDING.RUNNING]: "Working",
  [CALL_STANDING.FAILED]: "Failed",
  [CALL_STANDING.DONE]: "Done",
} as const satisfies Record<CallStanding, string>;

/** What a call held for the reader's answer is heard as, in its standing's place. */
const HELD_HEARD = "Waiting for your answer";

/** What a closed row is heard as, since React Native says "expanded" of an open one alone. */
const COLLAPSED_HEARD = "Collapsed";

/** What a press on a call's line, or a fold's, is heard to do. */
const CALL_HINT = "Shows or hides the call's input and output";
const FOLD_HINT = "Shows or hides the steps it holds";

/** What the spinner over the oldest row is heard as while an older page is read. */
const READING_OLDER = "Loading earlier messages";

/** How far a row's press reaches past its line, above and below, so a 28 pt line takes a press across the system's least target, 44 pt. */
const LINE_REACH = { top: 8, bottom: 8 } as const;

/** What a page's card says it opens. */
const PAGE_WORD = "Page";

/** What a pull request's card offers first: its page on GitHub. */
const REVIEW_WORD = "Review";

/** How near its oldest row the reader scrolls before the page older than it is read, in points. */
const OLDER_REACH = 400;

/** What stands over the oldest row where the page older than it could not be read, and what reads it again, as the panel says them. */
const OLDER_WORDS = {
  FAILED: "Earlier messages could not be read.",
  RETRY: "Try again",
} as const;

const styles = StyleSheet.create({
  list: { flex: 1 },
  content: { paddingVertical: SPACE.ROW },
  row: { paddingHorizontal: SPACE.EDGE, paddingVertical: SPACE.TIGHT },
  saidRow: { alignItems: "flex-end", gap: SPACE.TIGHT + 2, paddingVertical: SPACE.ROW },
  // Note that the line's menu spans the row, so its bubble stands at the row's end inside it as it stands outside.
  saidHeld: { alignSelf: "stretch", alignItems: "flex-end" },
  said: {
    maxWidth: "82%",
    borderRadius: 18,
    paddingHorizontal: SPACE.ROW + 4,
    paddingVertical: SPACE.ROW,
  },
  callLine: { flexDirection: "row", alignItems: "center", gap: SPACE.ROW - 2, minHeight: 28 },
  callWords: { flex: 1, flexDirection: "row", alignItems: "center", gap: 5, minWidth: 0 },
  wrapped: { flexWrap: "wrap" },
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
    borderRadius: RADIUS.CARD,
    paddingHorizontal: SPACE.EDGE - 4,
    paddingVertical: SPACE.ROW,
  },
  callGlyph: { width: MARK_SIZE.GLYPH, height: MARK_SIZE.GLYPH },
  head: {
    paddingHorizontal: SPACE.EDGE,
    paddingTop: SPACE.TIGHT,
    paddingBottom: SPACE.EDGE,
    gap: 6,
  },
  headLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  headModel: { flexDirection: "row", alignItems: "center", gap: 3 },
  older: { alignItems: "center", gap: SPACE.TIGHT * 2, paddingVertical: SPACE.ROW },
  jump: { position: "absolute", alignSelf: "center" },
  jumpFace: {
    width: JUMP_SIZE,
    height: JUMP_SIZE,
    borderRadius: JUMP_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
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

type InsetResult = { readonly paddingLeft: number };

/** The step a row stands in by, for the folds that hold it. */
function inset(depth: number): InsetResult {
  return { paddingLeft: SPACE.PAGE + depth * DEPTH_INSET };
}

/** Where a call or a group stands, at its line's end: the working mark while it runs, the failed mark once it failed, and nothing once it ended well; heard in its row's value rather than apart. */
function StandingMark({
  running,
  failed,
}: {
  readonly running: boolean;
  readonly failed: boolean;
}) {
  const colors = useColors();
  const size = useScaledSize(MARK_SIZE.GLYPH);

  if (running)
    return <ActivityIndicator size="small" color={colors.TEXT_MUTED} accessibilityElementsHidden />;

  if (!failed) return null;

  return (
    <SymbolView
      name="xmark.circle.fill"
      size={size}
      tintColor={colors.DANGER}
      accessibilityElementsHidden
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

/**
 * A call's glyph at a row mark's size: an SF Symbol through the system's
 * symbol view, or one of Lucide's, such as a pull request's, through
 * SwiftUI's own image in a host of that square, since React Native's image
 * draws a symbol set blank.
 */
function CallGlyph({ callKind }: { readonly callKind: CallKind }) {
  const colors = useColors();
  const size = useScaledSize(MARK_SIZE.GLYPH);
  const glyph = CALL_SYMBOL[callKind];

  if (!isLucideSymbol(glyph)) {
    return (
      <SymbolView
        name={glyph}
        size={size}
        tintColor={colors.TEXT_MUTED}
        accessibilityElementsHidden
      />
    );
  }

  return (
    <Host style={styles.callGlyph}>
      <ToneGlyph glyph={glyph} tone={STATUS_TONE.NEUTRAL} textStyle={TYPE_ROLE.ROW_LINE} hidden />
    </Host>
  );
}

/** A call's row: its kind's glyph, its verb in the full ink, what it was done to in the muted one, where it ran, and where it stands; pressed, it opens on its body. */
function CallRow({
  item,
  held,
  onToggle,
}: {
  readonly item: Extract<TranscriptItem, { kind: typeof TRANSCRIPT_ITEM.CALL }>;
  /** The answer the agent holds the call for, where it does. */
  readonly held: HeldCall | undefined;
  readonly onToggle: (item: TranscriptItem) => void;
}) {
  const colors = useColors();
  const large = useAccessibilitySize();
  // Note that at an accessibility size the line's words wrap rather than cut to a word or two.
  const lines = large ? undefined : 1;
  const { line, chip } = item;
  const subject = line.subject === undefined || line.subject === "" ? undefined : line.subject;
  const standing = held?.waiting === true ? HELD_HEARD : CALL_STANDING_HEARD[item.standing];

  return (
    <View style={[styles.row, inset(item.depth)]}>
      <Pressable
        onPress={() => onToggle(item)}
        accessibilityRole="button"
        accessibilityState={{ expanded: item.open }}
        accessibilityLabel={[line.verb, chip, subject, item.runOn].filter(Boolean).join(" ")}
        accessibilityValue={{
          text: item.open ? standing : `${standing}, ${COLLAPSED_HEARD}`,
        }}
        accessibilityHint={CALL_HINT}
        hitSlop={LINE_REACH}
        style={styles.callLine}
      >
        <CallGlyph callKind={item.callKind} />
        <View style={[styles.callWords, large ? styles.wrapped : null]}>
          <Text
            numberOfLines={lines}
            style={{
              flexShrink: 0,
              maxWidth: "70%",
              fontSize: TEXT_SIZE.FOOTNOTE,
              color: colors.TEXT_MUTED,
            }}
          >
            {line.verb}
          </Text>
          {chip === undefined ? null : (
            <View
              style={[styles.chip, { backgroundColor: colors.WELL, borderColor: colors.CHIP_EDGE }]}
            >
              <Text
                numberOfLines={lines}
                style={{ fontSize: TEXT_SIZE.CAPTION, color: colors.TEXT_BODY, fontWeight: "500" }}
              >
                {chip}
              </Text>
            </View>
          )}
          {subject === undefined || item.open ? null : (
            <Text
              numberOfLines={lines}
              style={{
                flexShrink: 1,
                fontSize: line.code ? TEXT_SIZE.CAPTION : TEXT_SIZE.FOOTNOTE,
                fontFamily: line.code ? MONOSPACE_FONT : undefined,
                color: line.code ? colors.TEXT_BODY : colors.TEXT_MUTED,
              }}
            >
              {subject}
            </Text>
          )}
        </View>
        {item.runOn === undefined ? null : (
          <Text
            numberOfLines={lines}
            style={{ fontSize: TEXT_SIZE.FOOTNOTE, color: colors.TEXT_MUTED }}
          >
            {item.runOn}
          </Text>
        )}
        {/* Note that a call held for an answer is not working, so its line says so under it rather than turning. */}
        <StandingMark
          running={item.standing === CALL_STANDING.RUNNING && held?.waiting !== true}
          failed={item.standing === CALL_STANDING.FAILED}
        />
      </Pressable>
      {held === undefined ? null : (
        <View style={styles.body}>
          {/* Note that the presses are SwiftUI's, hosted in the row at the height they draw. */}
          <Host matchContents={{ vertical: true }}>
            <HeldCallBody held={held} />
          </Host>
        </View>
      )}
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
  const large = useAccessibilitySize();

  const heard = [
    item.running ? CALL_STANDING_HEARD[CALL_STANDING.RUNNING] : undefined,
    item.open ? undefined : COLLAPSED_HEARD,
  ].filter((part) => part !== undefined);

  return (
    <View style={[styles.row, inset(item.depth)]}>
      <Pressable
        onPress={() => onToggle(item)}
        accessibilityRole="button"
        accessibilityState={{ expanded: item.open }}
        accessibilityLabel={item.summary}
        accessibilityValue={heard.length === 0 ? undefined : { text: heard.join(", ") }}
        accessibilityHint={FOLD_HINT}
        hitSlop={LINE_REACH}
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
          numberOfLines={large ? undefined : 1}
          style={{ flex: 1, fontSize: TEXT_SIZE.FOOTNOTE, color: colors.TEXT_MUTED }}
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
  /** Opens a link or a chip a message names, by the address it was written as, where the app draws it or in Safari. */
  readonly onOpenLink: (address: string) => void;
  readonly onToggle: (item: TranscriptItem) => void;
  /** Opens a page the agent showed whole, by the item that names it. */
  readonly onOpenPage: (
    item: Extract<TranscriptItem, { kind: typeof TRANSCRIPT_ITEM.PAGE }>,
  ) => void;
  /** The address a picture or a recording is drawn from, by its id; none while its bytes are on their way. */
  readonly mediaSource: (id: string) => string | undefined;
  /** Opens a recording the system's player cannot play where it plays. */
  readonly onOpenElsewhere?: (() => void) | undefined;
  /** Opens a web address in Safari, such as a pull request's page on GitHub. */
  readonly onOpenAddress: (address: string) => void;
  /** Opens a pull request's own screen, as a press on its card asks; none where the app draws no screen for it. */
  readonly onOpenPullRequest?: ((item: PullRequestItem) => void) | undefined;
  /** What a pull request's card offers after Review, such as Merge where it may merge now; none where it offers nothing more. */
  readonly pullRequestActs?: ((item: PullRequestItem) => readonly PullRequestAct[]) | undefined;
  /** The answer the agent holds a call for, by the call's id; none where it holds none. */
  readonly heldCall?: ((callId: string) => HeldCall | undefined) | undefined;
}

/** A pull request an agent opened, as the transcript lists it. */
type PullRequestItem = Extract<TranscriptItem, { kind: typeof TRANSCRIPT_ITEM.PULL_REQUEST }>;

/** One of the transcript's rows, as its kind draws it. */
function TranscriptRow({
  item,
  drawing,
}: {
  readonly item: TranscriptItem;
  readonly drawing: RowDrawing;
}) {
  const colors = useColors();
  const large = useAccessibilitySize();

  switch (item.kind) {
    case TRANSCRIPT_ITEM.SAID:
      return (
        <View style={[styles.row, styles.saidRow]}>
          {item.sender === undefined ? null : (
            <Text style={{ fontSize: TEXT_SIZE.FOOTNOTE, fontWeight: "600", color: colors.TEXT }}>
              {item.sender}
            </Text>
          )}
          <CopyWordsMenu words={item.words}>
            <View style={styles.saidHeld}>
              <View style={[styles.said, { backgroundColor: colors.SIDEBAR }]}>
                <Markdown
                  words={item.words}
                  typed
                  repository={drawing.repository}
                  onOpenLink={drawing.onOpenLink}
                />
              </View>
            </View>
          </CopyWordsMenu>
          {item.sent === undefined ? null : (
            <Text style={{ fontSize: TEXT_SIZE.CAPTION, color: colors.TEXT_MUTED }}>
              {item.sent}
            </Text>
          )}
        </View>
      );
    case TRANSCRIPT_ITEM.FOOT:
      return (
        <View style={[styles.row, { paddingBottom: SPACE.ROW }]}>
          <Text selectable style={{ fontSize: TEXT_SIZE.CAPTION, color: colors.TEXT_MUTED }}>
            {item.words}
          </Text>
        </View>
      );
    case TRANSCRIPT_ITEM.WORKING:
      return (
        <View style={[styles.row, styles.headLine, { paddingVertical: SPACE.ROW }]}>
          <ActivityIndicator size="small" color={colors.TEXT_MUTED} accessibilityElementsHidden />
          <Text style={{ fontSize: TEXT_SIZE.FOOTNOTE, color: colors.TEXT_MUTED }}>
            {item.words}
          </Text>
        </View>
      );
    case TRANSCRIPT_ITEM.WORDS:
      return (
        <View style={[styles.row, inset(item.depth), { paddingVertical: SPACE.TIGHT + 2 }]}>
          <CopyWordsMenu words={item.words}>
            <View>
              <Markdown
                words={item.words}
                repository={drawing.repository}
                onOpenLink={drawing.onOpenLink}
              />
            </View>
          </CopyWordsMenu>
        </View>
      );
    case TRANSCRIPT_ITEM.CALL:
      return (
        <CallRow item={item} held={drawing.heldCall?.(item.callId)} onToggle={drawing.onToggle} />
      );
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
                  label={shown.label}
                  onOpenElsewhere={drawing.onOpenElsewhere}
                />
              ) : (
                <Picture source={drawing.mediaSource(shown.id)} alt={shown.label} />
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
              size={MARK_SIZE.WRITER}
              tintColor={colors.TEXT_MUTED}
              accessibilityElementsHidden
            />
            <View style={{ flex: 1, gap: 2 }}>
              <Text
                numberOfLines={large ? undefined : 2}
                style={{ fontSize: TEXT_SIZE.SUBHEADLINE, fontWeight: "500", color: colors.TEXT }}
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
    case TRANSCRIPT_ITEM.PULL_REQUEST:
      return (
        <View style={[styles.row, inset(item.depth), { paddingVertical: SPACE.TIGHT + 2 }]}>
          {/* Note that the card is SwiftUI's, hosted in the row at the height it draws. */}
          <Host matchContents={{ vertical: true }}>
            <PullRequestCard
              state={item.state}
              number={item.number}
              title={item.title}
              additions={item.additions}
              deletions={item.deletions}
              acts={[
                { label: REVIEW_WORD, onPress: () => drawing.onOpenAddress(item.url) },
                ...(drawing.pullRequestActs?.(item) ?? []),
              ]}
              onOpen={
                drawing.onOpenPullRequest === undefined
                  ? undefined
                  : () => drawing.onOpenPullRequest?.(item)
              }
            />
          </Host>
        </View>
      );
    default: {
      const unknown: never = item;
      throw new Error(`A transcript item of no kind the list draws: ${JSON.stringify(unknown)}`);
    }
  }
}

type AgentHeadProps = {
  /** The model the agent runs on, as the panel's chip names it. */
  readonly model: string | undefined;
  readonly status: AgentStatus | undefined;
  /** Opens the picker that changes the model, as a press on the panel's chip does; none where the reader may not change it. */
  readonly onModel?: (() => void) | undefined;
};

/** What a press on the head's model says it does, to VoiceOver. */
const CHANGE_MODEL = "Change model";

/**
 * The line over the transcript, the agent's title standing in the system's
 * bar over it: where the agent stands and the model it runs on, as the
 * panel's tab and its model chip say them; nothing before either is known.
 * Where the model may be changed, its name is a press with a chevron after
 * it, as the panel's chip draws one, opening the picker.
 */
export function AgentHead({ model, status, onModel }: AgentHeadProps) {
  const colors = useColors();
  const state = status === undefined ? undefined : agentGlyphState(status);
  const words = status === undefined ? undefined : agentStateWords(status);
  const pressed = onModel !== undefined && model !== undefined && model !== "";

  const said = [words, pressed ? undefined : model]
    .filter((each) => each !== undefined && each !== "")
    .join(" · ");

  // Note that a change of state is told to VoiceOver as it lands, such as Working turning to Finished or Failed, since the reader may stand anywhere in the transcript.
  useAnnounced(words);

  if (said === "" && !pressed) return null;
  const ink = { fontSize: TEXT_SIZE.FOOTNOTE, color: colors.TEXT_MUTED };

  return (
    <View style={[styles.head, styles.headLine]}>
      {state === GLYPH_STATE.WORKING ? (
        <ActivityIndicator size="small" color={colors.WORKING} accessibilityElementsHidden />
      ) : state === GLYPH_STATE.FAILED ? (
        <SymbolView
          name="xmark.circle.fill"
          size={MARK_SIZE.GLYPH}
          tintColor={colors.DANGER}
          accessibilityElementsHidden
        />
      ) : null}
      {said === "" ? null : (
        <Text style={ink}>{pressed && words !== undefined ? `${said} ·` : said}</Text>
      )}
      {pressed ? (
        <Pressable
          onPress={onModel}
          accessibilityRole="button"
          accessibilityLabel={`${CHANGE_MODEL}, ${model}`}
          hitSlop={LINE_REACH}
          testID="agent-model"
          style={styles.headModel}
        >
          <Text style={ink}>{model}</Text>
          <SymbolView
            name="chevron.down"
            size={MARK_SIZE.GLYPH - 4}
            weight="semibold"
            tintColor={colors.TEXT_MUTED}
            accessibilityElementsHidden
          />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The control that brings the newest row into view, as Messages and the
 * chat apps draw it: a round button of Liquid Glass holding a down arrow,
 * centered over the list's foot, standing only once the reader has scrolled
 * back. Note that where Liquid Glass is unavailable, before iOS 26, or the
 * reader turned on Reduce Transparency, it is drawn solid on the surface's
 * ground inside the quiet ink rather than a hand-drawn copy of glass.
 */
function JumpToLatest({
  bottom,
  onPress,
}: {
  readonly bottom: number;
  readonly onPress: () => void;
}) {
  const colors = useColors();
  const solid = useReduceTransparency() || !isLiquidGlassAvailable();

  const arrow = (
    <SymbolView
      name="arrow.down"
      size={MARK_SIZE.GLYPH + 2}
      weight="semibold"
      tintColor={colors.TEXT}
      accessibilityElementsHidden
    />
  );

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={JUMP_TO_LATEST}
      hitSlop={SPACE.TIGHT}
      style={[styles.jump, { bottom }]}
    >
      {solid ? (
        <View
          style={[
            styles.jumpFace,
            {
              backgroundColor: colors.SURFACE,
              borderColor: colors.TEXT_MUTED,
              borderWidth: StyleSheet.hairlineWidth,
            },
          ]}
        >
          {arrow}
        </View>
      ) : (
        <GlassView glassEffectStyle="regular" isInteractive style={styles.jumpFace}>
          {arrow}
        </GlassView>
      )}
    </Pressable>
  );
}

/** The pages older than the oldest row held, as the list reads them: whether one is being read, whether the last read failed, and the read. */
export type OlderPages = {
  readonly reading: boolean;
  readonly failed: boolean;
  /** Reads the page older than the oldest row held, which lands before it, as the reader scrolls up to it; nothing where the last read failed. */
  readonly onRead: () => void;
  /** Reads it again once a read failed, as Try again asks. */
  readonly onRetry: () => void;
};

/**
 * What stands over the oldest row while older pages stand: the system's
 * spinner while one is read, and where it could not be read, why, with Try
 * again, which reads it again; nothing between reads.
 */
function OlderRow({ older }: { readonly older: OlderPages }) {
  const colors = useColors();

  if (older.reading) {
    return (
      <View style={styles.older}>
        <ActivityIndicator
          size="small"
          color={colors.TEXT_MUTED}
          accessibilityLabel={READING_OLDER}
        />
      </View>
    );
  }

  if (!older.failed) return null;

  return (
    <View style={styles.older}>
      <Text style={{ fontSize: TEXT_SIZE.FOOTNOTE, color: colors.TEXT_MUTED }}>
        {OLDER_WORDS.FAILED}
      </Text>
      <Host matchContents>
        <Button label={OLDER_WORDS.RETRY} look={BUTTON_LOOK.BORDERED} onPress={older.onRetry} />
      </Host>
    </View>
  );
}

type AgentTranscriptProps = Omit<RowDrawing, "now"> & {
  /** The rows, oldest first (`transcriptItems`). */
  readonly items: readonly TranscriptItem[];
  /** What stands over the oldest row, such as the agent's head. */
  readonly head: ReactNode;
  /** The empty state that stands in the rows' place while there are none, such as a read under way. */
  readonly empty?: EmptyStateProps | undefined;
  /** What the times count from; now where none is given. */
  readonly now?: number | undefined;
  /** The pages older than the oldest row, read as the reader scrolls up to it; none where nothing older stands. */
  readonly older?: OlderPages | undefined;
};

/**
 * An agent's transcript as one lazy list, the app's one React Native list,
 * since SwiftUI has no piece for its rows: it opens at its newest row and
 * stays anchored there, so a row that lands while the reader stands at the
 * newest comes into view, and one that lands while they read back holds
 * their place; a reader scrolled back is offered Jump to latest. Only the rows near the
 * screen are drawn, however long the transcript runs.
 */
export function AgentTranscript({
  items,
  head,
  empty,
  now,
  older,
  ...drawing
}: AgentTranscriptProps) {
  const colors = useColors();
  const reduceMotion = useReduceMotion();
  const { bottom, left, right } = useSafeAreaInsets();
  const list = useRef<FlatList<TranscriptItem>>(null);
  // Whether the reader stands at the newest row, which the list keeps in view as rows land; it opens there.
  const anchored = useRef(true);
  const [away, setAway] = useState(false);
  // The list's own width, so a wide window's rows stand centered within the reading width rather than across it.
  const [width, setWidth] = useState(0);
  const sides = Math.max(0, (width - left - right - READING_WIDTH) / 2);
  const rowDrawing: RowDrawing = { ...drawing, now: now ?? Date.now() };
  // Note that the room under the newest row clears the bar docked over the list's foot as tall as it stands, so a composer grown by its head never covers the end of the transcript.
  const foot = bottom + TAB_BAR_ROOM + useDockRoom();

  // Note that only the reader's own scroll moves the anchor, never the list's own scroll to its end as rows render in: a drag lets it go, and where the scroll settles sets it again.
  const onScrollBegin = useCallback(() => {
    anchored.current = false;
  }, []);

  // The older pages as they stand now, which the scroll reads without being made anew for each.
  const olderNow = useRef(older);
  useEffect(() => {
    olderNow.current = older;
  }, [older]);

  // Note that only the reader's own scroll up reads an older page, never the list's scroll as it opens, and a read that failed waits for Try again.
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setAway(fromEnd(event.nativeEvent) > LATEST_REACH);
    const pages = olderNow.current;

    if (anchored.current || pages === undefined || pages.reading || pages.failed) return;

    if (event.nativeEvent.contentOffset.y < OLDER_REACH) pages.onRead();
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
    <View
      style={[styles.list, { backgroundColor: colors.GROUND }]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      <FlatList
        ref={list}
        data={items}
        keyExtractor={itemKey}
        renderItem={({ item }) => <TranscriptRow item={item} drawing={rowDrawing} />}
        ListHeaderComponent={
          <>
            {head}
            {older === undefined ? null : <OlderRow older={older} />}
          </>
        }
        // Note that the empty state is SwiftUI's, so it stands in a host of its own: mounted bare in the list's React Native view, it raises a native exception that crashes the app.
        ListEmptyComponent={
          empty === undefined ? undefined : (
            <Host matchContents={{ vertical: true }}>
              <EmptyState {...empty} />
            </Host>
          )
        }
        ListFooterComponent={<View style={{ height: foot }} />}
        // Note that the rows stand inside the window's safe area at its sides too, clear of a rail the system draws there, as the folded iPhone Duo's.
        contentContainerStyle={[
          styles.content,
          { paddingLeft: left + sides, paddingRight: right + sides },
        ]}
        contentInsetAdjustmentBehavior="automatic"
        // Note that rows laid before the oldest, as an older page lands, leave the row the reader reads where it stood.
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        // Note that a drag down into the keyboard lowers it, as Messages' transcript does, since the composer docked over the list holds no key that does.
        keyboardDismissMode="interactive"
        onContentSizeChange={onContentSizeChange}
        onScroll={onScroll}
        onScrollBeginDrag={onScrollBegin}
        onScrollEndDrag={onScrollSettled}
        onMomentumScrollEnd={onScrollSettled}
        scrollEventThrottle={64}
        initialNumToRender={16}
        windowSize={9}
        accessibilityLabel="Transcript"
      />
      {away ? (
        <JumpToLatest
          bottom={foot}
          onPress={() => {
            anchored.current = true;
            // Note that the jump scrolls at once where the reader asked for less motion.
            list.current?.getScrollResponder()?.scrollToEnd({ animated: !reduceMotion });
          }}
        />
      ) : null}
    </View>
  );
}
