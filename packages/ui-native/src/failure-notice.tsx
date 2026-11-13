// failure-notice.tsx -- the app's one notice: a banner of Liquid Glass that slides down from the top with a refusal's words and a Try again, a write that went with its Undo, or says once that the phone is offline, read aloud by VoiceOver and let go on its own.

import { Host, HStack, Image, Spacer, Button as SwiftUIButton, Text } from "@expo/ui/swift-ui";
import {
  accessibilityElement,
  accessibilityIdentifier,
  buttonStyle,
  fixedSize,
  font,
  foregroundStyle,
  glassEffect,
  layoutPriority,
  lineLimit,
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
import { AccessibilityInfo, Animated, PanResponder, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
import { BAR_RADIUS } from "./glass-bar.js";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
import { BUZZ, buzz } from "./haptics.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
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

/** How far the banner travels in from above the screen's top as it arrives, in points. */
const ARRIVAL = 120;

/** How long it takes to slide in or out, in milliseconds, as the system's own banners do. */
const SLIDE_MS = 280;

/** How far a swipe up must carry the banner before it lets it go, in points. */
const SWIPE_AWAY = 24;

/** The glyph each notice leads with. */
const NOTICE_SYMBOL = {
  [NOTICE_KIND.REFUSED]: GLYPH.FAILED,
  [NOTICE_KIND.OFFLINE]: GLYPH.OFFLINE,
  [NOTICE_KIND.DONE]: GLYPH.RESOLVED,
} as const satisfies Record<ShownNotice["kind"], Glyph>;

const styles = StyleSheet.create({
  // The banner's column, over the whole window and taking no touch outside the banner itself.
  edge: { position: "absolute", top: 0, left: 0, right: 0 },
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

/** Where the one notice stands: the notice itself, the layer drawn last (the sheet on top), and how a layer comes and goes. */
interface NoticeStage {
  readonly shown: ShownNotice | undefined;
  readonly top: string | undefined;
  readonly gone: (serial: number) => void;
  readonly enter: (layer: string) => () => void;
}

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

/** The banner's words, its glyph, and Try again or Undo, in the system's glass. */
function NoticeBody({
  notice,
  onPress,
}: {
  readonly notice: ShownNotice;
  readonly onPress: () => void;
}) {
  const colors = useColors();
  const ink = notice.kind === NOTICE_KIND.REFUSED ? colors.DANGER : colors.TEXT_MUTED;
  const press = noticePress(notice);

  return (
    <Host matchContents={{ vertical: true }} style={styles.banner}>
      <HStack
        spacing={SPACE.ROW}
        modifiers={[
          padding({ leading: SPACE.EDGE, trailing: SPACE.ROW, vertical: SPACE.ROW + 2 }),
          glassEffect({
            glass: { variant: "regular" },
            // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- @expo/ui names this parameter `shape`.
            shape: "roundedRectangle",
            cornerRadius: BAR_RADIUS,
          }),
          // Note that the banner contains its pieces as elements of their own, because an identifier on a plain stack passes down to them and stood over Try again's own.
          accessibilityElement("contain"),
          accessibilityIdentifier("failure-notice"),
        ]}
      >
        <Image {...glyphImage(NOTICE_SYMBOL[notice.kind])} size={MARK_SIZE.LEAD} color={ink} />
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_TITLE }),
            foregroundStyle(colors.TEXT),
            lineLimit(3),
            layoutPriority(1),
          ]}
        >
          {notice.words}
        </Text>
        <Spacer />
        {press === undefined ? null : (
          <SwiftUIButton
            label={press.label}
            onPress={onPress}
            modifiers={[
              buttonStyle("borderless"),
              tint(colors.TEXT),
              font({ textStyle: TYPE_ROLE.ROW_TITLE, weight: "semibold" }),
              fixedSize(),
              accessibilityIdentifier(press.identifier),
            ]}
          />
        )}
      </HStack>
    </Host>
  );
}

