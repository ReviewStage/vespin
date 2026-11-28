// failure-notice.tsx -- the app's one notice: a banner of Liquid Glass that drops in under the top bar, with a refusal's words and a Try again, a write that went with its Undo, or says once that the phone is offline, read aloud by VoiceOver and let go on its own.

import { HStack, Image, Spacer, Button as SwiftUIButton } from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  Animation,
  accessibilityElement,
  accessibilityIdentifier,
  animation,
  buttonStyle,
  fixedSize,
  foregroundStyle,
  frame,
  layoutPriority,
  lineLimit,
  offset,
  opacity,
  padding,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import {
  AccessibilityInfo,
  PanResponder,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReduceMotion } from "./accessibility.js";
import {
  NO_NOTICE,
  NOTICE_KIND,
  type NoticeAsk,
  noticeAsked,
  noticeCleared,
  noticeGone,
  noticeOnline,
  type ShownNotice,
} from "./failure-notice-model.js";
import { font } from "./font.js";
import { BAR_GLASS } from "./glass-bar.js";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
import { BUZZ, buzz } from "./haptics.js";
import { Host } from "./host.js";
import { Text } from "./text.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, PRESS_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** What the banner's one button says, as the panel's refusals and its Undo toast offer it. */
const TRY_AGAIN = "Try again";
const UNDO = "Undo";

/** How long a notice stands before it goes on its own, in milliseconds: long enough to read a sentence, longer where it offers a press, and longest while VoiceOver reads it, so its Try again or Undo can still be reached. */
const STANDS_FOR = {
  WORDS: 4_000,
  WITH_PRESS: 6_000,
  SCREEN_READER: 10_000,
} as const;

/** How far the banner travels down from above its place as it arrives, in points. */
const ARRIVAL = 120;

/** How long the system's default spring takes to settle as the banner slides in or out, in milliseconds, after which one that left is let go. */
const SLIDE_MS = 500;

/** The banner's own room above and below its line, in points, which its press's 44 pt target reaches into. */
const BANNER_INSET = SPACE.ROW + 2;

/** How far a swipe up must carry the banner before it lets it go, in points. */
const SWIPE_AWAY = 24;

/**
 * How tall UIKit's navigation bar stands, in points, under the status bar:
 * on an iPad, on an iPhone held upright and on its side, and in a sheet,
 * which draws its own taller bar from its own top. The banner stands under
 * it, so it never covers the bar's title or its buttons. An iPad's counts
 * the room iPadOS 26 sets a split view's floating column in from the top
 * too, since a column's bar stands inside it.
 */
const NAVIGATION_BAR = {
  PAD: 58,
  PHONE: 44,
  PHONE_LANDSCAPE: 32,
  SHEET: 56,
} as const;

/** The glyph each notice leads with. */
const NOTICE_SYMBOL = {
  [NOTICE_KIND.REFUSED]: GLYPH.FAILED,
  [NOTICE_KIND.OFFLINE]: GLYPH.OFFLINE,
  [NOTICE_KIND.DONE]: GLYPH.RESOLVED,
} as const satisfies Record<ShownNotice["kind"], Glyph>;

const styles = StyleSheet.create({
  // The banner's column, across its place under the top bar and taking no touch outside the banner itself.
  edge: { position: "absolute", left: 0, right: 0 },
  lane: { paddingHorizontal: SPACE.ROW + 2, paddingTop: SPACE.TIGHT, alignItems: "center" },
  banner: { width: "100%", maxWidth: 560 },
  // A sheet's own frame, which its banner stands over.
  layer: { flex: 1 },
});

/** What a screen asks of the notice. */
export interface FailureNotices {
  /** Shows a notice in place of any standing, unless it says the phone is offline and that was said already while it has been. */
  readonly say: (asked: NoticeAsk) => void;
  /** Says the phone is online again: the offline notice goes, and the next time it is offline is said anew. */
  readonly online: () => void;
  /** Lets every notice go, its Try again or Undo with it, as the account it was said for is signed out or changed. */
  readonly clear: () => void;
}

const Notices = createContext<FailureNotices | undefined>(undefined);

/** Where the one notice stands: the notice itself, the layer drawn last (the sheet on top), how a layer comes and goes, and how far down the tab in front starts its bars. */
interface NoticeStage {
  readonly shown: ShownNotice | undefined;
  readonly top: string | undefined;
  readonly gone: (serial: number) => void;
  readonly enter: (layer: string) => () => void;
  readonly standBars: (place: string, top: number) => () => void;
}

