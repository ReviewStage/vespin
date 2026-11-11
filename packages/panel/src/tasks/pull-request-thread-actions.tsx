import type { ReviewThread } from "@repo/features/agent-wire";
import { PULL_REQUEST_ACTION } from "@repo/features/pull-request-write-wire";
import { BUTTON_SIZE, IconButton, Tooltip } from "@repo/ui";
import { CheckIcon, RotateCcwIcon } from "lucide-react";
import { createContext, type ReactNode, useContext, useRef } from "react";
import { DRAFT_PLACE, useDraft } from "../composer-drafts.js";
import { type HeldBodies, heldBodies } from "./comment-drafts.js";
import { CommentEditor, overCommentBound } from "./comment-editor.js";
import { REPLY_VARIANT } from "./comment-variant.js";
import {
  PullRequestWriteNote,
  type PullRequestWrites,
  type ReadAgain,
  usePullRequestWrites,
} from "./pull-request-writes.js";

/**
 * pull-request-thread-actions.tsx -- what a member does on a review thread of an agent's pull request, wherever the thread is drawn: reply to it, and resolve it or open it again, as a description's thread offers.
 *
 * Each is one change (`PULL_REQUEST_ACTION.REPLY_TO_THREAD`,
 * `RESOLVE_THREAD`, `UNRESOLVE_THREAD`) naming the thread by GitHub's own
 * id, which the conversation's read carries, made on GitHub by the service
 * as the member pressing it, on their own GitHub sign-in and never
 * our GitHub App's; GitHub's refusal stands under the thread in its own
 * words, with the sign-in offered where GitHub would not take the
 * member's. Whatever GitHub answered, the tab reads the conversation
 * again, so the thread says where it stands now.
 *
 * They stand where a description thread's do: Resolve at the head's end,
 * and the reply on the one message box, its words kept by the thread's id,
 * with no `@` (GitHub names logins) and no files (GitHub takes none).
 *
 * The controls are the thread's own, so a thread drawn anywhere in the tab,
 * in the Conversation or on its line in Files changed, carries them: the
 * tab says which agent's pull request its threads are on, and what to read
 * again once one changes, through `ThreadWritesProvider`, and a thread
 * drawn outside one, or read from a service that names no thread's id,
 * offers none.
 */

/** The controls' own words. */
const THREAD_WORDS = {
  REPLY: "Reply",
  REPLYING: "Replying",
  RESOLVE: "Resolve",
  RESOLVING: "Resolving",
  REOPEN: "Reopen",
  REOPENING: "Reopening",
} as const;

/** Which agent's pull request a tab's threads are on, and what to read again once one changes. */
interface ThreadWrites {
  readonly agentId: string;
  readonly onWritten: ReadAgain;
}

/** What a tab's threads write on, and the words held in its pending-comment edits, which outlast the box they were written in. */
interface ThreadWritesHeld extends ThreadWrites {
  readonly edits: HeldBodies;
}

const ThreadWritesContext = createContext<ThreadWritesHeld | undefined>(undefined);

/**
 * Gives every review thread drawn under it its controls, on the agent named,
 * and keeps the words of an edit closed unsent for as long as it stands, by
 * the comment's id, so one closed by Esc, or scrolled out of the list and
 * back, loses nothing.
 */
export function ThreadWritesProvider({
  value,
  children,
}: {
  value: ThreadWrites;
  children: ReactNode;
}): React.JSX.Element {
  const edits = useRef(heldBodies());
  return (
    <ThreadWritesContext.Provider
      value={{
        agentId: value.agentId,
        onWritten: value.onWritten,
        edits: edits.current,
      }}
    >
      {children}
    </ThreadWritesContext.Provider>
  );
}

/** Which agent's pull request the tab around the caller writes to, and what it reads again after; none outside a tab. A reaction's controls take it too (`pull-request-reactions.tsx`). */
export function useThreadWriting(): ThreadWritesHeld | undefined {
  return useContext(ThreadWritesContext);
}

/** What a thread drawn outside a tab reads again once changed: nothing, since it offers no change. */
export function noop(): void {}

