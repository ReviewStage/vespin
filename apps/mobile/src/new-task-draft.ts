/**
 * new-task-draft.ts -- what a New task holds unstarted, one draft per workspace: its words kept in the app's `NSUserDefaults` and its pictures in memory, until the next New task in that workspace opens on them, and forgotten on sign-out.
 *
 * The panel keeps New task's draft per workspace as it is written, with no
 * question on close (`composer-drafts.ts`), and so does the app: the ✕ and
 * a swipe down close the sheet at once, its draft kept. Its words outlast a
 * relaunch; its pictures, which may run to megabytes, stand only while the
 * app runs, as the panel keeps a box's files only while its window stands.
 * Starting the task, or emptying its box, lets the draft go. Only this
 * module writes the defaults key, so what it holds is the drafts.
 */

import { Option, Schema } from "effect";
import { useEffect, useRef } from "react";
import { Settings } from "react-native";
import type { HeldPicture } from "./use-attached-pictures.js";

/** The defaults key the drafts are kept under. */
const DRAFTS_KEY = "newTaskDrafts";

/** The words saved, by the workspace each would start a task in. */
const draftsSchema = Schema.Record(Schema.String, Schema.String);

type Drafts = typeof draftsSchema.Type;

const decodeDrafts = Schema.decodeUnknownOption(draftsSchema);

/** The drafts kept at launch, none where the defaults hold nothing readable. */
let held: Drafts = Option.getOrElse(decodeDrafts(Settings.get(DRAFTS_KEY)), (): Drafts => ({}));

/** The pictures held in each workspace's New task, for this launch alone. */
const heldPictures = new Map<string, readonly HeldPicture[]>();

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
  if (held[workspaceId] === words) return;

  keep({ ...held, [workspaceId]: words });
}

/** The pictures `workspaceId`'s New task held when it last closed; none where it held none. */
export function newTaskPictures(workspaceId: string): readonly HeldPicture[] {
  return heldPictures.get(workspaceId) ?? [];
}

/** Holds `pictures` as `workspaceId`'s New task pictures for this launch. */
export function holdNewTaskPictures(workspaceId: string, pictures: readonly HeldPicture[]): void {
  if (pictures.length === 0) heldPictures.delete(workspaceId);
  else heldPictures.set(workspaceId, pictures);
}

/** Lets `workspaceId`'s saved words go, as a start or an emptied box does. */
export function forgetNewTaskDraft(workspaceId: string): void {
  if (held[workspaceId] === undefined) return;

  const { [workspaceId]: _, ...rest } = held;
  keep(rest);
}

/** Forgets every saved draft when the account signs out, so the next account's New task opens empty. */
export function useNewTaskDraftsSignOut(signedIn: boolean): void {
  const wasSignedIn = useRef(signedIn);

  useEffect(() => {
    if (wasSignedIn.current && !signedIn) {
      heldPictures.clear();

      if (Object.keys(held).length > 0) keep({});
    }

    wasSignedIn.current = signedIn;
  }, [signedIn]);
}
