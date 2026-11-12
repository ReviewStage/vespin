import { PULL_REQUEST_WRITE_BOUNDS } from "@repo/features/pull-request-write-wire";
import {
  ANNOUNCE,
  BLOCK_MENU_GROUP,
  BUTTON_SIZE,
  ComposerFoot,
  ComposerFrame,
  type ComposerNote,
  type ComposerSend,
  IconButton,
  Tooltip,
} from "@repo/ui";
import { FileDiffIcon } from "@repo/ui/icons";
import { markdownClass } from "@repo/ui/markdown-class";
import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import {
  type DescriptionEditorHandle,
  EDITOR_ROOT_SELECTOR,
  FINISH,
  type Finish,
  PLACEMENT_END,
} from "../description-editor/contract.js";
import { enterSends } from "../enter-sends.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import type { OwnBlock } from "./block-picker.js";
import { REPLY_LOOK, type ReplyVariant } from "./comment-variant.js";
import { MarkdownEditor } from "./markdown-editor.js";
import { fencedBlock } from "./markdown-fence.js";

/**
 * comment-editor.tsx -- words a member sends to GitHub as Markdown, written on the description's editor: a pull request's comment, a review's, a line's, a thread's reply, and a pending comment's edit.
 *
 * The words are written where they are drawn (`markdown-editor.tsx`), so
 * no Preview stands beside them: the format toolbar over selected words,
 * Turn into among it, the `/` menu, and the writing chords are the editor's
 * own, and each block left untouched is handed back as it was written, so
 * an edit of a comment changes only what was changed. Enter sends, as every box does (`enter-sends.ts`), Shift+Enter adds a line, and Esc
 * lets go, where the owner answers either; the keys the editor took go no
 * further, so a menu's Esc never closes what holds the box. The owner holds
 * the words: a change it makes, such as letting them go once GitHub took
 * them, opens the editor again on what it now holds. A comment on lines of
 * the head offers a suggestion, from `/` and from a press over the words:
 * GitHub's ```suggestion block holding those lines as they read now, drawn
 * as a suggested change. GitHub takes no more than its bound for a comment,
 * so words past it say by how much, and the owner sends none.
 *
 * The box stands as every comment's field does (`comment-variant.ts`): a
 * reply in a card of its own, a thread's first comment and an edit bare on
 * the card around them, the shared foot (`ComposerFoot`) inside its frame
 * under the words, holding the suggestion's press where the + stands in a
 * message box, how near GitHub's bound the words stand, the owner's
 * presses, and the round send. It takes no files, since GitHub's comments
 * hold none we could send.
 */

/** The box's own words. */
const COMMENT_EDITOR_WORDS = {
  SUGGESTION: "Suggestion",
  ADD_SUGGESTION: "Add a suggestion",
  /** What the room the editor stands in is named. */
  room: (label: string) => `${label}, in Markdown`,
  /** What words past GitHub's bound say. */
  over: (by: number) =>
    `${by.toLocaleString("en-US")} ${by === 1 ? "character" : "characters"} over GitHub's limit.`,
} as const;

/** The info string GitHub reads a suggested change by. */
const SUGGESTION_INFO = "suggestion";

/** Whether the words are more than GitHub takes for a comment, which no box sends. */
export function overCommentBound(body: string): boolean {
  return body.length > PULL_REQUEST_WRITE_BOUNDS.MAX_BODY_CHARS;
}

/** The suggestion a comment on `lines` offers in its `/` menu: GitHub's suggestion block holding them as they read now. */
function suggestionBlock(lines: string): OwnBlock {
  return {
    group: BLOCK_MENU_GROUP.BLOCKS,
    row: {
      id: SUGGESTION_INFO,
      label: COMMENT_EDITOR_WORDS.SUGGESTION,
      icon: <FileDiffIcon aria-hidden="true" />,
    },
    aliases: ["suggest"],
    markdown: fencedBlock(lines, SUGGESTION_INFO),
  };
}

/** The text the editor opens on, and the count that opens it anew, kept for an owner's words changed outside it. */
interface Opened {
  readonly markdown: string;
  readonly key: number;
}

/**
 * Note that the editor opens on its words once, so words the owner changed
 * outside it, rather than the ones it last handed over, open it again.
 */
function useOpened(value: string): { opened: Opened; said: (markdown: string) => void } {
  const handed = useRef(value);
  const opened = useRef<Opened>({ markdown: value, key: 0 });

  if (value !== handed.current) {
    handed.current = value;
    opened.current = { markdown: value, key: opened.current.key + 1 };
  }

  return {
    opened: opened.current,
    said: (markdown) => {
      handed.current = markdown;
    },
  };
}

/**
 * The words, named `label` to a reader, on the description's editor in the
 * comment field's frame `variant` names; Enter is `onSubmit` and Esc
 * `onCancel` where given, `suggestion`, the lines a comment is on as they
 * read at the head, offers a suggestion where given, and the foot holds
 * `actions` before the round `send`, and `note` under them.
 */
