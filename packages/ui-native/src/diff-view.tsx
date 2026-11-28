// diff-view.tsx -- one changed file's diff as the app draws it: the patch read into columns once (`diff-view-model.ts`) and handed to the native view, in the theme's inks and the footnote's size, scaled with Dynamic Type.

import { useMemo } from "react";
import { StyleSheet } from "react-native";
import { useScaledSize } from "./accessibility.js";
import { diffColumns } from "./diff-view-model.js";
import { type NativeDiffLook, NativeDiffView } from "./diff-view-native.js";
import { useColors } from "./tokens/colors.js";
import { TEXT_SIZE } from "./tokens/type.js";

const styles = StyleSheet.create({
  fill: { flex: 1 },
});

/**
 * A changed file's diff, filling the space it stands in and scrolling by
 * itself: each hunk's header and rows, numbered on both sides, an added line
 * on the complete tone's tint and a removed one on danger's, in the
 * monospaced face at the footnote's size, as GitHub's mobile diff stands.
 * Words wrap unless `wrap` says not, where the diff scrolls sideways as one
 * block. The patch is read into columns once per patch; the native view
 * draws only the rows on screen. A patch that does not read as a unified
 * diff draws nothing, which its screen says in words (`fileNotice`).
 */
export function DiffView({
  patch,
  wrap = true,
  testID,
}: {
  readonly patch: string;
  readonly wrap?: boolean | undefined;
  readonly testID?: string | undefined;
}) {
  const colors = useColors();
  const fontSize = useScaledSize(TEXT_SIZE.FOOTNOTE);
  const rows = useMemo(() => diffColumns(patch), [patch]);

  const look: NativeDiffLook = {
    fontSize,
    wrap,
    text: colors.TEXT_BODY,
    muted: colors.TEXT_MUTED,
    ground: colors.GROUND,
    added: colors.COMPLETE,
    removed: colors.DANGER,
    hunk: colors.WORKING,
  };

  if (rows === undefined) return null;

  return <NativeDiffView rows={rows} look={look} style={styles.fill} testID={testID} />;
}
