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

/** Whether a Text stands inside another, whose face and weight it inherits unless it names its own. */
const NESTED = createContext(false);

/**
 * React Native's Text in the app's face. A Text that leads its words stands
 * in Geist unless its style names a face, such as code's Geist Mono, and a
 * nested one inherits it; under Bold Text, a weight it names, or a leading
 * Text's regular, is set a step heavier (`BOLDER`), so a strong run nested in
 * stepped words still stands out of them. Note that an embedded face does
 * not thicken under Bold Text on its own, as the system's does.
 */
export function NativeText({ style, ...props }: ComponentProps<typeof ReactNativeText>) {
  const nested = useContext(NESTED);
  const bold = useBoldText();
  const flat: TextStyle = StyleSheet.flatten(style) ?? {};
  const named = flat.fontWeight ?? (nested ? undefined : "400");

  const face: TextStyle = {
    ...(!nested && flat.fontFamily === undefined && { fontFamily: TEXT_FONT }),
    ...(bold && named !== undefined && { fontWeight: bolder(named) }),
  };

  return (
    <NESTED.Provider value>
      <ReactNativeText {...props} style={[style, face]} />
    </NESTED.Provider>
  );
}
