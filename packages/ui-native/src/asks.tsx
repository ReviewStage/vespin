// asks.tsx -- the questions an act asks first, as the system asks them: one a row's act raises standing by that row, UIKit's own action sheet rising from the screen's foot in a compact window, its alert in a regular one, SwiftUI's alert where words must be typed, and the alert that asks for words, such as a rename or an address.

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

/** Where an action sheet's act stands among its buttons: first, as iOS leads with it, its second act, where it offers one, after it, and Cancel last. */
const SHEET_BUTTON = { ACT: 0, SECOND: 1 } as const;

/** A second act an ask offers beside its first, such as Save draft beside Discard draft, as Mail's compose asks. */
type SecondAct = {
  readonly label: string;
  readonly onPress: () => void;
};

type ConfirmAskProps = {
  /** The question, as the panel's confirm asks it: "Remove from the merge queue?"; none where the acts say it alone, as Mail's Discard Draft and Save Draft do. Note that a gated ask always asks one. */
  readonly title?: string | undefined;
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
  /** A second act beside the first, in the system's own ink, such as Save draft beside Discard draft; none where the ask offers one act. Note that a gated ask takes none. */
  readonly second?: SecondAct | undefined;
  readonly presented: boolean;
  readonly onAct: () => void;
  /** Called as the ask goes, by either act or Cancel. */
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
        title={title ?? ""}
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
 * it takes something away, then its second act where it offers one, and the
 * system's own Cancel; in a regular one an alert with Cancel and its acts. Note that it's raised once each time
 * `presented` turns true, and that an answer coming after the caller let
 * the question go, after the ask unmounted, or to an earlier question acts
 * on nothing, since UIKit's question can't be taken down from React Native.
 */
function SystemConfirm({
  title,
  message,
  act,
  destructive = false,
  second,
  presented,
  onAct,
  onDismiss,
  compact,
}: ConfirmAskProps & { readonly compact: boolean }) {
  // The newest answers, which an answer reads as it lands.
  const live = useRef({ onAct, onDismiss, onSecond: second?.onPress });
  useEffect(() => {
    live.current = { onAct, onDismiss, onSecond: second?.onPress };
  });
  const secondLabel = second?.label;
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

    const answer = (picked: number | undefined) => {
      if (standing.current !== raise) return;

      const now = live.current;

      if (picked === SHEET_BUTTON.ACT) now.onAct();

      if (picked === SHEET_BUTTON.SECOND) now.onSecond?.();

      now.onDismiss();
    };

    if (compact) {
      // Note that a sheet with nothing taken away names no button red, the act standing first in the system's own ink.
      const options = secondLabel === undefined ? [act] : [act, secondLabel];

      const sheet: ActionSheetIOSOptions = {
        title,
        message,
        options: [...options, CANCEL.LABEL],
        cancelButtonIndex: options.length,
        destructiveButtonIndex: destructive ? SHEET_BUTTON.ACT : [],
      };

      ActionSheetIOS.showActionSheetWithOptions(sheet, answer);

      return;
    }

    SystemAlert.alert(title ?? "", message, [
      { text: CANCEL.LABEL, style: CANCEL.ROLE, onPress: () => answer(undefined) },
      {
        text: act,
        style: destructive ? DESTRUCTIVE_ROLE : "default",
        isPreferred: secondLabel === undefined,
        onPress: () => answer(SHEET_BUTTON.ACT),
      },
      ...(secondLabel === undefined
        ? []
        : [{ text: secondLabel, isPreferred: true, onPress: () => answer(SHEET_BUTTON.SECOND) }]),
    ]);
  }, [presented, compact, title, message, act, destructive, secondLabel]);

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
    <AskedGatedConfirm {...props} />
  );
}

/**
 * A gated ask, drawn from the first time it is asked and kept after, so its
 * alert's host is built as the person asks rather than as the page that
 * offers it opens. Note that it isn't drawn before, because building the
 * host and its field took Workspace settings' first open some 0.4 to 1.5 s
 * on an iPhone simulator, for an ask most opens never make.
 */
function AskedGatedConfirm(props: ConfirmAskProps) {
  const [asked, setAsked] = useState(props.presented);

  // Note that the ask is marked asked as it renders, React's way of keeping what an earlier render saw, so its first presented render already draws it.
  if (props.presented && !asked) setAsked(true);

  return asked ? <GatedConfirm {...props} /> : null;
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
