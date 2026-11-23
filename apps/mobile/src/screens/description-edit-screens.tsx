// description-edit-screens.tsx -- the sheet a task's description is edited whole in, as Notion edits a page: its blocks drawn with no syntax, formatted from the selection, people and things mentioned from an `@`, and a save through the host as the panel's editor saves it.

import { signedInAccountId } from "@repo/credentials/snapshot";
import {
  DOCUMENT_EDITOR_STATE,
  type DocumentEditor,
  editorAnswered,
  editorKeptMine,
  editorOpened,
  editorRefused,
  editorRetried,
  editorSent,
  editorTookTheirs,
  editorTyped,
  pendingSave,
} from "@repo/features/description-edit-model";
import { KEEP_MINE, lastEditConflict } from "@repo/features/description-edit-words";
import { mentionPill } from "@repo/features/pill-words";
import { TASK_BOUNDS } from "@repo/features/task-wire";
import type { TasksEditAnswer } from "@repo/features/tasks-view";
import { ACT_UNREACHED_WORDS, readFailedWords, readingWords } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import {
  askToChoose,
  BAR_TITLE,
  BUTTON_LOOK,
  BUZZ,
  buzz,
  type CaretAtWord,
  ConfirmAsk,
  type DocumentFieldHandle,
  DocumentPage,
  EmptyState,
  GLYPH,
  glyphSymbol,
  NOTICE_KIND,
  useColors,
  useFailureNotices,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { setStringAsync } from "expo-clipboard";
import { Stack } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCloseSheet } from "../close-sheet.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { type TaskOverview, useTaskOverview } from "../tasks/use-tasks.js";
import { DISCARD_CHANGES_WORDS, useKeptWords } from "../use-kept-words.js";
import { useMentionOffer } from "../use-mention-offer.js";
import { useWrite, WRITE_SUBJECT } from "../use-write.js";

/** What the sheet says, in the panel's words where it has them. */
export const DESCRIPTION_EDIT_WORDS = {
  TITLE: "Edit description",
  CANCEL: "Cancel",
  SAVE: "Save",
  /** The panel's own words over an empty description. */
  PLACEHOLDER: "Write the description",
  COPY_MINE: "Copy my text",
  READING: readingWords("the description"),
  UNREAD: readFailedWords("the description"),
  TRY_AGAIN: "Try again",
} as const;

const WORDS = DESCRIPTION_EDIT_WORDS;

/** The sheet's route, which a task's ⋯ and its Description header open with the task's id. */
export const EDIT_DESCRIPTION_ROUTE = "/edit-description";

/** The name a flow finds the field by. */
const WORDS_TEST_ID = "description-words";

/** What the editor's state says over the words: a conflict's note, or that the words are past what a description may hold, which Save holds back; none otherwise, a refused save being said in the failure notice. */
export function problemOf(
  editor: DocumentEditor,
  conflict: string | undefined,
): string | undefined {
  if (conflict !== undefined) return conflict;

  const past = editor.draft.length > TASK_BOUNDS.MAX_BODY_CHARS;

  return past && editor.state.kind === DOCUMENT_EDITOR_STATE.FAILED ? editor.state.note : undefined;
}

/** What a save's answer says where it did not go: a failure's note, as the panel's editor says it, or a conflict's; none where it saved. */
export function refusalOf(
  editor: DocumentEditor,
  answer: TasksEditAnswer,
  readerId: string | undefined,
): string | undefined {
  if ("saved" in answer) return undefined;

  if ("conflict" in answer) return lastEditConflict(answer.conflict.by, readerId).note;
  const { state } = editorAnswered(editor, answer);

  return state.kind === DOCUMENT_EDITOR_STATE.FAILED ? state.note : undefined;
}

