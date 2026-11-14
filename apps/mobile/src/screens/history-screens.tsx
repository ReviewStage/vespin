// history-screens.tsx -- a task description's version history on the phone: its versions, newest first, and one version read whole, with Restore this version and its Undo.

import {
  revisionSummary,
  revisionWriterName,
  VERSION_HISTORY_WORDS,
} from "@repo/features/description-history-words";
import { DESCRIPTION_ACTOR, type DescriptionLastEdit } from "@repo/features/task-wire";
import { dayAndTimeText } from "@repo/features/time-format";
import { readingWords, showMoreWords } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import {
  BUTTON_LOOK,
  BUZZ,
  EmptyState,
  GLYPH,
  LIST_LOOK,
  LinkRow,
  ListSection,
  NOTICE_KIND,
  RowList,
  Screen,
  useColors,
  useFailureNotices,
  useMinute,
  VERSION_WRITER,
  VersionRow,
  type VersionWriter,
  WordsRow,
} from "@repo/ui-native";
import { Stack, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useState } from "react";
import { useHostActs } from "../host/host-provider.js";
import { type PictureOf, useMemberPictures } from "../member-pictures.js";
import { useOpenLink } from "../open-link.js";
import { useOnOwnTab } from "../tab-route.js";
import { useDescriptionPictures } from "../tasks/use-description-pictures.js";
import {
  HISTORY_READ,
  useNewestVersion,
  useTaskHistory,
  useTaskVersion,
} from "../tasks/use-history.js";
import { useWrite, WRITE_SUBJECT } from "../use-write.js";

/** The route a version is opened on: the task by its id, and the version by its number in the query. */
export const VERSION_ROUTE = "/tasks/version/[id]";

/** The route a task's version history is opened on. */
export const HISTORY_ROUTE = "/tasks/history/[id]";

/** The glyph the history stands under while it says nothing else. */
const HISTORY_SYMBOL = GLYPH.HISTORY;

/** A version's number as its route's query carries it, none for anything that is not one. */
function versionNumber(spelled: string | undefined): number | undefined {
  const seq = Number(spelled);

  return Number.isInteger(seq) && seq >= 1 ? seq : undefined;
}

/** Who wrote a version, by the mark its row leads with, as the panel's version rows lead: a person by their face, its picture looked up only for a person, since a notetaker's version names the person whose call it was written on, whose photo is not its writer's. */
function versionWriter(lastEdit: DescriptionLastEdit, pictureOf: PictureOf): VersionWriter {
  switch (lastEdit.actor) {
    case DESCRIPTION_ACTOR.DEVELOPER:
      return {
        kind: VERSION_WRITER.PERSON,
        face: {
          name: revisionWriterName(lastEdit, undefined),
          picture: pictureOf(lastEdit.by?.userId),
        },
      };
    case DESCRIPTION_ACTOR.AGENT:
      return { kind: VERSION_WRITER.AGENT, name: revisionWriterName(lastEdit, undefined) };
    case DESCRIPTION_ACTOR.NOTETAKER:
      return { kind: VERSION_WRITER.PRODUCT };
    case DESCRIPTION_ACTOR.EARLIER:
      return { kind: VERSION_WRITER.EARLIER };
  }
}

/** What reads a version or the history again, as the app's other failures say it, in the system's bordered look rather than a filled one. */
const TRY_AGAIN = "Try again";

/** What the bar's Restore says, short for the bar; it is heard as the panel's whole "Restore this version". */
const RESTORE_BAR = "Restore";

/**
 * A task description's version history, as the panel's lists it: each
 * version under its writer, what it did and when, the newest marked
 * Current, and Show more under them while older versions stand unread. A
 * press opens the version whole. The host follows the history while the
 * screen stands, so a save lands at its head as it lands.
 */
export function HistoryScreen() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const history = useTaskHistory(id);
  const pictureOf = useMemberPictures();
  const now = useMinute();
  const revisions = history.page?.revisions ?? [];
  const earlier = history.page?.earlier;
  const newest = revisions[0]?.seq;

  const body =
    history.read === HISTORY_READ.FAILED ? (
      <EmptyState
        title={VERSION_HISTORY_WORDS.UNREAD}
        symbol={GLYPH.FAILED}
        action={{ label: TRY_AGAIN, onPress: history.retry, look: BUTTON_LOOK.BORDERED }}
      />
    ) : history.read === HISTORY_READ.READING ? (
      <EmptyState title={readingWords("the version history")} symbol={HISTORY_SYMBOL} loading />
    ) : revisions.length === 0 ? (
      <EmptyState title={VERSION_HISTORY_WORDS.NONE} symbol={HISTORY_SYMBOL} />
    ) : (
      <RowList look={LIST_LOOK.PLAIN}>
        <ListSection
          footer={
            history.older === HISTORY_READ.FAILED ? VERSION_HISTORY_WORDS.OLDER_UNREAD : undefined
          }
        >
          {revisions.map((line) => (
            <VersionRow
              key={line.seq}
              writer={versionWriter(line.lastEdit, pictureOf)}
              name={revisionWriterName(line.lastEdit, history.readerId)}
              summary={revisionSummary(line)}
              at={line.lastEdit.at}
              now={now}
              current={line.seq === newest}
              onPress={() =>
                router.push({
                  pathname: onOwnTab(VERSION_ROUTE),
                  params: {
                    id,
                    seq: String(line.seq),
                    at: String(line.lastEdit.at),
                    newest: String(newest),
                  },
                })
              }
            />
          ))}
          {earlier === undefined ? null : (
            <LinkRow
              symbol={GLYPH.MORE}
              label={
                history.older === HISTORY_READ.READING
                  ? readingWords("older versions")
                  : showMoreWords(earlier - 1)
              }
              disabled={history.older === HISTORY_READ.READING}
              onPress={history.readOlder}
            />
          )}
        </ListSection>
      </RowList>
    );

  return (
    <>
      <Stack.Screen options={{ title: VERSION_HISTORY_WORDS.TITLE }} />
      <Screen>{body}</Screen>
    </>
  );
}

