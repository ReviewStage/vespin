/**
 * use-inline-description.ts -- a task's description edited in place on its page, as the desktop's and Notion's are: a press on its words puts the caret there, the words save on a pause, on Done, as the page is left and as the app goes to the background, and a conflict asks the panel's choice.
 *
 * The editor is the panel's (`@repo/features/description-edit-model`), the
 * sheet's before it: the service lays a save over anything written
 * meanwhile, so an agent's note in another section stands beside it. A save
 * goes a second after the last key, as the panel's editor's pause does
 * (`SAVE_PAUSE`); Done saves what is typed and leaves the words once the
 * service holds them; a conflict says so over the words and asks Keep mine,
 * Copy my text, or Use theirs, which leaves on their words; a refused save
 * says why in the failure notice, whose Try again saves again. Words the
 * service does not hold yet are saved as the page goes and as the app goes
 * to the background, a failed save tried once more.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import {
  DOCUMENT_EDITOR_STATE,
  type DocumentEditor,
  editorAnswered,
  editorCloseAsked,
  editorCloses,
  editorKeptMine,
  editorOpened,
  editorRefused,
  editorRetried,
  editorSent,
  editorTookTheirs,
  editorTyped,
  leavingSave,
  pendingSave,
} from "@repo/features/description-edit-model";
import { KEEP_MINE, lastEditConflict } from "@repo/features/description-edit-words";
import { mentionPill } from "@repo/features/pill-words";
import type { TasksEditAnswer } from "@repo/features/tasks-view";
import { ACT_UNREACHED_WORDS } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import {
  askToChoose,
  type CaretAtWord,
  type DocumentFieldHandle,
  type DocumentPageMentions,
  NOTICE_KIND,
  useFailureNotices,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { type RefObject, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import {
  copyMine,
  DESCRIPTION_EDIT_WORDS,
  problemOf,
  refusalOf,
} from "../screens/description-edit-screens.js";
import { useMentionOffer } from "../use-mention-offer.js";
import { useWrite, WRITE_SUBJECT } from "../use-write.js";

/** How long typing rests before the words save, as the panel's editor waits (`SAVE_PAUSE`). */
const SAVE_PAUSE_MS = 1_000;

/** Where a press on the words as read landed: where its block starts in the Markdown, and how far in from the block's start. */
export interface PressedAt {
  readonly at: number;
  readonly x: number;
  readonly y: number;
}

/** The description edited in place, as the page draws it. */
export interface InlineDescription {
  /** Whether the words stand as the field, the caret in them; read otherwise. */
  readonly editing: boolean;
  /** Puts the words in the field with the caret where a press landed, or at their start. */
  readonly start: (at?: PressedAt) => void;
  /** Saves what is typed and leaves the field once the service holds it. */
  readonly done: () => void;
  readonly field: RefObject<DocumentFieldHandle | null>;
  readonly draft: string;
  readonly onChange: (words: string) => void;
  /** Whether the field takes keys: not while a save it waits on is out. */
  readonly editable: boolean;
  /** What stands over the words: a conflict's note, or a description past its length; none otherwise. */
  readonly problem: string | undefined;
  readonly onAtWord: (word: CaretAtWord | undefined) => void;
  /** What an `@` being typed offers; none while no `@` word stands. */
  readonly mentions: DocumentPageMentions | undefined;
}

