import type { AgentAttachment } from "@repo/features/agent-wire";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { pasteCutWords } from "@repo/features/words";
import {
  COMPOSER_LOOK,
  ComposerBody,
  ComposerFoot,
  ComposerFrame,
  type ComposerLook,
  type ComposerNote,
  type ComposerSend,
  type ComposerStop,
  cn,
  MicrophoneIcon,
  MoreButton,
  moreLabel,
  PlusIcon,
  riseAboveEnd,
  useMenu,
} from "@repo/ui";
import { OPENAI_KEY_MISSING_NOTE } from "@repo/ui/microphone-access";
import { UNREPORTED } from "@repo/ui/reported-failure";
import { useQuery } from "@tanstack/react-query";
import {
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PromptInput, submitPromptInput } from "../ai-elements/prompt-input.js";
import { useSideBundles } from "../bundle-loader.js";
import {
  COMPOSER_INPUT,
  type ComposerEditorHandle,
  type DescriptionEditorModule,
} from "../description-editor/contract.js";
import { ActionMenu, type MenuEntry } from "../desktop/action-menu.js";
import { failureShown, unreadShown } from "../failure-report.js";
import type { KeystrokeSpanName } from "../panel-spans.js";
import {
  type AttachedFiles,
  type AttachedFilesOptions,
  useAttachedFiles,
} from "../use-attached-files.js";
import {
  ATTACH_FILES,
  AttachFilesButton,
  type AttachPicker,
  attachmentRow,
} from "./attach-files-button.js";
import { AttachedFileChips, attachmentChips } from "./attached-file-chips.js";
import { ComposerField, type ComposerFieldFiles } from "./composer-field.js";
import { type ComposerPickers, useComposerPickers } from "./composer-pickers.js";
import { DictateButton, DictationStrip } from "./dictation-strip.js";
import { useWordFiles } from "./file-chips.js";
import { ComposerQuoteView } from "./reply-to-selection.js";
import type { DictationControl } from "./use-dictation.js";

/**
 * message-box.tsx -- the one box words are written in: an agent's message box, a description comment's field, and the field-only boxes of an Inbox form and an automation's prompt.
 *
 * A box is a hook and what it draws (`useMessageBox`, then `MessageBox` or
 * `MessageField`). The hook takes everything the box does: its words, what
 * its field is called, Send and Enter (`onSubmit`), whether it takes files,
 * the `@` list of the page's mentions, the `/` list of the repository's
 * skills where the owner hands them, dictation (`composer-pickers.tsx`), and
 * the keys the field leaves. It answers what an owner reads to say what its
 * Send does: the files, whether one is still read, the box's own note, and
 * how narrow the card stands. `MessageBox` draws the card: the shared
 * composer card (`../ai-elements/prompt-input.tsx`), a form whose Send and
 * Enter both submit it, each file it takes written into its words as its
 * chip where the caret stood (`file-chips.tsx`), and the files its words
 * do not name in a row over its field (`@repo/ui`'s `ComposerBody`), and
 * its foot (`ComposerFoot`): the + at the left, which
 * opens the file picker or, where the owner hands rows (`plus`), a menu of
 * Attachment and those rows; the owner's `tools` after it; at the right the
 * owner's `actions`, the microphone, the ⋯, and the owner's `beforeSend`;
 * then Send, or the owner's Stop in its place, and one note under the bar.
 * `MessageField` draws the field alone in a frame sized as a text field, for
 * a box that sends with its page.
 *
 * The box says four things of its own under the bar, the last said
 * standing: a file refused, a dictation that left nothing, a paste cut to
 * the room left, and that the editor bundle could not be loaded, with
 * Retry, the field inert meanwhile. The owner says what it says over them.
 *
 * The foot answers the card's own width, not the window's (the `composer`
 * container, tasks.css). As the card narrows, the owner's tools draw their
 * marks alone (`folds(FOLD_WIDTH.TOOLS)`); then the ⋯ takes in, in this
 * order, the owner's presses it offers in their stead (an agent's context
 * ring and permission mode chip) and the microphone, where the ring stands, since a ⋯ holding the
 * microphone alone would be one press behind two; then the owner's
 * chip draws its mark alone (`FOLD_WIDTH.MODEL`); and last the + goes into
 * the ⋯ too, which offers the + menu's rows in its place. The field and
 * Send always stand whole. What the ⋯ takes in is the stylesheet's, read
 * off the card as it opens; a popover it opens hangs where the ⋯ stands.
 */

