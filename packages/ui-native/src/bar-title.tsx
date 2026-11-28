// bar-title.tsx -- the muted line under a page's name in its stack's bar, such as an agent's state and model: UIKit's own subtitle, with a Manager's face before its name.

import { Spacer } from "@expo/ui/swift-ui";
import type { ManagerFace } from "@repo/features/manager-face";
import { StyleSheet } from "react-native";
import { Host } from "./host.js";
import { BAR_KIND, barSubtitle } from "./interactions.js";
import { managerFaceAsset } from "./manager-face-look.js";

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
  face,
}: {
  readonly words: string;
  /** Whether the title and its subtitle stand at the bar's leading edge beside the back button, in the bar's own row, as a regular window's page stands them where a tab bar floats in the middle of that row; a build without it centers them. */
  readonly leading?: boolean | undefined;
  /** A Manager's face, livelier while it works, which leads the bar's title, and that title, as the panel's page heads a Manager with its face; none for any other page. */
  readonly face?:
    | { readonly title: string; readonly face: ManagerFace; readonly working: boolean }
    | undefined;
}) {
  const mark =
    face === undefined
      ? undefined
      : { title: face.title, asset: managerFaceAsset(face.face, face.working) };

  return (
    <Host style={styles.probe} modifiers={[barSubtitle(BAR_KIND.STACK, words, leading, mark)]}>
      <Spacer />
    </Host>
  );
}
