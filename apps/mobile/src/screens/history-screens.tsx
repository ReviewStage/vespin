// history-screens.tsx -- a task description's version history on the phone: its versions, newest first, and one version read whole, with Restore this version and its Undo.

import {
  revisionSummary,
  revisionWriterName,
  VERSION_HISTORY_WORDS,
} from "@repo/features/description-history-words";
import { type VersionDiff, versionDiff } from "@repo/features/description-version-diff";
import type { DescriptionRevisionLine } from "@repo/features/task-wire";
import { agoText, dayAndTimeText } from "@repo/features/time-format";
import { readingWords, showMoreWords } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import {
  BUZZ,
  DetailPage,
  EmptyState,
  GLYPH,
  glyphSymbol,
  LIST_LOOK,
  LinkRow,
  ListSection,
  NOTICE_KIND,
  RowList,
  Screen,
  useColors,
  useFailureNotices,
  WordsRow,
} from "@repo/ui-native";
import { Stack, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useState } from "react";
import { PUSHED_PAGE, useDetailLeave, useDetailPush, useHandToDetail } from "../detail-stack.js";
import { useHostActs } from "../host/host-provider.js";
import { useOpenLink } from "../open-link.js";
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
import { useWrite, WRITE_SUBJECT } from "../use-write.js";

/** The route a version is opened on: the task by its id, and the version by its number in the query. */
export const VERSION_ROUTE = "/tasks/version/[id]";

/** The route a task's version history is opened on. */
export const HISTORY_ROUTE = "/tasks/history/[id]";

/** The glyph each version's row leads with, the panel's restore arrow round a clock. */
const VERSION_SYMBOL = GLYPH.HISTORY;

/** The glyph the history stands under while it says nothing else. */
const HISTORY_SYMBOL = GLYPH.HISTORY;

/** A version's number as its route's query carries it, none for anything that is not one. */
function versionNumber(spelled: string | undefined): number | undefined {
  const seq = Number(spelled);

  return Number.isInteger(seq) && seq >= 1 ? seq : undefined;
}

/** The line under a version's writer: Current first on the newest, so a narrow row cuts off its summary rather than it, then what it did and how long ago. */
function versionLine(line: DescriptionRevisionLine, newest: boolean, now: number): string {
  const said = [revisionSummary(line), agoText(line.lastEdit.at, now)];

  return (newest ? [VERSION_HISTORY_WORDS.CURRENT, ...said] : said).join(" · ");
}

/**
 * A task description's version history, as the panel's lists it: each
 * version under its writer, what it did and when, the newest marked
 * Current, and Show more under them while older versions stand unread. A
 * press opens the version whole. The host follows the history while the
 * screen stands, so a save lands at its head as it lands. In a window wide
 * enough for three columns it stands pushed over the split view's detail
 * instead, and a version opens over it there.
 */
export function HistoryScreen() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const handed = useHandToDetail({ kind: PUSHED_PAGE.HISTORY, taskId: id });

  if (handed) return null;

  return <History taskId={id} />;
}

/** A task description's version history, as `HistoryScreen` describes it; `inColumn` pushed over a split view's detail. */
export function History({
  taskId: id,
  inColumn = false,
}: {
  readonly taskId: string;
  readonly inColumn?: boolean | undefined;
}) {
  const router = useRouter();
  const toDetail = useDetailPush();
  const onOwnTab = useOnOwnTab();
  const history = useTaskHistory(id);
  const now = Date.now();
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
          {revisions.map((line) => (
            <LinkRow
              key={line.seq}
              symbol={VERSION_SYMBOL}
              label={revisionWriterName(line.lastEdit, history.readerId)}
              detail={versionLine(line, line.seq === newest, now)}
              onPress={() => {
                const version = {
                  kind: PUSHED_PAGE.VERSION,
                  taskId: id,
                  seq: line.seq,
                  at: line.lastEdit.at,
                  newest,
                } as const;

                if (toDetail(version)) return;
                router.push({
                  pathname: onOwnTab(VERSION_ROUTE),
                  params: {
                    id,
                    seq: String(line.seq),
                    at: String(line.lastEdit.at),
                    newest: String(newest),
                  },
                });
              }}
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

  if (inColumn) return <DetailPage bar={{ name: VERSION_HISTORY_WORDS.TITLE }}>{body}</DetailPage>;

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

  const handed = useHandToDetail(
    seq === undefined
      ? undefined
      : { kind: PUSHED_PAGE.VERSION, taskId: id, seq, at: opened, newest },
  );

  if (handed && seq !== undefined) return null;

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

/** One version and its restore; `at` its latest save, which titles it, and `newest` the description as it stands, which a restore's Undo puts back, each none where the route did not carry it; `inColumn` pushed over a split view's detail, where a restore that went goes back in its column. */
export function Version({
  taskId,
  seq,
  at,
  newest,
  inColumn = false,
}: {
  readonly taskId: string;
  readonly seq: number;
  readonly at: number | undefined;
  readonly newest: number | undefined;
  readonly inColumn?: boolean | undefined;
}) {
  const detail = useDetailLeave();
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

    // Note that the screen goes back as the restore is sent rather than once it lands, which waits on the service and then on the change reaching the app: the description takes the version as it arrives, Restored stands with its Undo then, and a refusal says why in the failure notice. In a column it leaves only while it stands on top of its stack.
    if (detail !== undefined) {
      if (detail.onTop()) detail.leave();
    } else if (navigation.isFocused()) router.back();
  };

  const body = version.isPending ? (
    <EmptyState title={readingWords("this version")} symbol={HISTORY_SYMBOL} loading />
  ) : read === undefined ? (
    <EmptyState
      title={VERSION_HISTORY_WORDS.VERSION_UNREAD}
      symbol={GLYPH.FAILED}
      retry={() => void version.refetch()}
    />
  ) : (
    <VersionWords
      diff={versionDiff(read.previous, read.description)}
      first={read.previous === null}
      onOpenLink={openLink}
      pictureSource={pictureSource}
      videoAt={videoAt}
      fileAt={fileAt}
    />
  );

  const name = at === undefined ? VERSION_HISTORY_WORDS.TITLE : dayAndTimeText(at);

  if (inColumn) {
    const restoreAct = {
      label: VERSION_HISTORY_WORDS.RESTORE,
      symbol: GLYPH.RESTORE,
      disabled: read === undefined || restoring,
      onPress: restore,
    };

    return <DetailPage bar={{ name, acts: current ? [] : [restoreAct] }}>{body}</DetailPage>;
  }

  return (
    <>
      <Stack.Screen options={{ title: name }} />
      {current ? null : (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon={glyphSymbol(GLYPH.RESTORE)}
            tintColor={colors.TEXT}
            accessibilityLabel={VERSION_HISTORY_WORDS.RESTORE}
            disabled={read === undefined || restoring}
            onPress={restore}
          />
        </Stack.Toolbar>
      )}
      <Screen>{body}</Screen>
    </>
  );
}
