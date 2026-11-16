// rolling-count.ts -- the modifiers that roll a count's digits as it changes, as the system's own counts do, unless the reader reduces motion.

import {
  Animation,
  animation,
  contentTransition,
  type ModifierConfig,
} from "@expo/ui/swift-ui/modifiers";
import { useReduceMotion } from "./accessibility.js";

/**
 * What a SwiftUI `Text` holding a count takes so its digits roll to the new
 * value, as Mail's unread counts and the system's badges do, rather than
 * jumping (the developer, Nov 16, 2026, from the widgets audit). Note that
 * the animation is keyed on the value, so only a change of the count rolls
 * it, and that nothing rolls where the reader reduces motion.
 */
export function useRollingCount(value: number): readonly ModifierConfig[] {
  const reduceMotion = useReduceMotion();

  return reduceMotion
    ? []
    : [contentTransition("numericText"), animation(Animation.default, value)];
}
