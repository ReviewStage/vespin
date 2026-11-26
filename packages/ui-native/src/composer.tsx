// composer.tsx -- the rounded glass field at a thread's or a transcript's foot: a + on the left, one act or a menu, the field, and Send, Stop, or Talk on the right, in a React Native bar or a SwiftUI column's foot.

import {
  Button,
  Divider,
  HStack,
  Image,
  Mask,
  Menu,
  ProgressView,
  Rectangle,
  RNHostView,
  ScrollView,
  Spacer,
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
  buttonStyle,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  layoutPriority,
  lineLimit,
  onGeometryChange,
  padding,
  tint,
  useScrollGeometryChange,
} from "@expo/ui/swift-ui/modifiers";
import { longPasteIn } from "@repo/features/long-paste";
import { TALK_LABEL } from "@repo/features/voice-call-words";
import {
  type ReactElement,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAccessibilitySize, useScaledSize, useTextScale } from "./accessibility.js";
import { COMPOSER_CALL, type ComposerCall, ComposerCallPresses } from "./call.js";
import type { CaretAtWord } from "./caret-at-word.js";
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
import { PillField, type PillFieldHandle } from "./pill-field.js";
import { type BarMenu, BarMenuButton } from "./split-view.js";
import { Text } from "./text.js";
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

/** How far the press frame stands past the round on each side at the default text size, which it keeps as the reader's text grows the round. */
const ROUND_MARGIN = (PRESS_SIZE - SEND_SIZE) / 2;

/**
 * The round button's press frame: Apple's least target at the default text
 * size, and past it the round with the same margin around it. Note that a
 * frame of the least target alone let a round grown by the reader's text
 * fill it, so at AX3 Send met the glass's edge while the + kept its room.
 */
function roundFrame(round: number) {
  const side = round + ROUND_MARGIN * 2;

  return [
    frame({ minWidth: side, minHeight: side }),
    SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
  ];
}

/** The round button's look: the system's prominent circle in the ink, its mark in the ground, inside its press frame. */
function roundModifiers(colors: ReturnType<typeof useColors>, round: number) {
  return [
    buttonStyle("borderedProminent"),
    SwiftModifiers.buttonBorderShape("circle"),
    tint(colors.TEXT),
    foregroundStyle(colors.GROUND),
    ...roundFrame(round),
  ];
}

/** What VoiceOver hears the round's spinner as: a Stop out, or words waiting on their holder. */
const SPINNER_WORDS = { STOPPING: "Stopping", WAITING: "Waiting" } as const;

