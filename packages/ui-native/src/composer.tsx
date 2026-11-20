// composer.tsx -- the rounded glass field at a thread's or a transcript's foot: a + on the left, one act or a menu, the field, and Send, Stop, or Talk on the right, in a React Native bar or a SwiftUI column's foot.

import {
  Button,
  Divider,
  HStack,
  Image,
  Menu,
  ProgressView,
  ScrollView,
  Spacer,
  Text,
  TextField,
  type TextFieldRef,
  type TextFieldSelection,
  Toggle,
  useNativeState,
  VStack,
} from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityIdentifier,
  accessibilityLabel,
  background,
  buttonStyle,
  disabled,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  opacity,
  padding,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { longPasteIn } from "@repo/features/long-paste";
import { TALK_LABEL } from "@repo/features/voice-call-words";
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from "react";
import { useAccessibilitySize, useScaledSize } from "./accessibility.js";
import { COMPOSER_CALL, type ComposerCall, ComposerCallPresses } from "./call.js";
import {
  BAR_EDGE,
  BAR_GLASS,
  BAR_MARGIN,
  BAR_ROW_SPACING,
  BarHead,
  GlassBar,
} from "./glass-bar.js";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
import { actContent } from "./glyph-label.js";
import { dropPictures } from "./interactions.js";
import { type BarMenu, BarMenuButton } from "./split-view.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, PRESS_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** The send button's round, in points. */
const SEND_SIZE = 32;

/**
 * A press's frame in the composer's row: Apple's least target, its mark
 * centered in it. The bar's edge is thin (`BAR_EDGE`) by as much as the frame
 * stands past its mark, so the bar draws as it did with its marks alone.
 * Note that a plain mark's button wears it on its label, never on the button,
 * so the whole frame takes the press: a borderless button or a menu answers
 * only where its label is hit. The round button wears it on itself, for its
 * place in the row alone, since its press is its circle's, as the system's is.
 */
const PRESS_FRAME = [
  frame({ minWidth: PRESS_SIZE, minHeight: PRESS_SIZE }),
  SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
];

/** How far the round button's circle stands past the mark inside it, on each axis, in points. */
const ROUND_EDGE = 12;

/** The mark inside the round button, centered in the circle's own size less its edge, so the system's circle draws at Send's size around it. */
function roundMark(round: number) {
  return [frame({ width: round - ROUND_EDGE, height: round - ROUND_EDGE })];
}

/** How much of Send's look stands while there is nothing to send, as Messages' gray arrow stands before a word is typed. */
const IDLE_OPACITY = 0.2;

/** The round button's look: the system's prominent circle in the ink, its mark in the ground, inside the composer's press frame. */
function roundModifiers(colors: ReturnType<typeof useColors>) {
  return [
    buttonStyle("borderedProminent"),
    SwiftModifiers.buttonBorderShape("circle"),
    tint(colors.TEXT),
    foregroundStyle(colors.GROUND),
    ...PRESS_FRAME,
  ];
}

/**
 * Send with nothing to send: the same circle and mark, faint, so it reads as
 * one button waiting in either scheme. Note that we draw the circle
 * ourselves, because a disabled prominent button drops its tint for the
 * system's own fill, which in light vanished into the composer's ground and
 * in dark stood as a black disc that read as a live button.
 */
function idleRoundModifiers(colors: ReturnType<typeof useColors>, round: number) {
  return [
    buttonStyle("plain"),
    foregroundStyle(colors.GROUND),
    frame({ width: round, height: round }),
    background(colors.TEXT, SwiftModifiers.shapes.circle()),
    opacity(IDLE_OPACITY),
    ...PRESS_FRAME,
  ];
}

/** How far the field's words stand from the bar's edge above and below, its own room inside the thin edge. */
const FIELD_INSET = SPACE.TIGHT * 2 - BAR_EDGE;

/** How far the field stands in from the bar's leading edge where no + leads it. */
const FIELD_LEADING = SPACE.ROW + 4 - BAR_EDGE;

/** How far the field's words stand from Send's frame, which stands its round in by less than the row's spacing did. */
const FIELD_TRAILING = SPACE.TIGHT;

/** The most lines the field grows to before it scrolls its words; fewer at an accessibility size, where six of its lines with the keyboard up left the transcript over it no room. */
const FIELD_LINES = { REGULAR: 6, LARGE: 3 } as const;

