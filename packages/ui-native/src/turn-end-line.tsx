// turn-end-line.tsx -- the line an agent's transcript ends on once its turn was stopped or failed, and the press on its row that goes on from it, as the panel's `TurnEnd` draws it: "Failed: the sandbox or checkout failed" then Try again.

import {
  END_LINE_PRESS,
  type EndLinePress,
  TRYING_AGAIN_LABEL,
} from "@repo/features/agent-end-line";
import { SymbolView } from "expo-symbols";
import { StyleSheet, Text, View } from "react-native";
import { useScaledSize } from "./accessibility.js";
import { BUTTON_LOOK, Button } from "./button.js";
import { GLYPH, type Glyph, glyphSymbol } from "./glyph.js";
import { InlineHost } from "./inline-host.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { ROLE_SIZE } from "./tokens/type.js";
import type { EndPress } from "./transcript-model.js";

/** The glyph each way on leads with, as the panel's buttons lead; a refused key's press, which opens Settings, leads with none, as the panel's does. */
const PRESS_GLYPH: Readonly<Record<EndLinePress, Glyph | undefined>> = {
  [END_LINE_PRESS.CONTINUE]: GLYPH.CONTINUE,
  [END_LINE_PRESS.KEY]: undefined,
  [END_LINE_PRESS.TRY_AGAIN]: GLYPH.RETRY,
};

const styles = StyleSheet.create({
  // Note that the row wraps, so a failure too long to share it takes it whole and the press stands under it, never between its words, as the panel's row wraps.
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: SPACE.ROW,
    paddingHorizontal: SPACE.EDGE,
    paddingVertical: SPACE.ROW,
  },
  line: { flexDirection: "row", alignItems: "flex-start", gap: SPACE.TIGHT, flexShrink: 1 },
  words: { flexShrink: 1 },
});

/**
 * The end line, as the panel's `TurnEnd` stands it: a stop's words alone,
 * quiet, since it was the reader's own doing; a failure's led by the failed
 * mark in the attention ink, its words muted rather than red, as every
 * failure line of the app's stands (`ProblemLine`); and the press after
 * them, the way on from the turn, busy while its act is out.
 */
export function TurnEndLine({
  words,
  failed,
  press,
  onPress,
}: {
  /** What ended the turn: "Stopped", or "Failed: " and why. */
  readonly words: string;
  readonly failed: boolean;
  /** The way on, after the words; none where the line offers none. */
  readonly press: EndPress | undefined;
  /** What the press does; none where the list offers no press, which then draws none. */
  readonly onPress: ((press: EndPress) => void) | undefined;
}) {
  const colors = useColors();
  const mark = useScaledSize(MARK_SIZE.GLYPH);

  return (
    <View style={styles.row}>
      <View style={styles.line} accessible accessibilityLabel={words}>
        {failed ? (
          <SymbolView name={glyphSymbol(GLYPH.FAILED)} size={mark} tintColor={colors.ATTENTION} />
        ) : null}
        <Text style={[styles.words, { fontSize: ROLE_SIZE.ROW_LINE, color: colors.TEXT_MUTED }]}>
          {words}
        </Text>
      </View>
      {press === undefined || onPress === undefined ? null : (
        <InlineHost matchContents>
          <Button
            // Note that the press is keyed by its words, so a busy press is drawn anew rather than left saying what it first said.
            key={press.busy ? TRYING_AGAIN_LABEL : press.label}
            label={press.busy ? TRYING_AGAIN_LABEL : press.label}
            symbol={PRESS_GLYPH[press.kind]}
            look={BUTTON_LOOK.BORDERED}
            disabled={press.busy}
            onPress={() => onPress(press)}
          />
        </InlineHost>
      )}
    </View>
  );
}
