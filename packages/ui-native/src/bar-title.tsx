// bar-title.tsx -- the muted line under a page's name in its stack's bar, such as an agent's state and model: UIKit's own subtitle.

import { Host, Spacer } from "@expo/ui/swift-ui";
import { StyleSheet } from "react-native";
import { BAR_KIND, barSubtitle } from "./interactions.js";

/** What stands under a page's name in its bar: its words, and what a press on them opens with what VoiceOver says it does, where they open anything. */
export type BarSubtitle = {
  readonly words: string;
  readonly onPress?: (() => void) | undefined;
  /** What a press on the line says it does, to VoiceOver, before its words, such as "Change model". */
  readonly label?: string | undefined;
};

const styles = StyleSheet.create({
  // A host of no size, which draws nothing and takes no touch.
  probe: { position: "absolute", width: 0, height: 0 },
});

/**
 * The words under a compact page's title in the native stack's bar, as Mail
 * names a mailbox's count under its name: UIKit's own subtitle, written by
 * `barSubtitle` from a host of no size, for a page whose content is React
 * Native's own, such as the agent's transcript, so no `Screen` carries it.
 * Note that it stays mounted with empty words, which draw no line, so the
 * line comes and goes without the host being made again.
 */
export function StackSubtitle({
  words,
  leading = false,
}: {
  readonly words: string;
  /** Whether the title and its subtitle stand at the bar's leading edge beside the back button, in the bar's own row, as a regular window's page stands them where a tab bar floats in the middle of that row; a build without it centers them. */
  readonly leading?: boolean | undefined;
}) {
  return (
    <Host style={styles.probe} modifiers={[barSubtitle(BAR_KIND.STACK, words, leading)]}>
      <Spacer />
    </Host>
  );
}