/** The sheet's bar: its title, the system's ✕ (Cancel to VoiceOver), and Save, lit once there is something to save and while none is out. */
function EditorBar({
  ready,
  onSave,
  onCancel,
}: {
  readonly ready: boolean;
  readonly onSave: () => void;
  readonly onCancel: () => void;
}) {
  const colors = useColors();

  // Note that the options are made once for their colors, because the stack sets a screen's options again whenever a new object comes, which a key typed would make.
  const options = useMemo(
    () => ({
      headerShown: true,
      title: WORDS.TITLE,
      headerTintColor: colors.TEXT,
      headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
      headerShadowVisible: false,
      contentStyle: { backgroundColor: colors.GROUND },
    }),
    [colors],
  );

  return (
    <>
      <Stack.Screen options={options} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          icon={glyphSymbol(GLYPH.CLOSE)}
          accessibilityLabel={WORDS.CANCEL}
          onPress={onCancel}
        />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          variant="prominent"
          tintColor={colors.ACCENT}
          disabled={!ready}
          onPress={onSave}
        >
          {WORDS.SAVE}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );
}

/** Copies the developer's own words to the pasteboard, with the system's tap of success, or says on the console why they could not be. */
export function copyMine(words: string): void {
  setStringAsync(words)
    .then(() => buzz(BUZZ.SUCCESS))
    .catch((cause: unknown) => {
      console.error("The description's words could not be copied.", cause);
      buzz(BUZZ.ERROR);
    });
}

/**
 * The description's words in the editor, opened on them as the page last
 * read them, which are the edit's base, and saved whole through the host as
 * the panel's editor saves them (`TASKS_EDIT`, `@repo/features/description-edit-model`):
 * the service lays the change over anything written meanwhile, so an agent's
 * note in another section stands beside it. Save sends it, the field held
 * while it is out, and the sheet closes once it is saved. A conflict, where
 * someone wrote over the same lines meanwhile, saves nothing: it says so in
 * the panel's words over the words, and asks, as the panel's editor offers,
 * Keep mine (the developer's change laid over theirs, saved at once), Copy my
 * text, or Use theirs, which closes on their words; a Save while it stands
 * asks again. A save refused says why in the failure notice, whose Try again
 * saves again from the words as they stand, the words kept in the editor.
 * Cancel, or a swipe down, asks first while the words differ from what the
 * service holds of them.
 */
