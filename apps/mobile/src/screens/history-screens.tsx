// history-screens.tsx -- a task description's version history on the phone: its versions, newest first, and one version read whole, with Restore this version and its Undo.

import {
  revisionSummary,
  revisionWriterName,
  VERSION_HISTORY_WORDS,
} from "@repo/features/description-history-words";
import { type VersionDiff, versionDiff } from "@repo/features/description-version-diff";
import {
  LINK_DESTINATION,
  linkOf,
  linkWorkspaceStep,
  taskLinkStep,
} from "@repo/features/link-grammar";
import { providerOf } from "@repo/features/model-label";
import type { ModelProvider } from "@repo/features/models-wire";
import { DESCRIPTION_ACTOR, type DescriptionLastEdit } from "@repo/features/task-wire";
import { dayAndTimeText } from "@repo/features/time-format";
import { readingWords, showMoreWords, VERB } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import { APP_COMMAND, APP_SHORTCUTS } from "@repo/settings/shortcuts";
import {
  BUZZ,
  EmptyState,
  GLYPH,
  LIST_LOOK,
  LinkRow,
  ListSection,
  type LongPressGroup,
  NOTICE_KIND,
  ROW_ACTION_TONE,
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
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs, useListedAgents } from "../host/host-provider.js";
import { useKeeping } from "../keeping.js";
import { type PictureOf, useMemberPictures } from "../member-pictures.js";
import { openInSafari, useOpenLink } from "../open-link.js";
import { useOnOwnTab } from "../tab-route.js";
import {
  type DescriptionPictures,
  useDescriptionPictures,
} from "../tasks/use-description-pictures.js";
import {
  HISTORY_READ,
  useNewestVersion,
  useTaskHistory,
  useTaskVersion,
} from "../tasks/use-history.js";
import { useTaskOverview } from "../tasks/use-tasks.js";
import { useWrite, WRITE_SUBJECT } from "../use-write.js";

/** The route a version is opened on: the task by its id, and the version by its number in the query. */
export const VERSION_ROUTE = "/tasks/version/[id]";

export const HISTORY_ROUTE = "/tasks/history/[id]";

/** The glyph the history stands under while it says nothing else. */
const HISTORY_SYMBOL = GLYPH.HISTORY;

/** A version's number as its route's query carries it, none for anything that is not one. */
function versionNumber(spelled: string | undefined): number | undefined {
  const seq = Number(spelled);

  return Number.isInteger(seq) && seq >= 1 ? seq : undefined;
}

/** Who wrote a version, by the mark its row leads with, as the panel's version rows lead: a person by their face, its picture looked up only for a person. */
function versionWriter(
  lastEdit: DescriptionLastEdit,
  pictureOf: PictureOf,
  harness: ModelProvider | undefined,
): VersionWriter {
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
      return { kind: VERSION_WRITER.AGENT, name: revisionWriterName(lastEdit, undefined), harness };
    case DESCRIPTION_ACTOR.EARLIER:
      return { kind: VERSION_WRITER.EARLIER };
  }
}

/** What the bar's Restore says, short for the bar; it is heard as the panel's whole "Restore this version". */
const RESTORE_BAR = "Restore";

/**
 * Restores a version of a task's description, as the panel's Restore this
 * version does: at once, Restored said with its Undo once it lands, which
 * puts back `undoTo`, the version that stood as it was pressed, and a
 * refusal said with Try again. Every restore of the description, an Undo
 * among them, is newer than a refused one, whose Try again then sends
 * nothing. Answers once the restore settles.
 */
