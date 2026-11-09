import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { pasteCutWords } from "@repo/features/words";
import {
  ComposerBody,
  ComposerFoot,
  type ComposerLook,
  type ComposerNote,
  type ComposerSend,
  type ComposerStop,
} from "@repo/ui";
import { UNREPORTED } from "@repo/ui/reported-failure";
import { useQuery } from "@tanstack/react-query";
import { type HTMLAttributes, type ReactNode, type RefObject, useRef, useState } from "react";
import { PromptInput, submitPromptInput } from "../ai-elements/prompt-input.js";
import { useSideBundles } from "../bundle-loader.js";
import {
  COMPOSER_INPUT,
  type ComposerEditorHandle,
  type DescriptionEditorModule,
} from "../description-editor/contract.js";
import { failureShown, unreadShown } from "../failure-report.js";
import type { KeystrokeSpanName } from "../panel-spans.js";
import {
  type AttachedFiles,
  type AttachedFilesOptions,
  useAttachedFiles,
} from "../use-attached-files.js";
import { AttachFilesButton } from "./attach-files-button.js";
import { AttachedFileChips, attachmentChips } from "./attached-file-chips.js";
import { ComposerField } from "./composer-field.js";
import { type ComposerPickers, useComposerPickers } from "./composer-pickers.js";
import { DictateButton, DictationStrip } from "./dictation-strip.js";
import { ComposerQuoteView } from "./reply-to-selection.js";

/**
 * message-box.tsx -- the box words are written in, an agent's message box and a description comment's field alike: its field, the files over it, dictation, the `@` and `/` lists, its foot and Send, and the one note under the bar.
 *
 * The box is the shared composer card (`../ai-elements/prompt-input.tsx`), a
 * form whose Send and Enter both submit it, its files over its field and its
 * foot under it (`@repo/ui`'s `ComposerBody` and `ComposerFoot`). The field is
 * the editor bundle's (`composer-field.tsx`), with the `@` list of the page's
 * mentions, the `/` list of the repository's skills where the owner hands
 * them, and dictation (`composer-pickers.tsx`). Files come by the foot's +,
 * a paste, or a drop on whatever the owner spreads `files.drop.target` on
 * (`use-attached-files.ts`), unless the box takes none, as a comment's edit.
 *
 * The box says four things of its own under the bar, the last said
 * standing: a file refused, a dictation that left nothing, a paste cut to
 * the room left, and that the editor bundle could not be loaded, with Retry,
 * the field inert meanwhile. The owner hands the rest: what it says instead,
 * what stands at the foot beside the microphone and over the field, Send,
 * and Stop. `agent-composer.tsx` lays an agent's chips, queue, and Stop on
 * it; `description-comments.tsx` a comment's Cancel, review, and unsent
 * sends. It is a hook and the card it draws, because an owner reads what the
 * box holds, a file still read or what it said, to say what Send does.
 */

/** What the box's note says while the editor bundle could not be loaded. */
const EDITOR_LOAD_FAILED = "The message box could not be loaded.";

/** What the box said last of its own: a file refused, a dictation that left nothing, or a paste cut. */
const SAID = {
  FILE: "file",
  DICTATION: "dictation",
  CUT: "cut",
} as const;

type Said = (typeof SAID)[keyof typeof SAID];

/** A comment's dictation hears no names of its own, which an agent's box takes from its repository. */
const NO_KEYWORDS: readonly string[] = [];

/** The note the box says of its own, and whether it is a paste cut, which an owner's failed send stands over. */
interface MessageBoxNote {
  readonly note: ComposerNote;
  readonly cut: boolean;
}

/** What the box's `@` and `/` lists and dictation take as `useComposerPickers` takes them: the agent the words go to, its skills and servers, Escape, and the lists' side. */
type PickerOptions = Omit<
  Parameters<typeof useComposerPickers>[0],
  "editor" | "room" | "draft" | "placeholder" | "keywords" | "onNote"
>;

/** What a box is written with: its words, what its field is called, and what its files and lists take. */
interface MessageBoxOptions extends PickerOptions {
  readonly draft: string;
  readonly setDraft: (text: string) => void;
  readonly placeholder: string;
  readonly label: string;
  readonly maxLength: number;
  /** Whether the box takes nothing now, as an agent's while a send holds it. */
  readonly held?: boolean | undefined;
  /** Where the box's files are kept; the box keeps its own where none is handed. */
  readonly holder?: AttachedFilesOptions["holder"];
  /** Whether the box takes files at all; a comment's edit keeps the files it was sent with. */
  readonly takesFiles?: boolean | undefined;
  /** Whether words pasted long enough to bury the message come as a text file, as an agent's box takes them. */
  readonly pastesTextAsFile?: boolean | undefined;
  /** The words a dictation is likely to say (`dictation-keywords.ts`); none for a comment. */
  readonly keywords?: readonly string[] | undefined;
}

/** A box as its owner reads it, and as `MessageBox` draws it. */
interface MessageBoxControl {
  readonly options: MessageBoxOptions;
  readonly editor: RefObject<ComposerEditorHandle | undefined>;
  readonly room: RefObject<HTMLDivElement | null>;
  /** The editor bundle; nothing until it has loaded. */
  readonly module: DescriptionEditorModule | undefined;
  readonly files: AttachedFiles;
  readonly pickers: ComposerPickers;
  /** What the box says of its own under the bar; nothing where it has nothing to say. */
  readonly note: MessageBoxNote | undefined;
  /** Takes the box's own notes down, as its words going does. */
  readonly quiet: () => void;
  /** Says `words` as the box's own note of `kind`, or takes it down where they are nothing. */
  readonly say: (kind: Said, words: string | undefined) => void;
}