export function CommentEditor({
  variant,
  label,
  placeholder,
  value,
  onChange,
  busy,
  focus = false,
  onSubmit,
  onCancel,
  suggestion,
  fieldRef,
  actions,
  send,
  note,
}: {
  /** How the field stands: a reply's, a thread's first comment's, or an edit's. */
  variant: ReplyVariant;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  /** Whether the words are on their way to GitHub. */
  busy: boolean;
  /** Whether the words take the keyboard as they open, at their end, once they stand in the window. */
  focus?: boolean | undefined;
  /** What Enter in the words does; none leaves Enter to write a line. */
  onSubmit?: (() => void) | undefined;
  /** What Esc in the words does; none passes it on. */
  onCancel?: (() => void) | undefined;
  /** The lines a comment is on as they read at the head, which a suggestion holds for the member to change; none offers no suggestion. */
  suggestion?: string | undefined;
  /** Where the words' own element is kept once the editor stands, for an owner that hands it the focus as it opens. */
  fieldRef?: RefObject<HTMLElement | null> | undefined;
  /** The owner's presses in the foot before the send: an edit's Cancel, a line comment's Start a review. */
  actions?: ReactNode;
  send: ComposerSend;
  /** What the owner says under the foot's bar: why the head could not be read. */
  note?: ComposerNote | undefined;
}): React.JSX.Element {
  const { opened, said } = useOpened(value);
  const handle = useRef<DescriptionEditorHandle | undefined>(undefined);
  const room = useRef<HTMLElement>(null);
  // Whether the last key the editor finished on is one no owner answers, which goes on as an untaken key does.
  const unanswered = useRef(false);
  const block = suggestion === undefined ? undefined : suggestionBlock(suggestion);
  const over = value.length - PULL_REQUEST_WRITE_BOUNDS.MAX_BODY_CHARS;
  useAnnounceShown(ANNOUNCE.ALERT, over > 0 ? COMMENT_EDITOR_WORDS.over(over) : "");

  // Note that a box drawn into a note the diff stands only once it draws again takes the keyboard once it stands in the window.
  useEffect(() => {
    const placed = room.current;

    if (!focus || placed === null || placed.isConnected) return undefined;

    const standing = new MutationObserver(() => {
      if (!placed.isConnected) return;
      standing.disconnect();
      handle.current?.focusAt(PLACEMENT_END);
    });

    standing.observe(document.body, { childList: true, subtree: true });

    return () => standing.disconnect();
  }, [focus]);

  useEffect(() => {
    if (fieldRef !== undefined) {
      fieldRef.current = room.current?.querySelector<HTMLElement>(EDITOR_ROOT_SELECTOR) ?? null;
    }
  });

  const finish = (how: Finish) => {
    const answer = how === FINISH.SUBMIT ? onSubmit : onCancel;
    unanswered.current = answer === undefined;
    answer?.();
  };

  return (
    <div className="flex min-w-0 flex-col gap-item-gap">
      <ComposerFrame
        look={REPLY_LOOK[variant]}
        className="comment-field comment-editor-frame"
        data-variant={variant}
        aria-busy={busy}
        onKeyDown={(event) => {
          const finishing = event.key === "Escape" || enterSends(event);

          if (!finishing || !event.defaultPrevented) return;

          // Note that a key the editor took, a menu's Esc or an answered finish, is the box's alone.
          if (unanswered.current) {
            unanswered.current = false;

            return;
          }

          event.stopPropagation();
        }}
      >
        <MarkdownEditor
          key={opened.key}
          markdown={opened.markdown}
          label={label}
          roomLabel={COMMENT_EDITOR_WORDS.room(label)}
          placeholder={placeholder}
          className={markdownClass(
            "comment-editor-text text-body-size leading-reading text-foreground",
          )}
          focus={focus}
          placement={focus ? PLACEMENT_END : undefined}
          handle={handle}
          room={room}
          onDraft={(markdown) => {
            said(markdown);
            onChange(markdown);
          }}
          onFinish={(_section, how) => finish(how)}
          sendsOnEnter={onSubmit !== undefined}
          ownBlocks={block === undefined ? undefined : [block]}
        />
        <ComposerFoot
          tools={
            block === undefined ? undefined : (
              <Tooltip label={COMMENT_EDITOR_WORDS.ADD_SUGGESTION}>
                <IconButton
                  size={BUTTON_SIZE.COMPACT}
                  icon={block.row.icon}
                  label={COMMENT_EDITOR_WORDS.ADD_SUGGESTION}
                  disabled={busy}
                  keepFocus
                  onClick={() => handle.current?.insertBlock({ markdown: block.markdown })}
                />
              </Tooltip>
            )
          }
          counter={{ length: value.length, limit: PULL_REQUEST_WRITE_BOUNDS.MAX_BODY_CHARS }}
          actions={actions}
          send={send}
          note={note}
        />
      </ComposerFrame>
      {over > 0 ? (
        <p className="comment-editor-note m-0 text-caption-inline text-destructive">
          {COMMENT_EDITOR_WORDS.over(over)}
        </p>
      ) : null}
    </div>
  );
}