function useRestoreVersion(
  taskId: string,
): (seq: number, undoTo: number | undefined) => Promise<boolean> {
  const acts = useHostActs();
  const write = useWrite();
  const notices = useFailureNotices();

  return (seq, undoTo) => {
    const subject = { kind: WRITE_SUBJECT.TASK_DESCRIPTION, id: taskId };

    const undo =
      undoTo === undefined || undoTo === seq
        ? undefined
        : () =>
            void write(() => acts[ACT_KIND.TASKS_RESTORE]({ taskId, seq: undoTo }), {
              refused: (restored) => (restored ? undefined : VERSION_HISTORY_WORDS.UNDO_REFUSED),
              unanswered: VERSION_HISTORY_WORDS.UNDO_REFUSED,
              // Note that a refused Undo offers Try again, as its words say; a newer restore of the description holds it off (`subject`).
              retry: true,
              subject,
              went: BUZZ.SUCCESS,
            });

    return write(() => acts[ACT_KIND.TASKS_RESTORE]({ taskId, seq }), {
      refused: (restored) => (restored ? undefined : VERSION_HISTORY_WORDS.RESTORE_REFUSED),
      unanswered: VERSION_HISTORY_WORDS.RESTORE_REFUSED,
      // Note that a refused restore offers Try again, as its words say, since nothing else on screen sends it again.
      retry: true,
      subject,
      went: BUZZ.SUCCESS,
      // Note that Restored and its Undo are said on the restore that landed, a Try again's included.
      done: () =>
        notices.say({ kind: NOTICE_KIND.DONE, words: VERSION_HISTORY_WORDS.RESTORED, undo }),
    });
  };
}

/**
 * A task description's version history, as the panel's lists it: each
 * version under its writer, what it did and when, the newest marked
 * Current, and Show more under them while older versions stand unread. A
 * press opens the version whole. The host follows the history while the
 * screen stands, so a save lands at its head as it lands.
 */
export function HistoryScreen() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();

  return <History taskId={id} />;
}

