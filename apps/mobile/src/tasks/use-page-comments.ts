/**
 * use-page-comments.ts -- the comments on one of a task's pages as its screen marks and starts them: the elements its open threads are on, tinted in the page, and a new thread on words selected in it or on the page whole.
 *
 * The threads themselves are read as the description's are, by the page
 * (`useTaskComments` with its `pageId`). A thread is started as the panel's
 * page starts one (`TASKS_COMMENT_START` with the page, its version, and the
 * element its words were selected in, `words: true`, or none for the page
 * whole), under an id minted here, so the host draws it at once, and under a
 * key kept for as long as the words stand, so the same words sent again
 * after a lost answer start one thread. The words typed are kept for the
 * spot they were typed on until they go, and again where the service
 * refused them, so Comment pressed again on the same words opens on them.
 * Note that they are let go when the account signs out, as an agent's
 * composer drafts are (`composer-drafts.ts`), and a refusal answered after
 * that keeps nothing, so the next account signed in never opens on
 * another's words.
 */

import { COMMENT_NOTE, commentRefusalNote } from "@repo/features/description-comment-notes";
import {
  DESCRIPTION_COMMENT_SCOPE,
  type DescriptionCommentThread,
} from "@repo/features/description-comment-wire";
import type { PageMark } from "@repo/features/page-pick";
import { ACT_KIND } from "@repo/host/acts";
import { BUZZ, buzz, NOTICE_KIND, useFailureNotices } from "@repo/ui-native";
import { randomUUID } from "expo-crypto";
import { useEffect, useMemo, useRef, useState } from "react";
import { useHostActs } from "../host/host-provider.js";
import {
  type AttachedPictures,
  type HeldPicture,
  useAttachedPictures,
} from "../use-attached-pictures.js";
import { useWrite } from "../use-write.js";
import { type SentReply, sameSend, threadOpen } from "./use-comments.js";

/** The element of a page words were selected in, as its pick read it: its path, the words, and the heading it stands under. */
export interface PageElement {
  readonly path: string;
  readonly quote: string;
  readonly section: string;
}

/** Where on a page a thread is started: the page and the version read, and the element its words were selected in, or none for the page whole. */
export interface PageSpot {
  readonly pageId: string;
  readonly version: number;
  readonly element: PageElement | undefined;
}

/** A start sent and not yet answered as posted, and the thread's id it named. */
interface SentStart extends SentReply {
  readonly threadId: string;
}

/** A new thread's draft on one spot of a page: its words, the pictures picked for it, and the start the service refused or never answered, so the same words go again under its key. */
interface PageDraft {
  readonly words: string;
  readonly pictures: readonly HeldPicture[];
  readonly sent: SentStart | undefined;
}

/** What a draft on the page whole is kept under in place of an element's path and words, which are never empty. */
const WHOLE_PAGE = "";

/** Each new thread's draft, by the page, then the element's path, then the words selected, so it outlives the sheet it was typed in. */
const pageDrafts = new Map<string, Map<string, Map<string, PageDraft>>>();

/** Whether an account stood signed in when the root last looked, so a sign-out is seen as it happens. */
let wasSignedIn = false;

/** How many sign-outs the drafts have been let go for, so a refusal answered after one keeps nothing. */
let signOuts = 0;

/** Follows whether an account is signed in, letting every page draft go as one signs out. */
function followPageDraftsAccount(signedIn: boolean): void {
  if (wasSignedIn && !signedIn) {
    pageDrafts.clear();
    signOuts += 1;
  }

  wasSignedIn = signedIn;
}

/** Lets every page comment draft go when the account signs out, so the next account's fields open empty. */
export function usePageDraftsSignOut(signedIn: boolean): void {
  useEffect(() => followPageDraftsAccount(signedIn), [signedIn]);
}

/** The draft kept on one spot of a page; none kept. */
function draftOf(spot: PageSpot): PageDraft | undefined {
  return pageDrafts
    .get(spot.pageId)
    ?.get(spot.element?.path ?? WHOLE_PAGE)
    ?.get(spot.element?.quote ?? WHOLE_PAGE);
}

/** Keeps a new thread's draft on one spot of a page, or lets it go at none or once it holds nothing. */
function keepDraft(spot: PageSpot, draft: PageDraft | undefined): void {
  const path = spot.element?.path ?? WHOLE_PAGE;
  const quote = spot.element?.quote ?? WHOLE_PAGE;
  const paths = pageDrafts.get(spot.pageId) ?? new Map<string, Map<string, PageDraft>>();
  const quotes = paths.get(path) ?? new Map<string, PageDraft>();

  const empty =
    draft === undefined ||
    (draft.words === "" && draft.pictures.length === 0 && draft.sent === undefined);

  if (empty) quotes.delete(quote);
  else quotes.set(quote, draft);

  if (quotes.size === 0) paths.delete(path);
  else paths.set(path, quotes);

  if (paths.size === 0) pageDrafts.delete(spot.pageId);
  else pageDrafts.set(spot.pageId, paths);
}