/** What the + is named by, whether it opens one act or a menu. */
export const ADD_LABEL = "Add";

/**
 * What the + offers where it opens a menu rather than one act, in the
 * menu's order from the +: its acts, such as Photos and Options, then the
 * choices within it, such as Permissions, each a menu of its own with the
 * one on checked, then its switches, such as Fast.
 */
export type ComposerMenu = {
  readonly actions: readonly {
    readonly label: string;
    readonly symbol: Glyph;
    readonly onPress: () => void;
  }[];
  readonly submenus?: readonly BarMenu[] | undefined;
  readonly switches?: BarMenu["choices"] | undefined;
};

type ComposerProps = {
  /** What the field says before anything is typed: "Reply", "Add a note". */
  readonly placeholder: string;
  /** The words in the field, where its holder keeps them, such as a thread's draft that outlives its screen; the field keeps its own where none are given. */
  readonly words?: string | undefined;
  /** Called with the words as they are typed. */
  readonly onWords?: ((words: string) => void) | undefined;
  /** Whether Send stands lit with no words typed, as it does once an ask's answer is picked. */
  readonly sendable?: boolean | undefined;
  /** Called with the words typed once Send is pressed; Send stands disabled where none is given. */
  readonly onSend?: ((words: string) => void) | undefined;
  /** What Send stands for while the field is empty and `sendable`, where that is an act of its own rather than a message, such as a notice's Got it: its glyph on the same round and its name; Send's own once a word is typed. */
  readonly sendAs?: ComposerSendAs | undefined;
  /** Opens what the + adds, such as a picture; the + is not drawn where neither this nor `addMenu` is given. */
  readonly onAdd?: (() => void) | undefined;
  /** What the + opens as a menu in place of `onAdd`'s one act, such as an agent's Photos, Permissions, and Fast. */
  readonly addMenu?: ComposerMenu | undefined;
  /** What the composer offers of a voice call into its agent: Talk in Send's place while the field holds nothing to send and no Stop stands, or the call's presses before Send while the call stands; none where it calls no one. */
  readonly call?: ComposerCall | undefined;
  /** Stops the turn under way, drawn as Stop in Send's place while the field is empty, as the panel's box offers it while its agent works. */
  readonly onStop?: (() => void) | undefined;
  /** Whether a Stop is out, which stands as the system's spinner in Stop's place until the agent stops. */
  readonly stopping?: boolean | undefined;
  /** What stands over the field inside the same glass: the pictures attached, and what a send that did not go said. */
  readonly head?: ReactNode;
  /** SwiftUI standing over the composer in a glass of its own, as the panel stands an agent's queue over its box: the messages queued behind the turn. */
  readonly above?: ReactNode;
  /** A queued message's words being edited in the field: Send stands as Save, and, where it may steer, held it offers Steer, as the panel's held Send steers an edit. */
  readonly saving?: ComposerSaving | undefined;
  /** Whether the field takes the keyboard as it stands, as a new comment's field does once opened for its words. */
  readonly autoFocus?: boolean | undefined;
  /** Asks the field to take the keyboard, its caret after its words, each time the count moves, as Edit does once it lays a message's words in; none where nothing asks. */
  readonly focusAsk?: number | undefined;
  /** Called with the file addresses of pictures dropped on the composer from Photos, Files, or another app, on an iPad; it takes no drop where none is given. */
  readonly onDropPictures?: ((uris: readonly string[], unreadable: number) => void) | undefined;
  /** Takes words pasted long enough to come as a file (`@repo/features/long-paste`), answering whether it did, so the field takes them back out of its words; they paste as words where none is given. */
  readonly onLongPaste?: ((words: string) => boolean) | undefined;
  /** The capsules saying where and how the message runs, such as a start's repository or where an agent works, leading the row under the field after the +, as the desktop composer's foot stands them; none on a thread's composer. */
  readonly tools?: ReactNode;
  /** What stands at the end of the row under the field before Send, such as the model chip, as the desktop composer stands its model picker at its foot's end; none on a thread's composer. */
  readonly trailing?: ReactNode;
  /** Dictate, just before Send at the row's end, and the strip the row becomes while a dictation records, as the desktop composer's (`dictation-strip.tsx`); none where the composer takes none. */
  readonly dictation?: ComposerDictation | undefined;
  /** The names a flow finds the field and the + by, where its holder names its own. */
  readonly testIds?: { readonly field: string; readonly add: string } | undefined;
};

