// host.tsx -- the package's one SwiftUI host: `@expo/ui`'s, built anew when Bold Text changes, so every word `font` set stands at the weight the setting asks.

import { Host as ExpoHost, type HostProps } from "@expo/ui/swift-ui";
import { Fragment } from "react";
import { useBoldText } from "./accessibility.js";

/** The key a host's content is built under, by Bold Text. */
const WEIGHT_KEY = { REGULAR: "regular", BOLD: "bold" } as const;

/**
 * `@expo/ui`'s Host, as every view of this package hosts SwiftUI. Note that
 * its content is keyed by Bold Text, because `font` reads the setting as it
 * builds a modifier, outside a hook, and a view whose props did not change
 * is never built again: a new key builds the content anew, so its words
 * thicken or thin as the setting changes, and once its first read answers.
 * A change rebuilds what the host holds, such as a list's scroll, which a
 * change made in Settings, away from the app, rarely meets.
 */
export function Host({ children, ...props }: HostProps) {
  const bold = useBoldText();

  return (
    <ExpoHost {...props}>
      <Fragment key={bold ? WEIGHT_KEY.BOLD : WEIGHT_KEY.REGULAR}>{children}</Fragment>
    </ExpoHost>
  );
}
