// asks.tsx -- the questions an act asks first, as the system asks them: one a row's act raises standing by that row, an action sheet rising from the screen's foot in a compact window, an alert in a regular one or where words must be typed, and the alert that asks for words, such as a rename or an address.

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
import { type ReactElement, type ReactNode, useEffect, useState } from "react";
import { WORDS_KIND, type WordsKind } from "./system-asks.js";
import { useWindowSizeClass } from "./use-window-size-class.js";
import { WINDOW_SIZE_CLASS } from "./window-size-class.js";

/** What an act that asks first offers beside its act, and the role the system draws it in. */
const CANCEL = { LABEL: "Cancel", ROLE: "cancel" } as const;

/** The role the system draws an act that takes something away in: red. */
const DESTRUCTIVE_ROLE = "destructive";

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
  /** What the gate's words are, which picks the keyboard its field raises, such as the address keyboard for an account's address. */
  readonly gateKind?: WordsKind | undefined;
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
  gateKind = WORDS_KIND.NAME,
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
              modifiers={[
                ...(gateKind === WORDS_KIND.EMAIL ? [keyboardType("email-address")] : []),
                autocorrectionDisabled(),
                textInputAutocapitalization("never"),
              ]}
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

/** A question a row's own act asks first, such as a task's Permanently delete or an agent's Archive, which stands by that row. */
export interface RowQuestion {
  readonly title: string;
  readonly message?: string | undefined;
  readonly act: string;
  readonly presented: boolean;
  readonly onAct: () => void;
  /** Called as the question goes, by its act, Cancel, or a tap outside it. */
  readonly onDismiss: () => void;
}

/** What a row that asks nothing now stands by: no question, never shown. */
export const QUIET_ROW_QUESTION: RowQuestion = {
  title: "",
  act: "",
  presented: false,
  onAct: () => undefined,
  onDismiss: () => undefined,
};

/** One drawn row, which a question its acts raise names, so the question stands by that row and not by another drawing the same task, as Pinned and its section both do. */
export interface RowAsker {
  readonly row: symbol;
}

/** The drawn row a question its acts raise names, the same for as long as the row stands. */
export function useRowAsker(): RowAsker {
  const [asker] = useState<RowAsker>(() => ({ row: Symbol("row") }));

  return asker;
}

/**
 * A row's content with the question its own acts ask first standing by it,
 * as iOS 26 stands a confirmation from the view that raised it: SwiftUI's
 * confirmation dialog with the row as its source, its glass by the row on
 * an iPhone and a popover from it on an iPad, its act red, and Cancel or a
 * tap outside letting it go. Note that it stands around every row that can
 * ask, asking or not, because wrapping a row only as it asks would draw
 * its long press menu anew as the menu went, and a question raised from a
 * screen's foot pointed at the tab bar rather than at the row it is about.
 * It stands inside the row's own SwiftUI tree, never beside a `Screen`.
 */
export function RowAsking({
  question,
  children,
}: {
  readonly question: RowQuestion;
  readonly children: ReactElement;
}): ReactElement {
  return (
    <ConfirmationDialog
      title={question.title}
      titleVisibility="visible"
      isPresented={question.presented}
      onIsPresentedChange={(shown) => {
        if (!shown) question.onDismiss();
      }}
    >
      <ConfirmationDialog.Trigger>{children}</ConfirmationDialog.Trigger>
      <ConfirmationDialog.Actions>
        <SwiftUIButton label={question.act} role={DESTRUCTIVE_ROLE} onPress={question.onAct} />
        <SwiftUIButton label={CANCEL.LABEL} role={CANCEL.ROLE} onPress={question.onDismiss} />
      </ConfirmationDialog.Actions>
      {question.message === undefined ? null : (
        <ConfirmationDialog.Message>
          <Text>{question.message}</Text>
        </ConfirmationDialog.Message>
      )}
    </ConfirmationDialog>
  );
}