/** Where a dictation stands: none under way, its voice recording, or its clip being heard as words. */
export const DICTATION_PHASE = {
  IDLE: "idle",
  RECORDING: "recording",
  TRANSCRIBING: "transcribing",
} as const;

export type DictationPhase = (typeof DICTATION_PHASE)[keyof typeof DICTATION_PHASE];

/** A composer's dictation, as the desktop's box offers it: where it stands, when its recording began, and its three presses. */
export interface ComposerDictation {
  readonly phase: DictationPhase;
  /** When the recording began, which the strip's clock counts from; none while nothing records. */
  readonly startedAt: number | undefined;
  /** Opens the microphone and starts recording. */
  readonly onStart: () => void;
  /** Drops the recording unsent, as the desktop strip's ✕ does. */
  readonly onCancel: () => void;
  /** Sends the recording to be heard as words, as the strip's ✓ does. */
  readonly onFinish: () => void;
}

/** The desktop's words for a dictation's presses and its wait (`dictation-strip.tsx`). */
const DICTATION_WORDS = {
  DICTATE: "Dictate",
  CANCEL: "Cancel",
  FINISH: "Done",
  TRANSCRIBING: "Transcribing",
} as const;

/** How often the strip's clock counts on, in milliseconds. */
const CLOCK_TICK_MS = 1_000;

/** How long a recording has run, as the strip says it: minutes and seconds, "0:07". */
function clockWords(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000));

  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The strip's clock: how long the recording has run, counting on each second while it stands. */
function DictationClock({ startedAt }: { readonly startedAt: number | undefined }) {
  const colors = useColors();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);

    return () => clearInterval(tick);
  }, []);

  return (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.ROW_LINE }),
        SwiftModifiers.monospacedDigit(),
        foregroundStyle(colors.TEXT_MUTED),
      ]}
    >
      {clockWords(startedAt === undefined ? 0 : now - startedAt)}
    </Text>
  );
}

/** One of the dictation's presses: its glyph alone at a press's size, in the muted ink, heard by its words. */
function DictationPress({
  glyph,
  label,
  onPress,
}: {
  readonly glyph: Glyph;
  readonly label: string;
  readonly onPress: () => void;
}) {
  const colors = useColors();
  const size = useScaledSize(MARK_SIZE.LEAD + 2);

  return (
    <Button
      onPress={onPress}
      modifiers={[
        buttonStyle("borderless"),
        accessibilityLabel(label),
        accessibilityIdentifier(`dictation-${label.toLowerCase()}`),
      ]}
    >
      <Image {...glyphImage(glyph)} size={size} color={colors.TEXT_MUTED} modifiers={PRESS_FRAME} />
    </Button>
  );
}

/**
 * The row under the field while a dictation stands, as the desktop's strip
 * stands at its box's foot: ✕, which drops the recording, how long it has
 * run, and ✓, which sends it to be heard; and, once sent, that it is being
 * heard, under the system's spinner, until the words land in the field.
 */
function DictationStrip({ dictation }: { readonly dictation: ComposerDictation }) {
  const colors = useColors();

  if (dictation.phase === DICTATION_PHASE.TRANSCRIBING) {
    return (
      <HStack spacing={TOOL_SPACING} modifiers={[padding({ leading: SPACE.TIGHT })]}>
        <ProgressView modifiers={[...PRESS_FRAME, tint(colors.TEXT_MUTED)]} />
        <Text
          modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_MUTED)]}
        >
          {DICTATION_WORDS.TRANSCRIBING}
        </Text>
        <Spacer />
      </HStack>
    );
  }

  return (
    <HStack spacing={TOOL_SPACING} modifiers={[padding({ leading: SPACE.TIGHT })]}>
      <DictationPress
        glyph={GLYPH.REMOVE}
        label={DICTATION_WORDS.CANCEL}
        onPress={dictation.onCancel}
      />
      <DictationClock startedAt={dictation.startedAt} />
      <Spacer />
      <DictationPress
        glyph={GLYPH.CHECK}
        label={DICTATION_WORDS.FINISH}
        onPress={dictation.onFinish}
      />
    </HStack>
  );
}

/** An act Send stands for while the field is empty, as the panel's empty Send reads Got it on a notice. */
export interface ComposerSendAs {
  readonly label: string;
  readonly symbol: Glyph;
}