/** How far down the tab in front starts its bars, under any tab bar floating over it, or none before a tab says. */
const BarsTop = createContext<number | undefined>(undefined);

const Stage = createContext<NoticeStage | undefined>(undefined);

/** The notice of the app drawn under `FailureNoticeProvider`. */
export function useFailureNotices(): FailureNotices {
  const notices = useContext(Notices);

  if (notices === undefined) throw new Error("A screen asked for a notice outside its provider.");

  return notices;
}

/** The banner's one button: Try again where the notice offers it, else Undo where it offers that, else none. */
function noticePress(
  notice: ShownNotice,
): { readonly label: string; readonly identifier: string; readonly act: () => void } | undefined {
  if (notice.retry !== undefined) {
    return { label: TRY_AGAIN, identifier: "failure-notice-retry", act: notice.retry };
  }

  return notice.undo === undefined
    ? undefined
    : { label: UNDO, identifier: "failure-notice-undo", act: notice.undo };
}

/**
 * The banner's words, its glyph, and Try again or Undo, in the system's
 * glass, standing `ARRIVAL` above its place, unseen, until it has
 * `arrived`, and sliding and fading between the two, or only fading where
 * the reader reduces motion. Note that SwiftUI moves it, not React Native,
 * because its accessibility frames stay where its host was laid out: a
 * React Native transform moved what was drawn but left Undo's frame where
 * the banner was not, so a tap aimed by it, as Maestro aims one, missed it.
 */
function NoticeBody({
  notice,
  arrived,
  onPress,
}: {
  readonly notice: ShownNotice;
  readonly arrived: boolean;
  readonly onPress: () => void;
}) {
  const colors = useColors();
  const reduceMotion = useReduceMotion();
  // Note that a refusal draws as a problem line does, the attention glyph over the muted ink, rather than danger's red: it asks for a second try, not alarm.
  const refused = notice.kind === NOTICE_KIND.REFUSED;
  const ink = refused ? colors.ATTENTION : colors.TEXT_MUTED;
  const press = noticePress(notice);

  return (
    <Host matchContents={{ vertical: true }} style={styles.banner}>
      <HStack
        spacing={SPACE.ROW}
        modifiers={[
          padding({ leading: SPACE.EDGE, trailing: SPACE.ROW, vertical: BANNER_INSET }),
          ...BAR_GLASS,
          // Note that the banner contains its pieces as elements of their own, because an identifier on a plain stack passes down to them and stood over Try again's own.
          accessibilityElement("contain"),
          accessibilityIdentifier("failure-notice"),
          offset({ y: arrived || reduceMotion ? 0 : -ARRIVAL }),
          opacity(arrived ? 1 : 0),
          // Note that it moves on the system's default spring, as SwiftUI's own transitions do, rather than a curve and a duration of ours.
          animation(Animation.default, arrived),
        ]}
      >
        <Image {...glyphImage(NOTICE_SYMBOL[notice.kind])} size={MARK_SIZE.LEAD} color={ink} />
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_TITLE }),
            foregroundStyle(refused ? colors.TEXT_MUTED : colors.TEXT),
            lineLimit(3),
            layoutPriority(1),
          ]}
        >
          {notice.words}
        </Text>
        <Spacer />
        {press === undefined ? null : (
          // Note that the press takes its target's 44 pt on its label, not the button, since only a label's frame and shape answer a press; the word alone stood about 20 pt tall. The button then gives back the banner's own vertical padding, so the target reaches into it rather than growing the banner.
          <SwiftUIButton
            onPress={onPress}
            modifiers={[
              buttonStyle("borderless"),
              tint(colors.TEXT),
              fixedSize(),
              padding({ vertical: -BANNER_INSET }),
              accessibilityIdentifier(press.identifier),
            ]}
          >
            <Text
              modifiers={[
                font({ textStyle: TYPE_ROLE.ROW_TITLE, weight: "semibold" }),
                foregroundStyle(colors.TEXT),
                frame({ minWidth: PRESS_SIZE, minHeight: PRESS_SIZE }),
                SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
              ]}
            >
              {press.label}
            </Text>
          </SwiftUIButton>
        )}
      </HStack>
    </Host>
  );
}

