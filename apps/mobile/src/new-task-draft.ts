/**
 * new-task-draft.ts -- the words of a New task the member saved rather than discarded, one draft per workspace, kept in the app's `NSUserDefaults` until the next New task in that workspace opens on them, and forgotten on sign-out.
 *
 * As Mail's compose asks Delete Draft or Save Draft when it is closed with
 * words in it, New task's ✕ and its swipe down offer Save draft beside
 * Discard draft; the panel keeps New task's words per workspace the same
 * way (`composer-drafts.ts`). Only the words are kept, never the pictures
 * attached, which may run to megabytes, as the panel keeps none across a
 * relaunch either. Starting the task or discarding the draft lets the saved
 * one go. Only this module writes the defaults key, so what it holds is the
 * drafts.
 */

import { Option, Schema } from "effect";
import { useEffect, useRef } from "react";
import { Settings } from "react-native";

/** The defaults key the drafts are kept under. */
const DRAFTS_KEY = "newTaskDrafts";

/** The words saved, by the workspace each would start a task in. */
const draftsSchema = Schema.Record(Schema.String, Schema.String);

type Drafts = typeof draftsSchema.Type;

const decodeDrafts = Schema.decodeUnknownOption(draftsSchema);

/** The drafts kept at launch, none where the defaults hold nothing readable. */
let held: Drafts = Option.getOrElse(decodeDrafts(Settings.get(DRAFTS_KEY)), (): Drafts => ({}));

/** Keeps `next` for this launch and the next. */
function keep(next: Drafts): void {
  held = next;
  Settings.set({ [DRAFTS_KEY]: next });
}

/** The words saved for a New task in `workspaceId`; none where none were saved. */
export function savedNewTaskDraft(workspaceId: string): string | undefined {
  return held[workspaceId];
}

/** Saves `words` as `workspaceId`'s New task draft, in place of any saved before. */
export function saveNewTaskDraft(workspaceId: string, words: string): void {
  keep({ ...held, [workspaceId]: words });
}

/** Lets `workspaceId`'s saved draft go, as a start or a discard does. */
export function forgetNewTaskDraft(workspaceId: string): void {
  if (held[workspaceId] === undefined) return;

  const { [workspaceId]: _, ...rest } = held;
  keep(rest);
}

/** Forgets every saved draft when the account signs out, so the next account's New task opens empty. */
export function useNewTaskDraftsSignOut(signedIn: boolean): void {
  const wasSignedIn = useRef(signedIn);

  useEffect(() => {
    if (wasSignedIn.current && !signedIn && Object.keys(held).length > 0) keep({});

    wasSignedIn.current = signedIn;
  }, [signedIn]);
}
