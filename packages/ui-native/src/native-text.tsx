// native-text.tsx -- React Native's Text as this package draws words where SwiftUI cannot, such as a transcript's rows and Markdown: in Geist, a weight heavier under Bold Text, as the system's own face would stand.

import { type ComponentProps, createContext, useContext } from "react";
import { Text as ReactNativeText, StyleSheet, type TextStyle } from "react-native";
import { useBoldText } from "./accessibility.js";
import { TEXT_FONT } from "./tokens/type.js";

type Weight = NonNullable<TextStyle["fontWeight"]>;

/**
 * Each weight a step heavier, which Bold Text asks of an embedded face as it
 * thickens the system's own; the app embeds Geist up to bold, so a step past
 * it stays bold.
 */
const BOLDER = {
  "100": "300",
  "200": "400",
  "300": "400",
  "400": "500",
  normal: "500",
  "500": "600",
  "600": "700",
  "700": "700",
  bold: "700",
  "800": "900",
  "900": "900",
} as const satisfies Record<string, Weight>;

function isListed(weight: string): weight is keyof typeof BOLDER {
  return Object.hasOwn(BOLDER, weight);
}

/** A weight a step heavier, or as it stands where the table names it not. */
function bolder(weight: Weight): Weight {
  const key = String(weight);

  return isListed(key) ? BOLDER[key] : weight;
}

/** The face and weight a Text's words are drawn in, which a Text inside it takes where it names none of its own. */
type Drawn = { readonly family: string; readonly weight: Weight };

/** What the Text around this one draws in, or nothing for a Text that leads its words. */
const AROUND = createContext<Drawn | undefined>(undefined);

/**
 * React Native's Text in the app's face. A Text that leads its words stands
 * in Geist at regular unless its style names a face or a weight, such as
 * code's Geist Mono, and one inside it takes the face and weight around it
 * unless it names its own. Each Text sets both on itself rather than leave
 * them to React Native's inheritance, because a View inside a line of words,
 * such as a mention's chip, starts React Native's anew, and the chip's label
 * would stand in the system's face. Under Bold Text, a weight a Text names,
 * or a leading Text's regular, is set a step heavier (`BOLDER`), so a strong
 * run in stepped words still stands out of them. Note that an embedded face
 * does not thicken under Bold Text on its own, as the system's does.
 */
export function NativeText({ style, ...props }: ComponentProps<typeof ReactNativeText>) {
  const around = useContext(AROUND);
  const bold = useBoldText();
  const flat: TextStyle = StyleSheet.flatten(style) ?? {};
  const named = flat.fontWeight ?? (around === undefined ? "400" : undefined);

  const drawn: Drawn = {
    family: flat.fontFamily ?? around?.family ?? TEXT_FONT,
    weight: named === undefined ? (around?.weight ?? "400") : bold ? bolder(named) : named,
  };

  return (
    <AROUND.Provider value={drawn}>
      <ReactNativeText
        {...props}
        style={[style, { fontFamily: drawn.family, fontWeight: drawn.weight }]}
      />
    </AROUND.Provider>
  );
}