/** What the box's note says while the editor bundle could not be loaded. */
const EDITOR_LOAD_FAILED = "The message box could not be loaded.";

/** What the box's own presses are called. */
const BOX_WORDS = {
  ADD: "Add files and more",
  DICTATE: "Dictate",
  MORE_THING: "Composer",
} as const;

/** What the box said last of its own: a file refused, a dictation that left nothing, or a paste cut. */
const SAID = {
  FILE: "file",
  DICTATION: "dictation",
  CUT: "cut",
} as const;

type Said = (typeof SAID)[keyof typeof SAID];

/** A comment's dictation hears no names of its own, which an agent's box takes from its repository. */
const NO_KEYWORDS: readonly string[] = [];

/** A + that offers nothing beside files, and a ⋯ that takes in none of the owner's presses. */
const NO_ROWS: readonly MenuEntry[] = [];
const NO_OFFERS: readonly OverflowOffer[] = [];

/**
 * The card widths below which a press draws its mark alone: the owner's
 * tools after the + first (New task's Runs on chip), then the owner's
 * presses that carry words (New task's Plan toggle, at the step the ⋯
 * stands), then the owner's chip (an agent's model). Note that they are
 * steps of the same order as the stylesheet's `composer` queries (tasks.css's,
 * and New task's in desktop.css, at 400 and 240), because the room each
 * leaves is counted on the steps before it.
 */
export const FOLD_WIDTH = {
  TOOLS: 520,
  ACTIONS: 400,
  MODEL: 300,
} as const;

export type FoldWidth = (typeof FOLD_WIDTH)[keyof typeof FOLD_WIDTH];

/** The fold widths, narrowest first. */
const FOLD_LINES = Object.values(FOLD_WIDTH).toSorted((a, b) => a - b);

/** The presses a narrow card's ⋯ takes in, by the class each wears on the foot. */
export const OVERFLOW_PRESS = {
  ATTACH: "message-box-attach",
  CONTEXT: "agent-context-button",
  DICTATE: "dictate-button",
} as const;

type OverflowPress = (typeof OVERFLOW_PRESS)[keyof typeof OVERFLOW_PRESS];

/** A press the ⋯ may take in, and the rows the menu offers in its place. */
export interface OverflowOffer {
  readonly press: OverflowPress;
  readonly entries: readonly MenuEntry[];
}

/** What the box's `@` and `/` lists and dictation take as `useComposerPickers` takes them: the agent the words go to, its skills and servers, Escape, and the lists' side. */
type PickerOptions = Omit<
  Parameters<typeof useComposerPickers>[0],
  "editor" | "room" | "draft" | "placeholder" | "keywords" | "onNote"
>;

/** Everything a box does: its words, what its field is called, Send and Enter, its files, its lists, and its keys. */
interface MessageBoxOptions extends PickerOptions {
  readonly draft: string;
  readonly setDraft: (text: string) => void;
  readonly placeholder: string;
  readonly label: string;
  readonly maxLength: number;
  /** What Send and Enter do. */
  readonly onSubmit: () => void;
  /** Whether the box takes nothing now, as an agent's while a send holds it, or a form's field while it is disabled. */
  readonly held?: boolean | undefined;
  /** Where the box's files are kept; the box keeps its own where none is handed. */
  readonly holder?: AttachedFilesOptions["holder"];
  /** Whether the box takes files at all, each written into its words as its chip; a field-only box sends words alone. */
  readonly takesFiles?: boolean | undefined;
  /** Whether words pasted long enough to bury the message come as a text file, as an agent's box takes them. */
  readonly pastesTextAsFile?: boolean | undefined;
  /** The words a dictation is likely to say (`dictation-keywords.ts`); none for a comment. */
  readonly keywords?: readonly string[] | undefined;
  /** A key the field's lists and dictation left, answering whether the owner took it. */
  readonly onKey?: ((event: KeyboardEvent) => boolean) | undefined;
  /** Whether a bare Enter writes a new line, so only ⌘ or Ctrl with Enter submits, as in a field whose words are kept rather than sent. */
  readonly enterWrites?: boolean | undefined;
  /** Whether the field takes the caret as it mounts, unless the developer is typing elsewhere; none on a phone's Home, or beside a list K and J step. */
  readonly takesFocus?: boolean | undefined;
  /** Whether the field takes the caret as it mounts, over `takesFocus` and whoever is typing elsewhere, as an opened comment's does. */
  readonly focus?: boolean | undefined;
  /** Whether the owner hands the field focus where it stands as the box first draws, as a dialog's card does, so the field takes it itself only where its editor lands later. */
  readonly focusedByOwner?: boolean | undefined;
  /** What the field says of itself beside its name, as a form's field names its label and whether it is required. */
  readonly aria?: Readonly<Record<string, string | undefined>> | undefined;
  /** The span its keystrokes are timed under; a message box's where none is given. */
  readonly keystrokeSpan?: KeystrokeSpanName | undefined;
}

