// asks.tsx -- the questions an act asks first, as the system asks them: an action sheet rising from the screen's foot in a compact window, an alert in a regular one or where words must be typed, and the alert that asks for words, such as a rename or an address.

import {
  Alert,
  ConfirmationDialog,
  Host,
  Button as SwiftUIButton,
  Text,
  TextField,
  useNativeState,
} from "@expo/ui/swift-ui";
import {
  autocorrectionDisabled,
  disabled,
  frame,
  keyboardType,
  textInputAutocapitalization,
} from "@expo/ui/swift-ui/modifiers";
import { type ReactNode, useEffect, useState } from "react";
import { useWindowSizeClass } from "./use-window-size-class.js";
import { WINDOW_SIZE_CLASS } from "./window-size-class.js";

/** What an act that asks first offers beside its act, and the role the system draws it in. */
const CANCEL = { LABEL: "Cancel", ROLE: "cancel" } as const;

/** A width past any window's, so the sheet's anchor fills the screen's foot whatever its width. */
const FULL_WIDTH = 10_000;

/** Where an ask's host stands: the size of nothing, so a screen draws it beside whatever it shows. */
const NO_SIZE = { position: "absolute" } as const;

/** Where an action sheet's host stands: along the screen's foot, so the sheet rises from there. */
const FOOT = { position: "absolute", left: 0, right: 0, bottom: 0, height: 1 } as const;

type ConfirmAskProps = {
  /** The question, as the panel's confirm asks it: "Remove from the merge queue?" */
  readonly title: string;
  /** What the act costs, under the question. */
  readonly message?: string | undefined;
  /** The act's own words, beside Cancel. */
  readonly act: string;
  /** Whether the act ends or takes away something, which the system draws red. */
  readonly destructive?: boolean | undefined;
  /**
   * Words the person types before the act can be pressed, such as the
   * account's address before Delete account, as the panel's confirm gates
   * an act that cannot be undone.
   */
  readonly gate?: string | undefined;
  readonly presented: boolean;
  readonly onAct: () => void;
  /** Called as the ask goes, by its act or Cancel. */
  readonly onDismiss: () => void;
};

/** An ask's trigger, which a screen never sees: the ask is presented by its `presented`, from a press anywhere. */
function HiddenTrigger({ wide }: { readonly wide: boolean }): ReactNode {
  return (
    <Text
      modifiers={[
        wide ? frame({ maxWidth: FULL_WIDTH, maxHeight: 0 }) : frame({ width: 0, height: 0 }),
      ]}
    >
      {""}
    </Text>
  );
}

/** The ask as the system's alert: its question, what it costs, the typed gate's field, Cancel, and its act, dimmed until the gate's words are typed. */
function AlertConfirm({
  title,
  message,
  act,
  destructive = false,
  gate,
  presented,
  onAct,
  onDismiss,
}: ConfirmAskProps) {
  const typed = useNativeState("");
  const [words, setWords] = useState("");
  // Note that the field is emptied each time the alert opens, so every ask is typed afresh and none is let through by an earlier one's words.
  useEffect(() => {
    if (!presented) return;
    typed.value = "";
    setWords("");
  }, [presented, typed]);
  const shut = gate !== undefined && words !== gate;

  return (
    <Host matchContents style={NO_SIZE}>
      <Alert
        title={title}
        isPresented={presented}
        onIsPresentedChange={(shown) => {
          if (!shown) onDismiss();
        }}
      >
        <Alert.Trigger>
          <HiddenTrigger wide={false} />
        </Alert.Trigger>
        <Alert.Actions>
          {gate === undefined ? null : (
            <TextField
              text={typed}
              placeholder={gate}
              onTextChange={setWords}
              modifiers={[autocorrectionDisabled(), textInputAutocapitalization("never")]}
            />
          )}
          <SwiftUIButton label={CANCEL.LABEL} role={CANCEL.ROLE} onPress={onDismiss} />
          <SwiftUIButton
            label={act}
            role={destructive ? "destructive" : "default"}
            onPress={onAct}
            modifiers={[disabled(shut)]}
          />
        </Alert.Actions>
        {message === undefined ? null : (
          <Alert.Message>
            <Text>{message}</Text>
          </Alert.Message>
        )}
      </Alert>
    </Host>
  );
}

