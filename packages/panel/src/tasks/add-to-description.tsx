import {
  type PictureAddition,
  taskPictureLine,
  withoutPictureLine,
  withPictureLine,
} from "@repo/features/agent-pictures-model";
import type { FileChip } from "@repo/features/attachment-model";
import { descriptionAttachmentAddress } from "@repo/features/description-attachment-link";
import { PICTURE_BOUNDS } from "@repo/features/picture-wire";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  PICTURE_KEEP_FAILURE,
  TASK_CALL_FAILURE,
  type TasksEditAnswer,
} from "@repo/features/tasks-view";
import { type Workspace, workspaceOfSlug } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT } from "@repo/settings";
import { isVideoDataUrl, STATUS_TONE } from "@repo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlusIcon } from "lucide-react";
import { useMemo } from "react";
import { type ActResult, type ActVariables, unreachedAs } from "../act.js";
import { actMutation } from "../act-mutations.js";
import { encodeImage } from "../feedback-images.js";
import { keepPictureRead } from "../picture-query.js";
import { useWorkingToast } from "../toast.js";
import { pressWrite, type UndoWrite } from "../undo-stack.js";
import { appStateQuery, selectWorkspaces } from "../use-app-state.js";
import { useWorkspaceExperiment } from "../workspace-experiments.js";
import type { ViewerAction } from "./attachment-viewer.js";
import { useTaskMentions } from "./task-mentions.js";

/**
 * add-to-description.tsx -- a picture or a recording an agent showed, added to its task's description: kept on the description as one of its own and written at the end of its text, as the developer's edit, with Undo.
 *
 * The picture is the agent's, read from its transcript, so it is kept on the
 * description again, as a picture pasted from another description is, and the description's
 * readers see it on the description's own terms. The Mac re-encodes a picture to
 * the description's bound first (`encodeImage`), since an agent's picture may be
 * larger than a description's may. A recording is kept as it is, never re-encoded,
 * where it is no larger than a video sent to the description may be
 * (`PICTURE_BOUNDS.MAX_SENT_VIDEO_BYTES`), and the description plays it in place. The line is written at the end of the description's text, a paragraph
 * of its own, through the same edit a developer's save is; an edit that
 * meets the text moved on is written again on the text as it stands. Note
 * that it is never written at the editor's caret, because the description's editor
 * closes as focus leaves it, and the press that adds the picture is in the
 * agent's tab. The toast says the adding is under way from the press, since
 * re-encoding, keeping, and writing can take a moment, and turns in place
 * into what came of it. Undo, from the toast or ⌘Z, is an entry of the undo
 * stack (`PICTURE_ADD`): it takes the line back out only while it still stands
 * alone, and ⇧⌘Z writes it again; the kept picture goes with the description.
 */

/** What the press is called. */
const ADD_LABEL = "Add to description";

/** What each outcome says in the window's toast. */
const ADD_WORDS = {
  ADDING: "Adding to the description…",
  ADDED: "Added to the description",
  NOT_A_PICTURE: "This picture could not be added to the description.",
  VIDEO_TOO_LARGE: `This video is over ${String(PICTURE_BOUNDS.MAX_SENT_VIDEO_BYTES / 1_000_000)} MB, too large to add to the description from here.`,
  TOO_MANY: "This description already holds as many pictures as it can.",
  TOO_MANY_VIDEOS: "This description already holds as many videos as it can.",
  NOT_SAVED: "The description could not be saved.",
  NOT_UNDONE: "The description changed since, so the picture stays in it.",
} as const;

/** How many times an edit is written again on the text as it stands before it gives up. */
const EDIT_TRIES = 3;

/** The file's own bytes, read from its `data:` URL. */
function fileOf(chip: FileChip): File {
  const base64 = chip.url.slice(chip.url.indexOf(",") + 1);
  const bytes = Uint8Array.from(atob(base64), (letter) => letter.charCodeAt(0));
  return new File([bytes], chip.name, { type: chip.mediaType });
}

/** Why a keep failed, in the toast's words. */
const KEEP_FAILED_WORDS = {
  [PICTURE_KEEP_FAILURE.TOO_MANY]: ADD_WORDS.TOO_MANY,
  [PICTURE_KEEP_FAILURE.TOO_MANY_VIDEOS]: ADD_WORDS.TOO_MANY_VIDEOS,
  [PICTURE_KEEP_FAILURE.NOT_FOUND]: ADD_WORDS.NOT_SAVED,
  [PICTURE_KEEP_FAILURE.UNANSWERED]: ADD_WORDS.NOT_SAVED,
} as const;