/** What Send does while the field holds a queued message's words being edited. */
export interface ComposerSaving {
  /** Writes the words back into the message's place in the queue. */
  readonly onSave: () => void;
  /** Sends them now as that message, steering the turn; none where it may not. */
  readonly onSteer?: (() => void) | undefined;
}

/** The panel's words for an edit's two ways. */
const SAVING_WORDS = { SAVE: "Save", STEER: "Steer" } as const;

/**
 * Send while the field holds a queued message's words: the same round
 * button, its mark a check, which saves them back in the message's place;
 * where it may steer, the system's menu with a primary act, so a tap saves
 * and a hold offers Steer, as the panel's held Send steers an edit.
 */
function SaveButton({ saving }: { readonly saving: ComposerSaving }) {
  const colors = useColors();
  const round = useScaledSize(SEND_SIZE);
  const markSize = useScaledSize(MARK_SIZE.GLYPH);
  const mark = <Image {...glyphImage(GLYPH.CHECK)} size={markSize} modifiers={roundMark(round)} />;

  if (saving.onSteer === undefined) {
    return (
      <Button
        onPress={saving.onSave}
        modifiers={[...roundModifiers(colors), accessibilityLabel(SAVING_WORDS.SAVE)]}
      >
        {mark}
      </Button>
    );
  }

  return (
    <Menu
      label={mark}
      onPrimaryAction={saving.onSave}
      modifiers={[...roundModifiers(colors), accessibilityLabel(SAVING_WORDS.SAVE)]}
    >
      <Button {...actContent(SAVING_WORDS.STEER, GLYPH.STEER)} onPress={saving.onSteer} />
    </Menu>
  );
}

/**
 * The round button at the field's end, the system's own prominent circle as
 * Messages draws Send: Send in the ink once there is something to send and
 * the system's dimmed circle until then, or, while nothing is typed, Stop
 * while a turn runs, and the system's spinner once it is pressed, and else
 * Talk where the composer calls its agent, the waveform on the same circle,
 * as ChatGPT's composer offers voice, so the first word turns it into Send.
 * Where the empty field's Send stands for an act of its own (`sendAs`), such
 * as a notice's Got it, the round wears that act's glyph and name until a
 * word is typed.
 */
function SendButton({
  empty,
  typed,
  onSend,
  sendAs,
  onStop,
  stopping,
  onTalk,
}: {
  readonly empty: boolean;
  /** Whether the field holds words, which make the round Send whatever it stood for while empty. */
  readonly typed: boolean;
  readonly onSend: (() => void) | undefined;
  readonly sendAs: ComposerSendAs | undefined;
  readonly onStop: (() => void) | undefined;
  readonly stopping: boolean;
  readonly onTalk: (() => void) | undefined;
}) {
  const colors = useColors();
  // Note that the circle and its marks grow with the reader's text size, as Messages' Send does, so the field's words never outgrow the button beside them.
  const round = useScaledSize(SEND_SIZE);
  const stopSize = useScaledSize(MARK_SIZE.GLYPH - 2);
  const sendSize = useScaledSize(MARK_SIZE.GLYPH);

  if (empty && onStop !== undefined && stopping) {
    return (
      <ProgressView
        modifiers={[
          frame({ width: round, height: round }),
          ...PRESS_FRAME,
          tint(colors.TEXT_MUTED),
          accessibilityLabel("Stopping"),
        ]}
      />
    );
  }

  if (empty && onStop !== undefined) {
    return (
      <Button onPress={onStop} modifiers={[...roundModifiers(colors), accessibilityLabel("Stop")]}>
        <Image {...glyphImage(GLYPH.STOP_TURN)} size={stopSize} modifiers={roundMark(round)} />
      </Button>
    );
  }

  if (empty && onTalk !== undefined) {
    return (
      <Button
        onPress={onTalk}
        modifiers={[...roundModifiers(colors), accessibilityLabel(TALK_LABEL.TALK)]}
      >
        <Image {...glyphImage(GLYPH.TALK)} size={sendSize} modifiers={roundMark(round)} />
      </Button>
    );
  }

  const sendable = !empty && onSend !== undefined;
  const act = typed ? undefined : sendAs;

  return (
    <Button
      onPress={() => onSend?.()}
      modifiers={[
        ...(sendable ? roundModifiers(colors) : idleRoundModifiers(colors, round)),
        disabled(!sendable),
        accessibilityLabel(act?.label ?? "Send"),
      ]}
    >
      <Image
        {...glyphImage(act?.symbol ?? GLYPH.SEND)}
        size={sendSize}
        modifiers={roundMark(round)}
      />
    </Button>
  );
}

