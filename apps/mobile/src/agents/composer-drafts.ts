/**
 * composer-drafts.ts -- the words typed in an agent's composer and not yet sent, by the agent and by the Manager chat's thread they were typed in, held in memory beside the screens and forgotten on sign-out.
 *
 * They outlive the page that drew them, as a widening window hands a page
 * from its tab's stack to a split view's detail, each drawing its own, and
 * the page drawn anew lays no suggestion in again. Note that they are let go
 * when the account signs out, an account switch's sign-out among them, so
 * the next account signed in on the phone never opens on another's words,
 * as New task's saved drafts are (`useNewTaskDraftsSignOut`).
 */

import { useEffect } from "react";

/** Words typed and not yet sent, with the suggestion last laid into them. */
export interface UnsentDraft {
  readonly words: string;
  readonly laidFor: string | undefined;
}

/** Each agent's words typed in its own box and not yet sent, by the agent. */
const unsentWords = new Map<string, UnsentDraft>();

/** Each reply typed in a Manager chat's thread and not yet sent, by the Manager and then the message the thread hangs on, so each thread keeps a draft of its own, as the panel's thread box does. */
const unsentReplies = new Map<string, Map<string, UnsentDraft>>();

/** Whether an account stood signed in when the root last looked, so a sign-out is seen as it happens. */
let wasSignedIn = false;

/** The draft kept for the agent's own box, or for one of its chat's threads (`thread`, by its root). */
export function keptDraft(agentId: string, thread: string | undefined): UnsentDraft | undefined {
  return thread === undefined ? unsentWords.get(agentId) : unsentReplies.get(agentId)?.get(thread);
}

/** Keeps the draft of the agent's box or one of its threads, or lets it go where `draft` is none. */
export function keepDraft(
  agentId: string,
  thread: string | undefined,
  draft: UnsentDraft | undefined,
): void {
  if (thread === undefined) {
    if (draft === undefined) unsentWords.delete(agentId);
    else unsentWords.set(agentId, draft);

    return;
  }

  const replies = unsentReplies.get(agentId) ?? new Map<string, UnsentDraft>();

  if (draft === undefined) replies.delete(thread);
  else replies.set(thread, draft);

  if (replies.size === 0) unsentReplies.delete(agentId);
  else unsentReplies.set(agentId, replies);
}

/** Follows whether an account is signed in, letting every draft go as one signs out. */
export function followDraftsAccount(signedIn: boolean): void {
  if (wasSignedIn && !signedIn) {
    unsentWords.clear();
    unsentReplies.clear();
  }

  wasSignedIn = signedIn;
}

/** Lets every unsent draft go when the account signs out, so the next account's composers open empty. */
export function useComposerDraftsSignOut(signedIn: boolean): void {
  useEffect(() => followDraftsAccount(signedIn), [signedIn]);
}