/**
 * How far below its place's top the banner stands: under the top bar, as
 * UIKit draws it, and under the status bar where the place is the window,
 * whose safe area holds it. A sheet draws its own bar from its own top.
 */
function useBannerTop(sheet: boolean): number {
  const { top: windowTop } = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // Note that a tab's bars start under the iPad's floating tab bar, which the window's safe area leaves out, so the banner stood over the columns' bars wherever that bar floated.
  const safeTop = Math.max(windowTop, useContext(BarsTop) ?? 0);

  if (sheet) return NAVIGATION_BAR.SHEET;

  if (Platform.OS === "ios" && Platform.isPad) return safeTop + NAVIGATION_BAR.PAD;

  return safeTop + (width > height ? NAVIGATION_BAR.PHONE_LANDSCAPE : NAVIGATION_BAR.PHONE);
}

/**
 * The banner: drops in under the top bar as a notice arrives, as the
 * system's own banners drop in from the top, and stands until its time is
 * up, a swipe up, or its Try again or Undo, then rises away. Note that it
 * stands over its place, the app's root view or a sheet, and passes every
 * touch outside it through to the screen under it; it does not stand in a
 * window of its own (`FullWindowOverlay`), because on iOS 27.2 that window
 * never drew, so no notice showed at all. A sheet open over the root would
 * cover it, so a sheet draws its own (`FailureNoticeLayer`), and the notice
 * stands in the one on top.
 */
function NoticeBanner({
  notice,
  onGone,
  sheet,
}: {
  readonly notice: ShownNotice | undefined;
  readonly onGone: (serial: number) => void;
  /** Whether its place is a sheet, which draws its own bar from its own top, rather than the window. */
  readonly sheet: boolean;
}) {
  const top = useBannerTop(sheet);
  const { left, right } = useSafeAreaInsets();
  const [drawn, setDrawn] = useState<ShownNotice | undefined>(notice);
  // Whether the banner stands in its place, or above it as it arrives and leaves.
  const [arrived, setArrived] = useState(false);
  // The notice let go, rising away until it is gone.
  const [leaving, setLeaving] = useState<number | undefined>(undefined);

  const leave = useCallback((serial: number) => {
    setArrived(false);
    setLeaving(serial);
  }, []);

  useEffect(() => {
    if (leaving === undefined) return;

    const rose = setTimeout(() => onGone(leaving), SLIDE_MS);

    return () => clearTimeout(rose);
  }, [leaving, onGone]);

  // A new notice arrives over whatever stood, said aloud once, and goes on its own once its time is up; one let go while it stands rises away.
  useEffect(() => {
    setLeaving(undefined);

    if (notice === undefined) {
      setArrived(false);
      const rose = setTimeout(() => setDrawn(undefined), SLIDE_MS);

      return () => clearTimeout(rose);
    }

    setDrawn(notice);
    setArrived(false);
    AccessibilityInfo.announceForAccessibility(notice.words);
    let live = true;
    let stay: ReturnType<typeof setTimeout> | undefined;

    const arrive = (reading: boolean) => {
      if (!live) return;

      const stands = reading
        ? STANDS_FOR.SCREEN_READER
        : noticePress(notice) === undefined
          ? STANDS_FOR.WORDS
          : STANDS_FOR.WITH_PRESS;

      setArrived(true);
      stay = setTimeout(() => leave(notice.serial), SLIDE_MS + stands);
    };

    AccessibilityInfo.isScreenReaderEnabled().then(arrive, () => arrive(false));

    // Note that its stay stops with it, so a banner that handed its notice to a sheet, or took a newer one, never lets that one go when the old stay runs out.
    return () => {
      live = false;
      clearTimeout(stay);
    };
  }, [notice, leave]);

  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, { dy }) => dy < -4,
        onPanResponderRelease: (_, { dy }) => {
          if (dy < -SWIPE_AWAY && drawn !== undefined) leave(drawn.serial);
        },
      }),
    [drawn, leave],
  );

  if (drawn === undefined) return null;

  const press = () => {
    leave(drawn.serial);
    buzz(BUZZ.SELECTION);
    noticePress(drawn)?.act();
  };

  // Note that the banner keeps the window's side safe areas, so it stands short of a tab rail beside it, as the folded iPhone Duo stands one.
  return (
    <View pointerEvents="box-none" style={[styles.edge, { top, left, right }]}>
      <View
        style={styles.lane}
        pointerEvents="box-none"
        accessibilityLiveRegion="polite"
        {...swipe.panHandlers}
      >
        <NoticeBody notice={drawn} arrived={arrived} onPress={press} />
      </View>
    </View>
  );
}

