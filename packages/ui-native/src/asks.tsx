// asks.tsx -- the questions an act asks first, as the system asks them: one a row's act raises standing by that row, UIKit's own action sheet rising from the screen's foot in a compact window, its alert in a regular one, SwiftUI's alert where words must be typed, and the alert that asks for words, such as a rename or an address.

import {
  Alert,
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
import {
  type ReactElement,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ActionSheetIOS, type ActionSheetIOSOptions, Alert as SystemAlert } from "react-native";
import { WORDS_KIND, type WordsKind } from "./system-asks.js";
import { useWindowSizeClass } from "./use-window-size-class.js";
import { WINDOW_SIZE_CLASS } from "./window-size-class.js";

/** What an act that asks first offers beside its act, and the role the system draws it in. */
const CANCEL = { LABEL: "Cancel", ROLE: "cancel" } as const;

/** The role the system draws an act that takes something away in: red. */
const DESTRUCTIVE_ROLE = "destructive";

/** Where an ask's host stands: the size of nothing, so a screen draws it beside whatever it shows. */
const NO_SIZE = { position: "absolute" } as const;

/** Where an action sheet's act and Cancel stand among its buttons: the act first, as iOS leads with it. */
const SHEET_BUTTON = { ACT: 0, CANCEL: 1 } as const;

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
function HiddenTrigger(): ReactNode {
  return <Text modifiers={[frame({ width: 0, height: 0 })]}>{""}</Text>;
}

/** The ask whose act is gated by typed words, as SwiftUI's alert: its question, what it costs, the gate's field, Cancel, and its act, dimmed until the gate's words are typed, which UIKit's own alert can't do from React Native. */
function GatedConfirm({
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
          <HiddenTrigger />
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

/**
 * The ask as UIKit's own question, raised as it's presented: in a compact
 * window an action sheet from the screen's foot, its act first, red where
 * it takes something away, and the system's own Cancel; in a regular one an
 * alert with Cancel and its act. Note that it's raised once each time
 * `presented` turns true, and that an answer coming after the caller let
 * the question go, after the ask unmounted, or to an earlier question acts
 * on nothing, since UIKit's question can't be taken down from React Native.
 */
function SystemConfirm({
  title,
  message,
  act,
  destructive = false,
  presented,
  onAct,
  onDismiss,
  compact,
}: ConfirmAskProps & { readonly compact: boolean }) {
  // The newest answers, which an answer reads as it lands.
  const live = useRef({ onAct, onDismiss });
  useEffect(() => {
    live.current = { onAct, onDismiss };
  });
  // The question raised and still answerable, by its own token: none once `presented` turns false or the ask unmounts, so a second run of the effect never raises it twice, and an answer to an earlier question, or one landing after the ask went, acts on nothing.
  const standing = useRef<symbol | undefined>(undefined);

  // Note that the token is let go during the commit that lets the question go or unmounts the ask, in a layout effect, so no native answer landing before the passive effects run can still act.
  useLayoutEffect(() => {
    if (!presented) standing.current = undefined;

    return () => {
      standing.current = undefined;
    };
  }, [presented]);

  useEffect(() => {
    if (!presented || standing.current !== undefined) return;

    const raise = Symbol("raise");
    standing.current = raise;

    const answer = (acted: boolean) => {
      if (standing.current !== raise) return;

      const now = live.current;

      if (acted) now.onAct();

      now.onDismiss();
    };

    if (compact) {
      // Note that a sheet with nothing taken away names no button red, the act standing first in the system's own ink.
      const sheet: ActionSheetIOSOptions = {
        title,
        message,
        options: [act, CANCEL.LABEL],
        cancelButtonIndex: SHEET_BUTTON.CANCEL,
        destructiveButtonIndex: destructive ? SHEET_BUTTON.ACT : [],
      };

      ActionSheetIOS.showActionSheetWithOptions(sheet, (index) =>
        answer(index === SHEET_BUTTON.ACT),
      );

      return;
    }

    SystemAlert.alert(title, message, [
      { text: CANCEL.LABEL, style: CANCEL.ROLE, onPress: () => answer(false) },
      {
        text: act,
        style: destructive ? DESTRUCTIVE_ROLE : "default",
        isPreferred: true,
        onPress: () => answer(true),
      },
    ]);
  }, [presented, compact, title, message, act, destructive]);

  return null;
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
 * own iPad asks with no source do. Both are UIKit's own, raised through
 * React Native (`Alert.alert`, `ActionSheetIOS`), with no view of ours;
 * only an ask gated by typed words stands as SwiftUI's alert, in a host of
 * its own, so a screen draws it beside whatever it shows: beside its
 * `Screen`, never inside that host, where an ask once took every press and
 * key on the screen.
 */
export function ConfirmAsk(props: ConfirmAskProps) {
  const compact = useWindowSizeClass() === WINDOW_SIZE_CLASS.COMPACT;

  return props.gate === undefined ? (
    <SystemConfirm {...props} compact={compact} />
  ) : (
    <GatedConfirm {...props} />
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
 * A row's content with the question its own acts ask first, such as a
 * task's Permanently delete or an agent's Archive, raised as `ConfirmAsk`
 * raises a screen's: UIKit's own action sheet from the screen's foot in a
 * compact window, and its alert in a regular one. Note that it's UIKit's
 * rather than SwiftUI's confirmation dialog from the row, because SwiftUI
 * presents only from a key window, and React Native's alerts (a rename's,
 * every `ConfirmAsk`) stand in a window of their own that leaves the app's
 * window unkeyed once they close, so a row's dialog raised after one never
 * showed (tasks.yaml, on main, Nov 17); UIKit's question stands in its own
 * window too, and needs no wait for a long press menu to go. An iPad's
 * question stands as the centered alert rather than a popover from its
 * row, since a row is SwiftUI's and has no React Native view to anchor to.
 */
export function RowAsking({
  question,
  children,
}: {
  readonly question: RowQuestion;
  readonly children: ReactElement;
}): ReactElement {
  const compact = useWindowSizeClass() === WINDOW_SIZE_CLASS.COMPACT;

  return (
    <>
      {children}
      <SystemConfirm
        title={question.title}
        message={question.message}
        act={question.act}
        destructive
        presented={question.presented}
        onAct={question.onAct}
        onDismiss={question.onDismiss}
        compact={compact}
      />
    </>
  );
}
