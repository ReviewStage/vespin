// accessibility.ts -- the system's accessibility settings a component draws by (Reduce Motion, Reduce Transparency, Increase Contrast), the reader's text size past which a layout stacks rather than crowds, and what VoiceOver is told as it happens.

import { useEffect, useRef, useSyncExternalStore } from "react";
import { AccessibilityInfo, useWindowDimensions } from "react-native";
import { ACCESSIBILITY_SCALE } from "./tokens/type.js";

/** The settings read, each by the event iOS tells a change of it by. */
const SETTING = {
  REDUCE_MOTION: "reduceMotionChanged",
  REDUCE_TRANSPARENCY: "reduceTransparencyChanged",
  INCREASE_CONTRAST: "darkerSystemColorsChanged",
} as const;

type Setting = (typeof SETTING)[keyof typeof SETTING];

/** How each setting is first read, before iOS tells of a change. */
const FIRST_READ = {
  [SETTING.REDUCE_MOTION]: () => AccessibilityInfo.isReduceMotionEnabled(),
  [SETTING.REDUCE_TRANSPARENCY]: () => AccessibilityInfo.isReduceTransparencyEnabled(),
  [SETTING.INCREASE_CONTRAST]: () => AccessibilityInfo.isDarkerSystemColorsEnabled(),
} as const satisfies Record<Setting, () => Promise<boolean>>;

/**
 * One setting as a store every component shares: read once, kept as iOS
 * tells of each change, and off until the first read answers. Note that the
 * one listener per setting is added on the first subscriber and kept for the
 * app's life, since the rows of a long list each read the colors, and a
 * listener apiece would be hundreds.
 */
function settingStore(setting: Setting) {
  let on = false;
  let started = false;
  const listeners = new Set<() => void>();
  const set = (next: boolean) => {
    if (next === on) return;
    on = next;
    for (const listener of listeners) listener();
  };
  const start = () => {
    started = true;
    AccessibilityInfo.addEventListener(setting, set);
    FIRST_READ[setting]().then(set, () => set(false));
  };
  return {
    subscribe(listener: () => void) {
      if (!started) start();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    read: () => on,
  };
}

const STORES = {
  [SETTING.REDUCE_MOTION]: settingStore(SETTING.REDUCE_MOTION),
  [SETTING.REDUCE_TRANSPARENCY]: settingStore(SETTING.REDUCE_TRANSPARENCY),
  [SETTING.INCREASE_CONTRAST]: settingStore(SETTING.INCREASE_CONTRAST),
} as const satisfies Record<Setting, ReturnType<typeof settingStore>>;

function useSetting(setting: Setting): boolean {
  const store = STORES[setting];
  return useSyncExternalStore(store.subscribe, store.read);
}

/** Whether the reader asked for less motion: a custom motion is left out, or cross-fades, where it is on. */
export function useReduceMotion(): boolean {
  return useSetting(SETTING.REDUCE_MOTION);
}

/** Whether the reader asked for less transparency: glass stands as a solid surface where it is on. */
export function useReduceTransparency(): boolean {
  return useSetting(SETTING.REDUCE_TRANSPARENCY);
}

/** Whether the reader asked for more contrast (Increase Contrast, iOS's darker system colors): `useColors` strengthens the quiet inks and the hairlines where it is on. */
export function useIncreaseContrast(): boolean {
  return useSetting(SETTING.INCREASE_CONTRAST);
}

/**
 * Whether the reader reads at one of the accessibility text sizes, past the
 * largest standard one, where a row stacks its end under its words and a
 * line of chips stands one to a line, rather than cut the words short or
 * run off the screen, as Apple's Human Interface Guidelines ask.
 */
export function useAccessibilitySize(): boolean {
  return useWindowDimensions().fontScale > ACCESSIBILITY_SCALE;
}

/** How far a fixed size grows with the reader's text: no smaller than drawn at the default size, and no more than twice it, as a mark beside words grows less than they do. */
const SCALED_RANGE = { MIN: 1, MAX: 2 } as const;

/**
 * A size in points scaled with the reader's text size, as SwiftUI's
 * `@ScaledMetric` scales one, for a mark drawn at a size of its own rather
 * than a text style's, so it keeps beside the words it leads.
 */
export function useScaledSize(points: number): number {
  const { fontScale } = useWindowDimensions();
  return points * Math.min(SCALED_RANGE.MAX, Math.max(SCALED_RANGE.MIN, fontScale));
}

/** Tells VoiceOver something that happened out of the reader's sight, such as a send refused; nothing where VoiceOver is off. */
function announce(words: string): void {
  if (words.trim() === "") return;
  AccessibilityInfo.announceForAccessibility(words);
}

/**
 * Tells VoiceOver `words` each time they change while the piece stands, such
 * as an agent's state turning from Working to Finished, so a reader who
 * moved on hears it as a sighted one sees it; with `atFirst`, also the words
 * it opens with, for a piece that appears because something happened, such
 * as a refusal's note.
 */
export function useAnnounced(words: string | undefined, atFirst = false): void {
  const said = useRef<string | undefined>(atFirst ? undefined : words);
  useEffect(() => {
    if (words === said.current) return;
    said.current = words;
    if (words !== undefined) announce(words);
  }, [words]);
}