/**
 * The elements a page's open threads are on, as the panel marks them in
 * its frame: each once for every different run of words a thread on it
 * quotes, so each run is tinted, and once untinted where no thread on it
 * quotes words, as a thread on the element whole does.
 */
export function pageMarks(threads: readonly DescriptionCommentThread[]): readonly PageMark[] {
  const quoted = new Map<string, Set<string>>();

  for (const thread of threads) {
    const path = thread.page?.element;

    if (path === undefined || !threadOpen(thread)) continue;
    const marked = quoted.get(path) ?? new Set<string>();
    quoted.set(path, marked);

    if (thread.scope === DESCRIPTION_COMMENT_SCOPE.WORDS) marked.add(thread.quote);
  }

  return [...quoted].flatMap(([path, words]) =>
    words.size === 0 ? [{ path }] : [...words].map((each) => ({ path, words: each })),
  );
}

/** The open threads on the element of a page a path names, the oldest started first. */
export function threadsOn(
  threads: readonly DescriptionCommentThread[],
  path: string,
): readonly DescriptionCommentThread[] {
  return threads.filter((thread) => thread.page?.element === path && threadOpen(thread));
}

/** A new thread's field on a page: its words, whether they may go, what a send that did not go said, and the send, which answers the thread's id at once, before the service has. */
export interface PageCommentStart {
  readonly words: string;
  readonly onWords: (words: string) => void;
  readonly pictures: AttachedPictures;
  readonly sendable: boolean;
  readonly send: (typed: string) => string | undefined;
  readonly note: string | undefined;
}

/**
 * A new thread on a spot of one of a task's pages, as the module's head
 * says. A send the service refused, or never answered, says why in the
 * failure notice, since the thread it opened stands in the field's place,
 * and keeps the words, the pictures, and their key on the spot.
 */
export function usePageCommentStart(taskId: string, spot: PageSpot): PageCommentStart {
  const acts = useHostActs();
  const write = useWrite();
  const notices = useFailureNotices();
  const [words, setLocal] = useState(() => draftOf(spot)?.words ?? "");
  const [note, setNote] = useState<string | undefined>(undefined);
  // Note that a second tap before the sheet has moved on would start the thread twice, so the send in flight is held here.
  const inFlight = useRef(false);

  const pictures = useAttachedPictures(setNote, undefined, undefined, {
    held: draftOf(spot)?.pictures ?? [],
    keep: (held) => {
      const was = draftOf(spot);
      keepDraft(spot, { words: was?.words ?? "", pictures: held, sent: was?.sent });
    },
  });

  return useMemo(() => {
    const onWords = (next: string) => {
      setLocal(next);
      const was = draftOf(spot);
      keepDraft(spot, { words: next, pictures: was?.pictures ?? [], sent: was?.sent });
    };

    const send = (typed: string): string | undefined => {
      const kept = typed.trim();

      if (kept === "" || inFlight.current || pictures.reading) return undefined;

      // A picture past a bound holds the start back, saying why, as an agent's composer does.
      if (pictures.refusal !== undefined) {
        setNote(pictures.refusal);
        buzz(BUZZ.WARNING);

        return undefined;
      }

      inFlight.current = true;
      const files = pictures.files ?? [];
      const was = draftOf(spot)?.sent;
      const repeated = sameSend(was, kept, files) ? was : undefined;
      const carried = pictures.take();

      const start: SentStart = {
        words: kept,
        files,
        key: repeated?.key ?? randomUUID(),
        threadId: repeated?.threadId ?? randomUUID(),
      };

      // Note that the draft goes as the send does, since the thread opens in the field's place; a refusal keeps it again below, for the same account alone.
      keepDraft(spot, undefined);
      const sentUnder = signOuts;
      const { element } = spot;

      void write(
        () =>
          acts[ACT_KIND.TASKS_COMMENT_START]({
            taskId,
            start: {
              id: start.threadId,
              clientKey: start.key,
              page: { id: spot.pageId, version: spot.version },
              ...(element === undefined ? undefined : { element: { ...element, words: true } }),
              words: kept,
              attachments: [...files],
            },
          }),
        {
          refused: (answer) =>
            "thread" in answer
              ? undefined
              : "refused" in answer
                ? commentRefusalNote(answer.refused)
                : COMMENT_NOTE.NOT_POSTED,
          unanswered: COMMENT_NOTE.NOT_POSTED,
          inPlace: (why, noticed) => {
            // Note that words typed on the same spot since, in a field opened on it again, are kept over the refused ones.
            if (sentUnder === signOuts && (draftOf(spot)?.words ?? "").trim() === "") {
              keepDraft(spot, { words: kept, pictures: carried, sent: start });
            }

            if (!noticed) notices.say({ kind: NOTICE_KIND.REFUSED, words: why });
          },
          went: BUZZ.SUCCESS,
        },
      ).finally(() => {
        inFlight.current = false;
      });

      return start.threadId;
    };

    return {
      words,
      onWords,
      pictures,
      sendable: words.trim() !== "" && !pictures.reading,
      send,
      note,
    };
  }, [acts, write, notices, taskId, spot, words, note, pictures]);
}
