// system-asks.ts -- the system's own sheets a screen raises from a press: the alert that asks for a name, as Files and Notes rename, and the share sheet a link is copied or sent from.

import { Alert, Share } from "react-native";

/** What the name alert offers beside its act, and the role the system draws it in. */
const CANCEL = { LABEL: "Cancel", STYLE: "cancel" } as const;

/** What the name alert asks: its question, the act that keeps the name, and the name it opens on. */
export interface NameAsk {
  /** The question, as the panel's menu names the act: "Rename task". */
  readonly title: string;
  /** The act's own words, beside Cancel. */
  readonly act: string;
  /** The name the field opens on, selected for typing over. */
  readonly name: string;
  /** Called with the name typed, trimmed, once the act is pressed on a name that is not blank and not the one it opened on. */
  readonly onName: (name: string) => void;
}

/**
 * Asks for a name in the system's alert with a text field, Cancel and the
 * act beside it, as iOS renames a file or a folder. Note that it is
 * UIKit's alert rather than SwiftUI's, because SwiftUI's alert takes a
 * field only as a direct child of its actions, which `@expo/ui`'s slot
 * cannot promise; UIKit's stands centered over whatever raised it, a menu
 * dismissed among it.
 */
export function askForName({ title, act, name, onName }: NameAsk): void {
  Alert.prompt(
    title,
    undefined,
    [
      { text: CANCEL.LABEL, style: CANCEL.STYLE },
      {
        text: act,
        isPreferred: true,
        onPress: (typed) => {
          const kept = typed?.trim() ?? "";

          if (kept !== "" && kept !== name.trim()) onName(kept);
        },
      },
    ],
    "plain-text",
    name,
  );
}

/**
 * Raises the system's share sheet on a link, whose first row copies it, so
 * Copy link copies and sends a link as iOS does everywhere else. Note that
 * a sheet put away answers nothing, and a sheet that could not stand is said
 * on the console, since the press had nothing else to show.
 */
export function shareLink(url: string): void {
  Share.share({ url }).catch((cause: unknown) => {
    console.error("The share sheet did not open.", cause);
  });
}
