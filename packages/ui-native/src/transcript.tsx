// transcript.tsx -- an agent's transcript as the iPhone draws it: the app's one React Native list, lazy, anchored at its newest row, its rows the panel's anatomy in the brand's inks.

import { Image, Button as SwiftUIButton } from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import { accessibilityLabel, buttonStyle, frame, tint } from "@expo/ui/swift-ui/modifiers";
import { INTEGRATION_NAME, type IntegrationProvider } from "@repo/features/integration-wire";
import {
  CHAT_EDIT_WORDS,
  CHAT_THREAD_WORDS,
  chatWorkWords,
} from "@repo/features/manager-chat-view";
import type { ReplyButtonLink } from "@repo/features/reply-button-wire";
import type { CallKind } from "@repo/features/turn-rows";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { Predicate } from "effect";
import { SymbolView } from "expo-symbols";
import {
  Fragment,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type AccessibilityActionEvent,
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  type HostInstance,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAccessibilitySize, useReduceMotion, useScaledSize } from "./accessibility.js";
import { AudioClip } from "./audio-clip.js";
import { BUTTON_LOOK, Button } from "./button.js";
import {
  CHANNEL_SEAT,
  type ChannelFaces,
  ChannelMessage,
  NewRule,
  SenderPress,
  ThreadReplies,
  ThreadRule,
} from "./channel-row.js";
import { BUBBLE_PADDING, BUBBLE_SHARE, CHAT_SIDE, ChatBubble, chatRunOf } from "./chat-bubble.js";
import { EmptyState, type EmptyStateProps } from "./empty-state.js";
import { FileChip } from "./file-chip.js";
import { GitHubLineCard } from "./github-line-card.js";
import { BAR_EDGE, BAR_MARGIN, useDockKeyboard, useDockRoom } from "./glass-bar.js";
import { GLYPH, glyphImage, glyphSymbol } from "./glyph.js";
import { type HeldCall, HeldCallBody } from "./held-call.js";
import {
  CardMenu,
  CopyWordsMenu,
  type HeldAct,
  HeldLeadProvider,
  HeldMenu,
  MessageMenu,
  MessageWords,
  PictureOriginProvider,
  PictureSetProvider,
  TurnActs,
  useCopyWords,
} from "./held-menu.js";
import { InlineHost } from "./inline-host.js";
import { ROW_ACTION_TONE } from "./list-row.js";
import { Markdown, type MarkdownWordPicture, Picture } from "./markdown.js";
import { IntegrationMark, WorkingMark } from "./marks.js";
import { MEDIA_BOUNDS } from "./media-frame.js";
import { PictureSet } from "./picture-set.js";
import { LoaderImage, PICTURE_FIT, type PictureRef, usePictureRef } from "./picture-source.js";
import { Press } from "./press.js";
import { type PullRequestAct, PullRequestCard } from "./pull-request-card.js";
import type { SuggestionLook } from "./suggestion-look.js";
import { type BrandColors, useColors } from "./tokens/colors.js";
import { MARK_SIZE, PRESS_SIZE, RADIUS, READING_WIDTH, SPACE } from "./tokens/space.js";
import { MONOSPACE_FONT, PROSE_SIZE, ROLE_SIZE } from "./tokens/type.js";
import { CALL_SYMBOL } from "./transcript-look.js";
import {
  CALL_STANDING,
  type CallStanding,
  type ChatSender,
  type OriginPart,
  RULE_LOOK,
  type SaidCard,
  type SaidFile,
  type SaidPicture,
  SHOWN_MEDIA,
  type ShownMedia,
  TRANSCRIPT_ITEM,
  type TranscriptItem,
  type TranscriptPlace,
} from "./transcript-model.js";
import { type UndeliveredLine, UndeliveredMark } from "./undelivered-mark.js";
import { Video } from "./video.js";

/** Who the reader's own line is from, as a picture's viewer names it. */
const SENT_BY_YOU = "You";

/** How far a sent line stands from the line of its run beside it, so a run's bubbles stand 2 pt apart, as Messages draws a sender's run; runs stand `SPACE.ROW` twice apart. */
const RUN_GAP = 1;

/** How far a row a fold or a group holds stands in, for each step it is held. */
const DEPTH_INSET = 18;

/** How near its newest row, as a share of the list's height, the reader stands for a row that lands to be scrolled into view, as FlashList's chat lists keep their end. */
const AUTOSCROLL_SHARE = 0.1;

/** How far past its newest row's top the list opens, which the scroll view clamps to its end: as far as any row could stand, so a newest row taller than the screen opens at its end rather than its top. */
const OPEN_PAST_NEWEST = Number.MAX_SAFE_INTEGER;

/** How far the list stands from its newest row before Jump to latest is offered, in points. */
const LATEST_REACH = 240;

/** How near its newest row the list stands to keep it in view as rows land, in points. */
const ANCHOR_REACH = 48;

/** How wide the round control that brings the newest row into view stands, in points: the system's least target, as wide as Send's press frame, so it stands centered over Send. */
const JUMP_SIZE = PRESS_SIZE;

/** How far the round control's circle stands past the arrow inside it, on each axis, in points, as the composer's round button stands past its mark. */
const JUMP_EDGE = 12;

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

/** What a pull request card's long press offers, as the panel's pull request row's right-click names them. */
const PULL_REQUEST_MENU_WORDS = {
  COPY_GITHUB_LINK: "Copy GitHub link",
  OPEN_ON_GITHUB: "Open on GitHub",
} as const;

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
  // Note that while there are no rows the content fills the list, so the empty state has room to center in.
  emptyContent: { flexGrow: 1 },
  emptyHost: { flex: 1 },
  // Note that a landed row's wash stands a step in from the row's sides, rounded as a card, as the panel's stands a step around the place it lights.
  landed: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    marginHorizontal: SPACE.EDGE / 2,
    borderRadius: RADIUS.CARD,
  },
  row: { paddingHorizontal: SPACE.EDGE, paddingVertical: SPACE.TIGHT },
  saidRow: { alignItems: "flex-end", gap: SPACE.TIGHT + 2, paddingVertical: SPACE.ROW },
  // Note that the line's menu spans the row, so its bubble stands at the row's end inside it as it stands outside.
  saidHeld: { alignSelf: "stretch", alignItems: "flex-end" },
  undelivered: { alignSelf: "flex-end", paddingTop: SPACE.TIGHT },
  // Note that a line anyone but the reader sent stands at the column's leading edge, its pictures, files and bubble with it, as the panel stands a received line at its left.
  received: { alignItems: "flex-start" },
  // Note that the turn's acts stand their first glyph flush with the words above it, each glyph centered in its 44 pt target.
  turnActs: { alignSelf: "flex-start", marginStart: -(PRESS_SIZE - MARK_SIZE.GLYPH) / 2 },
  originBody: { alignSelf: "stretch", gap: SPACE.TIGHT },
  // Note that a prompt's card spans the row, as the panel's Prompt card spans the message's measure.
  promptCard: {
    alignSelf: "stretch",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.CARD,
    overflow: "hidden",
  },
  promptHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.ROW - 2,
    paddingHorizontal: SPACE.EDGE - 4,
    paddingVertical: SPACE.ROW,
  },
  promptWords: { gap: SPACE.ROW, paddingHorizontal: SPACE.EDGE - 4, paddingBottom: SPACE.ROW },
  stamp: { alignSelf: "center", fontWeight: "500", paddingBottom: SPACE.TIGHT },
  callLine: { flexDirection: "row", alignItems: "center", gap: SPACE.ROW - 2, minHeight: 28 },
  callWords: { flex: 1, flexDirection: "row", alignItems: "center", gap: 5, minWidth: 0 },
  wrapped: { flexWrap: "wrap" },
  chip: {
    flexShrink: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.TAG,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  body: {
    marginLeft: MARK_SIZE.GLYPH + SPACE.ROW - 2,
    gap: SPACE.TIGHT + 2,
    paddingTop: SPACE.TIGHT,
  },
  block: { borderWidth: StyleSheet.hairlineWidth, borderRadius: RADIUS.BLOCK, overflow: "hidden" },
  blockTitle: { paddingHorizontal: SPACE.ROW, paddingTop: 6 },
  blockText: { padding: SPACE.ROW, paddingTop: SPACE.TIGHT },
  media: { gap: SPACE.ROW },
  // Note that each picture or recording sizes itself by the media's one rule (`mediaFrame`), and its caption wraps at the widest one stands.
  shown: { maxWidth: MEDIA_BOUNDS.WIDTH, alignItems: "flex-start", gap: SPACE.TIGHT },
  page: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.ROW,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.CARD,
    paddingHorizontal: SPACE.EDGE - 4,
    paddingVertical: SPACE.ROW,
  },
  headLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  older: { alignItems: "center", gap: SPACE.TIGHT * 2, paddingVertical: SPACE.ROW },
  jump: { position: "absolute" },
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

/** The message id of the reader's own newest line, a line on its way among them; none where they sent none. */
function newestOwnLine(items: readonly TranscriptItem[]): string | undefined {
  return items.findLast((item) => item.kind === TRANSCRIPT_ITEM.SAID && !item.received)?.place
    .message;
}

/**
 * Tells `onSent` each time a line of the reader's own lands as the
 * transcript's newest, as a send of theirs does: never for the lines the
 * transcript opens on or reads in later, nor for an older line of theirs
 * becoming the newest again once a refused one is deleted.
 */