/**
 * The `data:` URL the file is kept on the description as, or why it cannot be: a
 * recording as it is, within a sent video's bound, and a picture re-encoded
 * within a picture's.
 */
async function keptUrlOf(chip: FileChip): Promise<{ url: string } | { refused: string }> {
  if (isVideoDataUrl(chip.url)) {
    return fileOf(chip).size > PICTURE_BOUNDS.MAX_SENT_VIDEO_BYTES
      ? { refused: ADD_WORDS.VIDEO_TOO_LARGE }
      : { url: chip.url };
  }
  const encoded = await encodeImage(fileOf(chip), PICTURE_BOUNDS.MAX_BYTES);
  if (encoded === undefined) return { refused: ADD_WORDS.NOT_A_PICTURE };
  return { url: `data:${encoded.mediaType};base64,${encoded.base64}` };
}

/** A picture's words: the name the viewer saves it by, without its extension. */
function wordsOf(chip: FileChip): string {
  const dot = chip.name.lastIndexOf(".");
  return dot > 0 ? chip.name.slice(0, dot) : chip.name;
}

/** The description's text after an edit written on whatever it stands as now; what refused it where no edit saved: the answer that refused it, or the condition where nothing more was said. */
async function edited(
  save: (base: string, value: string) => Promise<TasksEditAnswer>,
  change: (text: string) => string | undefined,
  known: string,
): Promise<string | { readonly refused: unknown }> {
  let base = known;
  for (let tried = 0; tried < EDIT_TRIES; tried += 1) {
    const value = change(base);
    if (value === undefined) return { refused: FAILURE_CONDITION.NOT_KEPT };
    const answer = await save(base, value);
    if ("saved" in answer) return value;
    if (!("conflict" in answer)) return { refused: answer };
    base = answer.conflict.current;
  }
  return { refused: FAILURE_CONDITION.CONFLICT };
}

/** The description's text as a press's edits last left it, and exactly what its add wrote, which Undo takes back out. */
interface KnownText {
  text: string;
  added: string;
}

/** A picture's line added to a task's description: the task, the line, and the text its edits keep. */
interface PictureLine {
  readonly taskId: string;
  readonly line: string;
  readonly known: KnownText;
}

/** What an edit of the line came to: the text it saved, or what refused it and the words saying so. */
type PictureAnswer =
  | { readonly saved: string }
  | { readonly refused: unknown; readonly words: string };

/** An edit of the description, sent on `send`, as an answer: unreached where the act port never answered. */
function saver(
  send: (
    variables: ActVariables<typeof ACT_KIND.TASKS_EDIT>,
  ) => Promise<ActResult<typeof ACT_KIND.TASKS_EDIT>>,
  taskId: string,
): (base: string, value: string) => Promise<TasksEditAnswer> {
  return (base, value) =>
    send({ taskId, edit: { document: { base, value } } }).catch(
      unreachedAs(TASK_CALL_FAILURE.UNANSWERED),
    );
}

/**
 * The line's edit written on the text `known` last held, as an answer:
 * where it saved, `known` takes the text it left and, for an add, exactly
 * what was added; where it was refused, `words` say so.
 */
async function lineEdited(
  send: Parameters<typeof saver>[0],
  { taskId, known }: PictureLine,
  change: (text: string) => PictureAddition | undefined,
  words: string,
): Promise<PictureAnswer> {
  // Note that what was added is kept from the edit that saved, since a
  // retry on a moved text may add other line breaks than the first try.
  let written: PictureAddition | undefined;
  const saved = await edited(
    saver(send, taskId),
    (text) => {
      written = change(text);
      return written?.text;
    },
    known.text,
  );
  if (typeof saved !== "string") return { refused: saved.refused, words };
  known.text = saved;
  if (written !== undefined) known.added = written.added;
  return { saved };
}

/** Whether `text` still holds the line exactly as the add wrote it, a paragraph of its own. */
function lineStands(text: string, { known }: PictureLine): boolean {
  return withoutPictureLine(text, known.added) !== undefined;
}