/** What the + menu holds, wherever its button stands: its acts, a rule, then its choices within and its switches. */
export function AddMenuItems({ menu }: { readonly menu: ComposerMenu }) {
  const submenus = menu.submenus ?? [];
  const switches = menu.switches ?? [];

  return (
    <>
      {menu.actions.map((action) => (
        <Button
          key={action.label}
          {...actContent(action.label, action.symbol)}
          onPress={action.onPress}
        />
      ))}
      {menu.actions.length === 0 || (submenus.length === 0 && switches.length === 0) ? null : (
        <Divider />
      )}
      {submenus.map((submenu) => (
        <BarMenuButton key={submenu.label} menu={submenu} />
      ))}
      {switches.map((each) => (
        <Toggle
          key={each.label}
          label={each.label}
          isOn={each.on}
          onIsOnChange={() => each.onPress()}
        />
      ))}
    </>
  );
}

/** The + as a menu, as SwiftUI draws one from a press. */
function AddMenu({ menu, testId }: { readonly menu: ComposerMenu; readonly testId: string }) {
  const colors = useColors();
  const addSize = useScaledSize(MARK_SIZE.LEAD + 2);

  return (
    <Menu
      label={
        <Image
          {...glyphImage(GLYPH.ADD)}
          size={addSize}
          color={colors.TEXT_MUTED}
          modifiers={PRESS_FRAME}
        />
      }
      modifiers={[accessibilityLabel(ADD_LABEL), accessibilityIdentifier(testId)]}
    >
      <AddMenuItems menu={menu} />
    </Menu>
  );
}

/** The name a flow finds a composer's + by, where its holder names none. */
const ADD_TEST_ID = "composer-add";

/**
 * The + that leads a bar of glass: a menu of what it adds where it offers
 * more than one thing, else its one act, such as a picture; nothing where it
 * is given neither.
 */
export function AddPress({
  menu,
  onAdd,
  testId = ADD_TEST_ID,
}: {
  readonly menu?: ComposerMenu | undefined;
  readonly onAdd?: (() => void) | undefined;
  /** The name a flow finds the + by. */
  readonly testId?: string | undefined;
}) {
  const colors = useColors();
  const addSize = useScaledSize(MARK_SIZE.LEAD + 2);

  if (menu !== undefined) return <AddMenu menu={menu} testId={testId} />;

  if (onAdd === undefined) return null;

  return (
    <Button
      onPress={onAdd}
      modifiers={[
        buttonStyle("borderless"),
        accessibilityLabel(ADD_LABEL),
        accessibilityIdentifier(testId),
      ]}
    >
      <Image
        {...glyphImage(GLYPH.ADD)}
        size={addSize}
        color={colors.TEXT_MUTED}
        modifiers={PRESS_FRAME}
      />
    </Button>
  );
}

/** The composer's pieces: the +, the field, a call's presses, and Send or Stop, each laid out by its holder. */
interface ComposerParts {
  readonly add: ReactElement | null;
  readonly field: ReactElement;
  readonly call: ReactElement | null;
  readonly send: ReactElement;
}

/** Whether the composer stands its controls in a row under its field, as the desktop composer does: one that starts work or speaks to an agent, holding capsules (`tools`, `trailing`). */
function stacked(props: ComposerProps): boolean {
  return props.tools !== undefined || props.trailing !== undefined;
}