/**
 * The banner: slides down under the status bar as a notice arrives, or
 * fades in where the reader reduces motion, stands until its time is up,
 * a swipe up, or its Try again or Undo, and slides away. Note that it stands over the
 * app's root view, above the tabs, and passes every touch outside it
 * through to the screen under it; it does not stand in a window of its own
 * (`FullWindowOverlay`), because on iOS 27.2 that window never drew, so no
 * notice showed at all. A sheet open over the root would cover it, so a
 * sheet draws its own (`FailureNoticeLayer`), and the notice stands in the
 * one on top.
 */
function NoticeBanner({
  notice,
  onGone,
}: {
  readonly notice: ShownNotice | undefined;
  readonly onGone: (serial: number) => void;
}) {
  const reduceMotion = useReduceMotion();
  const [place] = useState(() => new Animated.Value(0));
  const [drawn, setDrawn] = useState<ShownNotice | undefined>(notice);

  const leave = useCallback(
    (serial: number) => {
      place.stopAnimation();
      Animated.timing(place, {
        toValue: 0,
        duration: SLIDE_MS,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) onGone(serial);
      });
    },
    [place, onGone],
  );

  // A new notice arrives over whatever stood, said aloud once, and goes on its own once its time is up; one let go while it stands slides away.
  useEffect(() => {
    if (notice === undefined) {
      Animated.timing(place, { toValue: 0, duration: SLIDE_MS, useNativeDriver: true }).start(
        ({ finished }) => finished && setDrawn(undefined),
      );

      return;
    }

    setDrawn(notice);
    place.setValue(0);
    AccessibilityInfo.announceForAccessibility(notice.words);
    let live = true;

    const arrive = (reading: boolean) => {
      if (!live) return;

      const stands = reading
        ? STANDS_FOR.SCREEN_READER
        : noticePress(notice) === undefined
          ? STANDS_FOR.WORDS
          : STANDS_FOR.WITH_PRESS;

      // Note that the notice's stay is a pause between its slide in and its slide out, so a swipe or a newer notice stops all three as one.
      Animated.sequence([
        Animated.timing(place, { toValue: 1, duration: SLIDE_MS, useNativeDriver: true }),
        Animated.delay(stands),
        Animated.timing(place, { toValue: 0, duration: SLIDE_MS, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) onGone(notice.serial);
      });
    };

    AccessibilityInfo.isScreenReaderEnabled().then(arrive, () => arrive(false));

    return () => {
      live = false;
      place.stopAnimation();
    };
  }, [notice, place, onGone]);

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

  const arriving = reduceMotion
    ? { opacity: place }
    : {
        opacity: place,
        transform: [
          { translateY: place.interpolate({ inputRange: [0, 1], outputRange: [-ARRIVAL, 0] }) },
        ],
      };

  return (
    <SafeAreaView edges={["top"]} pointerEvents="box-none" style={styles.edge}>
      <Animated.View
        style={[styles.lane, arriving]}
        pointerEvents="box-none"
        accessibilityLiveRegion="polite"
        {...swipe.panHandlers}
      >
        <NoticeBody notice={drawn} onPress={press} />
      </Animated.View>
    </SafeAreaView>
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

  const top = layers.at(-1);

  const stage = useMemo<NoticeStage>(
    () => ({ shown: state.shown, top, gone, enter }),
    [state.shown, top, gone, enter],
  );

  return (
    <Notices.Provider value={notices}>
      <Stage.Provider value={stage}>
        {children}
        <NoticeBanner notice={top === undefined ? state.shown : undefined} onGone={gone} />
      </Stage.Provider>
    </Notices.Provider>
  );
}

/**
 * A sheet's own place for the notice: wraps the sheet's screens, and draws
 * the notice over them while this sheet is the one on top, so a write
 * refused inside a sheet, or under it, is seen rather than hidden behind it.
 */
export function FailureNoticeLayer({ children }: { readonly children: ReactNode }) {
  const stage = useContext(Stage);
  const layer = useId();

  if (stage === undefined) throw new Error("A sheet drew a notice layer outside its provider.");

  const { enter, top, shown, gone } = stage;

  useEffect(() => enter(layer), [enter, layer]);

  return (
    <View style={styles.layer}>
      {children}
      <NoticeBanner notice={top === layer ? shown : undefined} onGone={gone} />
    </View>
  );
}
