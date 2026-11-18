// system-asks.ts -- the system's own sheets a screen raises from a press: the alert that asks for words, such as a name as Files and Notes rename or an address, and the share sheet a link or words are copied or sent from.

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

/** What a typed answer is, which picks the keyboard its field raises. */
export const WORDS_KIND = {
  /** A name, such as a rename's. */
  NAME: "name",
  /** An email address, on the address keyboard. */
  EMAIL: "email",
} as const;

export type WordsKind = (typeof WORDS_KIND)[keyof typeof WORDS_KIND];

/** Each kind's keyboard, as UIKit's alert names it. */
const KEYBOARD = {
  [WORDS_KIND.NAME]: "default",
  [WORDS_KIND.EMAIL]: "email-address",
} as const satisfies Record<WordsKind, string>;

/** One act beside Cancel, handed the words typed, trimmed and never blank. */
export interface WordsAct {
  readonly label: string;
  readonly onWords: (words: string) => void;
}

/** What the words alert asks: its question, what it explains, the words its field opens on, what they are, and its acts. */
export interface WordsAsk {
  readonly title: string;
  readonly message?: string | undefined;
  readonly initial?: string | undefined;
  readonly kind: WordsKind;
  /** Its acts, the last the one Return presses. */
  readonly acts: readonly WordsAct[];
}

/**
 * Asks for words in the system's alert with a text field, Cancel and its
 * acts, as iOS renames a file or asks for an address. An act pressed with
 * nothing typed does nothing, as the alert can't dim it. Note that it is
 * UIKit's alert rather than SwiftUI's, because SwiftUI's alert takes a
 * field only as a direct child of its actions, which `@expo/ui`'s slot
 * cannot promise; UIKit's stands centered over whatever raised it, a menu
 * dismissed among it.
 */
export function askForWords({ title, message, initial = "", kind, acts }: WordsAsk): void {
  Alert.prompt(
    title,
    message,
    [
      { text: CANCEL.LABEL, style: CANCEL.STYLE },
      ...acts.map((act, at) => ({
        text: act.label,
        isPreferred: at === acts.length - 1,
        onPress: (typed?: string) => {
          const kept = typed?.trim() ?? "";

          if (kept !== "") act.onWords(kept);
        },
      })),
    ],
    "plain-text",
    initial,
    KEYBOARD[kind],
  );
}

/** Asks for a name as `askForWords` does, opened on the name it has, and renames only to a name that differs from it. */
export function askForName({ title, act, name, onName }: NameAsk): void {
  askForWords({
    title,
    initial: name,
    kind: WORDS_KIND.NAME,
    acts: [
      {
        label: act,
        onWords: (typed) => {
          if (typed !== name.trim()) onName(typed);
        },
      },
    ],
  });
}

/**
 * Raises the system's share sheet on words, such as a transcript copied as
 * Markdown, which it sends as text to Messages, Mail, Notes or a file. Note
 * that a sheet put away answers nothing, and a sheet that could not stand
 * rejects, so the caller can say so where its press shows a failure.
 */
export function shareWords(message: string): Promise<void> {
  return Share.share({ message }).then(() => undefined);
}