/** The ask as the system's action sheet, rising from the screen's foot: its question and what it costs, its act first, and the system's own Cancel. */
function SheetConfirm({
  title,
  message,
  act,
  destructive = false,
  presented,
  onAct,
  onDismiss,
}: ConfirmAskProps) {
  return (
    <Host style={FOOT}>
      <ConfirmationDialog
        title={title}
        titleVisibility="visible"
        isPresented={presented}
        onIsPresentedChange={(shown) => {
          if (!shown) onDismiss();
        }}
      >
        <ConfirmationDialog.Trigger>
          <HiddenTrigger wide />
        </ConfirmationDialog.Trigger>
        <ConfirmationDialog.Actions>
          <SwiftUIButton
            label={act}
            role={destructive ? "destructive" : "default"}
            onPress={onAct}
          />
          <SwiftUIButton label={CANCEL.LABEL} role={CANCEL.ROLE} onPress={onDismiss} />
        </ConfirmationDialog.Actions>
        {message === undefined ? null : (
          <ConfirmationDialog.Message>
            <Text>{message}</Text>
          </ConfirmationDialog.Message>
        )}
      </ConfirmationDialog>
    </Host>
  );
}

/**
 * The question an act asks first, as iOS asks it. In a compact window it's
 * the system's action sheet, rising from the screen's foot whatever pressed
 * the act, a bar button, a menu or a row, its act first and red where it
 * takes something away, and the system's own Cancel. In a regular window,
 * and wherever words must be typed first, it's the system's alert, since an
 * iPad draws an action sheet as a popover from the view that presents it,
 * and the act is pressed in a bar, a menu or the menu bar, which no view of
 * ours stands on; an alert stands centered whatever presents it, as Apple's
 * own iPad asks with no source do. It stands in a host of its own, so a
 * screen draws it beside whatever it shows: beside its `Screen`, never
 * inside that host, where an ask once took every press and key on the
 * screen.
 */
export function ConfirmAsk(props: ConfirmAskProps) {
  const compact = useWindowSizeClass() === WINDOW_SIZE_CLASS.COMPACT;

  return compact && props.gate === undefined ? (
    <SheetConfirm {...props} />
  ) : (
    <AlertConfirm {...props} />
  );
}

/** What a `WordsAsk` field takes, and the keyboard it raises for it. */
export const WORDS_ASK_KIND = {
  /** A name, such as a rename's, its first word capitalized and corrected as Files' rename does. */
  NAME: "name",
  /** An email address, on the address keyboard, with nothing capitalized or corrected. */
  EMAIL: "email",
} as const;

export type WordsAskKind = (typeof WORDS_ASK_KIND)[keyof typeof WORDS_ASK_KIND];

/** One of a `WordsAsk`'s acts beside Cancel, handed the words typed. */
export interface WordsAskAct {
  readonly label: string;
  readonly onAct: (words: string) => void;
}

type WordsAskProps = {
  readonly title: string;
  readonly message?: string | undefined;
  readonly placeholder: string;
  /** The words the field holds as the alert opens, such as the name a rename starts from. */
  readonly initial?: string | undefined;
  readonly kind: WordsAskKind;
  /** Its acts, the last the one Return presses; each dimmed while the field is empty. */
  readonly acts: readonly WordsAskAct[];
  readonly presented: boolean;
  /** Called as the alert goes, by an act or Cancel. */
  readonly onDismiss: () => void;
};

/**
 * Words asked for in the system's alert, as iOS asks a rename or an
 * address, as Files and Notes rename a folder: its field, Cancel, and its
 * acts, each dimmed until something is typed. The field starts from
 * `initial` each time the alert opens. It stands in a host of its own, the
 * size of nothing, as `ConfirmAsk` does.
 */
export function WordsAsk({
  title,
  message,
  placeholder,
  initial = "",
  kind,
  acts,
  presented,
  onDismiss,
}: WordsAskProps) {
  const typed = useNativeState(initial);
  const [words, setWords] = useState(initial);
  useEffect(() => {
    if (!presented) return;
    typed.value = initial;
    setWords(initial);
  }, [presented, initial, typed]);
  const empty = words.trim().length === 0;

  const field =
    kind === WORDS_ASK_KIND.EMAIL
      ? [
          keyboardType("email-address"),
          autocorrectionDisabled(),
          textInputAutocapitalization("never"),
        ]
      : [textInputAutocapitalization("sentences")];

  return (
    <Host matchContents style={NO_SIZE}>
      <Alert
        title={title}
        isPresented={presented}
        onIsPresentedChange={(shown) => {
          if (!shown) onDismiss();
        }}
      >
        <Alert.Trigger>
          <HiddenTrigger wide={false} />
        </Alert.Trigger>
        <Alert.Actions>
          <TextField
            text={typed}
            placeholder={placeholder}
            onTextChange={setWords}
            modifiers={field}
          />
          <SwiftUIButton label={CANCEL.LABEL} role={CANCEL.ROLE} onPress={onDismiss} />
          {acts.map((act) => (
            <SwiftUIButton
              key={act.label}
              label={act.label}
              onPress={() => act.onAct(words.trim())}
              modifiers={[disabled(empty)]}
            />
          ))}
        </Alert.Actions>
        {message === undefined ? null : (
          <Alert.Message>
            <Text>{message}</Text>
          </Alert.Message>
        )}
      </Alert>
    </Host>
  );
}
