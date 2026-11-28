// held-menu.tsx -- the menu a long press opens on a picture, a recording, a file, or a message, as iOS's own apps open one: its acts in the system's menu over the thing lifted.

import { Button, HStack, Image, Menu, RNHostView } from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import { accessibilityLabel, buttonStyle, frame } from "@expo/ui/swift-ui/modifiers";
import type { DraftCopy } from "@repo/features/draft-text";
import { markdownPlainText } from "@repo/features/markdown-plain-text";
import { dayAndTimeText } from "@repo/features/time-format";
import {
  type ComponentRef,
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { useScaledSize } from "./accessibility.js";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
import { actContent } from "./glyph-label.js";
import { InlineHost } from "./inline-host.js";
import {
  KEEP_ACT,
  KEEP_SYMBOL,
  KEEP_WORDS,
  type KeepAct,
  type Kept,
  keepActs,
} from "./keep-model.js";
import { LongPressMenu, ROW_ACTION_TONE, type RowAction } from "./list-row.js";
import { Press } from "./press.js";
import type { LongPressGroup } from "./row-menu-model.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, PRESS_SIZE } from "./tokens/space.js";
import { PROSE_SIZE } from "./tokens/type.js";

/** What a message's own Copy is called, as the panel's Copy under a message names it. */
const COPY_MESSAGE = "Copy message";

const styles = StyleSheet.create({
  // Note that the menu and its host span the width they stand in, since a host sized by its SwiftUI alone would stand no wider than nothing.
  host: { alignSelf: "stretch" },
  // Note that the words being selected stand as the words drawn do, with no inset of the text view's own, so they don't move as the selection starts.
  selecting: { padding: 0, paddingTop: 0, paddingBottom: 0, fontSize: PROSE_SIZE },
});

/** One act of a held thing's menu: its words, its glyph, and what a press does. */
export interface HeldAct {
  readonly label: string;
  readonly symbol: Glyph;
  /** Whether it takes something away for good, which the system draws red, as a queued message's Delete. */
  readonly destructive?: boolean | undefined;
  readonly onPress: () => void;
}

/** Where a pressed thumbnail stands in the window, in points, which a picture's viewer grows out of. */
interface PicturePlace {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A picture opened full screen: what it is drawn from, the words its viewer's bar holds, and the thumbnail it grows out of. */
export interface ViewedPicture {
  readonly source: string;
  readonly title: string;
  /** When it was shown, under the title; none where nothing says. */
  readonly subtitle: string | undefined;
  readonly place: PicturePlace;
}

/** Who showed the pictures under it and when, which a picture's viewer names in its bar, as Photos names a photo's day. */
export interface PictureOrigin {
  readonly by: string;
  readonly at: number | undefined;
}

/**
 * What the app does with what is held: opens a picture full screen in the
 * app's own viewer, grown out of its thumbnail, and a file in the system's
 * Quick Look;
 * copies a picture or a text file's words, saves a picture or a recording to
 * Photos, or shares any of them in the system's share sheet; copies a
 * message's words; and copies a draft's body as rich text, its marks and
 * links kept. The app answers them with the device's own Quick Look,
 * pasteboard, Photos, and share sheet, and says what did not go; nothing
 * here reaches the device.
 */
export interface Keeping {
  readonly open: (kept: Kept) => void;
  /** Opens `pictures` full screen at `index`, a swipe stepping through the rest. */
  readonly view: (pictures: readonly ViewedPicture[], index: number) => void;
  readonly keep: (kept: Kept, act: KeepAct) => void;
  readonly copyWords: (words: string) => void;
  /** Shares words in the system's share sheet, such as a message's. */
  readonly shareWords: (words: string) => void;
  readonly copyRich: (copy: DraftCopy) => void;
}

const KeepingDoor = createContext<Keeping | undefined>(undefined);

const OriginDoor = createContext<PictureOrigin | undefined>(undefined);

/** A thumbnail whose place in the window can be measured, as a React Native view's can. */
interface MeasuredThumbnail {
  readonly measureInWindow: (
    done: (x: number, y: number, width: number, height: number) => void,
  ) => void;
}

/** Where a drawn thumbnail is held, as a React Native view's ref holds it. */
export interface ThumbnailRef {
  readonly current: MeasuredThumbnail | null;
}

/** One picture of a set its viewer steps through: what it opens as, but where it stands, which is measured as the press lands. */
interface SetMember {
  readonly picture: Omit<ViewedPicture, "place">;
  readonly drawn: ThumbnailRef;
}

/** The pictures of one thread, message, or description, each standing while it is drawn. */
const SetDoor = createContext<Set<SetMember> | undefined>(undefined);

/** Whether the message around a view has its words selected in place, and what ends it, as `MessageWords` reads it; none outside a message's menu. */
const SelectingDoor = createContext<
  { readonly words: string; readonly done: () => void } | undefined
>(undefined);

/** Hands every picture, recording, file, and message under it what the app does with what is held; none offers no menu. */
export function KeepingProvider({
  keeping,
  children,
}: {
  readonly keeping: Keeping;
  readonly children: ReactNode;
}) {
  return <KeepingDoor value={keeping}>{children}</KeepingDoor>;
}

/** The acts every picture, recording, and file under it leads its long press menu with, ahead of its own; none outside one. */
const LeadDoor = createContext<readonly HeldAct[]>([]);

/**
 * Hands every picture, recording, and file under it the acts its long press
 * menu leads with, ahead of its own Copy, Save, and Share, as Messages leads
 * a photo's with Reply, such as a chat message's Reply in thread, so a
 * message of files alone offers what its words' menu would.
 */
export function HeldLeadProvider({
  acts,
  children,
}: {
  readonly acts: readonly HeldAct[];
  readonly children: ReactNode;
}) {
  return <LeadDoor value={acts}>{children}</LeadDoor>;
}

/** Names who showed the pictures under it and when, for their viewer's bar. */
export function PictureOriginProvider({
  origin,
  children,
}: {
  readonly origin: PictureOrigin;
  readonly children: ReactNode;
}) {
  return <OriginDoor value={origin}>{children}</OriginDoor>;
}

/** Gathers the pictures under it into one set, which a picture's viewer steps through with a swipe, as one thread's, message's, or description's are; a set inside another joins the outer one. */
export function PictureSetProvider({ children }: { readonly children: ReactNode }) {
  const outer = useContext(SetDoor);
  const [members] = useState(() => new Set<SetMember>());

  return outer === undefined ? <SetDoor value={members}>{children}</SetDoor> : children;
}

/** Where a thumbnail stands in the window now; none where it stands in no window. */
function placeOf(drawn: ThumbnailRef): Promise<PicturePlace | undefined> {
  return new Promise((done) => {
    const thumbnail = drawn.current;

    if (thumbnail === null) {
      done(undefined);

      return;
    }

    thumbnail.measureInWindow((x, y, width, height) => done({ x, y, width, height }));
  });
}

/** Opens `pressed` among the set's pictures, each in the order it stands on the page, top to bottom and then left to right, as a reader meets them. */
async function viewAmong(
  keeping: Keeping,
  members: readonly SetMember[],
  pressed: SetMember,
): Promise<void> {
  const placed = await Promise.all(
    members.map(async (member) => ({ member, place: await placeOf(member.drawn) })),
  );

  const inOrder = placed
    .filter((each) => each.place !== undefined || each.member === pressed)
    .map((each) => ({ ...each, place: each.place ?? { x: 0, y: 0, width: 0, height: 0 } }))
    .sort((a, b) => a.place.y - b.place.y || a.place.x - b.place.x);

  keeping.view(
    inOrder.map(({ member, place }) => ({ ...member.picture, place })),
    inOrder.findIndex((each) => each.member === pressed),
  );
}

/**
 * A thumbnail's press that opens its picture full screen in the app's
 * viewer, grown out of the thumbnail's place, its bar naming who showed it
 * and when where a message says, and the picture's own words otherwise, a
 * swipe stepping through the other pictures of its set (`PictureSetProvider`);
 * none where nothing is drawn yet or no app answers it. Note that the set
 * holds each picture while it is drawn, and that each one's place is measured
 * as the press lands, since a scroll moves them.
 */
export function usePictureView(
  source: string | null | undefined,
  name: string,
  drawn: ThumbnailRef,
): (() => void) | undefined {
  const keeping = useContext(KeepingDoor);
  const origin = useContext(OriginDoor);
  const set = useContext(SetDoor);
  const title = origin?.by ?? name;
  const subtitle = origin?.at === undefined ? undefined : dayAndTimeText(origin.at);

  // Note that each picture stands in its set while it is drawn, as it is drawn now, so a press reads the set as the page stands.
  useEffect(() => {
    if (set === undefined || source == null) return;
    const standing: SetMember = { picture: { source, title, subtitle }, drawn };
    set.add(standing);

    return () => {
      set.delete(standing);
    };
  }, [set, source, title, subtitle, drawn]);

  if (keeping === undefined || source == null) return undefined;

  return () => {
    const members = set === undefined ? [] : [...set];

    const pressed = members.find((each) => each.drawn === drawn) ?? {
      picture: { source, title, subtitle },
      drawn,
    };

    void viewAmong(keeping, members.includes(pressed) ? members : [pressed], pressed);
  };
}

/** Where a picture opened from no thumbnail grows from: the window's middle, as nothing on the page stands for it. */
const NO_PLACE: PicturePlace = { x: 0, y: 0, width: 0, height: 0 };

/**
 * Opens pictures no thumbnail on the page draws full screen in the app's
 * viewer, at `index`, a swipe stepping through the rest, such as the
 * newest window of each app an agent uses, which its capsule opens; none
 * where no app answers it.
 */
export function usePicturesView():
  | ((pictures: readonly Omit<ViewedPicture, "place">[], index: number) => void)
  | undefined {
  const keeping = useContext(KeepingDoor);

  if (keeping === undefined) return undefined;

  return (pictures, index) =>
    keeping.view(
      pictures.map((picture) => ({ ...picture, place: NO_PLACE })),
      index,
    );
}

/** Copies words to the pasteboard through the app's keeping, as a held link's Copy link does; none where no app answers it. */
export function useCopyWords(): ((words: string) => void) | undefined {
  return useContext(KeepingDoor)?.copyWords;
}

/** The acts a kept thing's menu offers, in their order, led by any its holder hands it (`HeldLeadProvider`); none where nothing is kept yet. */
export function useKeptActs(kept: Kept | undefined): readonly HeldAct[] {
  const keeping = useContext(KeepingDoor);
  const lead = useContext(LeadDoor);

  if (kept === undefined) return [];

  const own =
    keeping === undefined
      ? []
      : keepActs(kept).map((act) => ({
          label: KEEP_WORDS[act],
          symbol: KEEP_SYMBOL[act],
          onPress: () => keeping.keep(kept, act),
        }));

  return [...lead, ...own];
}

/**
 * A file chip's press that opens its file full screen in the system's
 * Quick Look, as Messages and Mail open one; none where nothing is
 * held yet or no app answers it. Note that the preview opens with the
 * system's plain transition rather than growing from the thumbnail, since
 * grown from it Quick Look stood in its immersive mode, its bar and Done
 * hidden until a tap, on the iOS 27.2 iPhone and the iPad alike.
 */
export function useQuickLook(kept: Kept | undefined): (() => void) | undefined {
  const keeping = useContext(KeepingDoor);

  if (keeping === undefined || kept === undefined) return undefined;

  return () => keeping.open(kept);
}

/** The words of a message's acts beyond its Copy, as the panel and iOS's own apps say them. */
const MESSAGE_ACT_WORDS = {
  COPY_LINK: "Copy link",
  SELECT_TEXT: "Select text",
  SHARE: KEEP_WORDS[KEEP_ACT.SHARE],
  MORE: "More",
} as const;

/**
 * A message's acts, in the panel's order and then iOS's own: Copy, Copy
 * link where the message has an address, then Select text and Share, as
 * Messages and ChatGPT offer them on a held message, with what the message
 * offers of its own after Copy link, such as the panel's Edit; none for a
 * message of no words, or where no app answers them.
 */
function useMessageActs(
  words: string,
  link: string | undefined,
  more: readonly HeldAct[],
  selectText: (() => void) | undefined,
): readonly HeldAct[] {
  const keeping = useContext(KeepingDoor);

  if (keeping === undefined || words.trim() === "") return [];

  return [
    { label: COPY_MESSAGE, symbol: GLYPH.COPY, onPress: () => keeping.copyWords(words) },
    ...(link === undefined
      ? []
      : [
          {
            label: MESSAGE_ACT_WORDS.COPY_LINK,
            symbol: GLYPH.LINK,
            onPress: () => keeping.copyWords(link),
          },
        ]),
    ...more,
    ...(selectText === undefined
      ? []
      : [
          {
            label: MESSAGE_ACT_WORDS.SELECT_TEXT,
            symbol: GLYPH.SELECT_TEXT,
            onPress: selectText,
          },
        ]),
    {
      label: MESSAGE_ACT_WORDS.SHARE,
      symbol: GLYPH.SHARE,
      onPress: () => keeping.shareWords(words),
    },
  ];
}

/**
 * A line of the member's own, or a teammate's, that a long press lifts and
 * opens SwiftUI's own menu on, as Messages and ChatGPT open one on a sent
 * bubble: headed by when it was sent ("Oct 11, 2:14 PM"), then Copy, Copy
 * link where it has an address, Select text, and Share; the line alone where
 * it has no words.
 */
export function MessageMenu({
  words,
  at,
  link,
  more = [],
  width,
  children,
}: {
  readonly words: string;
  /** When it was sent; none where its line kept no time. */
  readonly at: number | undefined;
  /** Its address on vespin.dev, which Copy link copies; none where it has none. */
  readonly link?: string | undefined;
  /** What it offers of its own after Copy link, in the panel's order, such as Edit. */
  readonly more?: readonly HeldAct[] | undefined;
  /** The width it stands in where the caller knows it before it is laid out (`HeldMenu`'s `width`). */
  readonly width?: number | undefined;
  readonly children: ReactElement;
}) {
  const [selecting, setSelecting] = useState(false);
  const acts = useMessageActs(words, link, more, () => setSelecting(true));

  if (selecting)
    return (
      <Selecting words={words} onDone={() => setSelecting(false)}>
        {children}
      </Selecting>
    );

  return (
    <HeldMenu acts={acts} title={at === undefined ? undefined : dayAndTimeText(at)} width={width}>
      {children}
    </HeldMenu>
  );
}

/**
 * The acts under an agent's finished turn, standing as a quiet row of the
 * panel's glyphs rather than on a hover, which a phone has none of, as
 * ChatGPT's row stands under its reply: Copy, Copy link where the turn has
 * an address, then Share, each a 44 pt target in the muted ink, named for
 * VoiceOver by its words, and a ⋯ holding what else the turn offers, in the
 * system's menu; for a turn of no words, Copy link and the ⋯ alone, and
 * nothing where it offers no more.
 */
export function TurnActs({
  words,
  link,
  more = [],
}: {
  readonly words: string;
  readonly link?: string | undefined;
  /** What the turn offers past its row, in the panel's order, such as Fork to new agent, behind a ⋯ at the row's end. */
  readonly more?: readonly HeldAct[] | undefined;
}) {
  const colors = useColors();
  const keeping = useContext(KeepingDoor);
  const size = useScaledSize(MARK_SIZE.GLYPH);

  const copyable = words.trim() !== "";

  // Note that a turn of no words still stands its row where it offers more, such as Fork to new agent, as the panel's foot does.
  if (keeping === undefined || (!copyable && more.length === 0)) return null;

  const acts: readonly HeldAct[] = [
    ...(copyable
      ? [{ label: COPY_MESSAGE, symbol: GLYPH.COPY, onPress: () => keeping.copyWords(words) }]
      : []),
    ...(link === undefined
      ? []
      : [
          {
            label: MESSAGE_ACT_WORDS.COPY_LINK,
            symbol: GLYPH.LINK,
            onPress: () => keeping.copyWords(link),
          },
        ]),
    ...(copyable
      ? [
          {
            label: MESSAGE_ACT_WORDS.SHARE,
            symbol: GLYPH.SHARE,
            onPress: () => keeping.shareWords(words),
          },
        ]
      : []),
  ];

  return (
    <InlineHost matchContents>
      <HStack spacing={0}>
        {acts.map((act) => (
          <Button
            key={act.label}
            onPress={act.onPress}
            modifiers={[buttonStyle("borderless"), accessibilityLabel(act.label)]}
          >
            <Image
              {...glyphImage(act.symbol)}
              size={size}
              color={colors.TEXT_MUTED}
              modifiers={[
                frame({ minWidth: PRESS_SIZE, minHeight: PRESS_SIZE }),
                SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
              ]}
            />
          </Button>
        ))}
        {more.length === 0 ? null : (
          <Menu
            label={
              <Image
                {...glyphImage(GLYPH.MORE)}
                size={size}
                color={colors.TEXT_MUTED}
                modifiers={[
                  frame({ minWidth: PRESS_SIZE, minHeight: PRESS_SIZE }),
                  SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
                ]}
              />
            }
            modifiers={[accessibilityLabel(MESSAGE_ACT_WORDS.MORE)]}
          >
            {more.map((act) => (
              <Button
                key={act.label}
                {...actContent(act.label, act.symbol)}
                onPress={act.onPress}
                {...(act.destructive === true ? { role: "destructive" as const } : {})}
              />
            ))}
          </Menu>
        )}
      </HStack>
    </InlineHost>
  );
}

/** What the app does with what is held, for a piece that copies on a press of its own, such as a draft's Copy; none where no app answers it. */
export function useKeeping(): Keeping | undefined {
  return useContext(KeepingDoor);
}

/** A held thing's act as the long press menu takes it: red where it takes something away for good. */
function heldItem(act: HeldAct): RowAction {
  return {
    label: act.label,
    symbol: act.symbol,
    tone: act.destructive === true ? ROW_ACTION_TONE.DESTRUCTIVE : ROW_ACTION_TONE.NEUTRAL,
    onPress: act.onPress,
  };
}

/**
 * SwiftUI content a long press opens its acts on, lifted as the system lifts
 * a held thing, such as a thread's message; the content alone where it
 * offers none.
 */
export function HeldSwiftMenu({
  acts,
  title,
  groups = [],
  onTap,
  children,
}: {
  readonly acts: readonly HeldAct[];
  /** What heads the menu, such as when a message was sent. */
  readonly title?: string | undefined;
  /** Groups the menu holds after the held thing's own acts, each set apart by a divider, such as a comment's Add reaction. */
  readonly groups?: readonly LongPressGroup[] | undefined;
  /** What a tap on the held views does, as SwiftUI's own tap (`LongPressMenu`'s `onTap`). */
  readonly onTap?: (() => void) | undefined;
  readonly children: ReactElement;
}) {
  return (
    <LongPressMenu groups={[acts.map(heldItem), ...groups]} title={title} onTap={onTap}>
      {children}
    </LongPressMenu>
  );
}

/**
 * React Native views a long press opens its acts on, as Photos and Messages
 * open one on a picture: SwiftUI's own menu, hosted at the width the views
 * stand in and the height they draw, the views hosted back inside it, so a
 * press still reaches them. The views alone where they offer no act. Note
 * that the hosted views stand in a box exactly as wide as the row offers,
 * measured outside the host, because a host that takes its height from its
 * views lays them out with no width of its own, so a view sized by a share
 * of its width, such as a picture's or a recording's well at its shape,
 * stood at no height at all.
 */
export function HeldMenu({
  acts,
  title,
  width: known,
  onTap,
  children,
}: {
  readonly acts: readonly HeldAct[];
  /** What heads the menu, such as when a message was sent. */
  readonly title?: string | undefined;
  /** What a tap on the held views does, as SwiftUI's own tap over them (`LongPressMenu`'s `onTap`), never a React Native press inside them, which a scroll of the list around them never cancels, since its views stand in a host of their own; none where a tap does nothing. */
  readonly onTap?: (() => void) | undefined;
  /** The width the held views stand in where the caller knows it before they are laid out, as a transcript's row does, so they are bounded from their first frame; else the width the menu measures where it stands. */
  readonly width?: number | undefined;
  readonly children: ReactElement;
}) {
  const [measured, setWidth] = useState<number | undefined>(undefined);
  // Note that a width known up front bounds the views on their first layout, since one measured comes a frame later, and the views laid out unbounded in that frame stood one line wide past the screen, their host's height a step behind their words.
  const width = known ?? measured;

  // Note that views offering no act stand in no host of their own, so a React Native press over them is one the list's scroll cancels, as it is everywhere else.
  if (acts.length === 0) {
    return onTap === undefined ? (
      children
    ) : (
      <Press onPress={onTap} accessible={false}>
        {children}
      </Press>
    );
  }

  return (
    <View style={styles.host} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <InlineHost matchContents={{ vertical: true }} style={styles.host}>
        <HeldSwiftMenu acts={acts} title={title} onTap={onTap}>
          <RNHostView matchContents={{ vertical: true }}>
            <View style={width === undefined ? undefined : { width }}>{children}</View>
          </RNHostView>
        </HeldSwiftMenu>
      </InlineHost>
    </View>
  );
}

/**
 * A card a message's words stand folded in, such as an automation's prompt,
 * whose long press offers Copy message, Copy link where it has an address,
 * and Share, as the panel's card offers Copy under it; no Select text, since
 * its words stand folded away from where the menu is held.
 */
export function CardMenu({
  words,
  link,
  width,
  children,
}: {
  readonly words: string;
  /** Its address on vespin.dev, which Copy link copies; none where it has none. */
  readonly link?: string | undefined;
  /** The width it stands in where the caller knows it before it is laid out (`HeldMenu`'s `width`). */
  readonly width?: number | undefined;
  readonly children: ReactElement;
}) {
  return (
    <HeldMenu acts={useMessageActs(words, link, [], undefined)} width={width}>
      {children}
    </HeldMenu>
  );
}

/** A message's React Native views, whose long press offers Copy message, Select text and Share; the views alone for a message of no words. */
export function CopyWordsMenu({
  words,
  width,
  children,
}: {
  readonly words: string;
  /** The width the message stands in where the caller knows it before it is laid out (`HeldMenu`'s `width`). */
  readonly width?: number | undefined;
  readonly children: ReactElement;
}) {
  const [selecting, setSelecting] = useState(false);
  const acts = useMessageActs(words, undefined, [], () => setSelecting(true));

  if (selecting)
    return (
      <Selecting words={words} onDone={() => setSelecting(false)}>
        {children}
      </Selecting>
    );

  return (
    <HeldMenu acts={acts} width={width}>
      {children}
    </HeldMenu>
  );
}

/** A message drawn in SwiftUI, such as a thread's, whose long press offers Copy message, Select text and Share; the message alone where it has no words. */
export function CopyWordsSwiftMenu({
  words,
  groups,
  children,
}: {
  readonly words: string;
  /** Groups the menu holds after Copy message, such as a comment's Add reaction. */
  readonly groups?: readonly LongPressGroup[] | undefined;
  readonly children: ReactElement;
}) {
  // Note that a message SwiftUI draws offers no Select text, since a SwiftUI line under a menu selects no span of its words in place.
  return (
    <HeldSwiftMenu acts={useMessageActs(words, undefined, [], undefined)} groups={groups}>
      {children}
    </HeldSwiftMenu>
  );
}

/** A message's views with its words selected in place, its menu let go meanwhile, so a press and a drag move the selection rather than lift the menu. */
function Selecting({
  words,
  onDone,
  children,
}: {
  readonly words: string;
  readonly onDone: () => void;
  readonly children: ReactElement;
}) {
  return <SelectingDoor value={{ words, done: onDone }}>{children}</SelectingDoor>;
}

/**
 * A message's words, drawn by `children`, as Messages selects a bubble's:
 * once its menu's Select text is pressed, the words stand in the system's
 * own text view in their place, read-only, all of them selected, with the
 * selection's handles and iOS's edit menu (Copy, Look Up, Share), a drag of
 * either handle picking any span; the selection let go, by a tap elsewhere
 * or a tap in the words, the words stand drawn again and the menu returns.
 * Note that the words are said plainly while selected (`markdownPlainText`),
 * since the system's text view draws no Markdown. Outside a message's menu,
 * or while nothing is selected, the words as drawn.
 */
export function MessageWords({ children }: { readonly children: ReactElement }) {
  const selecting = useContext(SelectingDoor);

  if (selecting === undefined) return children;

  return <SelectedWords words={selecting.words} onDone={selecting.done} />;
}

/** A message's words in the system's text view, read-only, all selected as it stands, ending as the selection is let go. */
function SelectedWords({ words, onDone }: { readonly words: string; readonly onDone: () => void }) {
  const colors = useColors();
  const field = useRef<ComponentRef<typeof TextInput>>(null);
  // Whether the words have stood selected, so the caret the view opens with never ends the selection before it is drawn.
  const spanned = useRef(false);
  const plain = markdownPlainText(words);

  // Note that the view takes the focus as it stands, so its selection shows its handles and the edit menu at once, as Messages' Select does.
  useEffect(() => {
    field.current?.focus();
  }, []);

  return (
    <TextInput
      ref={field}
      value={plain}
      editable={false}
      multiline
      scrollEnabled={false}
      // Note that it opens with every word selected, and ends once the selection is let go to a caret or the view loses the focus.
      // Note that the selection set on focus says nothing back on iOS, so it is counted here, and a tap that collapses it ends the selecting.
      onFocus={() => {
        field.current?.setSelection(0, plain.length);
        spanned.current = plain.length > 0;
      }}
      onSelectionChange={(event) => {
        const { start, end } = event.nativeEvent.selection;

        if (start !== end) spanned.current = true;
        else if (spanned.current) onDone();
      }}
      onBlur={onDone}
      style={[styles.selecting, { color: colors.TEXT_BODY }]}
    />
  );
}