/** The composer's pieces, the field holding its words and Send sending them. */
function useComposerParts(props: ComposerProps): ComposerParts {
  const {
    placeholder,
    words: held,
    onWords,
    sendable = false,
    onSend,
    sendAs,
    onAdd,
    addMenu,
    call,
    onStop,
    stopping = false,
    onLongPaste,
    testIds,
  } = props;

  const text = useNativeState(held ?? "");
  const field = useRef<TextFieldRef>(null);
  const { focusAsk } = props;

  // Note that a field opening on words handed back, as a refused send's, stands its caret after them, as Messages keeps a draft's, rather than at their start.
  const [opened] = useState(() => (held ?? "").length);
  const caret = useNativeState<TextFieldSelection>({ start: opened, end: opened });
  const [typed, setTyped] = useState(held ?? "");
  const words = held ?? typed;
  // Note that the field is handed the holder's words only where they moved apart from what was typed, as a send empties them or a refusal hands them back.
  const shown = useRef(words);
  useEffect(() => {
    if (held === undefined || held === shown.current) return;
    shown.current = held;
    text.set(held);
  }, [held, text]);

  // Note that the field takes the keyboard once its holder's words have landed in it, after the effect above lays them in, so the caret stands after them.
  useEffect(() => {
    if (focusAsk === undefined || focusAsk === 0) return;
    const end = shown.current.length;
    void field.current
      ?.focus()
      .then(() => field.current?.setSelection(end, end))
      .catch(() => undefined);
  }, [focusAsk]);

  // Note that a long paste its holder took as a file is taken back out of the words at once, since the field hears no paste of its own, only its words as they change.
  const type = (next: string) => {
    const pasted = onLongPaste === undefined ? undefined : longPasteIn(shown.current, next);
    const taken = pasted !== undefined && onLongPaste?.(pasted.words) === true;
    const typedNow = taken ? pasted.kept : next;
    shown.current = typedNow;

    if (taken) text.set(typedNow);
    setTyped(typedNow);
    onWords?.(typedNow);
  };

  const empty = words.trim() === "" && !sendable;
  const lines = useAccessibilitySize() ? FIELD_LINES.LARGE : FIELD_LINES.REGULAR;
  const rowed = stacked(props);
  // Note that a field over a row of controls opens to two lines once a word is typed, as the desktop composer's does, so what is typed has room before it grows. The limit is always a range, because `@expo/ui` draws a range and a bare limit down two branches, and a switch between them made the field anew, dropping the keyboard after the first letter typed.
  const height = lineLimit({ min: rowed && words !== "" ? 2 : 1, max: lines });

  const send =
    onSend === undefined
      ? undefined
      : () => {
          onSend(words.trim());

          if (held !== undefined) return;
          shown.current = "";
          text.set("");
          setTyped("");
        };

  return {
    add: rowed ? null : <AddPress menu={addMenu} onAdd={onAdd} />,
    field: (
      <TextField
        ref={field}
        text={text}
        placeholder={placeholder}
        axis="vertical"
        autoFocus={props.autoFocus === true}
        {...(opened > 0 && { selection: caret })}
        onTextChange={type}
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_TITLE }),
          height,
          padding({
            vertical: FIELD_INSET,
            trailing: FIELD_TRAILING,
            ...((rowed || (addMenu === undefined && onAdd === undefined)) && {
              leading: FIELD_LEADING,
            }),
          }),
          // Note that the field with its room stands at least as tall as its buttons' frames, so one line sits level with them in a row laid along its foot, and a longer field grows up from there. It takes every point of width its container leaves it, so SwiftUI sizes its text view at that one width as its words change, rather than asking its ideal width too.
          frame({
            minHeight: PRESS_SIZE,
            maxWidth: Number.POSITIVE_INFINITY,
            alignment: "leading",
          }),
          accessibilityIdentifier(testIds?.field ?? "composer-field"),
        ]}
      />
    ),
    call:
      call?.kind === COMPOSER_CALL.ON_CALL ? <ComposerCallPresses presses={call.presses} /> : null,
    send:
      props.saving === undefined ? (
        <SendButton
          empty={empty}
          typed={words.trim() !== ""}
          onSend={send}
          sendAs={sendAs}
          onStop={onStop}
          stopping={stopping}
          onTalk={call?.kind === COMPOSER_CALL.TALK ? call.onTalk : undefined}
        />
      ) : (
        <SaveButton saving={props.saving} />
      ),
  };
}

/** The composer's pieces in one row, the field between the + and Send, as a thread's reply stands. */
function RowPieces({ parts }: { readonly parts: ComposerParts }) {
  return (
    <>
      {parts.add}
      {parts.field}
      {parts.call}
      {parts.send}
    </>
  );
}

/** How far apart the capsules stand in the row under the field. */
const TOOL_SPACING = SPACE.TIGHT * 2;

/**
 * The row under the field, as the desktop composer's foot stands it: the +
 * at its start and the capsules saying where the message runs after it,
 * scrolling sideways where they outrun the bar, then at its end what is
 * picked for it, such as the model, a call's presses, and Send or Stop,
 * inside the composer's own glass, so the keyboard that lifts the composer
 * never covers them.
 */