/** The description of the task `taskId` names, `body` as the page last read it, edited in place; nothing is saved before the task is read. */
export function useInlineDescription(
  taskId: string | undefined,
  workspaceId: string | undefined,
  body: string,
): InlineDescription {
  const acts = useHostActs();
  const write = useWrite();
  const notices = useFailureNotices();
  const [editing, setEditing] = useState(false);
  const [editor, setEditor] = useState(() => editorOpened(body));
  // The editor as it stands now, read by a save's answer, a choice's press and a pause's timer, which land after the render that set them.
  const live = useRef(editor);
  const field = useRef<DocumentFieldHandle | null>(null);
  const pressed = useRef<PressedAt | undefined>(undefined);
  const [atWord, setAtWord] = useState<CaretAtWord | undefined>(undefined);
  // Whether the page still stands, so a Try again after it went sends nothing it no longer holds.
  const standing = useRef(true);

  const { data: readerId } = useQuery({
    ...appStateQuery,
    select: (state) => signedInAccountId(state.account),
  });

  const update = (next: DocumentEditor) => {
    live.current = next;
    setEditor(next);
  };

  const mentions = useMentionOffer(
    { workspaceId, taskId, description: editing ? editor.draft : undefined },
    {
      word: editing ? atWord : undefined,
      pick: (mention) => field.current?.pick(mentionPill(mention.name, mention.target)),
      rewrite: (words) => field.current?.rewrite(words),
    },
  );

  const conflict =
    editor.state.kind === DOCUMENT_EDITOR_STATE.CONFLICT
      ? lastEditConflict(editor.state.by, readerId)
      : undefined;

  const askConflict = (held: DocumentEditor) => {
    if (held.state.kind !== DOCUMENT_EDITOR_STATE.CONFLICT) return;
    const words = lastEditConflict(held.state.by, readerId);

    askToChoose({
      title: words.note,
      acts: [
        {
          label: KEEP_MINE,
          onPress: () => {
            update(editorKeptMine(live.current));
            save();
          },
        },
        { label: DESCRIPTION_EDIT_WORDS.COPY_MINE, onPress: () => copyMine(live.current.draft) },
        {
          label: words.take,
          destructive: true,
          onPress: () => {
            update(editorTookTheirs(live.current));
            setEditing(false);
          },
        },
      ],
    });
  };

  // Note that a save sends the words as they stand, one at a time, and lays the answer on the editor as it stands once it lands.
  const save = (request = pendingSave(editorRetried(live.current))) => {
    const now = live.current;

    if (taskId === undefined || now.sending !== undefined || request === undefined) return;

    if (now.state.kind === DOCUMENT_EDITOR_STATE.CONFLICT) {
      askConflict(now);

      return;
    }

    update(editorSent(editorRetried(now), request));
    // What the save came to, read once it settles: the service's answer, or the words its refusal is said in.
    let answered: TasksEditAnswer | undefined;
    let refusal: string | undefined;
    let noticed = false;

    void write(
      () =>
        acts[ACT_KIND.TASKS_EDIT]({ taskId, edit: request }).then((answer) => {
          answered = answer;

          return answer;
        }),
      {
        refused: (answer) => refusalOf(live.current, answer, readerId),
        subject: { kind: WRITE_SUBJECT.TASK_DESCRIPTION, id: taskId },
        inPlace: (words, said) => {
          refusal = words;
          noticed = said;
        },
      },
    ).then(() => {
      if (!standing.current) return;

      const settled =
        answered === undefined
          ? editorRefused(live.current, refusal ?? ACT_UNREACHED_WORDS)
          : editorAnswered(live.current, answered);

      update(settled);

      if (settled.state.kind === DOCUMENT_EDITOR_STATE.CONFLICT) {
        askConflict(settled);

        return;
      }

      if (settled.state.kind !== DOCUMENT_EDITOR_STATE.FAILED || noticed) return;
      notices.say({
        kind: NOTICE_KIND.REFUSED,
        words: refusal ?? settled.state.note,
        retry: () => {
          if (standing.current) save();
        },
      });
    });
  };

  const saveRef = useRef(save);

  useEffect(() => {
    saveRef.current = save;
  });

  // Note that the words save a pause after the last key, as the panel's editor saves them, never while a save is out or a conflict waits.
  useEffect(() => {
    if (!editing || editor.sending !== undefined || pendingSave(editor) === undefined) return;

    const timer = setTimeout(() => saveRef.current(), SAVE_PAUSE_MS);

    return () => clearTimeout(timer);
  }, [editing, editor]);

  // Note that Done leaves the field once the words it asked to save are the service's, so the words as read never stand older than what was typed.
  useEffect(() => {
    if (editing && editorCloses(editor)) setEditing(false);
  }, [editing, editor]);

  // Note that words the service does not hold yet are saved as the app goes to the background and as the page goes, a failed save tried once more.
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        field.current?.flush();
        saveRef.current(leavingSave(live.current));
      }
    });

    return () => {
      listener.remove();
      field.current?.flush();
      saveRef.current(leavingSave(live.current));
      standing.current = false;
    };
  }, []);

  // Note that a press kept as the field came to stand is laid once it has, the caret where the press landed.
  useEffect(() => {
    if (!editing) return;
    const at = pressed.current;
    pressed.current = undefined;

    if (at === undefined) field.current?.focus();
    else field.current?.focusAt(at.at, at.x, at.y);
  }, [editing]);

  const start = (at?: PressedAt) => {
    if (editing) return;
    pressed.current = at;
    // Note that the field opens on the words as the page last read them, the base its saves are laid against.
    update(editorOpened(body));
    setEditing(true);
  };

  const done = () => {
    field.current?.flush();
    update(editorCloseAsked(live.current));
    save();

    // Note that words already the service's leave at once, since no save goes out to settle them.
    if (editorCloses(live.current)) setEditing(false);
  };

  return {
    editing,
    start,
    done,
    field,
    draft: editor.draft,
    onChange: (words) => update(editorTyped(live.current, words)),
    editable: editor.sending === undefined || !editor.closing,
    problem: problemOf(editor, conflict?.note),
    onAtWord: setAtWord,
    mentions:
      mentions === undefined
        ? undefined
        : {
            groups: mentions.groups,
            empty: mentions.empty,
            crumb: mentions.crumb,
            onPick: mentions.pick,
          },
  };
}