function DescriptionEditor({
  overview,
  body,
}: {
  readonly overview: TaskOverview;
  readonly body: string;
}) {
  const { task } = overview;
  const acts = useHostActs();
  const write = useWrite();
  const notices = useFailureNotices();
  const [editor, setEditor] = useState(() => editorOpened(body));
  // The editor as it stands now, read by a save's answer and a choice's press, which land after the render that sent them.
  const live = useRef(editor);
  // Whether the sheet still stands, so a Try again after it closed sends nothing it no longer holds.
  const standing = useRef(true);
  useEffect(
    () => () => {
      standing.current = false;
    },
    [],
  );

  const { data: readerId } = useQuery({
    ...appStateQuery,
    select: (state) => signedInAccountId(state.account),
  });

  // The field's door, and the `@` word its caret stands in, which offers what the task can mention.
  const field = useRef<DocumentFieldHandle>(null);
  const [atWord, setAtWord] = useState<CaretAtWord | undefined>(undefined);

  const mentions = useMentionOffer(
    { workspaceId: overview.workspace?.id, taskId: task.id, description: editor.draft },
    {
      word: atWord,
      pick: (mention) => field.current?.pick(mentionPill(mention.name, mention.target)),
      rewrite: (words) => field.current?.rewrite(words),
    },
  );

  const kept = useKeptWords(editor.draft !== editor.base);
  const close = useCloseSheet(kept);

  const conflict =
    editor.state.kind === DOCUMENT_EDITOR_STATE.CONFLICT
      ? lastEditConflict(editor.state.by, readerId)
      : undefined;

  const update = (next: DocumentEditor) => {
    live.current = next;
    setEditor(next);
  };

  const leave = () => {
    kept.release();
    close();
  };

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
        { label: WORDS.COPY_MINE, onPress: () => copyMine(live.current.draft) },
        {
          label: words.take,
          destructive: true,
          onPress: () => {
            update(editorTookTheirs(live.current));
            leave();
          },
        },
      ],
    });
  };

  const save = () => {
    const now = live.current;

    if (now.sending !== undefined) return;

    if (now.state.kind === DOCUMENT_EDITOR_STATE.CONFLICT) {
      askConflict(now);

      return;
    }

    const retried = editorRetried(now);
    const request = pendingSave(retried);

    if (request === undefined) return;
    update(editorSent(retried, request));
    // What the save came to, read once it settles: the service's answer, or the words its refusal is said in.
    let answered: TasksEditAnswer | undefined;
    let refusal: string | undefined;
    let noticed = false;

    void write(
      () =>
        acts[ACT_KIND.TASKS_EDIT]({ taskId: task.id, edit: request }).then((answer) => {
          answered = answer;

          return answer;
        }),
      {
        // Note that a conflict is a save that did not go too, settled in place by the developer's choice rather than in the notice.
        refused: (answer) => refusalOf(live.current, answer, readerId),
        // Note that a save is the description's newest write, so a refused restore's or Undo's Try again sent before it sends nothing over it.
        subject: { kind: WRITE_SUBJECT.TASK_DESCRIPTION, id: task.id },
        went: BUZZ.SUCCESS,
        inPlace: (words, said) => {
          refusal = words;
          noticed = said;
        },
      },
    ).then((went) => {
      if (!standing.current) return;

      const settled =
        answered === undefined
          ? editorRefused(live.current, refusal ?? ACT_UNREACHED_WORDS)
          : editorAnswered(live.current, answered);

      update(settled);

      // Note that words the save didn't carry keep the sheet open, so they are saved or discarded rather than dropped with it.
      if (went && settled.draft === settled.base) {
        leave();

        return;
      }

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

  // Note that Save and Cancel first write the keys typed since the field's last frame, so neither reads the words from before them.
  const saveTyped = () => {
    field.current?.flush();
    save();
  };

  const cancelTyped = () => {
    field.current?.flush();
    close();
  };

  const ready =
    editor.sending === undefined &&
    (conflict !== undefined || pendingSave(editorRetried(editor)) !== undefined);

  return (
    <>
      <EditorBar ready={ready} onSave={saveTyped} onCancel={cancelTyped} />
      <ConfirmAsk
        title={DISCARD_CHANGES_WORDS.QUESTION}
        act={DISCARD_CHANGES_WORDS.DISCARD}
        destructive
        presented={kept.asking}
        onAct={kept.discard}
        onDismiss={kept.stay}
      />
      <DocumentPage
        ref={field}
        value={editor.draft}
        onChange={(words) => update(editorTyped(live.current, words))}
        placeholder={WORDS.PLACEHOLDER}
        editable={editor.sending === undefined}
        problem={problemOf(editor, conflict?.note)}
        repository={task.repository}
        onAtWord={setAtWord}
        mentions={
          mentions === undefined
            ? undefined
            : {
                groups: mentions.groups,
                empty: mentions.empty,
                crumb: mentions.crumb,
                onPick: mentions.pick,
              }
        }
        testID={WORDS_TEST_ID}
      />
    </>
  );
}

/**
 * Edit description over the task `taskId` names: the editor once the
 * description is read, as the page last read it; reading while it is on its
 * way; and its failure with Try again where the read failed.
 */
export function DescriptionEditScreen({ taskId }: { readonly taskId: string }) {
  const overview = useTaskOverview(taskId);
  const close = useCloseSheet();
  const body = overview?.document?.description.body;
  const retry = overview?.documentRetry;

  if (overview !== undefined && body !== undefined) {
    // Note that the editor is drawn anew for each task, so words never carry into another.
    return <DescriptionEditor key={overview.task.id} overview={overview} body={body} />;
  }

  return (
    <>
      <EditorBar ready={false} onSave={() => undefined} onCancel={close} />
      {retry === undefined ? (
        <EmptyState title={WORDS.READING} symbol={GLYPH.FILE_TEXT} loading />
      ) : (
        <EmptyState
          title={WORDS.UNREAD}
          symbol={GLYPH.FAILED}
          action={{ label: WORDS.TRY_AGAIN, onPress: retry, look: BUTTON_LOOK.BORDERED }}
        />
      )}
    </>
  );
}
