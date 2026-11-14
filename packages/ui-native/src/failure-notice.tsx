// failure-notice.tsx -- the app's one notice: a banner of Liquid Glass that slides down from the top with a refusal's words and a Try again, a write that went with its Undo, or says once that the phone is offline, read aloud by VoiceOver and let go on its own.

import { Host, HStack, Image, Spacer, Button as SwiftUIButton, Text } from "@expo/ui/swift-ui";
import {
  Animation,
  accessibilityElement,
  accessibilityIdentifier,
  animation,
  buttonStyle,
  fixedSize,
  font,
  foregroundStyle,
  layoutPriority,
  lineLimit,
  offset,
  padding,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AccessibilityInfo, Animated, PanResponder, StyleSheet } from "react-native";
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
import { useBarGlass } from "./glass-bar.js";
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
 * glass, standing `ARRIVAL` above its place until it has `arrived`, and
 * sliding between the two. Note that SwiftUI slides it, not React Native,
 * because its accessibility frames stay where its host was laid out: a
 * React Native transform moved what was drawn but left Undo's frame above
 * the screen's top, so a tap aimed by it, as Maestro aims one, landed on the
 * status bar.
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
  const ink = notice.kind === NOTICE_KIND.REFUSED ? colors.DANGER : colors.TEXT_MUTED;
  const press = noticePress(notice);
  const glass = useBarGlass();

  return (
    <Host matchContents={{ vertical: true }} style={styles.banner}>
      <HStack
        spacing={SPACE.ROW}
        modifiers={[
          padding({ leading: SPACE.EDGE, trailing: SPACE.ROW, vertical: SPACE.ROW + 2 }),
          ...glass,
          // Note that the banner contains its pieces as elements of their own, because an identifier on a plain stack passes down to them and stood over Try again's own.
          accessibilityElement("contain"),
          accessibilityIdentifier("failure-notice"),
          offset({ y: arrived ? 0 : -ARRIVAL }),
          animation(Animation.easeInOut({ duration: SLIDE_MS / 1000 }), arrived),
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
 * The banner: fades in and slides down under the status bar as a notice
 * arrives, or only fades in where the reader reduces motion, stands until its time is up,
 * a swipe up, or its Try again or Undo, and slides away. Note that it stands over the
 * app's root view, above the tabs, and passes every touch outside it
 * through to the screen under it; it does not stand in a window of its own
 * (`FullWindowOverlay`), because on iOS 27.2 that window never drew, so no
 * notice showed at all. A sheet open over the root covers it.
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
  // Whether the banner stands in its place, or above it as it arrives and leaves.
  const [lowered, setLowered] = useState(false);

  const leave = useCallback(
    (serial: number) => {
      place.stopAnimation();
      setLowered(false);
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
      setLowered(false);
      Animated.timing(place, { toValue: 0, duration: SLIDE_MS, useNativeDriver: true }).start(
        ({ finished }) => finished && setDrawn(undefined),
      );

      return;
    }

    setDrawn(notice);
    setLowered(false);
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

      // Note that the notice's stay is a pause after its fade in, so a swipe or a newer notice stops both as one, and it leaves as a swipe has it leave.
      setLowered(true);
      Animated.sequence([
        Animated.timing(place, { toValue: 1, duration: SLIDE_MS, useNativeDriver: true }),
        Animated.delay(stands),
      ]).start(({ finished }) => {
        if (finished) leave(notice.serial);
      });
    };

    AccessibilityInfo.isScreenReaderEnabled().then(arrive, () => arrive(false));

    return () => {
      live = false;
      place.stopAnimation();
    };
  }, [notice, place, leave]);

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

  return (
    <SafeAreaView edges={["top"]} pointerEvents="box-none" style={styles.edge}>
      <Animated.View
        style={[styles.lane, { opacity: place }]}
        pointerEvents="box-none"
        accessibilityLiveRegion="polite"
        {...swipe.panHandlers}
      >
        <NoticeBody notice={drawn} arrived={lowered || reduceMotion} onPress={press} />
      </Animated.View>
    </SafeAreaView>
  );
}

/**
 * Holds the app's one notice over everything under it, and hands
 * `useFailureNotices` to the screens: a refusal, or a write that went with
 * its Undo, stands in place of any notice standing, and the offline notice
 * once a stretch offline
 * (`failure-notice-model.ts`).
 */
export function FailureNoticeProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState(NO_NOTICE);

  const notices = useMemo<FailureNotices>(
    () => ({
      say: (asked) => setState((was) => noticeAsked(was, asked)),
      online: () => setState(noticeOnline),
      clear: () => setState(noticeCleared),
    }),
    [],
  );

  const gone = useCallback((serial: number) => setState((was) => noticeGone(was, serial)), []);

  return (
    <Notices.Provider value={notices}>
      {children}
      <NoticeBanner notice={state.shown} onGone={gone} />
    </Notices.Provider>
  );
}