/** A thread's controls: the agent its pull request is the agent's, GitHub's id for it, and the one change it has out, which its Resolve and its reply share. */
export interface ThreadControls {
  readonly agentId: string;
  readonly threadId: string;
  readonly writes: PullRequestWrites;
}

/** The controls of `thread`; none where the tab gives it no agent or the read named no id for it. */
export function useThreadControls(thread: ReviewThread): ThreadControls | undefined {
  const writing = useThreadWriting();
  const writes = usePullRequestWrites(writing?.agentId ?? "", writing?.onWritten ?? noop);
  if (writing === undefined || thread.id === undefined) return undefined;
  return { agentId: writing.agentId, threadId: thread.id, writes };
}

/** Resolve, or Reopen where the thread is resolved, as a glyph at the head's end; nothing without controls. */
export function ThreadResolve({
  controls,
  resolved,
  onRefused,
}: {
  controls: ThreadControls | undefined;
  resolved: boolean;
  /** Hears GitHub's refusal, which stands under the comments, so a folded card opens on it. */
  onRefused: () => void;
}): React.JSX.Element | null {
  if (controls === undefined) return null;
  const { threadId, writes } = controls;
  const action = resolved
    ? PULL_REQUEST_ACTION.UNRESOLVE_THREAD
    : PULL_REQUEST_ACTION.RESOLVE_THREAD;
  const label = resolved ? THREAD_WORDS.REOPEN : THREAD_WORDS.RESOLVE;
  return (
    <Tooltip label={label}>
      <IconButton
        size={BUTTON_SIZE.COMPACT}
        icon={resolved ? <RotateCcwIcon /> : <CheckIcon />}
        label={label}
        disabled={writes.pending !== undefined && writes.pending !== action}
        busy={writes.pending === action}
        busyLabel={resolved ? THREAD_WORDS.REOPENING : THREAD_WORDS.RESOLVING}
        onClick={() =>
          void writes.write({ action, threadId }).then((outcome) => {
            if (!outcome.done) onRefused();
          })
        }
      />
    </Tooltip>
  );
}

/** The reply's box, as a description's thread draws its own, in GitHub's Markdown: Enter sending, and Esc leaving it with its words kept. */
function ReplyBox({ controls }: { controls: ThreadControls }): React.JSX.Element {
  const { agentId, threadId, writes } = controls;
  const { draft, update } = useDraft({ kind: DRAFT_PLACE.REVIEW_REPLY, agentId, threadId });
  const words = draft.text;
  const out = writes.pending;
  const sending = out === PULL_REQUEST_ACTION.REPLY_TO_THREAD;
  const blank = words.trim() === "" || overCommentBound(words);
  const send = () => {
    const body = words.trim();
    if (blank || out !== undefined) return;
    // Note that the words stay until GitHub took them, so a refusal leaves them to send again, and only the words sent go, so any written since stay.
    void writes.write({ action: PULL_REQUEST_ACTION.REPLY_TO_THREAD, threadId, body }, () =>
      update((was) => (was.text === words ? { ...was, text: "" } : was)),
    );
  };
  return (
    <CommentEditor
      variant={REPLY_VARIANT.REPLY}
      label={THREAD_WORDS.REPLY}
      placeholder={THREAD_WORDS.REPLY}
      value={words}
      onChange={(text) => update((was) => ({ ...was, text }))}
      busy={out !== undefined}
      onSubmit={send}
      send={{
        label: THREAD_WORDS.REPLY,
        empty: blank,
        held: out !== undefined && !sending,
        onSend: send,
        busy: sending,
        busyLabel: THREAD_WORDS.REPLYING,
      }}
    />
  );
}

/** Under a thread's comments: the reply's box, and GitHub's refusal of the thread's last change under it; nothing without controls. */
export function ThreadReply({
  controls,
}: {
  controls: ThreadControls | undefined;
}): React.JSX.Element | null {
  if (controls === undefined) return null;
  return (
    <div className="pull-request-thread-actions flex flex-col gap-control-gap px-list-inset pb-list-inset">
      <ReplyBox controls={controls} />
      <PullRequestWriteNote writes={controls.writes} className="pull-request-thread-note" />
    </div>
  );
}