/** What `MessageBox` and `MessageField` draw a box from, which its owner never reads. */
interface Drawn {
  readonly options: MessageBoxOptions;
  readonly inWords: BoxFiles;
  readonly module: DescriptionEditorModule | undefined;
  readonly pickers: ComposerPickers;
  readonly takesFocus: boolean;
  readonly say: (kind: Said, words: string | undefined) => void;
}

/** The key a box keeps what it is drawn from under, out of its owner's reach. */
const DRAWN: unique symbol = Symbol("message-box drawn");

/** A box as its owner reads it. */
export interface MessageBoxControl {
  /** The field's editor, for what lays words in from outside; nothing until it has mounted. */
  readonly editor: RefObject<ComposerEditorHandle | undefined>;
  /** The field's own element. */
  readonly room: RefObject<HTMLDivElement | null>;
  /** The card's own element. */
  readonly frame: RefObject<HTMLElement | null>;
  readonly files: AttachedFiles;
  readonly dictation: DictationControl;
  /** Whether a dictation records or is heard, which holds the words still. */
  readonly dictating: boolean;
  /** What the box says of its own under the bar, and whether it is a paste cut, which an owner's failed send stands over; nothing where it has nothing to say. */
  readonly note: { readonly note: ComposerNote; readonly cut: boolean } | undefined;
  /** Takes the box's own notes down, as its words going does. */
  readonly quiet: () => void;
  /** Whether the card stands narrower than `below`, where a press draws its mark alone. */
  readonly folds: (below: FoldWidth) => boolean;
  /** A popover's open setter that hands the keyboard back to the ⋯ as it closes, where the ⋯ opened it in place of its hidden press. */
  readonly handBack: (set: (open: boolean) => void) => (open: boolean) => void;
  readonly [DRAWN]: Drawn;
}

/** The presses standing on the card's foot that the stylesheet hid for want of room. */
function hiddenPresses(
  card: HTMLElement | null,
  offers: readonly OverflowOffer[],
): readonly OverflowPress[] {
  if (card === null) return [];
  return offers
    .map((offer) => offer.press)
    .filter((press) => {
      const element = card.querySelector(`.${press}`);
      return element !== null && getComputedStyle(element).display === "none";
    });
}

/**
 * The narrowest fold width the card lays its foot out under, followed as it
 * resizes; nothing before it was laid out, or where it is wider than every
 * fold. Note that it holds the fold rather than the width, because the card
 * resizes as every pane beside it lands, and a width held would draw the
 * whole box again mid-glide for the chips it already draws.
 */
function useFootFold(card: RefObject<HTMLElement | null>): FoldWidth | undefined {
  const [under, setUnder] = useState<FoldWidth | undefined>(undefined);
  useEffect(() => {
    const form = card.current;
    if (form === null) return undefined;
    const measure = () => {
      const style = getComputedStyle(form);
      const inner =
        form.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight);
      setUnder(inner > 0 ? FOLD_LINES.find((line) => inner < line) : undefined);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(form);
    return () => observer.disconnect();
  }, [card]);
  return under;
}

/** The box's own note: what it said last, or that the editor did not load, with Retry. */
function ownNote(
  said: { readonly said: Said; readonly words: string } | undefined,
  unloaded: boolean,
  retry: () => void,
): MessageBoxControl["note"] {
  if (said !== undefined) {
    return {
      cut: said.said === SAID.CUT,
      // Note that a refused file and a cut paste are the person's input checked, and a dictation that left nothing a failure of the app's.
      note: {
        words: said.words,
        failure:
          said.said === SAID.DICTATION
            ? failureShown({
                surface: FAILURE_SURFACE.DICTATION,
                cause: FAILURE_CONDITION.REFUSED,
                refused: true,
              })
            : UNREPORTED.INPUT,
      },
    };
  }
  if (!unloaded) return undefined;
  return {
    cut: false,
    note: {
      words: EDITOR_LOAD_FAILED,
      failure: unreadShown(FAILURE_SURFACE.BUNDLE_LOAD),
      onRetry: retry,
    },
  };
}