function useOwnSend(items: readonly TranscriptItem[], onSent: () => void): void {
  const newest = newestOwnLine(items);
  const hasRows = items.length > 0;
  // The reader's lines already seen, and whether the list stood rows when it last looked, so the lines it opens on never count as sent.
  const seen = useRef(new Set(newest === undefined ? [] : [newest]));
  const stood = useRef(hasRows);
  const told = useRef(onSent);
  useEffect(() => {
    told.current = onSent;
  }, [onSent]);

  useEffect(() => {
    const sent = newest !== undefined && stood.current && !seen.current.has(newest);

    if (newest !== undefined) seen.current.add(newest);
    stood.current = hasRows;

    if (sent) told.current();
  }, [newest, hasRows]);
}

type InsetResult = { readonly paddingLeft: number };

/** A fold standing inside a channel row's words, which sets it in already. */
const FOLD_IN_CHANNEL: InsetResult = { paddingLeft: 0 };

/** The step a row stands in by, for the folds that hold it. */
function inset(depth: number): InsetResult {
  return { paddingLeft: SPACE.EDGE + depth * DEPTH_INSET };
}

/** How wide a row's own content stands, inside its sides and the steps it is held in, in a column of `column` points. */
function rowWidth(column: number, depth = 0): number {
  return column - SPACE.EDGE * 2 - depth * DEPTH_INSET;
}

/** The widest a sent line's words stand inside its bubble, in a column of `column` points, past any room its sender's face takes (`room`). */
function bubbleWordsWidth(column: number, room = 0): number {
  return Math.floor((rowWidth(column) - room) * BUBBLE_SHARE) - BUBBLE_PADDING.HORIZONTAL * 2;
}

/**
 * A message of a Manager's chat as a channel's row (`ChannelMessage`): its
 * sender's face, name, and time where it opens their run, then what it
 * carried, its pictures and files, then its words, held for its menu,
 * which leads with Reply in thread where the channel opens threads, the
 * mark of words edited since it was sent run on after them, and under them the
 * summary of its thread's replies, which opens it, as the panel's channel
 * stands each message whoever sent it.
 */
function ChannelSaid({
  item,
  sender,
  faces,
  drawing,
}: {
  readonly item: Extract<TranscriptItem, { kind: typeof TRANSCRIPT_ITEM.SAID }>;
  readonly sender: ChatSender;
  readonly faces: ChannelFaces;
  readonly drawing: RowDrawing;
}) {
  const width = rowWidth(drawing.column) - CHANNEL_SEAT;
  const open = drawing.onOpenChatThread;
  const thread = open === undefined ? undefined : item.thread;
  const wordless = item.words.trim() === "";

  const threadAct: readonly HeldAct[] =
    thread === undefined || open === undefined
      ? []
      : [
          {
            label: CHAT_THREAD_WORDS.REPLY,
            symbol: GLYPH.REPLY_IN_THREAD,
            onPress: () => open(thread.root),
          },
        ];

  const message = (
    <ChannelMessage
      sender={sender}
      faces={faces}
      opens={!item.joinsAbove}
      stamp={item.stamp}
      onOpenLink={drawing.onOpenLink}
    >
      {/* Note that a message's pictures name who sent it and when in their viewer's bar, and each of them and its files leads its long press with Reply in thread, as Messages leads a photo's with Reply, so a message of files alone opens its thread too. */}
      <HeldLeadProvider acts={threadAct}>
        <PictureOriginProvider origin={{ by: sender.name, at: item.at }}>
          <PictureSet
            atEnd={false}
            pictures={(item.pictures ?? []).map((picture) => ({
              key: picture.key,
              source: picture.url ?? saidSource(drawing, picture.pictureId),
              alt: picture.name,
              onRetry:
                picture.pictureId === undefined ? undefined : retryOf(drawing, picture.pictureId),
            }))}
          />
        </PictureOriginProvider>
        {(item.files ?? []).map((file) => (
          <FileChip
            key={file.key}
            atEnd={false}
            held={file.base64 !== undefined}
            name={file.name}
            mediaType={file.mediaType}
            source={sentFileSource(drawing, item.place.row, file)}
            size={file.size}
            onRetry={sentFileRetry(drawing, item.place.row, file)}
          />
        ))}
      </HeldLeadProvider>
      {/* Note that a message of files alone, or of what the Manager showed alone, draws no words under them. */}
      {wordless ? null : (
        <MessageMenu
          words={item.words}
          at={item.at}
          // Note that every message offers its link, the Manager's as much as a person's, as the panel's menu offers Copy link; every message leads with Reply in thread, then what the page offers every chat message, such as Edit.
          link={drawing.messageLink?.(item.place.row)}
          more={[...threadAct, ...(drawing.messageMore?.(item) ?? [])]}
          width={width}
        >
          <View>
            {/* Note that Select text selects the words in the row itself (`MessageWords`). */}
            <MessageWords>
              <Markdown
                words={item.words}
                typed={!sender.manager}
                repository={drawing.repository}
                onOpenLink={drawing.onOpenLink}
                width={width}
                wordPictures={item.wordPictures}
                wordPicture={(name) => wordPictureOf(drawing, item.wordPictures?.get(name))}
                after={item.edited === true ? CHAT_EDIT_WORDS.EDITED : undefined}
              />
            </MessageWords>
          </View>
        </MessageMenu>
      )}
      {thread === undefined || open === undefined ? null : (
        <ThreadReplies thread={thread} faces={faces} onOpen={open} />
      )}
      <UndeliveredUnder line={drawing.undelivered?.(item.place.row)} />
    </ChannelMessage>
  );

  // Note that a line of no words and nothing it carried, such as the Manager's message of what it showed alone, whose pictures stand as a row of their own under it, offers Reply in thread on a long press of its head, since it holds no words to hold.
  const bare = wordless && (item.pictures ?? []).length + (item.files ?? []).length === 0;

  return (
    <View
      style={[
        styles.row,
        { paddingTop: item.joinsAbove ? RUN_GAP : SPACE.ROW, paddingBottom: RUN_GAP },
      ]}
    >
      {bare ? (
        <HeldMenu acts={threadAct} width={rowWidth(drawing.column)}>
          {message}
        </HeldMenu>
      ) : (
        message
      )}
    </View>
  );
}

/**
 * The working mark among the transcript's React Native views, in a host of
 * its own the mark's size, as the panel stands its mark in a running call's
 * row; hidden from VoiceOver, since its row says it is working.
 */
function TranscriptWorkingMark() {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <InlineHost matchContents>
        <WorkingMark />
      </InlineHost>
    </View>
  );
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

  if (running) return <TranscriptWorkingMark />;

  if (!failed) return null;

  return (
    <SymbolView
      name={glyphSymbol(GLYPH.FAILED)}
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
      <Text style={[styles.blockTitle, { fontSize: ROLE_SIZE.ROW_LINE, color: colors.TEXT_MUTED }]}>
        {title}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text
          selectable
          style={[
            styles.blockText,
            { fontFamily: MONOSPACE_FONT, fontSize: ROLE_SIZE.ROW_LINE, color: colors.TEXT_BODY },
          ]}
        >
          {text}
        </Text>
      </ScrollView>
    </View>
  );
}

/**
 * A call's glyph at a row mark's size, the panel's own for its kind, through
 * the system's symbol view (`patches/expo-symbols@58.0.4.patch`), so a call's
 * row costs no SwiftUI host; or, for a call of an integration's tool, the
 * integration's mark, as the panel's row leads with it. Note that the mark
 * alone takes a SwiftUI host, because the symbol view tints whatever it draws
 * in one ink, which would flatten a mark in its brand's own colors.
 */
function CallGlyph({
  callKind,
  provider,
  icon,
}: {
  readonly callKind: CallKind;
  readonly provider: IntegrationProvider | undefined;
  /** What its app's icon is drawn from, once read; none while it is on its way, where it could not be read, or where its app kept none, when its kind's glyph stands in. */
  readonly icon: PictureRef | undefined;
}) {
  const colors = useColors();
  const size = useScaledSize(MARK_SIZE.GLYPH);
  // Note that an icon kept by its id is read here, so its landing draws the glyph again and never its row.
  const drawn = usePictureRef(icon) ?? undefined;

  // Note that an app's icon is its own picture, drawn at the glyph's size in its place, as the panel's row wears it; its row's words name the app, so it is hidden from VoiceOver.
  if (drawn !== undefined) {
    return (
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <LoaderImage
          source={drawn}
          fit={PICTURE_FIT.CONTAIN}
          style={{ width: size, height: size }}
        />
      </View>
    );
  }

  return provider === undefined ? (
    <SymbolView
      name={glyphSymbol(CALL_SYMBOL[callKind])}
      size={size}
      tintColor={colors.TEXT_MUTED}
      accessibilityElementsHidden
    />
  ) : (
    <InlineHost style={{ width: size, height: size }}>
      <IntegrationMark provider={provider} size={size} ink={colors.TEXT_MUTED} />
    </InlineHost>
  );
}

/** The VoiceOver action a call's row offers to open the thread its chip names, since the chip stands inside the row's one element. */
const OPEN_THREAD_ACTION = { name: "openThread", label: "Open thread" } as const;

/**
 * A call's row: its kind's glyph, or its app's icon for a call on an app
 * on the reader's Mac, its verb in the full ink, what it was done to in the
 * muted one, where it ran, and where it stands; pressed, it opens on its
 * body. A call about one Inbox thread, such as a post, names
 * it by its chip, whose press alone opens the thread, as the panel's chip
 * does, and VoiceOver offers the same as one of the row's actions.
 */
