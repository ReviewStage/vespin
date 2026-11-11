// failure-notice.tsx -- the app's one notice that an action did not go: a banner of Liquid Glass that slides down from the top with the refusal's words and a Try again, or says once that the phone is offline, read aloud by VoiceOver and let go on its own.

import { Host, HStack, Image, Spacer, Button as SwiftUIButton, Text } from "@expo/ui/swift-ui";
import {
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
  useMemo,
  useState,
} from "react";
import { AccessibilityInfo, Animated, PanResponder, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FullWindowOverlay } from "react-native-screens";
import { useReduceMotion } from "./accessibility.js";
import {
  NO_NOTICE,
  NOTICE_KIND,
  type NoticeAsk,
  noticeAsked,
  noticeGone,
  noticeOnline,
  type ShownNotice,
} from "./failure-notice-model.js";
import { BAR_RADIUS } from "./glass-bar.js";
import { BUZZ, buzz } from "./haptics.js";
import type { SfSymbol } from "./sf-symbol.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** What the banner's one button says, as the panel's refusals offer it. */
const TRY_AGAIN = "Try again";

/** How long a notice stands before it goes on its own, in milliseconds: long enough to read a sentence, longer where it offers a press, and longest while VoiceOver reads it, so its Try again can still be reached. */
const STANDS_FOR = {
  WORDS: 4_000,
  WITH_RETRY: 6_000,
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
  [NOTICE_KIND.REFUSED]: "exclamationmark.triangle.fill",
  [NOTICE_KIND.OFFLINE]: "wifi.slash",
} as const satisfies Record<ShownNotice["kind"], SfSymbol>;

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
}

const Notices = createContext<FailureNotices | undefined>(undefined);

/** The notice of the app drawn under `FailureNoticeProvider`. */
export function useFailureNotices(): FailureNotices {
  const notices = useContext(Notices);
  if (notices === undefined) throw new Error("A screen asked for a notice outside its provider.");
  return notices;
}

/** The banner's words, its glyph, and Try again, in the system's glass. */
function NoticeBody({
  notice,
  onRetry,
}: {
  readonly notice: ShownNotice;
  readonly onRetry: () => void;
}) {
  const colors = useColors();
  const ink = notice.kind === NOTICE_KIND.REFUSED ? colors.DANGER : colors.TEXT_MUTED;
  return (
    <Host matchContents={{ vertical: true }} style={styles.banner}>
      <HStack
        spacing={SPACE.ROW}
        modifiers={[
          padding({ leading: SPACE.EDGE, trailing: SPACE.ROW, vertical: SPACE.ROW + 2 }),
          glassEffect({
            glass: { variant: "regular", interactive: true },
            shape: "roundedRectangle",
            cornerRadius: BAR_RADIUS,
          }),
          accessibilityIdentifier("failure-notice"),
        ]}
      >
        <Image systemName={NOTICE_SYMBOL[notice.kind]} size={MARK_SIZE.LEAD} color={ink} />
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
        {notice.retry === undefined ? null : (
          <SwiftUIButton
            label={TRY_AGAIN}
            onPress={onRetry}
            modifiers={[
              buttonStyle("borderless"),
              tint(colors.TEXT),
              font({ textStyle: TYPE_ROLE.ROW_TITLE, weight: "semibold" }),
              fixedSize(),
              accessibilityIdentifier("failure-notice-retry"),
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
 * a swipe up, or Try again, and slides away. Note that it stands in a
 * window of its own (`FullWindowOverlay`), so it draws over a sheet as
 * well as the tabs, as the system's banners do, and passes every touch
 * outside it through to the screen under it.
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
        : notice.retry === undefined
          ? STANDS_FOR.WORDS
          : STANDS_FOR.WITH_RETRY;
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
  const retry = () => {
    leave(drawn.serial);
    buzz(BUZZ.SELECTION);
    drawn.retry?.();
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
    <FullWindowOverlay>
      <SafeAreaView edges={["top"]} pointerEvents="box-none" style={styles.edge}>
        <Animated.View
          style={[styles.lane, arriving]}
          pointerEvents="box-none"
          accessibilityLiveRegion="polite"
          {...swipe.panHandlers}
        >
          <NoticeBody notice={drawn} onRetry={retry} />
        </Animated.View>
      </SafeAreaView>
    </FullWindowOverlay>
  );
}

/**
 * Holds the app's one failure notice over everything under it, and hands
 * `useFailureNotices` to the screens: a refusal stands in place of any
 * notice standing, and the offline notice once a stretch offline
 * (`failure-notice-model.ts`).
 */
export function FailureNoticeProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState(NO_NOTICE);
  const notices = useMemo<FailureNotices>(
    () => ({
      say: (asked) => setState((was) => noticeAsked(was, asked)),
      online: () => setState(noticeOnline),
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