/**
 * The foot's ⋯, which the stylesheet shows only once the card is too narrow
 * for every press: opened, it offers each press the stylesheet hid, read as
 * it opens, so it never offers one still standing beside it. The card
 * changing width closes it, since what it offers was read at the old width;
 * the panel beside it may be dragged with no window resize.
 */
function BoxMore({
  card,
  offers,
}: {
  card: RefObject<HTMLElement | null>;
  offers: readonly OverflowOffer[];
}): React.JSX.Element {
  const menu = useMenu(true);
  const [taken, setTaken] = useState<readonly OverflowPress[]>([]);
  const trigger = menu.trigger(riseAboveEnd);
  const standing = menu.open !== undefined;
  const { close } = menu;
  useEffect(() => {
    const box = card.current;
    if (!standing || box === null) return undefined;
    const width = box.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      if (box.getBoundingClientRect().width !== width) close(false);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [standing, close, card]);
  const actions = offers
    .filter((offer) => taken.includes(offer.press))
    .flatMap((each) => each.entries);
  return (
    <>
      <span className="message-box-more hidden">
        <MoreButton
          thing={BOX_WORDS.MORE_THING}
          {...trigger}
          onClick={(event) => {
            setTaken(hiddenPresses(card.current, offers));
            trigger.onClick(event);
          }}
        />
      </span>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          replayUnmasked
          label={moreLabel(BOX_WORDS.MORE_THING)}
          menu={menu.drawn}
          groups={[actions]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** The + press's own box at the foot's left, which the narrowest card hides as the ⋯ takes the press in. */
export function ComposerAttach({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className={`${OVERFLOW_PRESS.ATTACH} flex`}>{children}</span>;
}

/** The presses at the foot's right, before Send: the owner's, the microphone, and the ⋯. */
export function ComposerActions({ children }: { children: ReactNode }): React.JSX.Element {
  // It may narrow, so a long chip's words are cut short before the presses are.
  return (
    <div className="message-box-actions relative flex min-w-0 flex-initial items-center gap-tight-gap">
      {children}
    </div>
  );
}

/** The files a box holds as its words name them: the files drawn beside the words, the field's file chips, and the viewer a chip opens. */
interface BoxFiles {
  readonly beside: readonly AgentAttachment[];
  readonly field: ComposerFieldFiles | undefined;
  readonly viewer: ReactNode;
}

/**
 * The box's files: each file whose marker the words hold drawn there as its
 * chip, opening over the window and walking the files in the order the
 * words name them, and every other file beside the words, as every file
 * stood before files went into the words: one the words could not take, its
 * editor not loaded or its bound reached, or whose chip was copied into
 * code. Where the box takes none into its words, every file beside them.
 */
function useBoxFiles(
  takes: boolean,
  draft: string,
  attachments: readonly AgentAttachment[],
): BoxFiles {
  const chips = attachmentChips(attachments);
  const shown = useWordFiles(chips, takes ? draft : "");
  const names = useMemo(() => new Set(attachments.map((file) => file.name)), [attachments]);
  if (!takes) return { beside: attachments, field: undefined, viewer: null };
  return {
    beside: attachments.filter((_, at) => shown.beside.some((chip) => chip === chips[at])),
    // Note that every file the box holds is chipped, so a marker undo brings back is its chip at once.
    field: { names, chip: shown.chip },
    viewer: shown.viewer,
  };
}

/** The box's field, as both its card and a field-only frame draw it; `onEnter` is what a bare Enter, or ⌘ with Enter where Enter writes, does. */
function BoxField({
  box,
  onEnter,
}: {
  box: MessageBoxControl;
  onEnter: () => void;
}): React.JSX.Element {
  const { options, module, pickers, takesFocus, say, inWords } = box[DRAWN];
  const { files } = box;
  const held = options.held === true;
  const takesFiles = options.takesFiles !== false;
  return (
    <ComposerField
      keystrokeSpan={options.keystrokeSpan}
      module={module}
      editor={box.editor}
      room={box.room}
      draft={options.draft}
      // Note that the words changing again takes a cut paste's note down, so it never outlives the paste it was said of.
      setDraft={(text) => {
        if (box.note?.cut === true) box.quiet();
        options.setDraft(text);
        files.follow(text);
      }}
      onPasteCut={() => say(SAID.CUT, pasteCutWords(options.maxLength))}
      placeholder={options.placeholder}
      label={options.label}
      input={
        held
          ? COMPOSER_INPUT.DISABLED
          : box.dictating
            ? COMPOSER_INPUT.READ_ONLY
            : COMPOSER_INPUT.EDITABLE
      }
      maxLength={options.maxLength}
      takesFocus={takesFocus}
      focus={options.focus}
      enterWrites={options.enterWrites === true}
      {...pickers.field}
      aria={{ ...pickers.field.aria, ...options.aria }}
      onKey={(event) => pickers.field.onKey(event) || options.onKey?.(event) === true}
      onEnter={onEnter}
      onPasteFiles={takesFiles ? files.paste : () => false}
      onPasteText={options.pastesTextAsFile === true ? files.pasteText : undefined}
      files={inWords.field}
      quote={(quote) => <ComposerQuoteView quote={quote} held={held || box.dictating} />}
    />
  );
}

/** A box written with `options`, as above. */
export function useMessageBox(options: MessageBoxOptions): MessageBoxControl {
  const editor = useRef<ComposerEditorHandle | undefined>(undefined);
  const room = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLElement>(null);
  const [said, setSaid] = useState<{ readonly said: Said; readonly words: string } | undefined>(
    undefined,
  );
  const say = (kind: Said, words: string | undefined) =>
    setSaid(words === undefined ? undefined : { said: kind, words });
  const bundle = useQuery(useSideBundles().descriptionEditor);
  // Whether the editor stood as the box first drew, which an owner that focuses the field focuses.
  const [mountedFirst] = useState(bundle.data !== undefined);
  const takesFiles = options.takesFiles !== false;
  const files = useAttachedFiles({
    holder: options.holder,
    held: options.held === true || !takesFiles,
    onRefusal: (words) => say(SAID.FILE, words),
    words: options.draft,
    inWords: takesFiles
      ? {
          place: () => {
            const mark = editor.current?.mark();
            return mark === undefined ? undefined : (names) => mark.insertFiles(names);
          },
        }
      : undefined,
  });
  const inWords = useBoxFiles(takesFiles, options.draft, files.attachments);
  const { draft, placeholder, keywords = NO_KEYWORDS, ...picked } = options;
  const pickers = useComposerPickers({
    ...picked,
    editor,
    room,
    draft,
    placeholder,
    keywords,
    onNote: (words) => say(SAID.DICTATION, words),
  });
  const fold = useFootFold(frame);
  // Note that a popover closed by key while the ⋯ stands hands focus to the
  // ⋯, after its own close has handed it to its hidden press, because a
  // hidden press can hold no keyboard; with the press drawn, the ⋯ is not.
  const handBack = (set: (open: boolean) => void) => (open: boolean) => {
    const more = frame.current?.querySelector<HTMLElement>(".message-box-more") ?? null;
    const press = more?.querySelector<HTMLElement>("button") ?? null;
    const returning =
      !open && (document.activeElement?.closest(".ui-anchored-popover") ?? null) !== null;
    set(open);
    if (returning && more !== null && press !== null && getComputedStyle(more).display !== "none") {
      queueMicrotask(() => press.focus());
    }
  };
  return {
    editor,
    room,
    frame,
    files,
    dictation: pickers.dictation,
    dictating: pickers.dictating,
    // Note that a bundle that failed is not kept (`bundle-loader.ts`), so Retry imports it again.
    note: ownNote(said, bundle.isError, () => void bundle.refetch()),
    quiet: () => setSaid(undefined),
    folds: (below) => fold !== undefined && fold <= below,
    handBack,
    [DRAWN]: {
      options,
      inWords,
      module: bundle.data,
      pickers,
      takesFocus:
        options.takesFocus !== false && !(options.focusedByOwner === true && mountedFirst),
      say,
    },
  };
}

/** The card a box draws, as above. */
export function MessageBox({
  box,
  look,
  className,
  head,
  tools,
  actions,
  beforeSend,
  plus = NO_ROWS,
  more = NO_OFFERS,
  send,
  stop,
  note,
  ...frame
}: Omit<HTMLAttributes<HTMLFormElement>, "onSubmit" | "className" | "children"> & {
  box: MessageBoxControl;
  look?: ComposerLook | undefined;
  /** The owner's class, which places the card in its surface. */
  className?: string | undefined;
  /** What stands over the field inside the card: an answer's question, a comment's sends not sent. */
  head?: ReactNode;
  /** What stands after the + at the foot's left: New task's Runs on chip. */
  tools?: ReactNode;
  /** What stands first at the foot's right, before the microphone: an agent's model chip and context ring, a comment's Start a review. */
  actions?: ReactNode;
  /** What stands just before Send: an edit's Cancel. */
  beforeSend?: ReactNode;
  /** The rows the + menu offers after Attachment; none opens the file picker from the + itself. */
  plus?: readonly MenuEntry[] | undefined;
  /** The owner's presses the ⋯ takes in as the card narrows, and the rows it offers for each. */
  more?: readonly OverflowOffer[] | undefined;
  send: ComposerSend;
  stop?: ComposerStop | undefined;
  /** What the owner says under the bar over the box's own notes; nothing where it has nothing to say, which says the box's. */
  note?: ComposerNote | undefined;
}): React.JSX.Element {
  const { options, module, inWords } = box[DRAWN];
  const { files, room, dictation } = box;
  const picker = useRef<AttachPicker>(null);
  const held = options.held === true;
  const takesFiles = options.takesFiles !== false;
  const openPicker = () => picker.current?.open();
  // Note that a + folded away hands the ⋯ its menu's rows, or its own press where it opens the picker itself.
  const offers: readonly OverflowOffer[] = [
    ...(takesFiles
      ? [
          {
            press: OVERFLOW_PRESS.ATTACH,
            entries:
              plus.length === 0
                ? [
                    {
                      label: ATTACH_FILES,
                      icon: <PlusIcon />,
                      disabled: held,
                      onSelect: openPicker,
                    },
                  ]
                : [attachmentRow(openPicker, held), ...plus],
          },
        ]
      : []),
    ...more,
    {
      press: OVERFLOW_PRESS.DICTATE,
      entries: [
        {
          label: dictation.keyMissing ? OPENAI_KEY_MISSING_NOTE : BOX_WORDS.DICTATE,
          icon: <MicrophoneIcon />,
          disabled: held || module === undefined,
          onSelect: dictation.start,
        },
      ],
    },
  ];
  return (
    <PromptInput
      {...frame}
      ref={box.frame}
      className={cn("message-box", className)}
      look={look}
      dropping={files.drop.dropping}
      onSubmit={options.onSubmit}
    >
      {head}
      <ComposerBody
        files={
          takesFiles ? (
            <>
              {/* Note that the row holds only files the words do not name: one the words could not take, its editor not loaded or its bound reached, one whose marker stands in code, and a comment's own files sent before markers. */}
              <AttachedFileChips
                files={attachmentChips(inWords.beside)}
                onRemove={
                  held
                    ? undefined
                    : (index) => {
                        const file = inWords.beside[index];
                        if (file !== undefined) files.remove(files.attachments.indexOf(file));
                      }
                }
              />
              {inWords.viewer}
            </>
          ) : undefined
        }
      >
        <BoxField
          box={box}
          onEnter={() => {
            if (room.current !== null) submitPromptInput(room.current);
          }}
        />
      </ComposerBody>
      <ComposerFoot
        tools={
          <>
            {takesFiles ? (
              <ComposerAttach>
                <AttachFilesButton
                  label={plus.length === 0 ? ATTACH_FILES : BOX_WORDS.ADD}
                  disabled={held}
                  picker={picker}
                  onFiles={files.attach}
                  more={plus}
                />
              </ComposerAttach>
            ) : null}
            {tools}
          </>
        }
        counter={{ length: options.draft.length, limit: options.maxLength }}
        actions={
          <ComposerActions>
            {actions}
            <DictateButton dictation={dictation} disabled={held || module === undefined} />
            <BoxMore card={box.frame} offers={offers} />
            {beforeSend}
          </ComposerActions>
        }
        strip={box.dictating ? <DictationStrip dictation={dictation} /> : undefined}
        send={send}
        stop={stop}
        note={note ?? box.note?.note}
      />
    </PromptInput>
  );
}

/** A box's field alone, in a frame sized as a text field, for a box that sends with its page: an Inbox form's field, an automation's prompt. */
export function MessageField({
  box,
  look = COMPOSER_LOOK.INPUT,
  className,
  invalid,
  ...frame
}: Omit<HTMLAttributes<HTMLElement>, "className" | "children"> & {
  box: MessageBoxControl;
  look?: ComposerLook | undefined;
  /** The owner's class, which places and sizes the field in its surface. */
  className?: string | undefined;
  /** Whether what it holds is what stops its form. */
  invalid?: boolean | undefined;
}): React.JSX.Element {
  const { options } = box[DRAWN];
  return (
    <ComposerFrame {...frame} look={look} className={className} invalid={invalid}>
      <BoxField box={box} onEnter={options.onSubmit} />
    </ComposerFrame>
  );
}