/**
 * Holds the app's one notice over everything under it, and hands
 * `useFailureNotices` to the screens: a refusal, or a write that went with
 * its Undo, stands in place of any notice standing, and the offline notice
 * once a stretch offline
 * (`failure-notice-model.ts`). It draws over the root while no sheet stands,
 * and in the sheet on top while one does (`FailureNoticeLayer`), since a
 * sheet is a view of its own over the root, which would hide it.
 */
export function FailureNoticeProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState(NO_NOTICE);
  const [layers, setLayers] = useState<readonly string[]>([]);
  const [bars, setBars] = useState<readonly { readonly place: string; readonly top: number }[]>([]);

  const notices = useMemo<FailureNotices>(
    () => ({
      say: (asked) => setState((was) => noticeAsked(was, asked)),
      online: () => setState(noticeOnline),
      clear: () => setState(noticeCleared),
    }),
    [],
  );

  const gone = useCallback((serial: number) => setState((was) => noticeGone(was, serial)), []);

  // Note that a sheet opens over the ones before it, so the layer that entered last is the one on top.
  const enter = useCallback((layer: string) => {
    setLayers((were) => [...were, layer]);

    return () => setLayers((were) => were.filter((was) => was !== layer));
  }, []);

  // Note that the tab that said last is the one in front, since a tab says while it stands in front alone.
  const standBars = useCallback((place: string, barsTop: number) => {
    setBars((were) => [...were.filter((was) => was.place !== place), { place, top: barsTop }]);

    return () => setBars((were) => were.filter((was) => was.place !== place));
  }, []);

  const top = layers.at(-1);

  const stage = useMemo<NoticeStage>(
    () => ({ shown: state.shown, top, gone, enter, standBars }),
    [state.shown, top, gone, enter, standBars],
  );

  return (
    <Notices value={notices}>
      <Stage value={stage}>
        {children}
        <BarsTop value={bars.at(-1)?.top}>
          <NoticeBanner
            notice={top === undefined ? state.shown : undefined}
            onGone={gone}
            sheet={false}
          />
        </BarsTop>
      </Stage>
    </Notices>
  );
}

/**
 * A sheet's own place for the notice: wraps the sheet's screens, and draws
 * the notice over them, under the sheet's own bar, while this sheet is the
 * one on top, so a write refused inside a sheet, or under it, is seen rather
 * than hidden behind it.
 */
export function FailureNoticeLayer({
  children,
  inFront,
}: {
  readonly children: ReactNode;
  /** Whether the sheet is the screen in front: false once a page opens over it, such as one a notification opened, so its notice stands where it is seen rather than in the sheet under that page. */
  readonly inFront: boolean;
}) {
  const stage = useContext(Stage);
  const layer = useId();

  if (stage === undefined) throw new Error("A sheet drew a notice layer outside its provider.");

  const { enter, top, shown, gone } = stage;

  useEffect(() => (inFront ? enter(layer) : undefined), [enter, layer, inFront]);

  return (
    <View style={styles.layer}>
      {children}
      <NoticeBanner notice={top === layer ? shown : undefined} onGone={gone} sheet />
    </View>
  );
}

/**
 * A tab's word to the notice of how far down its own bars start: its safe
 * area's top, which on an iPad counts the tab bar floating over its columns
 * where the system's tab sidebar is folded, as a portrait iPad folds it, and
 * which the window's own safe area, all the notice over the app's root view
 * reads, leaves out. Said while the tab stands in front, so the banner drops
 * in under that tab's column bars rather than over their buttons, as Mail's
 * and Notes' notices stand clear of the bar.
 */
export function FailureNoticeBars({
  inFront,
}: {
  /** Whether the tab is the one shown. */
  readonly inFront: boolean;
}) {
  const stage = useContext(Stage);
  const place = useId();
  const { top } = useSafeAreaInsets();

  if (stage === undefined) throw new Error("A tab said its bars outside the notice's provider.");

  const { standBars } = stage;

  useEffect(() => (inFront ? standBars(place, top) : undefined), [standBars, place, top, inFront]);

  return null;
}