function CallRow({
  item,
  held,
  drawing,
  onToggle,
  onOpenThread,
  placeCall,
}: {
  readonly item: Extract<TranscriptItem, { kind: typeof TRANSCRIPT_ITEM.CALL }>;
  /** The answer the agent holds the call for, where it does. */
  readonly held: HeldCall | undefined;
  /** How the media its open body holds is read and opened. */
  readonly drawing: RowDrawing;
  readonly onToggle: (item: TranscriptItem) => void;
  readonly onOpenThread: ((threadId: string) => void) | undefined;
  readonly placeCall: ((callId: string, row: HostInstance | null) => void) | undefined;
}) {
  const { callId, thread } = item;

  const openThread =
    thread === undefined || onOpenThread === undefined ? undefined : () => onOpenThread(thread);

  // Note that the row hands the transcript its press, so a reader sent to this call lands on it once the list has scrolled it into view.
  const press = useCallback(
    (row: HostInstance | null) => placeCall?.(callId, row),
    [callId, placeCall],
  );

  const colors = useColors();
  const large = useAccessibilitySize();
  // Note that at an accessibility size the line's words wrap rather than cut to a word or two.
  const lines = large ? undefined : 1;
  const { line, chip } = item;
  const subject = line.subject === undefined || line.subject === "" ? undefined : line.subject;
  // Note that the integration's mark is hidden from VoiceOver, so its name is heard in the mark's place.
  const mark = item.provider === undefined ? undefined : INTEGRATION_NAME[item.provider];
  const standing = held?.waiting === true ? HELD_HEARD : CALL_STANDING_HEARD[item.standing];

  return (
    <View style={[styles.row, inset(item.depth)]}>
      <Press
        ref={press}
        onPress={() => onToggle(item)}
        accessibilityRole="button"
        accessibilityState={{ expanded: item.open }}
        accessibilityLabel={[line.verb, chip, subject, mark, item.runOn].filter(Boolean).join(" ")}
        accessibilityValue={{
          text: item.open ? standing : `${standing}, ${COLLAPSED_HEARD}`,
        }}
        accessibilityHint={CALL_HINT}
        accessibilityActions={openThread === undefined ? undefined : [OPEN_THREAD_ACTION]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === OPEN_THREAD_ACTION.name) openThread?.();
        }}
        hitSlop={LINE_REACH}
        style={styles.callLine}
      >
        <CallGlyph
          callKind={item.callKind}
          provider={item.provider}
          icon={
            item.appIcon === undefined
              ? undefined
              : (drawing.mediaSource(item.appIcon) ?? undefined)
          }
        />
        <View style={[styles.callWords, large ? styles.wrapped : null]}>
          <Text
            numberOfLines={lines}
            style={{
              flexShrink: 0,
              maxWidth: "70%",
              fontSize: ROLE_SIZE.ROW_LINE,
              color: colors.TEXT_MUTED,
            }}
          >
            {line.verb}
          </Text>
          {chip === undefined ? null : (
            <Press
              disabled={openThread === undefined}
              onPress={openThread}
              style={[
                styles.chip,
                { backgroundColor: colors.SURFACE, borderColor: colors.CHIP_EDGE },
              ]}
            >
              <Text
                numberOfLines={lines}
                style={{ fontSize: ROLE_SIZE.TIME, color: colors.TEXT_BODY, fontWeight: "500" }}
              >
                {chip}
              </Text>
            </Press>
          )}
          {subject === undefined || item.open ? null : (
            <Text
              numberOfLines={lines}
              style={{
                flexShrink: 1,
                fontSize: line.code ? ROLE_SIZE.TIME : ROLE_SIZE.ROW_LINE,
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
            style={{ fontSize: ROLE_SIZE.ROW_LINE, color: colors.TEXT_MUTED }}
          >
            {item.runOn}
          </Text>
        )}
        {/* Note that a call held for an answer is not working, so its line says so under it rather than turning. */}
        <StandingMark
          running={item.standing === CALL_STANDING.RUNNING && held?.waiting !== true}
          failed={item.standing === CALL_STANDING.FAILED}
        />
      </Press>
      {held === undefined ? null : (
        <View style={styles.body}>
          {/* Note that the presses are SwiftUI's, hosted in the row at the height they draw. */}
          <InlineHost matchContents={{ vertical: true }}>
            <HeldCallBody held={held} />
          </InlineHost>
        </View>
      )}
      {item.open ? (
        <View style={styles.body}>
          {item.body.map((block) => (
            <BodyBlock key={block.title} title={block.title} text={block.text} colors={colors} />
          ))}
          {/* Note that what the body holds under its answer, such as the window a computer call read, stands after its blocks, as the panel's body ends on it. */}
          {item.answered.map((shown) => (
            <View key={shown.id} style={styles.shown}>
              <ShownMediaView
                shown={shown}
                source={drawing.mediaSource(shown.id)}
                onOpenElsewhere={drawing.onOpenElsewhere}
                onRetry={retryOf(drawing, shown.id)}
              />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** What a webhook call's body is called, folded under the prompt it rode in with, and its block's title, as the panel names them. */
const WEBHOOK_BODY = { LABEL: "Webhook body", KIND: "body" } as const;

/** What an automation's prompt's card is called, as the panel's Prompt card names it. */
const PROMPT_CARD = { LABEL: "Prompt", JOIN: " · " } as const;

/** What a part of a sender line that opens somewhere is offered to VoiceOver as, and the name its action goes by before its place in the line. */
const OPEN_WORD = "Open";
const OPEN_ACTION = "open-";

/**
 * Who sent a line, as the panel's sender line names it: an automation's
 * prompt by the automation, then what its run was about and who asked for
 * it; a line sent from a suggestion by the agent that suggested it, after
 * its lead; each joined by " · ". A part with an address opens it as a link
 * does, as an underlined word in the ink, and is offered to VoiceOver as one
 * of the line's actions, since a word inside a line is never an element of
 * its own on iOS.
 */
function OriginFrom({
  parts,
  onOpenLink,
}: {
  readonly parts: readonly OriginPart[];
  readonly onOpenLink: (address: string) => void;
}) {
  const colors = useColors();

  // Note that each part that opens somewhere is offered by its place in the line, since two parts may read alike.
  const opening = parts.flatMap(({ words, address }, at) =>
    address === undefined ? [] : [{ name: `${OPEN_ACTION}${at}`, words, address }],
  );

  const actions =
    opening.length === 0
      ? {}
      : {
          accessibilityActions: opening.map(({ name, words }) => ({
            name,
            label: `${OPEN_WORD} ${words}`,
          })),
          onAccessibilityAction: (event: AccessibilityActionEvent) => {
            const address = opening.find(
              ({ name }) => name === event.nativeEvent.actionName,
            )?.address;

            if (address !== undefined) onOpenLink(address);
          },
        };

  return (
    <Text {...actions} style={{ fontSize: ROLE_SIZE.ROW_LINE, color: colors.TEXT_MUTED }}>
      {parts.map(({ lead, words, after, address }, at) => (
        <Fragment key={at}>
          {at === 0 ? null : " · "}
          {lead === undefined ? null : `${lead} `}
          <Text
            onPress={address === undefined ? undefined : () => onOpenLink(address)}
            style={{
              color: at === 0 || address !== undefined ? colors.TEXT : undefined,
              fontWeight: at === 0 ? "600" : undefined,
              textDecorationLine: address === undefined ? undefined : "underline",
            }}
          >
            {words}
          </Text>
          {after}
        </Fragment>
      ))}
    </Text>
  );
}

/**
 * Who sent a line, over its bubble: their name in semibold, heard as the
 * line's heading, and where it names a page (`address`), a tap that opens
 * it (`SenderPress`), as a press on the panel's sender opens their page, an
 * agent's, or a GitHub account's.
 */
function SenderName({
  name,
  address,
  onOpenLink,
}: {
  readonly name: string;
  readonly address: string | undefined;
  readonly onOpenLink: (address: string) => void;
}) {
  const colors = useColors();

  return (
    <SenderPress name={name} address={address} onOpenLink={onOpenLink}>
      <Text
        accessibilityRole="header"
        style={{ fontSize: ROLE_SIZE.ROW_LINE, fontWeight: "600", color: colors.TEXT }}
      >
        {name}
      </Text>
    </SenderPress>
  );
}

/** A webhook call's body under the prompt it rode in with, folded under its own line, as the caller sent it. */
function OriginBody({ body }: { readonly body: string }) {
  const colors = useColors();
  const chevron = useScaledSize(MARK_SIZE.GLYPH - 3);
  const column = useScaledSize(MARK_SIZE.GLYPH);
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.originBody}>
      <Press
        onPress={() => setOpen((was) => !was)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={WEBHOOK_BODY.LABEL}
        hitSlop={LINE_REACH}
        style={styles.callLine}
      >
        <SymbolView
          name={glyphSymbol(open ? GLYPH.UNFOLDED : GLYPH.FOLDED)}
          size={chevron}
          tintColor={colors.TEXT_MUTED}
          style={{ width: column, height: column }}
          accessibilityElementsHidden
        />
        <Text style={{ flex: 1, fontSize: ROLE_SIZE.ROW_LINE, color: colors.TEXT_MUTED }}>
          {WEBHOOK_BODY.LABEL}
        </Text>
      </Press>
      {open ? <BodyBlock title={WEBHOOK_BODY.KIND} text={body} colors={colors} /> : null}
    </View>
  );
}

/**
 * An automation's prompt as the panel's Prompt card stands: closed under
 * its label and its first line, the chevron iOS opens a row by at its
 * lead, and once a press opens it, the prompt's words and the webhook's
 * body under a head that names the label alone, since the words then say
 * their own first line. Note that the words stand in the card itself, never
 * inside its long press menu's host, which holds the head alone, so a prompt
 * however long is laid out as the transcript's own rows are.
 */
function PromptCard({
  item,
  card,
  drawing,
}: {
  readonly item: Extract<TranscriptItem, { kind: typeof TRANSCRIPT_ITEM.SAID }>;
  readonly card: SaidCard;
  readonly drawing: RowDrawing;
}) {
  const colors = useColors();
  const large = useAccessibilitySize();
  const chevron = useScaledSize(MARK_SIZE.GLYPH - 3);
  const glyph = useScaledSize(MARK_SIZE.GLYPH);
  const { open } = card;

  return (
    <View
      style={[
        styles.promptCard,
        { backgroundColor: colors.SURFACE, borderColor: colors.CHIP_EDGE },
      ]}
    >
      <CardMenu
        words={item.words}
        link={drawing.messageLink?.(item.place.row)}
        width={rowWidth(drawing.column)}
      >
        <Press
          onPress={() => drawing.onToggle(item)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${PROMPT_CARD.LABEL}, ${card.title}`}
          style={styles.promptHead}
        >
          <SymbolView
            name={glyphSymbol(open ? GLYPH.UNFOLDED : GLYPH.FOLDED)}
            size={chevron}
            tintColor={colors.TEXT_MUTED}
            style={{ width: glyph, height: glyph }}
            accessibilityElementsHidden
          />
          <SymbolView
            name={glyphSymbol(GLYPH.AUTOMATION)}
            size={glyph}
            tintColor={colors.TEXT_MUTED}
            accessibilityElementsHidden
          />
          <Text
            numberOfLines={large ? undefined : 1}
            style={{ flex: 1, fontSize: ROLE_SIZE.ROW_LINE, color: colors.TEXT_MUTED }}
          >
            {PROMPT_CARD.LABEL}
            {open || card.title === "" ? null : (
              <>
                {PROMPT_CARD.JOIN}
                <Text style={{ color: colors.TEXT, fontWeight: "500" }}>{card.title}</Text>
              </>
            )}
          </Text>
        </Press>
      </CardMenu>
      {open ? (
        <View style={styles.promptWords}>
          <Markdown
            words={item.words}
            typed
            repository={drawing.repository}
            onOpenLink={drawing.onOpenLink}
            width={rowWidth(drawing.column) - (SPACE.EDGE - 4) * 2}
            wordPictures={item.wordPictures}
            wordPicture={(name) => wordPictureOf(drawing, item.wordPictures?.get(name))}
          />
          {item.body === undefined ? null : <OriginBody body={item.body} />}
        </View>
      ) : null}
    </View>
  );
}

/** A fold's or a group's line: what it holds, counted, with the disclosure chevron iOS opens a row by. */
function FoldRow({
  item,
  onToggle,
  inset: indent,
}: {
  readonly item: Extract<TranscriptItem, { kind: typeof TRANSCRIPT_ITEM.FOLD }>;
  readonly onToggle: (item: TranscriptItem) => void;
  /** How far in it stands. */
  readonly inset: InsetResult;
}) {
  const colors = useColors();
  const chevron = useScaledSize(MARK_SIZE.GLYPH - 3);
  const column = useScaledSize(MARK_SIZE.GLYPH);
  const large = useAccessibilitySize();

  const heard = [
    item.running ? CALL_STANDING_HEARD[CALL_STANDING.RUNNING] : undefined,
    item.open ? undefined : COLLAPSED_HEARD,
  ].filter((part) => part !== undefined);

  return (
    <View style={[styles.row, indent]}>
      <Press
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
          name={glyphSymbol(item.open ? GLYPH.UNFOLDED : GLYPH.FOLDED)}
          size={chevron}
          tintColor={colors.TEXT_MUTED}
          style={{ width: column, height: column }}
          accessibilityElementsHidden
        />
        <Text
          numberOfLines={large ? undefined : 1}
          style={{ flex: 1, fontSize: ROLE_SIZE.ROW_LINE, color: colors.TEXT_MUTED }}
        >
          {item.summary}
        </Text>
        <StandingMark running={item.running} failed={false} />
      </Press>
    </View>
  );
}

/** The mark a line of the reader's that did not go stands under its bubble at the column's trailing edge, as Messages marks one; nothing for a line that went. */
function UndeliveredUnder({ line }: { readonly line: UndeliveredLine | undefined }) {
  if (line === undefined) return null;

  return (
    <View style={styles.undelivered}>
      <InlineHost matchContents>
        <UndeliveredMark line={line} />
      </InlineHost>
    </View>
  );
}

/** What drawing the list's rows needs beyond the rows. */
interface RowDrawing {
  readonly repository: string | null | undefined;
  /** How wide the column the rows stand in is, inside the window's safe area and the reading width, known before any row is laid out. */
  readonly column: number;
  /** Opens a link or a chip a message names, by the address it was written as, where the app draws it or in Safari. */
  readonly onOpenLink: (address: string) => void;
  readonly onToggle: (item: TranscriptItem) => void;
  /** Opens a page the agent showed whole, by the item that names it. */
  readonly onOpenPage: (
    item: Extract<TranscriptItem, { kind: typeof TRANSCRIPT_ITEM.PAGE }>,
  ) => void;
  /** What a picture or a recording is drawn from, by its id: a picture the service's address and its read's headers, or a file; none while it is on its way, and `null` where it could not be read. */
  readonly mediaSource: (id: string) => PictureRef | null | undefined;
  /** Reads a picture or a recording whose bytes could not be read again, by its id. */
  readonly onRetryMedia?: ((id: string) => void) | undefined;
  /** Where a file a sent line carried was written for its chip to open, by the line's message and the file's place on it; none while it is written, and `null` where it could not be. A file the line kept no bytes of is drawn by its name and kind alone. */
  readonly fileSource?: ((message: string, key: string) => string | null | undefined) | undefined;
  /** Writes a sent line's file again where it could not be written, by the line's message and the file's place on it. */
  readonly onRetryFile?: ((message: string, key: string) => void) | undefined;
  /** Opens a recording the system's player cannot play where it plays. */
  readonly onOpenElsewhere?: (() => void) | undefined;
  /** Opens a web address in Safari, such as a pull request's page on GitHub. */
  readonly onOpenAddress: (address: string) => void;
  /** A message's address on vespin.dev by its id, which its Copy link copies; none where messages have none. */
  readonly messageLink?: ((messageId: string) => string | undefined) | undefined;
  /** What a sent line's long press or a finished turn's ⋯ offers past copying and sharing it, in the panel's order, such as Edit, Rewind conversation to here, and Fork to new agent; none where messages offer nothing more. */
  readonly messageMore?: ((item: MessageItem) => readonly HeldAct[]) | undefined;
  /** Opens an Inbox thread by its id, as a press on a call's thread chip asks; none where the app opens no thread from here. */
  readonly onOpenThread?: ((threadId: string) => void) | undefined;
  /** Opens a pull request's own screen, as a press on its card asks; none where the app draws no screen for it. */
  readonly onOpenPullRequest?: ((item: PullRequestItem) => void) | undefined;
  /** What a pull request's card offers after Review, such as Merge where it may merge now; none where it offers nothing more. */
  readonly pullRequestActs?: ((item: PullRequestItem) => readonly PullRequestAct[]) | undefined;
  /** The answer the agent holds a call for, by the call's id; none where it holds none. */
  readonly heldCall?: ((callId: string) => HeldCall | undefined) | undefined;
  /** How a suggestion the agent wrote into its words stands, by its button and the words it was written with; every suggestion is drawn as its plain link where none is given. */
  readonly suggestion?:
    | ((link: ReplyButtonLink, words: string) => SuggestionLook | undefined)
    | undefined;
  /** Hands the transcript a call's row as it stands and as it goes, so a reader sent to the call lands on it. */
  readonly placeCall?: ((callId: string, row: HostInstance | null) => void) | undefined;
  /** That a line of the reader's did not go, by the id it is drawn under, with what mends it; none for a line that went. */
  readonly undelivered?: ((lineId: string) => UndeliveredLine | undefined) | undefined;
  /** The faces of a Manager's chat, which draws as a channel, each message headed by its sender's face and name, where the transcript is one; none for any other agent. */
  readonly channel?: ChannelFaces | undefined;
  /** Opens a Manager chat message's thread, by the message it hangs on, from Reply in thread or the summary of its replies; none where the chat opens no thread, as on a thread's own page. */
  readonly onOpenChatThread?: ((root: string) => void) | undefined;
}

/** A message whose acts the transcript draws: a sent line, held for its menu, and a finished turn's foot. */
export type MessageItem = Extract<
  TranscriptItem,
  { kind: typeof TRANSCRIPT_ITEM.SAID | typeof TRANSCRIPT_ITEM.FOOT }
>;

/** A pull request an agent opened, as the transcript lists it. */
type PullRequestItem = Extract<TranscriptItem, { kind: typeof TRANSCRIPT_ITEM.PULL_REQUEST }>;

/** What a picture a sent line kept by its id is drawn from, read as the agent's shown ones are; `null` for one the line names no way to, which stands as could not be read. */
function saidSource(
  drawing: RowDrawing,
  pictureId: string | undefined,
): PictureRef | null | undefined {
  return pictureId === undefined ? null : drawing.mediaSource(pictureId);
}

/** Where a sent line's file is opened from: the file the app wrote of its bytes, none while it is written, or `null` where it could not be or the list writes none, which the chip says it could not read. */
function sentFileSource(
  drawing: RowDrawing,
  message: string,
  file: SaidFile,
): string | null | undefined {
  return drawing.fileSource === undefined ? null : drawing.fileSource(message, file.key);
}

/** What writes a sent line's file again, where the transcript offers it. */
function sentFileRetry(
  drawing: RowDrawing,
  message: string,
  file: SaidFile,
): (() => void) | undefined {
  const retry = drawing.onRetryFile;

  return retry === undefined ? undefined : () => retry(message, file.key);
}

/** A picture a sent line's words name by its marker, as its chip draws it: read as the line's other pictures are, by its bytes or its id. */
function wordPictureOf(
  drawing: RowDrawing,
  picture: SaidPicture | undefined,
): MarkdownWordPicture | undefined {
  if (picture === undefined) return undefined;

  return {
    source: picture.url ?? saidSource(drawing, picture.pictureId),
    onRetry: picture.pictureId === undefined ? undefined : retryOf(drawing, picture.pictureId),
  };
}

/** What reads a picture or a recording again, by its id, where the transcript offers it. */
function retryOf(drawing: RowDrawing, id: string): (() => void) | undefined {
  const retry = drawing.onRetryMedia;

  return retry === undefined ? undefined : () => retry(id);
}

/** One thing a call showed, as its kind draws it: a picture, a recording in the system's player, or a sound clip in its strip; one whose bytes could not be read offers Try again. */
function ShownMediaView({
  shown,
  source,
  onOpenElsewhere,
  onRetry,
}: {
  readonly shown: ShownMedia;
  readonly source: PictureRef | null | undefined;
  readonly onOpenElsewhere: (() => void) | undefined;
  readonly onRetry: (() => void) | undefined;
}) {
  // Note that a clip plays from a file alone, so one held any other way stands as one that could not be read; a recording plays from its address too, as a picture draws from it.
  const played = source == null || Predicate.isString(source) ? source : null;

  switch (shown.kind) {
    case SHOWN_MEDIA.VIDEO:
      return (
        <Video
          source={source}
          label={shown.label}
          onOpenElsewhere={onOpenElsewhere}
          onRetry={onRetry}
        />
      );
    case SHOWN_MEDIA.AUDIO:
      return <AudioClip source={played} label={shown.label} onRetry={onRetry} />;
    case SHOWN_MEDIA.PICTURE:
      return <Picture source={source} alt={shown.label} onRetry={onRetry} />;
  }
}

/** Show work, or Hide work while it stands open, where a Manager's working line's turn has done work (`workShown`); none where it has done none. A finished turn's work stands in its fold over its first message instead. */
function workActs(
  item: Extract<TranscriptItem, { kind: typeof TRANSCRIPT_ITEM.WORKING }>,
  drawing: RowDrawing,
): readonly HeldAct[] {
  if (item.workShown === undefined) return [];

  return [
    {
      label: chatWorkWords(item.workShown),
      symbol: GLYPH.SHOW_WORK,
      onPress: () => drawing.onToggle(item),
    },
  ];
}

/**
 * One of the transcript's rows, as its kind draws it. Note that it is drawn
 * again only as its item or the list's drawing moves, because a working
 * agent's transcript moves several times a second, and every row on screen
 * drawn again for each move held the JS thread behind the reader's keys.
 */
const TranscriptRow = memo(function TranscriptRow({
  item,
  drawing,
}: {
  readonly item: TranscriptItem;
  readonly drawing: RowDrawing;
}) {
  const colors = useColors();
  const large = useAccessibilitySize();
  const pageMark = useScaledSize(MARK_SIZE.WRITER);
  const pageChevron = useScaledSize(MARK_SIZE.GLYPH - 3);
  const copyWords = useCopyWords();

  switch (item.kind) {
    case TRANSCRIPT_ITEM.SAID: {
      // Note that a Manager's chat stands every message as a channel's row, whoever sent it, as the panel's chat does.
      if (item.channel !== undefined && drawing.channel !== undefined) {
        return (
          <ChannelSaid
            item={item}
            sender={item.channel}
            faces={drawing.channel}
            drawing={drawing}
          />
        );
      }

      return (
        <View
          style={[
            styles.row,
            styles.saidRow,
            item.received ? styles.received : null,
            item.joinsAbove ? { paddingTop: RUN_GAP } : null,
            item.joinsBelow ? { paddingBottom: RUN_GAP } : null,
          ]}
        >
          {item.stamp === undefined ? null : (
            <Text style={[styles.stamp, { fontSize: ROLE_SIZE.TIME, color: colors.TEXT_MUTED }]}>
              {item.stamp}
            </Text>
          )}
          {item.from === undefined ? null : (
            <OriginFrom parts={item.from} onOpenLink={drawing.onOpenLink} />
          )}
          {item.sender === undefined || item.joinsAbove ? null : (
            <SenderName
              name={item.sender}
              address={item.senderAddress}
              onOpenLink={drawing.onOpenLink}
            />
          )}
          {/* Note that the pictures a line carried that its words name none of stand over its words at its end, as Messages and the panel stand a message's photos over its bubble: one by the media's one rule, several as a set side by side; a picture its words name stands where they name it, as its chip. */}
          {/* Note that a line's pictures name who sent it and when in their viewer's bar, the reader's own as theirs. */}
          <PictureOriginProvider origin={{ by: item.sender ?? SENT_BY_YOU, at: item.at }}>
            <PictureSet
              atEnd={!item.received}
              pictures={(item.pictures ?? []).map((picture) => ({
                key: picture.key,
                source: picture.url ?? saidSource(drawing, picture.pictureId),
                alt: picture.name,
                onRetry:
                  picture.pictureId === undefined ? undefined : retryOf(drawing, picture.pictureId),
              }))}
            />
          </PictureOriginProvider>
          {/* Note that the other files a line carried, such as a PDF, stand under its pictures as their chips, as the panel stands a message's files over its bubble. */}
          {(item.files ?? []).map((file) => (
            <FileChip
              key={file.key}
              atEnd={!item.received}
              held={file.base64 !== undefined}
              name={file.name}
              mediaType={file.mediaType}
              source={sentFileSource(drawing, item.place.row, file)}
              size={file.size}
              onRetry={sentFileRetry(drawing, item.place.row, file)}
            />
          ))}
          {/* Note that a line of files alone draws no empty bubble under them, and an automation's prompt stands in its card rather than a bubble. */}
          {item.card !== undefined ? (
            <PromptCard item={item} card={item.card} drawing={drawing} />
          ) : item.words.trim() === "" &&
            (item.pictures ?? []).length + (item.files ?? []).length > 0 ? null : (
            <MessageMenu
              words={item.words}
              at={item.at}
              // Note that a line that reached a turn under way stands in the turn's message, so it is linked by its own row's id.
              link={drawing.messageLink?.(item.place.row)}
              more={drawing.messageMore?.(item)}
              width={rowWidth(drawing.column)}
            >
              <View style={[styles.saidHeld, item.received ? styles.received : null]}>
                <ChatBubble
                  side={item.received ? CHAT_SIDE.RECEIVED : CHAT_SIDE.SENT}
                  run={chatRunOf(item.joinsAbove, item.joinsBelow)}
                >
                  {/* Note that Select text selects the words in the bubble itself, as Messages does (`MessageWords`). */}
                  <MessageWords>
                    <Markdown
                      words={item.words}
                      typed
                      repository={drawing.repository}
                      onOpenLink={drawing.onOpenLink}
                      width={bubbleWordsWidth(drawing.column)}
                      wordPictures={item.wordPictures}
                      wordPicture={(name) => wordPictureOf(drawing, item.wordPictures?.get(name))}
                    />
                  </MessageWords>
                </ChatBubble>
              </View>
            </MessageMenu>
          )}
          {item.body === undefined || item.card !== undefined ? null : (
            <OriginBody body={item.body} />
          )}
          <UndeliveredUnder line={drawing.undelivered?.(item.place.row)} />
        </View>
      );
    }

    case TRANSCRIPT_ITEM.FOOT:
      // Note that a finished turn ends on how long it worked, then the acts on its words, standing rather than on a hover, as ChatGPT's row stands under its reply.
      return (
        <View style={[styles.row, { paddingBottom: SPACE.ROW }]}>
          <Text selectable style={{ fontSize: ROLE_SIZE.TIME, color: colors.TEXT_MUTED }}>
            {item.words}
          </Text>
          <View style={styles.turnActs}>
            <TurnActs
              words={item.copy}
              link={drawing.messageLink?.(item.place.message)}
              more={drawing.messageMore?.(item)}
            />
          </View>
        </View>
      );
    case TRANSCRIPT_ITEM.WORKING:
      // Note that a Manager's chat says it works in a bubble of the Manager's, as Messages shows the other side typing, and as the panel's chat draws its working line.
      if (item.chat === true && item.sender !== undefined && drawing.channel !== undefined) {
        return (
          <View style={[styles.row, { paddingVertical: SPACE.ROW }]}>
            <ChannelMessage sender={item.sender} faces={drawing.channel} opens working>
              {/* Note that a long press offers the turn under way's work, as the press beside the panel's working line does. */}
              <HeldMenu acts={workActs(item, drawing)}>
                <View>
                  <Text
                    style={{
                      fontSize: PROSE_SIZE,
                      color: item.waiting === true ? colors.ATTENTION : colors.TEXT_MUTED,
                    }}
                  >
                    {item.words}
                  </Text>
                </View>
              </HeldMenu>
            </ChannelMessage>
          </View>
        );
      }

      // Note that the line is words alone, as the panel's Working line is, its mark left to the rows of what runs; and that an agent held for an answer says so in the attention ink, since it waits on the reader rather than working.
      return (
        <View style={[styles.row, styles.headLine, { paddingVertical: SPACE.ROW }]}>
          <Text
            style={{
              fontSize: ROLE_SIZE.ROW_LINE,
              color: item.waiting === true ? colors.ATTENTION : colors.TEXT_MUTED,
            }}
          >
            {item.words}
          </Text>
        </View>
      );
    case TRANSCRIPT_ITEM.RULE:
      return (
        <View style={[styles.row, { paddingVertical: SPACE.ROW }]}>
          {item.look === RULE_LOOK.NEW ? (
            <NewRule words={item.words} />
          ) : (
            <ThreadRule words={item.words} />
          )}
        </View>
      );
    case TRANSCRIPT_ITEM.WORDS:
      return (
        <View style={[styles.row, inset(item.depth), { paddingVertical: SPACE.TIGHT + 2 }]}>
          <CopyWordsMenu words={item.words} width={rowWidth(drawing.column, item.depth)}>
            <View>
              <MessageWords>
                <Markdown
                  words={item.words}
                  repository={drawing.repository}
                  onOpenLink={drawing.onOpenLink}
                  suggestion={drawing.suggestion}
                  width={rowWidth(drawing.column, item.depth)}
                />
              </MessageWords>
            </View>
          </CopyWordsMenu>
        </View>
      );
    case TRANSCRIPT_ITEM.CALL:
      return (
        <CallRow
          item={item}
          held={drawing.heldCall?.(item.callId)}
          drawing={drawing}
          onToggle={drawing.onToggle}
          onOpenThread={drawing.onOpenThread}
          placeCall={drawing.placeCall}
        />
      );
    case TRANSCRIPT_ITEM.FOLD:
      // Note that a Manager's turn's work folded over the message that opens its run stands under the Manager's head, its words then going on the run under it, as the panel stands the fold under the name.
      if (item.channel !== undefined && drawing.channel !== undefined && item.depth === 0) {
        return (
          <View style={[styles.row, { paddingTop: SPACE.ROW, paddingBottom: 0 }]}>
            <ChannelMessage sender={item.channel} faces={drawing.channel} opens stamp={item.stamp}>
              <FoldRow item={item} onToggle={drawing.onToggle} inset={FOLD_IN_CHANNEL} />
            </ChannelMessage>
          </View>
        );
      }

      // Note that a Manager's turn's work folded over a message further on its run stands past the seat, in line with its words, as its pictures stand.
      return (
        <FoldRow
          item={item}
          onToggle={drawing.onToggle}
          inset={
            drawing.channel === undefined || item.depth > 0
              ? inset(item.depth)
              : { paddingLeft: SPACE.EDGE + CHANNEL_SEAT }
          }
        />
      );
    case TRANSCRIPT_ITEM.MEDIA: {
      // Note that what a Manager shows in its chat stands past its face, in line with its bubbles.
      const mediaInset =
        drawing.channel === undefined || item.depth > 0
          ? inset(item.depth)
          : { paddingLeft: SPACE.EDGE + CHANNEL_SEAT };

      // Note that several pictures with no captions stand as one set side by side, as Messages groups photos; a recording, a sound clip, or a picture with its own caption, stands alone so its caption stays under it.
      if (
        item.media.length > 1 &&
        item.media.every((shown) => shown.kind === SHOWN_MEDIA.PICTURE && shown.caption === "")
      ) {
        return (
          <View style={[styles.row, mediaInset, styles.media]}>
            <PictureSet
              pictures={item.media.map((shown) => ({
                key: shown.id,
                source: drawing.mediaSource(shown.id),
                alt: shown.label,
                onRetry: retryOf(drawing, shown.id),
              }))}
            />
          </View>
        );
      }

      return (
        <View style={[styles.row, mediaInset, styles.media]}>
          {item.media.map((shown) => (
            <View key={shown.id} style={styles.shown}>
              <ShownMediaView
                shown={shown}
                source={drawing.mediaSource(shown.id)}
                onOpenElsewhere={drawing.onOpenElsewhere}
                onRetry={retryOf(drawing, shown.id)}
              />
              {shown.caption === "" ? null : (
                <Text style={{ fontSize: ROLE_SIZE.ROW_LINE, color: colors.TEXT_MUTED }}>
                  {shown.caption}
                </Text>
              )}
            </View>
          ))}
        </View>
      );
    }

    case TRANSCRIPT_ITEM.PAGE:
      return (
        <View style={[styles.row, inset(item.depth)]}>
          <Press
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
              name={glyphSymbol(GLYPH.PAGE)}
              size={pageMark}
              tintColor={colors.TEXT_MUTED}
              accessibilityElementsHidden
            />
            <View style={{ flex: 1, gap: 2 }}>
              <Text
                numberOfLines={large ? undefined : 2}
                style={{ fontSize: ROLE_SIZE.ROW_TITLE, fontWeight: "500", color: colors.TEXT }}
              >
                {item.title}
              </Text>
              <Text style={{ fontSize: ROLE_SIZE.ROW_LINE, color: colors.TEXT_MUTED }}>
                {PAGE_WORD}
              </Text>
            </View>
            <SymbolView
              name={glyphSymbol(GLYPH.FOLDED)}
              size={pageChevron}
              tintColor={colors.TEXT_MUTED}
              accessibilityElementsHidden
            />
          </Press>
        </View>
      );
    case TRANSCRIPT_ITEM.GITHUB:
      // Note that GitHub's card stands across the column at its leading edge, as the panel stands a received line, between the sent lines' bubbles.
      return (
        <View style={[styles.row, { paddingVertical: SPACE.ROW }]}>
          <GitHubLineCard
            fold={item.fold}
            open={item.open}
            copy={item.copy}
            width={rowWidth(drawing.column)}
            repository={drawing.repository}
            onToggle={() => drawing.onToggle(item)}
            onOpenLink={drawing.onOpenLink}
          />
        </View>
      );
    case TRANSCRIPT_ITEM.PULL_REQUEST:
      return (
        <View style={[styles.row, inset(item.depth), { paddingVertical: SPACE.TIGHT + 2 }]}>
          {/* Note that the card is SwiftUI's, hosted in the row at the height it draws. */}
          <InlineHost matchContents={{ vertical: true }}>
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
              // Note that the long press offers what a press does not, as the panel's pull request row's right-click does: its GitHub link to copy, then its page on GitHub, where a press opens its own screen.
              menu={[
                copyWords === undefined
                  ? []
                  : [
                      {
                        label: PULL_REQUEST_MENU_WORDS.COPY_GITHUB_LINK,
                        symbol: GLYPH.LINK,
                        tone: ROW_ACTION_TONE.NEUTRAL,
                        onPress: () => copyWords(item.url),
                      },
                    ],
                drawing.onOpenPullRequest === undefined
                  ? []
                  : [
                      {
                        label: PULL_REQUEST_MENU_WORDS.OPEN_ON_GITHUB,
                        symbol: GLYPH.OPEN_EXTERNALLY,
                        tone: ROW_ACTION_TONE.NEUTRAL,
                        onPress: () => drawing.onOpenAddress(item.url),
                      },
                    ],
              ]}
            />
          </InlineHost>
        </View>
      );
    default: {
      const unknown: never = item;
      throw new Error(`A transcript item of no kind the list draws: ${JSON.stringify(unknown)}`);
    }
  }
});

/**
 * The control that brings the newest row into view: the system's round glass
 * button holding a down arrow, standing only once the reader has scrolled
 * back, over the list's foot at the end of the rows' words, as the panel's
 * way back stands in its log's corner, so it covers at most a line's end
 * rather than the middle of the words, and centered over the composer's
 * Send, the bar's last press, at its size. iOS draws its glass solid where
 * the reader turned on Reduce Transparency.
 */
function JumpToLatest({
  bottom,
  end,
  onPress,
}: {
  readonly bottom: number;
  /** How far in from the list's trailing edge it stands: where the composer's bar stands its last press. */
  readonly end: number;
  readonly onPress: () => void;
}) {
  const colors = useColors();

  return (
    <InlineHost matchContents style={[styles.jump, { bottom, right: end }]}>
      <SwiftUIButton
        onPress={onPress}
        modifiers={[
          buttonStyle("glass"),
          SwiftModifiers.buttonBorderShape("circle"),
          tint(colors.TEXT),
          accessibilityLabel(JUMP_TO_LATEST),
        ]}
      >
        <Image
          {...glyphImage(GLYPH.JUMP_DOWN)}
          size={MARK_SIZE.GLYPH + 2}
          modifiers={[frame({ width: JUMP_SIZE - JUMP_EDGE, height: JUMP_SIZE - JUMP_EDGE })]}
        />
      </SwiftUIButton>
    </InlineHost>
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
      <Text style={{ fontSize: ROLE_SIZE.ROW_LINE, color: colors.TEXT_MUTED }}>
        {OLDER_WORDS.FAILED}
      </Text>
      <InlineHost matchContents>
        <Button label={OLDER_WORDS.RETRY} look={BUTTON_LOOK.BORDERED} onPress={older.onRetry} />
      </InlineHost>
    </View>
  );
}

type AgentTranscriptProps = Omit<RowDrawing, "column"> & {
  /** The rows, oldest first (`transcriptItems`). */
  readonly items: readonly TranscriptItem[];
  /** What stands over the oldest row, such as the agent's head. */
  readonly head: ReactNode;
  /** The empty state that stands in the rows' place while there are none, such as a read under way. */
  readonly empty?: EmptyStateProps | undefined;
  /** The pages older than the oldest row, read as the reader scrolls up to it; none where nothing older stands. */
  readonly older?: OlderPages | undefined;
  /** A row to scroll into view, such as the call a held approval waits on or the message a link names, each ask a serial of its own so the same row is shown again. */
  readonly reveal?: TranscriptReveal | undefined;
  /** Told the rows on screen each time they change, so a page reads only what it shows, such as a pull request card's state or a picture's bytes. */
  readonly onRowsShown?: ((items: readonly TranscriptItem[]) => void) | undefined;
};

/** What a list's caller hands its rows: the drawing less what the list measures and places itself. */
type HandedDrawing = Omit<RowDrawing, "column" | "placeCall">;

/**
 * The drawing the list hands its rows, the same object for as long as what
 * a row draws from stands: the caller's reads (a picture's source, a held
 * call, a message's acts), the column's width, and which of the presses are
 * offered, each read by its identity. Each press itself is read as it is
 * pressed, from the drawing the caller handed last, so a caller's press
 * made anew on each render never draws a row again. Note that a row the
 * reader opens lets the end go (`anchored`), so the call or fold they
 * opened stays where they pressed it rather than scrolling away under the
 * body it opens.
 */
function useRowDrawing(
  drawing: HandedDrawing,
  column: number,
  placeCall: NonNullable<RowDrawing["placeCall"]>,
  anchored: { current: boolean },
): RowDrawing {
  const handed = useRef(drawing);
  useLayoutEffect(() => {
    handed.current = drawing;
  });

  const {
    repository,
    mediaSource,
    fileSource,
    messageLink,
    messageMore,
    pullRequestActs,
    heldCall,
    suggestion,
    undelivered,
    channel,
  } = drawing;

  const offers = {
    retryMedia: drawing.onRetryMedia !== undefined,
    retryFile: drawing.onRetryFile !== undefined,
    openElsewhere: drawing.onOpenElsewhere !== undefined,
    openThread: drawing.onOpenThread !== undefined,
    openPullRequest: drawing.onOpenPullRequest !== undefined,
    openChatThread: drawing.onOpenChatThread !== undefined,
  };

  const { retryMedia, retryFile, openElsewhere, openThread, openPullRequest, openChatThread } =
    offers;

  return useMemo<RowDrawing>(
    () => ({
      repository,
      mediaSource,
      fileSource,
      messageLink,
      messageMore,
      pullRequestActs,
      heldCall,
      suggestion,
      undelivered,
      channel,
      column,
      placeCall,
      onOpenLink: (address) => handed.current.onOpenLink(address),
      onToggle: (item) => {
        anchored.current = false;
        handed.current.onToggle(item);
      },
      onOpenPage: (item) => handed.current.onOpenPage(item),
      onOpenAddress: (address) => handed.current.onOpenAddress(address),
      onRetryMedia: retryMedia ? (id) => handed.current.onRetryMedia?.(id) : undefined,
      onRetryFile: retryFile
        ? (message, key) => handed.current.onRetryFile?.(message, key)
        : undefined,
      onOpenElsewhere: openElsewhere ? () => handed.current.onOpenElsewhere?.() : undefined,
      onOpenThread: openThread ? (threadId) => handed.current.onOpenThread?.(threadId) : undefined,
      onOpenPullRequest: openPullRequest
        ? (item) => handed.current.onOpenPullRequest?.(item)
        : undefined,
      onOpenChatThread: openChatThread
        ? (root) => handed.current.onOpenChatThread?.(root)
        : undefined,
    }),
    [
      repository,
      mediaSource,
      fileSource,
      messageLink,
      messageMore,
      pullRequestActs,
      heldCall,
      suggestion,
      undelivered,
      channel,
      column,
      placeCall,
      anchored,
      retryMedia,
      retryFile,
      openElsewhere,
      openThread,
      openPullRequest,
      openChatThread,
    ],
  );
}

/** A row the transcript is asked to bring into view, the ask told apart by its serial: a call's, which then takes VoiceOver's focus, or a message's, by its row's id, which is lit once as it lands (`LandedWash`). */
export type TranscriptReveal =
  | { readonly callId: string; readonly serial: number }
  | { readonly messageId: string; readonly serial: number };

/** The row a message the transcript was asked to bring into view stands in, by its key (`itemKey`), lit once as it lands, each ask its own. */
type LandedRow = { readonly key: string; readonly serial: number };

/**
 * The index of the row a reveal names, below 0 where no row is it: its
 * call's line, or its message's: the line someone said, by its row's id,
 * as a Manager's chat names each message, else the first row of the turn
 * a transcript's message is.
 */
function revealedIndex(items: readonly TranscriptItem[], reveal: TranscriptReveal): number {
  if ("callId" in reveal) {
    return items.findIndex(
      (item) => item.kind === TRANSCRIPT_ITEM.CALL && item.callId === reveal.callId,
    );
  }

  const said = items.findIndex(
    (item) => item.kind === TRANSCRIPT_ITEM.SAID && item.place.row === reveal.messageId,
  );

  return said >= 0 ? said : items.findIndex((item) => item.place.message === reveal.messageId);
}

/** How long a landed row's wash stands, then fades, in milliseconds: the panel's (`landed.css`'s `--ui-confirm-delay` and `--ui-duration-shape`). */
const LANDED_MS = { HOLD: 1200, FADE: 460 } as const;

/** The accent's share in a landed row's wash, as a hex color's alpha: the panel's 18%. */
const LANDED_ALPHA = "2e";

/**
 * "You landed here", as the panel lights a place a link brought the eye to
 * (`@repo/ui/landed`): a wash of the accent behind the row, standing for a
 * moment and then fading. Reduce Motion drops the fade alone, so the wash
 * still stands, still, for as long.
 */
function LandedWash({ children }: { readonly children: ReactNode }) {
  const colors = useColors();
  const reduceMotion = useReduceMotion();
  const [light] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const fade = Animated.timing(light, {
      toValue: 0,
      delay: LANDED_MS.HOLD,
      duration: reduceMotion ? 0 : LANDED_MS.FADE,
      useNativeDriver: true,
    });

    fade.start();

    return () => fade.stop();
  }, [light, reduceMotion]);

  return (
    <View>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.landed,
          { backgroundColor: `${colors.ACCENT}${LANDED_ALPHA}`, opacity: light },
        ]}
      />
      {children}
    </View>
  );
}

/** How long a revealed row's scroll takes to settle at most, in milliseconds, after which its row takes VoiceOver's focus where the scroll's own end did not send it: the system's scroll animation, with room. */
const REVEAL_SETTLE_MS = 600;

/** How the list opens at a row a reveal asked for before it first stood: with the row at its top, which the reveal's own scroll then moves to its place. */
const OPEN_AT_REVEAL = { viewOffset: 0 } as const;

/** Where a revealed row stands in the screen, from its top: a little above the middle, clear of the composer docked over the foot. */
const REVEAL_POSITION = 0.35;

/**
 * An agent's transcript as one lazy list, the app's one React Native list,
 * since SwiftUI has no piece for its rows: FlashList's own chat list, which
 * opens at its newest row (`startRenderingFromBottom`), while a row that
 * lands as the reader reads back holds their place. It keeps to its newest
 * row as `@repo/ui/end-anchor` keeps a log on the panel: it opens anchored
 * there, only the reader's own drag, a row they open, or a reveal lets go,
 * and while anchored every change of its content's size or its own (a row
 * landing or growing as its words stream, a picture drawn late, the list
 * resized) takes it back to its end, which FlashList's own autoscroll does
 * only as rows land; a line the reader sends brings it into view wherever
 * they stood, just over the composer's stack, as Messages' does; a reader
 * scrolled back is offered Jump to latest.
 * Only the rows near the screen are drawn, however long the transcript runs.
 */
export function AgentTranscript({
  items,
  head,
  empty,
  older,
  reveal,
  onRowsShown,
  ...drawing
}: AgentTranscriptProps) {
  const colors = useColors();
  // Note that the list is handed one callback for the rows on screen, which tells the newest one the page gave, since FlashList reads the callback it was first handed.
  const shownTold = useRef(onRowsShown);
  useEffect(() => {
    shownTold.current = onRowsShown;
  }, [onRowsShown]);

  const onShown = useCallback(
    ({ viewableItems }: { readonly viewableItems: readonly { readonly item: TranscriptItem }[] }) =>
      shownTold.current?.(viewableItems.map(({ item }) => item)),
    [],
  );

  const reduceMotion = useReduceMotion();
  const { bottom, left, right } = useSafeAreaInsets();
  const list = useRef<FlashListRef<TranscriptItem>>(null);
  // Whether the list keeps to its newest row; it opens there, unless it opens at a row a reveal asked for, so its content settling never takes it off that row.
  const anchored = useRef(reveal === undefined);
  const [away, setAway] = useState(false);
  // The list's own width, so a wide window's rows stand centered within the reading width rather than across it.
  const [width, setWidth] = useState(0);
  const sides = Math.max(0, (width - left - right - READING_WIDTH) / 2);
  const column = width - left - right - sides * 2;

  // The calls' rows as they stand, and the call a reader was sent to whose row has not yet taken VoiceOver's focus.
  const calls = useRef(new Map<string, HostInstance>());
  const sentTo = useRef<string | undefined>(undefined);
  // Whether the scroll that brings the call sent to into view has settled, so its row, mounted after, takes the focus as it stands.
  const settled = useRef(false);

  // Note that the focus waits for the scroll that brings the call into view to settle, since a focus sent as it starts lands on a row still off screen, and a row the list had not yet drawn as it settled takes it once it stands (`placeCall`).
  const focusSentTo = useCallback(() => {
    settled.current = true;
    const callId = sentTo.current;
    const row = callId === undefined ? undefined : calls.current.get(callId);

    if (row === undefined) return;
    sentTo.current = undefined;
    settled.current = false;
    AccessibilityInfo.sendAccessibilityEvent(row, "focus");
  }, []);

  const placeCall = useCallback(
    (callId: string, row: HostInstance | null) => {
      if (row === null) {
        calls.current.delete(callId);

        return;
      }

      calls.current.set(callId, row);

      // Note that the row takes the focus a frame later, once it is laid out, where the scroll settled before it was drawn.
      if (settled.current && sentTo.current === callId) requestAnimationFrame(focusSentTo);
    },
    [focusSentTo],
  );

  const rowDrawing = useRowDrawing(drawing, column, placeCall, anchored);

  // Note that the list waits for its own width, so no row is ever laid out unbounded, and its first render, which starts from its newest row, has the rows to start from.
  const measured = width > 0;
  const hasRows = items.length > 0;
  // The row a reveal already asked for as the list first stands with rows, which it opens at rather than its newest, so the list's own first scroll, which it may apply again as it settles, never takes the reader back off it; -1 where none was asked.
  // Note that it is chosen as the render that first measures the list, before the list mounts, so the list is first drawn with it.
  const [opensAtReveal, setOpensAtReveal] = useState<number | undefined>(undefined);

  if (measured && hasRows && opensAtReveal === undefined) {
    setOpensAtReveal(reveal === undefined ? -1 : revealedIndex(items, reveal));
  }

  const revealOpening = opensAtReveal ?? -1;

  const keyboard = useDockKeyboard();
  const dock = useDockRoom();
  // Note that the room under the newest row clears the bar docked over the list's foot as tall as it stands, so a composer grown by its head never covers the end of the transcript, and no more, since no tab bar stands under a conversation (`(tabs)/_layout.tsx`). While the keyboard stands, the list's own keyboard inset holds the room under the bar, since the keyboard covers the safe area and the bar stands right on it.
  // Note that a keyboard standing only partway over that room, as one an interactive drag is pulling down, takes only the part it covers, since the bar stands clear of the safe area until the keyboard rises past it.
  const foot = Math.max(0, bottom - keyboard) + dock;
  // Note that Jump to latest stands just over the composer, on the keyboard while it stands past the safe area.
  const jumpFoot = Math.max(bottom, keyboard) + dock + SPACE.ROW;

  // Note that a line the reader sends brings the end into view, wherever they stood, as Messages' does, and anchors it there.
  useOwnSend(items, () => {
    anchored.current = true;
    list.current?.scrollToEnd({ animated: !reduceMotion });
  });

  // Note that every change of the content's size takes an anchored list back to its end, since FlashList's own autoscroll scrolls once as a row lands, before the row is measured, and skips a growth that follows a scroll within 100 ms: a row growing as its words stream, a picture drawn late, or a Not delivered mark would otherwise leave the end behind the composer.
  const onContentSize = useCallback(() => {
    if (anchored.current) list.current?.scrollToEnd({ animated: false });
  }, []);

  // Note that only the reader's own scroll moves the anchor, never the list's own: a drag lets it go, and where the scroll settles sets it again.
  const onScrollBegin = useCallback(() => {
    anchored.current = false;
  }, []);

  // The older pages as they stand now, which the scroll reads without being made anew for each.
  const olderNow = useRef(older);
  useEffect(() => {
    olderNow.current = older;
  }, [older]);

  // Note that only the reader's own scroll up reads an older page, never the list's as it opens at its newest row, and a read that failed waits for Try again.
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setAway(fromEnd(event.nativeEvent) > LATEST_REACH);
    const pages = olderNow.current;

    if (anchored.current || pages === undefined || pages.reading || pages.failed) return;

    if (event.nativeEvent.contentOffset.y < OLDER_REACH) pages.onRead();
  }, []);

  const onScrollSettled = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    anchored.current = fromEnd(event.nativeEvent) < ANCHOR_REACH;
  }, []);

  // Note that a drag let go with speed carries on in its momentum, which settles it, so the anchor stays let go until then rather than taken where the finger left, and a room or a keyboard that changes meanwhile never pulls the list back under the reader.
  const onDragEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if ((event.nativeEvent.velocity?.y ?? 0) === 0) onScrollSettled(event);
    },
    [onScrollSettled],
  );

  // The message a link brought into view, whose row is lit once.
  const [landed, setLanded] = useState<LandedRow | undefined>(undefined);

  const renderItem = useCallback(
    ({ item }: { readonly item: TranscriptItem }) => (
      <PictureSetProvider key={itemKey(item)}>
        {landed !== undefined && itemKey(item) === landed.key ? (
          <LandedWash key={landed.serial}>
            <TranscriptRow item={item} drawing={rowDrawing} />
          </LandedWash>
        ) : (
          <TranscriptRow item={item} drawing={rowDrawing} />
        )}
      </PictureSetProvider>
    ),
    [rowDrawing, landed],
  );

  // The rows as they stand now, which a reveal reads without being asked anew as each lands.
  const itemsNow = useRef(items);
  useEffect(() => {
    itemsNow.current = items;
  }, [items]);

  // Note that a revealed row lets the anchor go, so a row landing at the end does not scroll it away again.
  // Note that an ask made before the list has its width waits for it, since the list stands only once measured, and its scroll waits a frame, past the list's own first scroll to its newest row.
  useEffect(() => {
    if (reveal === undefined || !measured) return;

    const index = revealedIndex(itemsNow.current, reveal);
    const row = itemsNow.current[index];

    if (row === undefined) return;
    anchored.current = false;

    if ("callId" in reveal) {
      sentTo.current = reveal.callId;
      settled.current = false;
    } else setLanded({ key: itemKey(row), serial: reveal.serial });

    const frame = requestAnimationFrame(() => {
      void list.current?.scrollToIndex({
        index,
        viewPosition: REVEAL_POSITION,
        animated: !reduceMotion,
      });
    });

    // Note that a scroll that moves the list ends in its momentum's end, which sends the focus, while one that has nowhere to go, the row already in view, ends at once, so the focus is also sent once the scroll would have settled.
    const settling = setTimeout(focusSentTo, reduceMotion ? 0 : REVEAL_SETTLE_MS);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settling);
    };
  }, [reveal, measured, reduceMotion, focusSentTo]);

  // Note that the keyboard rising under a reader at the newest row brings the row up with it, as Messages' does, rather than leaving it behind the keyboard; the list's inset has already grown for it, so its end is the row clear of the bar.
  useEffect(() => {
    if (keyboard > 0 && anchored.current) list.current?.scrollToEnd({ animated: !reduceMotion });
  }, [keyboard, reduceMotion]);

  // Note that the dock's room growing under a reader at the newest row, as it does once the dock is first measured or a queued line or a held call joins the composer's head, keeps the row clear of it, as the keyboard's rise does, since the list holds the row the reader reads where it stood rather than its end.
  useEffect(() => {
    if (dock > 0 && anchored.current) list.current?.scrollToEnd({ animated: false });
  }, [dock]);

  return (
    <View
      style={[styles.list, { backgroundColor: colors.GROUND }]}
      onLayout={(event) => {
        setWidth(event.nativeEvent.layout.width);

        // Note that the list resized under a reader at its end keeps the end in view, as an iPad's page column narrows once the split view stands its sidebar and list beside it and its rows reflow taller, which left a page just opened above its end.
        if (anchored.current) list.current?.scrollToEnd({ animated: false });
      }}
    >
      {measured ? (
        <FlashList
          ref={list}
          data={items}
          keyExtractor={itemKey}
          // Note that each row is keyed by its item, so a cell FlashList recycles for another item mounts that item's row afresh rather than keeping the last one's state, such as a fold left open or a picture's measured size.
          // Note that each row's pictures are one set its viewer swipes through, a message's or a showing's own, since rows scrolled away are drawn no longer.
          renderItem={renderItem}
          // Note that a row lit as it lands is drawn again, since FlashList draws a row again only as its data or this moves.
          extraData={landed}
          ListHeaderComponent={
            <>
              {head}
              {older === undefined ? null : <OlderRow older={older} />}
            </>
          }
          // Note that the empty state is SwiftUI's, so it stands in a host of its own: mounted bare in the list's React Native view, it raises a native exception that crashes the app. The host fills the room the list leaves rather than matching its content, since the state asks for all the height it is offered, so a host sized to its content stood at no height and a brand-new agent's page was blank.
          ListEmptyComponent={
            empty === undefined || hasRows ? undefined : (
              <InlineHost style={styles.emptyHost}>
                <EmptyState {...empty} />
              </InlineHost>
            )
          }
          ListFooterComponent={<View style={{ height: foot }} />}
          // Note that the rows stand inside the window's safe area at its sides too, clear of a rail the system draws there, as the folded iPhone Duo's.
          contentContainerStyle={[
            styles.content,
            hasRows ? undefined : styles.emptyContent,
            { paddingLeft: left + sides, paddingRight: right + sides },
          ]}
          contentInsetAdjustmentBehavior="automatic"
          // Note that FlashList opens at its newest row's top, so the list asks it for an offset past that row which the scroll view clamps to the content's end, and a newest row taller than the screen opens at its end, clear of the composer, as the rest do.
          initialScrollIndex={
            !hasRows ? undefined : revealOpening >= 0 ? revealOpening : items.length - 1
          }
          initialScrollIndexParams={
            revealOpening >= 0 ? OPEN_AT_REVEAL : { viewOffset: OPEN_PAST_NEWEST }
          }
          // Note that the list opens at its newest row, keeps it in view as rows land while the reader stands near it, and, as an older page lands before the oldest row, leaves the row the reader reads where it stood, as FlashList's chat lists do.
          maintainVisibleContentPosition={{
            startRenderingFromBottom: true,
            autoscrollToBottomThreshold: AUTOSCROLL_SHARE,
            animateAutoScrollToBottom: false,
          }}
          // Note that the list stands its end clear of the keyboard with the system's own inset, moved on the keyboard's own curve, so the newest rows never sit behind it.
          automaticallyAdjustKeyboardInsets
          // Note that a drag lowers the keyboard under the finger, as Messages' does, since the composer docked over the list holds no key that does and the dock follows the keyboard frame by frame.
          keyboardDismissMode="interactive"
          onScroll={onScroll}
          onScrollBeginDrag={onScrollBegin}
          onContentSizeChange={onContentSize}
          onScrollEndDrag={onDragEnd}
          onMomentumScrollEnd={(event) => {
            onScrollSettled(event);
            focusSentTo();
          }}
          scrollEventThrottle={64}
          onViewableItemsChanged={onShown}
          accessibilityLabel="Transcript"
        />
      ) : null}
      {away ? (
        <JumpToLatest
          bottom={jumpFoot}
          end={right + sides + BAR_MARGIN + BAR_EDGE}
          onPress={() => {
            anchored.current = true;
            // Note that the jump scrolls at once where the reader asked for less motion.
            list.current?.scrollToEnd({ animated: !reduceMotion });
          }}
        />
      ) : null}
    </View>
  );
}