/**
 * A picture's line added to the description, as the undo stack takes it
 * back and puts it back: written at the end of the text, taken back out
 * where it still stands alone, the description's text as this press's
 * edits last left it being what each reads. A refusal is reported with what
 * refused the edit as its cause.
 */
const PICTURE_ADD = {
  words: ADD_WORDS.ADDED,
  unmasked: () => true,
  kind: ACT_KIND.TASKS_EDIT,
  read: (_text, asked) => asked,
  act: (send, change) =>
    lineEdited(send, change, (text) => withPictureLine(text, change.line), ADD_WORDS.NOT_SAVED),
  undo: (send, change) =>
    lineEdited(
      send,
      change,
      (text) => {
        const without = withoutPictureLine(text, change.known.added);
        return without === undefined ? undefined : { text: without, added: change.known.added };
      },
      ADD_WORDS.NOT_UNDONE,
    ),
  holds: lineStands,
  undone: (text, change) => !lineStands(text, change),
  refused: (answer) => ("words" in answer ? answer.words : undefined),
  surface: FAILURE_SURFACE.DESCRIPTION_ADD,
  about: ({ taskId }) => ({ taskId }),
  cause: (answer) => ("refused" in answer ? answer.refused : answer),
} satisfies UndoWrite<string, PictureLine, PictureLine, typeof ACT_KIND.TASKS_EDIT, PictureAnswer>;

/** The account's workspaces before their first read lands. */
const NO_WORKSPACES: readonly Workspace[] = [];

/**
 * The viewer's Add to description, for a transcript drawn on a plan's page; none
 * where it is drawn off one, as an agent with no plan's is, nor while the
 * task's workspace has Descriptions off.
 */
export function useAddToDescription(): ViewerAction | undefined {
  const page = useTaskMentions();
  // The task's workspace, which its page names by its slug.
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data ?? NO_WORKSPACES;
  const descriptionsOn = useWorkspaceExperiment(
    page?.workspaceId ??
      (page === undefined ? undefined : workspaceOfSlug(workspaces, page.workspace)?.id),
    EXPERIMENT.DESCRIPTIONS,
  );
  const { mutateAsync: sendEdit } = useMutation(actMutation(ACT_KIND.TASKS_EDIT));
  const { mutateAsync: sendKeep } = useMutation(actMutation(ACT_KIND.TASKS_PICTURE_KEEP));
  const queryClient = useQueryClient();
  const working = useWorkingToast();
  return useMemo(() => {
    const taskId = page?.holder?.taskId;
    if (!descriptionsOn || page === undefined || taskId === undefined || page.workspace === "") {
      return undefined;
    }
    const { workspace } = page;
    const add = async (chip: FileChip) => {
      const settle = working(ADD_WORDS.ADDING);
      const failed = (words: string, cause: unknown, refused?: true) =>
        settle({
          words,
          tone: STATUS_TONE.DANGER,
          failure: {
            surface: FAILURE_SURFACE.DESCRIPTION_ADD,
            cause,
            about: { taskId },
            ...(refused === undefined ? {} : { refused }),
          },
        });
      const keeping = await keptUrlOf(chip);
      if ("refused" in keeping) return failed(keeping.refused, keeping.refused, true);
      const { url } = keeping;
      const kept = await sendKeep({ planId: taskId, picture: url }).catch(
        unreachedAs(PICTURE_KEEP_FAILURE.UNANSWERED),
      );
      if ("failure" in kept) return failed(KEEP_FAILED_WORDS[kept.failure], kept);
      keepPictureRead(queryClient, taskId, kept.id, url);
      const address = descriptionAttachmentAddress(
        { taskId: taskId, attachmentId: kept.id },
        workspace,
      );
      const line = taskPictureLine(wordsOf(chip), address);
      // Note that the edit is written on the description's words as the page last read
      // them, and a conflict answers the text as it stands for the next.
      const known: KnownText = { text: page.text(), added: "" };
      await pressWrite(
        PICTURE_ADD,
        { rows: () => known.text, send: sendEdit },
        { taskId, line, known },
        settle,
      );
    };
    return {
      label: ADD_LABEL,
      icon: <ImagePlusIcon aria-hidden="true" />,
      onPress: (chip: FileChip) => void add(chip),
    };
  }, [descriptionsOn, sendEdit, sendKeep, queryClient, page, working]);
}