/** The system's spinner in the round's place, at the round's size inside its press frame, while what the round stands for is under way. */
function RoundSpinner({ label }: { readonly label: string }) {
  const colors = useColors();
  const round = useScaledSize(SEND_SIZE);

  return (
    <ProgressView
      modifiers={[
        frame({ width: round, height: round }),
        ...roundFrame(round),
        tint(colors.TEXT_MUTED),
        accessibilityLabel(label),
      ]}
    />
  );
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

/**
 * A field whose words hold pills (`PillField`) in place of the system's
 * plain one: its door, through which its holder puts a picked mention's pill
 * where the `@` word stands, the `@` word its caret stands in as it moves,
 * and the files whose markers it draws as pills.
 */
export interface ComposerPills {
  readonly field: RefObject<PillFieldHandle | null>;
  readonly onAtWord: (word: CaretAtWord | undefined) => void;
  readonly files?: ReadonlySet<string> | undefined;
  /** Told as the field takes and lets go of the keyboard, so what an `@` offers can be read before one is typed. */
  readonly onFocusChange?: ((focused: boolean) => void) | undefined;
  /** The file each held picture's pill draws its thumbnail from, by the picture's name (`PillField`'s `thumbnails`). */
  readonly thumbnails?: ReadonlyMap<string, string> | undefined;
  /** Opens a held picture full screen, by its name, as a press on its pill asks. */
  readonly onPicturePress?: ((name: string) => void) | undefined;
}

type ComposerProps = {
  /** What the field says before anything is typed: "Reply", "Add a note". */
  readonly placeholder: string;
  /** The words in the field, where its holder keeps them, such as a thread's draft that outlives its screen; the field keeps its own where none are given. */
  readonly words?: string | undefined;
  /** Called with the words as they are typed. */
  readonly onWords?: ((words: string) => void) | undefined;
  /** Whether Send stands lit with no words typed, as it does once an ask's answer is picked. */
  readonly sendable?: boolean | undefined;
  /** Called with the words typed once Send is pressed; where none is given, the system's spinner stands in Send's place under words, as while a start is out, and nothing while the field is empty. */
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
  /** Draws the words with their mentions as pills (`ComposerPills`), as the desktop's box draws its chips; the system's plain field where none is given. */
  readonly pills?: ComposerPills | undefined;
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

/** How far the row under the field stands in from the glass on each side, so Send's round at its end keeps the room the + keeps at its start, rather than meeting the glass's edge once the reader's text grows it past its press frame. */
const ROW_SIDES = padding({ horizontal: SPACE.TIGHT });

/** How far ahead a recording's clock may count, which no dictation reaches: a day. */
const CLOCK_REACH_MS = 86_400_000;

/**
 * The strip's clock: how long the recording has run, as the system's own
 * timer text counts it on ("0:07"), so it ticks with no render of ours; it
 * stands at 0:00 until the recording has started.
 */
function DictationClock({ startedAt }: { readonly startedAt: number | undefined }) {
  const colors = useColors();
  const [opened] = useState(() => Date.now());
  const lower = new Date(startedAt ?? opened);

  return (
    <Text
      timerInterval={{ lower, upper: new Date(lower.getTime() + CLOCK_REACH_MS) }}
      countsDown={false}
      {...(startedAt === undefined ? { pauseTime: lower } : {})}
      modifiers={[
        font({ textStyle: TYPE_ROLE.ROW_LINE }),
        SwiftModifiers.monospacedDigit(),
        foregroundStyle(colors.TEXT_MUTED),
      ]}
    />
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
      <HStack spacing={TOOL_SPACING} modifiers={[ROW_SIDES]}>
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
    <HStack spacing={TOOL_SPACING} modifiers={[ROW_SIDES]}>
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
        modifiers={[...roundModifiers(colors, round), accessibilityLabel(SAVING_WORDS.SAVE)]}
      >
        {mark}
      </Button>
    );
  }

  return (
    <Menu
      label={mark}
      onPrimaryAction={saving.onSave}
      modifiers={[...roundModifiers(colors, round), accessibilityLabel(SAVING_WORDS.SAVE)]}
    >
      <Button {...actContent(SAVING_WORDS.STEER, GLYPH.STEER)} onPress={saving.onSteer} />
    </Menu>
  );
}

/**
 * The round button at the field's end, the system's own prominent circle as
 * Messages draws Send: Send in the ink once there is something to send, or,
 * while nothing is typed, Stop while a turn runs, and the system's spinner
 * once it is pressed, and else Talk where the composer calls its agent, the
 * waveform on the same circle, as ChatGPT's composer offers voice, so the
 * first word turns it into Send; and nothing at all while the field is empty
 * and none of those stands, as Messages draws no Send before a word is typed.
 * Words its holder cannot send yet, as a start's while what it starts in is
 * still being read or while a start is out, stand the system's spinner in
 * Send's place, as the desktop's start box shows one while a start is out,
 * rather than a dimmed round that reads as a broken button.
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

  if (empty && onStop !== undefined && stopping)
    return <RoundSpinner label={SPINNER_WORDS.STOPPING} />;

  if (empty && onStop !== undefined) {
    return (
      <Button
        onPress={onStop}
        modifiers={[...roundModifiers(colors, round), accessibilityLabel("Stop")]}
      >
        <Image {...glyphImage(GLYPH.STOP_TURN)} size={stopSize} modifiers={roundMark(round)} />
      </Button>
    );
  }

  if (empty && onTalk !== undefined) {
    return (
      <Button
        onPress={onTalk}
        modifiers={[...roundModifiers(colors, round), accessibilityLabel(TALK_LABEL.TALK)]}
      >
        <Image {...glyphImage(GLYPH.TALK)} size={sendSize} modifiers={roundMark(round)} />
      </Button>
    );
  }

  // Note that an empty field with nothing for Send to stand for draws no Send, as Messages draws none before a word is typed, rather than a dimmed round that reads as a broken button; Dictate, where the composer offers it, then ends the row.
  if (empty) return null;

  if (onSend === undefined) return <RoundSpinner label={SPINNER_WORDS.WAITING} />;

  const act = typed ? undefined : sendAs;

  return (
    <Button
      onPress={onSend}
      modifiers={[...roundModifiers(colors, round), accessibilityLabel(act?.label ?? "Send")]}
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
  const { focusAsk, pills } = props;

  const {
    field: pillDoor,
    files: pillFiles,
    thumbnails: pillThumbnails,
    onPicturePress,
    onAtWord: onPillAtWord,
    onFocusChange: onPillFocus,
  } = pills ?? {};

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

    if (pillDoor !== undefined) return pillDoor.current?.focus();
    const end = shown.current.length;
    void field.current
      ?.focus()
      .then(() => field.current?.setSelection(end, end))
      .catch(() => undefined);
  }, [focusAsk, pillDoor]);

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
  // Note that the field stands one line until its words wrap, then grows to its most. The limit is a range, because `@expo/ui` draws a range and a bare limit down two branches, and a switch between them made the field anew, dropping the keyboard.
  const height = lineLimit({ min: 1, max: lines });

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

  const room = padding({
    vertical: FIELD_INSET,
    trailing: FIELD_TRAILING,
    ...((rowed || (addMenu === undefined && onAdd === undefined)) && {
      leading: FIELD_LEADING,
    }),
  });

  // Note that the field with its room stands at least as tall as its buttons' frames, so one line sits level with them in a row laid along its foot, and a longer field grows up from there. It takes every point of width its container leaves it, so its text view is sized at that one width as its words change, rather than asking its ideal width too.
  const span = frame({
    minHeight: PRESS_SIZE,
    maxWidth: Number.POSITIVE_INFINITY,
    alignment: "leading",
  });

  // Note that a field of pills is UIKit's text view, which stands in the glass through a host of its own, its width the glass's and its height its words'.
  const pillsField =
    pillDoor === undefined ? undefined : (
      <VStack alignment="leading" modifiers={[room, span]}>
        <RNHostView matchContents={{ vertical: true }}>
          <PillField
            ref={pillDoor}
            value={words}
            onChange={type}
            files={pillFiles}
            thumbnails={pillThumbnails}
            onPicturePress={onPicturePress}
            placeholder={placeholder}
            maxLines={lines}
            onAtWord={onPillAtWord}
            onFocusChange={onPillFocus}
            autoFocus={props.autoFocus === true}
            testID={testIds?.field ?? "composer-field"}
          />
        </RNHostView>
      </VStack>
    );

  return {
    add: rowed ? null : <AddPress menu={addMenu} onAdd={onAdd} />,
    field: pillsField ?? (
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
          room,
          span,
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

/** How far the capsules fade out at an edge of the row they run on past, about one capsule's lead glyph and its gap. */
const CAPSULE_FADE = SPACE.EDGE * 2;

/** The mask's ink: shown where opaque, hidden where clear; only its alpha is read. */
const MASK_INK = { SHOWN: "black", HIDDEN: "clear" } as const;

/** How far short of an end the scroll may sit and still be at it, since its offsets are fractional. */
const SCROLL_END_SLACK = 1;

/** Which ends of the capsule row have more of it beyond them. */
type CapsuleOverflow = { readonly before: boolean; readonly after: boolean };

/** One end's fade, from hidden at the row's edge to shown inward: `toward` names the edge it fades out at. */
function CapsuleFade({ toward }: { readonly toward: "leading" | "trailing" }) {
  const ends = [MASK_INK.SHOWN, MASK_INK.HIDDEN];

  return (
    <Rectangle
      modifiers={[
        frame({ width: CAPSULE_FADE }),
        foregroundStyle({
          type: "linearGradient",
          colors: toward === "trailing" ? ends : [...ends].reverse(),
          startPoint: { x: 0, y: 0.5 },
          endPoint: { x: 1, y: 0.5 },
        }),
      ]}
    />
  );
}

/**
 * The capsules saying where a message runs, scrolling sideways where they
 * outrun the row, and fading out softly at an end while more of them lies
 * past it, as the system's own scrolling rows of chips do, rather than
 * cutting a word off hard at the edge. Note that the fade is a mask of the
 * scroll view's own, which leaves the capsules' presses alone, and that it
 * is redrawn only as an end's state turns, never on each frame of a scroll.
 */
function CapsuleScroll({
  children,
  onWhole,
}: {
  readonly children: ReactNode;
  readonly onWhole: (width: number) => void;
}) {
  const [overflow, setOverflow] = useState<CapsuleOverflow>({ before: false, after: false });

  // Note that an end's state is set only when it turns, so a scroll's frames that change neither redraw nothing.
  const geometry = useScrollGeometryChange((at) => {
    const before = at.contentOffsetX > SCROLL_END_SLACK;
    const after = at.contentOffsetX + at.containerWidth < at.contentWidth - SCROLL_END_SLACK;
    setOverflow((was) => (was.before === before && was.after === after ? was : { before, after }));
  });

  return (
    <Mask>
      <ScrollView
        axes="horizontal"
        showsIndicators={false}
        modifiers={geometry === null ? [] : [geometry]}
      >
        {/* Note that the capsules inside a sideways scroll stand at their whole width, so it is measured here before the padding the fade keeps clear. */}
        <HStack
          spacing={TOOL_SPACING}
          modifiers={[
            onGeometryChange(({ width }) => onWhole(width)),
            padding({ trailing: SPACE.ROW }),
          ]}
        >
          {children}
        </HStack>
      </ScrollView>
      <Mask.Content>
        <HStack spacing={0}>
          {overflow.before ? <CapsuleFade toward="leading" /> : null}
          <Rectangle modifiers={[foregroundStyle(MASK_INK.SHOWN)]} />
          {overflow.after ? <CapsuleFade toward="trailing" /> : null}
        </HStack>
      </Mask.Content>
    </Mask>
  );
}

/** The widths the row under the field is laid out by, in points: its own, the + at its start, what stands at its end, the capsules' whole, and, each at its whole width, what is picked (the model chip) and the presses after it. */
type RowWidths = {
  readonly row: number;
  readonly add: number;
  readonly end: number;
  readonly capsules: number;
  readonly picked: number;
  readonly presses: number;
};

/** A row not yet measured. */
const UNMEASURED: RowWidths = { row: 0, add: 0, end: 0, capsules: 0, picked: 0, presses: 0 };

/** Whether the capsules stand on a line of their own: where they would not stand whole between the + and what stands at the row's end; a row not yet measured keeps one line. */
function capsulesOwnLine(widths: RowWidths): boolean {
  const room = widths.row - widths.add - widths.end - TOOL_SPACING * 2;

  return widths.row > 0 && widths.capsules > room;
}

/** Whether what is picked and the presses fit the row whole on one line, each at its whole width; a row not yet measured keeps one line. */
function endFits(widths: RowWidths): boolean {
  const gap = widths.picked > 0 && widths.presses > 0 ? TOOL_SPACING : 0;

  return widths.row === 0 || widths.picked + gap + widths.presses <= widths.row;
}

/** Whether what is picked holds its whole width: where it fits the row even on a line of its own; a chip not yet measured holds it, so it is measured whole. */
function pickedWhole(widths: RowWidths): boolean {
  return widths.row === 0 || widths.picked <= widths.row;
}

/**
 * The row under the field, as the desktop composer's foot stands it: the +
 * at its start and the capsules saying where the message runs after it,
 * then at its end what is picked for it, such as the model, whole, a call's
 * presses, and Send or Stop, inside the composer's own glass, so the
 * keyboard that lifts the composer never covers them. Where the capsules
 * would not stand whole between them, as on a phone or the folded Duo,
 * where the model and the presses left them a few letters, the + and the
 * capsules take a line of their own over the rest, as a page's chips stand
 * one to a line where a row has no room for them, and there scroll
 * sideways where they still outrun it, fading where they run on
 * (`CapsuleScroll`).
 */
function ComposerRow({
  props,
  parts,
}: {
  readonly props: ComposerProps;
  readonly parts: ComposerParts;
}) {
  const { addMenu, onAdd, tools, trailing, testIds, dictation } = props;
  const [widths, setWidths] = useState<RowWidths>(UNMEASURED);
  const scale = useTextScale();

  // Note that each width is set only as it changes, and none of them moves with the layout chosen, so choosing one line or two never turns the choice again.
  const measured = (key: keyof RowWidths) => (width: number) =>
    setWidths((was) => (was[key] === width ? was : { ...was, [key]: width }));

  // Note that the end keeps the widest it has stood, so the capsules don't jump back up beside it as Talk gives way to Send under the first word typed.
  const measuredEnd = (width: number) =>
    setWidths((was) => (width <= was.end ? was : { ...was, end: width }));

  // Note that a change of the reader's text size measures the end again, since a chip too wide for even a line of its own is cut and so no longer measured whole, and the end's widest kept would hold the old size's.
  useEffect(() => {
    setWidths((was) => (was.picked === 0 && was.end === 0 ? was : { ...was, picked: 0, end: 0 }));
  }, [scale]);

  // Note that a dictation under way stands its strip in the row's place, as the desktop's strip stands in its box's foot.
  if (dictation !== undefined && dictation.phase !== DICTATION_PHASE.IDLE) {
    return <DictationStrip dictation={dictation} />;
  }

  const start = (
    <HStack spacing={TOOL_SPACING}>
      <HStack modifiers={[onGeometryChange(({ width }) => measured("add")(width))]}>
        <AddPress menu={addMenu} onAdd={onAdd} testId={testIds?.add} />
      </HStack>
      <CapsuleScroll onWhole={measured("capsules")}>{tools}</CapsuleScroll>
    </HStack>
  );

  // Note that what is picked and the presses are each measured at their whole width (`fixedSize`) whichever layout stands, so the layout never feeds what chooses it; a model of a longer or shorter name is measured as it is drawn.
  const picked =
    trailing === undefined ? null : (
      <HStack
        modifiers={
          pickedWhole(widths)
            ? [fixedSize(), onGeometryChange(({ width }) => measured("picked")(width))]
            : []
        }
      >
        {trailing}
      </HStack>
    );

  const presses = (
    <HStack
      spacing={TOOL_SPACING}
      modifiers={[fixedSize(), onGeometryChange(({ width }) => measured("presses")(width))]}
    >
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

  // Note that what is picked for the message, such as the model, is offered the row first and holds its whole words, so the capsules before it give way rather than cut its name short, as Apple's own rows never cut a control's word where they have room; a priority alone still left the agent page's chip "Op…" beside the capsules' scroll.
  const end = (
    <HStack
      spacing={TOOL_SPACING}
      modifiers={[layoutPriority(1), onGeometryChange(({ width }) => measuredEnd(width))]}
    >
      {picked}
      {presses}
    </HStack>
  );

  // Note that an end wider than the row, as at an accessibility size on a phone, stands what is picked on a line of its own over the presses, as iOS stacks a row's parts at those sizes, so the model's name stays whole and Send stays inside the glass; past even that line's width the name is cut.
  const ends = endFits(widths) ? (
    <HStack spacing={TOOL_SPACING}>
      <Spacer />
      {end}
    </HStack>
  ) : (
    <>
      {picked === null ? null : (
        <HStack spacing={TOOL_SPACING}>
          <Spacer />
          {picked}
        </HStack>
      )}
      <HStack spacing={TOOL_SPACING}>
        <Spacer />
        {presses}
      </HStack>
    </>
  );

  return (
    <VStack
      alignment="leading"
      spacing={TOOL_SPACING}
      modifiers={[
        // Note that the row is measured as the room the glass gives it, never its own content's width, since an end holding its whole width past that room had grown the row, and the glass with it, to fit, so the end always seemed to fit (`endFits`).
        frame({ minWidth: 0, maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
        onGeometryChange(({ width }) => measured("row")(width)),
        ROW_SIDES,
      ]}
    >
      {capsulesOwnLine(widths) || !endFits(widths) ? (
        <>
          {start}
          {ends}
        </>
      ) : (
        <HStack spacing={TOOL_SPACING}>
          {start}
          {end}
        </HStack>
      )}
    </VStack>
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
      // Note that a field over a row of controls stands on the glass alone, as the desktop's box stands its field and its row on one ground, with no filled box of ours behind the words.
      field={!rowed}
      head={props.head}
      heads={props.pills !== undefined}
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

  // Note that a composer with a row under its field stands it there inside the same glass, as the bar does, and that a field of pills keeps the column even with no head over it, so the `@` offer coming and going never draws the field anew and drops its keyboard.
  const foot =
    props.head === undefined && !rowed && props.pills === undefined ? (
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