/**
 * One version of a task's description, read whole as it stood after its
 * revision, its time in the bar. Restore this version stands in the bar but
 * over the newest, which is the description as it stands, and restores at
 * once, as the panel's does: a restore that went goes back to the history,
 * where it now stands at the head, and says so in the app's notice with
 * Undo, which restores the version that was newest before it.
 */
export function VersionScreen() {
  const {
    id = "",
    seq: spelled,
    at,
    newest: spelledNewest,
  } = useLocalSearchParams<{ id: string; seq?: string; at?: string; newest?: string }>();

  const seq = versionNumber(spelled);

  if (seq === undefined) {
    return (
      <Screen>
        <EmptyState title={VERSION_HISTORY_WORDS.VERSION_UNREAD} symbol={HISTORY_SYMBOL} />
      </Screen>
    );
  }

  const savedAt = Number(at);
  const newest = versionNumber(spelledNewest);

  return (
    <Version
      taskId={id}
      seq={seq}
      at={Number.isFinite(savedAt) && at !== undefined ? savedAt : undefined}
      newest={newest}
    />
  );
}

/** One version and its restore; `at` its latest save, which titles it, and `newest` the description as it stands, which a restore's Undo puts back, each none where the route did not carry it. */
function Version({
  taskId,
  seq,
  at,
  newest,
}: {
  readonly taskId: string;
  readonly seq: number;
  readonly at: number | undefined;
  readonly newest: number | undefined;
}) {
  const colors = useColors();
  const router = useRouter();
  const navigation = useNavigation();
  const acts = useHostActs();
  const write = useWrite();
  const openLink = useOpenLink();
  const notices = useFailureNotices();
  const version = useTaskVersion(taskId, seq);
  const [restoring, setRestoring] = useState(false);
  // The version that stands now, as the history beneath this screen follows it, else as the list stood when it was left.
  const standingNow = useNewestVersion(taskId) ?? newest;
  const current = standingNow === seq;
  const answer = version.data;
  const read = answer === undefined || "failure" in answer ? undefined : answer.revision;
  const { pictureSource, videoAt } = useDescriptionPictures(read?.description.body);

  const restore = () => {
    if (restoring) return;
    // Note that the Undo puts back the version that stood when the restore was pressed, as the panel's does.
    const undoTo = standingNow;
    setRestoring(true);
    // Note that every restore of this task's description, an Undo among them, is newer than a refused one, whose Try again then sends nothing.
    const subject = { kind: WRITE_SUBJECT.TASK_DESCRIPTION, id: taskId };

    const undo =
      undoTo === undefined || undoTo === seq
        ? undefined
        : () =>
            void write(() => acts[ACT_KIND.TASKS_RESTORE]({ taskId, seq: undoTo }), {
              refused: (restored) => (restored ? undefined : VERSION_HISTORY_WORDS.UNDO_REFUSED),
              unanswered: VERSION_HISTORY_WORDS.UNDO_REFUSED,
              subject,
              went: BUZZ.SUCCESS,
            });

    void write(() => acts[ACT_KIND.TASKS_RESTORE]({ taskId, seq }), {
      refused: (restored) => (restored ? undefined : VERSION_HISTORY_WORDS.RESTORE_REFUSED),
      unanswered: VERSION_HISTORY_WORDS.RESTORE_REFUSED,
      // Note that a refused restore offers Try again, as its words say, since the screen has gone back and nothing else sends it again.
      retry: true,
      subject,
      went: BUZZ.SUCCESS,
      // Note that Restored and its Undo are said on the restore that landed, a Try again's included.
      done: () =>
        notices.say({ kind: NOTICE_KIND.DONE, words: VERSION_HISTORY_WORDS.RESTORED, undo }),
    }).then(() => setRestoring(false));

    // Note that the screen goes back as the restore is sent rather than once it lands, which waits on the service and then on the change reaching the app: the description takes the version as it arrives, Restored stands with its Undo then, and a refusal says why in the failure notice.
    if (navigation.isFocused()) router.back();
  };

  const body = version.isPending ? (
    <EmptyState title={readingWords("this version")} symbol={HISTORY_SYMBOL} loading />
  ) : read === undefined ? (
    <EmptyState
      title={VERSION_HISTORY_WORDS.VERSION_UNREAD}
      symbol={GLYPH.FAILED}
      action={{
        label: TRY_AGAIN,
        onPress: () => void version.refetch(),
        look: BUTTON_LOOK.BORDERED,
      }}
    />
  ) : (
    <RowList look={LIST_LOOK.PLAIN}>
      <ListSection>
        <WordsRow
          words={read.description.body}
          onOpenLink={openLink}
          pictureSource={pictureSource}
          videoAt={videoAt}
        />
      </ListSection>
    </RowList>
  );

  return (
    <>
      <Stack.Screen
        options={{ title: at === undefined ? VERSION_HISTORY_WORDS.TITLE : dayAndTimeText(at) }}
      />
      {/* Note that Restore says what it does in words, as Pages' does, and stands dimmed on the description as it stands, heard as already current, as the panel keeps it, rather than vanishing. */}
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          tintColor={colors.TEXT}
          accessibilityLabel={
            current ? VERSION_HISTORY_WORDS.ALREADY_CURRENT : VERSION_HISTORY_WORDS.RESTORE
          }
          disabled={current || read === undefined || restoring}
          onPress={restore}
        >
          {RESTORE_BAR}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Screen>{body}</Screen>
    </>
  );
}