/** The box's own note: what it said last, or that the editor did not load, with Retry. */
function ownNote(
  said: { readonly said: Said; readonly words: string } | undefined,
  unloaded: boolean,
  retry: () => void,
): MessageBoxNote | undefined {
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

/** A box written with `options`, as above. */
export function useMessageBox(options: MessageBoxOptions): MessageBoxControl {
  const editor = useRef<ComposerEditorHandle | undefined>(undefined);
  const room = useRef<HTMLDivElement>(null);
  const [said, setSaid] = useState<{ readonly said: Said; readonly words: string } | undefined>(
    undefined,
  );
  const say = (kind: Said, words: string | undefined) =>
    setSaid(words === undefined ? undefined : { said: kind, words });
  const bundle = useQuery(useSideBundles().descriptionEditor);
  const files = useAttachedFiles({
    holder: options.holder,
    held: options.held === true || options.takesFiles === false,
    onRefusal: (words) => say(SAID.FILE, words),
  });
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
  return {
    options,
    editor,
    room,
    module: bundle.data,
    files,
    pickers,
    // Note that a bundle that failed is not kept (`bundle-loader.ts`), so Retry imports it again.
    note: ownNote(said, bundle.isError, () => void bundle.refetch()),
    quiet: () => setSaid(undefined),
    say,
  };
}

/** The card a box draws: what stands over its field, its field and files, and its foot. */
export function MessageBox({
  box,
  onSubmit,
  head,
  tools,
  actions = (dictate) => dictate,
  send,
  stop,
  note,
  onKey,
  takesFocus = true,
  focus,
  keystrokeSpan,
  className,
  look,
  ...frame
}: Omit<HTMLAttributes<HTMLFormElement>, "onSubmit" | "className" | "children"> & {
  box: MessageBoxControl;
  /** What Send and Enter do. */
  onSubmit: () => void;
  /** What stands over the field inside the card: an answer's question, a comment's sends not sent. */
  head?: ReactNode;
  /** What stands at the foot's start, in place of the +, which an owner whose + offers more draws itself. */
  tools?: ReactNode;
  /** What stands at the foot's end before Send, handed the microphone to stand among it. */
  actions?: (dictate: ReactNode) => ReactNode;
  send: ComposerSend;
  stop?: ComposerStop | undefined;
  /** What the owner says under the bar; nothing where it has nothing to say. */
  note: ComposerNote | undefined;
  /** A key the field's lists and dictation left, answering whether the owner took it. */
  onKey?: ((event: KeyboardEvent) => boolean) | undefined;
  /** Whether the field takes the caret as it mounts, unless the developer is typing elsewhere. */
  takesFocus?: boolean;
  /** Whether the field takes the caret as it mounts, over `takesFocus` and whoever is typing elsewhere. */
  focus?: boolean | undefined;
  /** The span its keystrokes are timed under; a message box's where none is given. */
  keystrokeSpan?: KeystrokeSpanName | undefined;
  /** The owner's class, which places the card in its surface. */
  className?: string | undefined;
  look?: ComposerLook | undefined;
}): React.JSX.Element {
  const { options, editor, room, module, files, pickers } = box;
  const { dictation, dictating } = pickers;
  const held = options.held === true;
  const takesFiles = options.takesFiles !== false;
  return (
    <PromptInput
      {...frame}
      className={className}
      look={look}
      dropping={files.drop.dropping}
      onSubmit={onSubmit}
    >
      {head}
      <ComposerBody
        files={
          takesFiles ? (
            <AttachedFileChips
              files={attachmentChips(files.attachments)}
              onRemove={held ? undefined : files.remove}
            />
          ) : undefined
        }
      >
        <ComposerField
          keystrokeSpan={keystrokeSpan}
          module={module}
          editor={editor}
          room={room}
          draft={options.draft}
          // Note that the words changing again takes a cut paste's note down, so it never outlives the paste it was said of.
          setDraft={(text) => {
            if (box.note?.cut === true) box.quiet();
            options.setDraft(text);
          }}
          onPasteCut={() => box.say(SAID.CUT, pasteCutWords(options.maxLength))}
          placeholder={options.placeholder}
          label={options.label}
          input={
            held
              ? COMPOSER_INPUT.DISABLED
              : dictating
                ? COMPOSER_INPUT.READ_ONLY
                : COMPOSER_INPUT.EDITABLE
          }
          maxLength={options.maxLength}
          takesFocus={takesFocus}
          focus={focus}
          {...pickers.field}
          onKey={(event) => pickers.field.onKey(event) || onKey?.(event) === true}
          onEnter={() => {
            if (room.current !== null) submitPromptInput(room.current);
          }}
          onPasteFiles={takesFiles ? files.paste : () => false}
          onPasteText={options.pastesTextAsFile === true ? files.pasteText : undefined}
          quote={(quote) => <ComposerQuoteView quote={quote} held={held || dictating} />}
        />
      </ComposerBody>
      <ComposerFoot
        tools={
          tools ??
          (takesFiles ? <AttachFilesButton disabled={held} onFiles={files.attach} /> : undefined)
        }
        counter={{ length: options.draft.length, limit: options.maxLength }}
        actions={actions(
          <DictateButton dictation={dictation} disabled={held || module === undefined} />,
        )}
        strip={dictating ? <DictationStrip dictation={dictation} /> : undefined}
        send={send}
        stop={stop}
        note={note}
      />
    </PromptInput>
  );
}
