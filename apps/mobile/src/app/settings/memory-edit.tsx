// memory-edit.tsx -- Settings' page a memory's words are written on: a new one from Memory's +, or one the reader may change from its row, saved through the host as the panel's card saves it.

import {
  MEMORY_EDITOR_WORDS,
  MEMORY_PAGE_WORDS,
  MEMORY_SAVE_FAILED,
  memorySaveRefusal,
} from "@repo/features/memory-settings-words";
import { MEMORY_BOUNDS } from "@repo/features/memory-wire";
import { ACT_KIND } from "@repo/host/acts";
import { selectWorkspaceMemories, selectWorkspaces } from "@repo/host/app-state-reads";
import {
  BUZZ,
  ConfirmAsk,
  EmptyState,
  ListSection,
  NOTICE_KIND,
  Screen,
  SettingsForm,
  useColors,
  useFailureNotices,
  WordsField,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useChosenWorkspace } from "../../chosen-workspace.js";
import { appStateQuery } from "../../host/app-state-query.js";
import { useHostActs } from "../../host/host-provider.js";
import { useLiveFollow } from "../../host/live-follow.js";
import { DISCARD_WORDS, useKeptWords } from "../../use-kept-words.js";
import { useWrite } from "../../use-write.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

/** The name a flow finds the words by. */
const WORDS_TEST_ID = "memory-words";

/** The glyph a memory gone meanwhile stands under, the panel's brain. */
const MEMORY_SYMBOL = "brain";

export default function MemoryEditScreen() {
  const { memory } = useLocalSearchParams<{ memory?: string }>();
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { chosen } = useChosenWorkspace(workspaces);

  if (chosen === undefined) return null;

  // Note that the page is drawn anew for each workspace, so a draft never carries into another.
  return <MemoryEditor key={chosen.id} workspaceId={chosen.id} memoryId={memory} />;
}

/**
 * A memory's words, as the panel's card writes them: a new one's from
 * nothing, or one the reader may change from its words as they stand,
 * headed New memory or Edit memory. Save in the bar is lit once the words
 * are new, not empty, and within the panel's bound; it saves through the
 * one save act, an edit naming the memory it replaces, and goes back to
 * Memory once the service took them. A save refused says why under the
 * words and keeps them. Back, or a swipe down of Settings, asks first while
 * the words differ from what was saved. An edit whose memory was deleted
 * meanwhile says so in place of the words.
 */
function MemoryEditor({
  workspaceId,
  memoryId,
}: {
  readonly workspaceId: string;
  readonly memoryId: string | undefined;
}) {
  const colors = useColors();
  const router = useRouter();
  const acts = useHostActs();
  const write = useWrite();
  const notices = useFailureNotices();

  const { data: held } = useQuery({
    ...appStateQuery,
    select: useMemo(() => selectWorkspaceMemories(workspaceId), [workspaceId]),
  });

  const rows = held?.rows;
  const live = memoryId === undefined ? undefined : rows?.find((each) => each.id === memoryId);
  // Note that the memory is kept as it was first read, since a save is drawn over the list the moment it is sent, and the words it held must not change under the field.
  const [memory, setMemory] = useState(live);

  if (memory === undefined && live !== undefined) setMemory(live);
  const [words, setWords] = useState<string | undefined>(undefined);
  const [note, setNote] = useState<string | undefined>(undefined);
  // Whether a save is out, or went and the page is leaving.
  const [saving, setSaving] = useState(false);

  // An edit waits on the memories' read, which the page follows itself, since it may be opened before Memory read them.
  const reading = memoryId !== undefined && rows === undefined;

  const gone =
    memoryId !== undefined &&
    rows !== undefined &&
    (memory === undefined || (!saving && live === undefined));

  // Whether a save is out, read at the press itself.
  const out = useRef(false);
  // Whether the page still stands, since a save that lands after it was left must not go back from the screen in front.
  const standing = useRef(true);
  useEffect(() => {
    standing.current = true;

    return () => {
      standing.current = false;
    };
  }, []);
  useLiveFollow(workspaceId, (id) => acts[ACT_KIND.MEMORIES_FOLLOW]({ workspaceId: id }));

  const saved = memory?.text ?? "";
  const text = (words ?? saved).trim();
  const tooLong = text.length > MEMORY_BOUNDS.MAX_CHARS;
  const changed = !reading && !gone && text !== saved.trim();
  const kept = useKeptWords(changed);

  const save = () => {
    if (out.current || saving || !changed || text === "" || tooLong) return;
    out.current = true;
    setSaving(true);
    setNote(undefined);

    void write(
      () =>
        acts[ACT_KIND.MEMORIES_SAVE]({
          workspaceId,
          text,
          ...(memory !== undefined && { replaces: memory.id }),
        }),
      {
        refused: memorySaveRefusal,
        unanswered: MEMORY_SAVE_FAILED,
        // Note that a refusal landing after the page was left says why in the failure notice, since its words have nowhere else to stand.
        inPlace: (refusal) => {
          if (standing.current) setNote(refusal);
          else notices.say({ kind: NOTICE_KIND.REFUSED, words: refusal });
        },
        went: BUZZ.SUCCESS,
      },
    ).then((went) => {
      out.current = false;

      if (!went) {
        setSaving(false);

        return;
      }

      if (!standing.current) return;
      kept.release();
      router.back();
    });
  };

  const title = memoryId === undefined ? MEMORY_EDITOR_WORDS.ADD : MEMORY_EDITOR_WORDS.EDIT;

  return (
    <>
      <Stack.Screen options={{ title }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          variant="prominent"
          tintColor={colors.ACCENT}
          disabled={saving || !changed || text === "" || tooLong}
          onPress={save}
        >
          {MEMORY_EDITOR_WORDS.SAVE}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <ConfirmAsk
        title={DISCARD_WORDS.QUESTION}
        act={DISCARD_WORDS.DISCARD}
        destructive
        presented={kept.asking}
        onAct={() => {
          // Note that the page stands no longer from the discard itself, since it stays mounted through its exit.
          standing.current = false;
          kept.discard();
        }}
        onDismiss={kept.stay}
      />
      <Screen>
        {reading ? (
          <EmptyState title={MEMORY_PAGE_WORDS.READING} symbol={MEMORY_SYMBOL} loading />
        ) : gone ? (
          <EmptyState title={MEMORY_EDITOR_WORDS.GONE} symbol={MEMORY_SYMBOL} />
        ) : (
          <SettingsForm>
            <ListSection
              // Note that the words' length is said over an earlier refusal, since it is what holds Save now.
              footer={tooLong ? MEMORY_EDITOR_WORDS.TOO_LONG : note}
            >
              <WordsField
                placeholder={MEMORY_EDITOR_WORDS.PLACEHOLDER}
                initialWords={saved}
                autoFocus
                onWords={setWords}
                testId={WORDS_TEST_ID}
                label={title}
                disabled={saving}
              />
            </ListSection>
          </SettingsForm>
        )}
      </Screen>
    </>
  );
}