function ComposerRow({
  props,
  parts,
}: {
  readonly props: ComposerProps;
  readonly parts: ComposerParts;
}) {
  const { addMenu, onAdd, tools, trailing, testIds, dictation } = props;

  // Note that a dictation under way stands its strip in the row's place, as the desktop's strip stands in its box's foot.
  if (dictation !== undefined && dictation.phase !== DICTATION_PHASE.IDLE) {
    return <DictationStrip dictation={dictation} />;
  }

  return (
    <HStack spacing={TOOL_SPACING} modifiers={[padding({ leading: SPACE.TIGHT })]}>
      <AddPress menu={addMenu} onAdd={onAdd} testId={testIds?.add} />
      <ScrollView axes="horizontal" showsIndicators={false}>
        <HStack spacing={TOOL_SPACING} modifiers={[padding({ trailing: SPACE.ROW })]}>
          {tools}
        </HStack>
      </ScrollView>
      {trailing}
      {dictation === undefined ? null : (
        <DictationPress
          glyph={GLYPH.DICTATE}
          label={DICTATION_WORDS.DICTATE}
          onPress={dictation.onStart}
        />
      )}
      {parts.call}
      {parts.send}
    </HStack>
  );
}

/**
 * A composer in the system's Liquid Glass at the screen's foot, above the tab
 * bar: the + for what a message carries, the field, which grows with its
 * words, and Send filled with the ink, or Stop while the field is empty and
 * a turn runs, and, where it starts work, the + and the start's capsules in
 * a row under the field. Where its holder keeps the words, the field
 * follows them, so words a refused send hands back stand in it again; else
 * it empties on Send. Pictures dropped on it, on an iPad, go to its
 * holder's `onDropPictures`. It stands in a React Native bar (`GlassBar`),
 * docked over a compact window's screen (`GlassDock`).
 */
export function Composer(props: ComposerProps) {
  const { onDropPictures } = props;
  const parts = useComposerParts(props);
  const rowed = stacked(props);

  return (
    <GlassBar
      field
      head={props.head}
      foot={rowed ? <ComposerRow props={props} parts={parts} /> : undefined}
      above={props.above}
      modifiers={onDropPictures === undefined ? [] : [dropPictures(onDropPictures)]}
    >
      {rowed ? parts.field : <RowPieces parts={parts} />}
    </GlassBar>
  );
}

/**
 * The same composer at the foot of a SwiftUI column, such as a split view's
 * detail, where no React Native bar can stand: its pieces in a row of the
 * system's own glass, rounded as the bar is (`BAR_GLASS`), taking pictures
 * dropped on it as the bar does.
 */
export function ComposerFoot(props: ComposerProps) {
  const { onDropPictures } = props;
  const parts = useComposerParts(props);
  const rowed = stacked(props);

  const glass = [
    padding({ all: BAR_EDGE }),
    ...BAR_GLASS,
    padding({ horizontal: BAR_MARGIN, bottom: SPACE.ROW }),
    ...(onDropPictures === undefined ? [] : [dropPictures(onDropPictures)]),
  ];

  // Note that a field over a row of controls stands alone in the glass's column, at its width, with no row of its own around it to size it again.
  const pieces = rowed ? (
    parts.field
  ) : (
    <HStack alignment="bottom" spacing={BAR_ROW_SPACING}>
      <RowPieces parts={parts} />
    </HStack>
  );

  // Note that a composer with a row under its field stands it there inside the same glass, as the bar does.
  const foot =
    props.head === undefined && !rowed ? (
      <HStack alignment="bottom" spacing={BAR_ROW_SPACING} modifiers={glass}>
        <RowPieces parts={parts} />
      </HStack>
    ) : (
      <VStack alignment="leading" spacing={SPACE.TIGHT * 2} modifiers={glass}>
        {props.head === undefined ? null : <BarHead>{props.head}</BarHead>}
        {pieces}
        {rowed ? <ComposerRow props={props} parts={parts} /> : null}
      </VStack>
    );

  // Note that the composer keeps its place under what stands over it whether or not anything stands there, so its field is never drawn anew as the queue comes and goes.
  return (
    <VStack spacing={SPACE.TIGHT * 2}>
      {props.above === undefined ? null : (
        <VStack modifiers={[padding({ horizontal: BAR_MARGIN })]}>{props.above}</VStack>
      )}
      {foot}
    </VStack>
  );
}