/** A task description's version history, as `HistoryScreen` describes it. */
function History({ taskId: id }: { readonly taskId: string }) {
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const history = useTaskHistory(id);
  const pictureOf = useMemberPictures();
  const listedAgents = useListedAgents();

  // An agent's version leads with its harness's mark where the task's agents still hold its model, as the panel's version rows do.
  const harnessOf = (agentId: string | undefined): ModelProvider | undefined => {
    const model = listedAgents.find((agent) => agent.id === agentId)?.model;

    return model === undefined ? undefined : providerOf(model);
  };

  const keeping = useKeeping();
  const restoreVersion = useRestoreVersion(id);
  const task = useTaskOverview(id)?.task;
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const linkStep = task === undefined ? undefined : linkWorkspaceStep(task.workspaceId, workspaces);

  // A version's long press, as the panel's version row's menu holds it: its links, once its workspace is known, then Restore this version on any but the description as it stands.
  const versionMenu = (seq: number, current: boolean): readonly LongPressGroup[] => {
    const link =
      task === undefined || linkStep === undefined
        ? undefined
        : linkOf(
            { kind: LINK_DESTINATION.VERSION, taskId: taskLinkStep(task), revision: seq },
            linkStep,
          );

    return [
      link === undefined
        ? []
        : [
            {
              label: APP_SHORTCUTS[APP_COMMAND.COPY_LINK].label,
              symbol: GLYPH.LINK,
              tone: ROW_ACTION_TONE.NEUTRAL,
              onPress: () => keeping.copyWords(link),
            },
            {
              label: VERB.OPEN_IN_BROWSER,
              symbol: GLYPH.OPEN_EXTERNALLY,
              tone: ROW_ACTION_TONE.NEUTRAL,
              onPress: () => openInSafari(link),
            },
          ],
      current
        ? []
        : [
            {
              label: VERSION_HISTORY_WORDS.RESTORE,
              symbol: GLYPH.RESTORE,
              tone: ROW_ACTION_TONE.NEUTRAL,
              onPress: () => void restoreVersion(seq, newest),
            },
          ],
    ];
  };

  const now = useMinute();
  const revisions = history.page?.revisions ?? [];
  const earlier = history.page?.earlier;
  const newest = revisions[0]?.seq;

  const body =
    history.read === HISTORY_READ.FAILED ? (
      <EmptyState
        title={VERSION_HISTORY_WORDS.UNREAD}
        symbol={GLYPH.FAILED}
        retry={history.retry}
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
          {revisions.map((line, index) => (
            <VersionRow
              key={line.seq}
              writer={versionWriter(line.lastEdit, pictureOf, harnessOf(line.agentId))}
              name={revisionWriterName(line.lastEdit, history.readerId)}
              summary={revisionSummary(line)}
              at={line.lastEdit.at}
              now={now}
              current={line.seq === newest}
              first={index === 0}
              menu={versionMenu(line.seq, line.seq === newest)}
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
  const savedAt = Number(at);
  const newest = versionNumber(spelledNewest);
  const opened = Number.isFinite(savedAt) && at !== undefined ? savedAt : undefined;

  if (seq === undefined) {
    return (
      <Screen>
        <EmptyState title={VERSION_HISTORY_WORDS.VERSION_UNREAD} symbol={HISTORY_SYMBOL} />
      </Screen>
    );
  }

  return <Version taskId={id} seq={seq} at={opened} newest={newest} />;
}

/**
 * A version's words against the version before it, as the panel's version
 * page draws them: each section a row, one written in or changed edged in
 * green, one struck edged in red and dimmed. The phone's Markdown draws no
 * mark inside its words, so a changed section reads as it was written,
 * its struck words left out (`plain`). A version that changed nothing says so under
 * its words; the first, with nothing before it, says nothing.
 */
function VersionWords({
  diff,
  first,
  onOpenLink,
  pictureSource,
  videoAt,
  fileAt,
}: DescriptionPictures & {
  readonly diff: VersionDiff;
  readonly first: boolean;
  readonly onOpenLink: (address: string) => void;
}) {
  const unchanged = !first && !diff.changed;

  return (
    <RowList look={LIST_LOOK.PLAIN}>
      <ListSection footer={unchanged ? VERSION_HISTORY_WORDS.NO_CHANGE : undefined}>
        {diff.units.map((unit, at) => (
          <WordsRow
            // A section's heading may stand twice, struck and written again, so its place keys it.
            key={at}
            words={unit.plain}
            change={unit.change}
            last={at === diff.units.length - 1}
            onOpenLink={onOpenLink}
            pictureSource={pictureSource}
            videoAt={videoAt}
            fileAt={fileAt}
          />
        ))}
      </ListSection>
    </RowList>
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
  const openLink = useOpenLink(useTaskOverview(taskId)?.task.workspaceId);
  const restoreVersion = useRestoreVersion(taskId);
  const version = useTaskVersion(taskId, seq);
  const [restoring, setRestoring] = useState(false);
  // The version that stands now, as the history beneath this screen follows it, else as the list stood when it was left.
  const standingNow = useNewestVersion(taskId) ?? newest;
  const current = standingNow === seq;
  const answer = version.data;
  const read = answer === undefined || "failure" in answer ? undefined : answer.revision;

  // Note that the version is compared with the one before it once per read rather than on every draw, since a long description's comparison holds the screen for a moment each time.
  const diff = useMemo(
    () => (read === undefined ? undefined : versionDiff(read.previous, read.description)),
    [read],
  );

  // Note that the version and the one before it are each read for their pictures on their own, since a section struck from the one before draws through that version's own reference definitions, which share names with the version's.
  const shownPictures = useDescriptionPictures(read?.description.body);
  const struckPictures = useDescriptionPictures(read?.previous?.body);

  // Note that a picture the version itself names keeps what its own read says, `null` where it cannot be drawn among it, and only one it never named is asked of the version before.
  const pictureSource = (written: string) => {
    const shown = shownPictures.pictureSource(written);

    return shown === undefined ? struckPictures.pictureSource(written) : shown;
  };

  const videoAt = (written: string) =>
    shownPictures.videoAt(written) ?? struckPictures.videoAt(written);

  const fileAt = (written: string) =>
    shownPictures.fileAt(written) ?? struckPictures.fileAt(written);

  const restore = () => {
    if (restoring) return;
    setRestoring(true);
    void restoreVersion(seq, standingNow).then(() => setRestoring(false));

    // Note that the screen goes back as the restore is sent rather than once it lands, which waits on the service and then on the change reaching the app: the description takes the version as it arrives, Restored stands with its Undo then, and a refusal says why in the failure notice.
    if (navigation.isFocused()) router.back();
  };

  const body = version.isPending ? (
    <EmptyState title={readingWords("this version")} symbol={HISTORY_SYMBOL} loading />
  ) : read === undefined || diff === undefined ? (
    <EmptyState
      title={VERSION_HISTORY_WORDS.VERSION_UNREAD}
      symbol={GLYPH.FAILED}
      retry={() => void version.refetch()}
    />
  ) : (
    <VersionWords
      diff={diff}
      first={read.previous === null}
      onOpenLink={openLink}
      pictureSource={pictureSource}
      videoAt={videoAt}
      fileAt={fileAt}
    />
  );

  const name = at === undefined ? VERSION_HISTORY_WORDS.TITLE : dayAndTimeText(at);

  return (
    <>
      <Stack.Screen options={{ title: name }} />
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
