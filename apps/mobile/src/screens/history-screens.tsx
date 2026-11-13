// history-screens.tsx -- a task description's version history on the phone: its versions, newest first, and one version read whole, with Restore this version and its Undo.

import {
  revisionSummary,
  revisionWriterName,
  VERSION_HISTORY_WORDS,
} from "@repo/features/description-history-words";
import type { DescriptionRevisionLine } from "@repo/features/task-wire";
import { agoText, dayAndTimeText } from "@repo/features/time-format";
import { readingWords, showMoreWords, VERB } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import {
  BUTTON_LOOK,
  BUZZ,
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
import { useEffect, useRef, useState } from "react";
import { useHostActs } from "../host/host-provider.js";
import { useOpenLink } from "../open-link.js";
import { useOnOwnTab } from "../tab-route.js";
import { useDescriptionPictures } from "../tasks/use-description-pictures.js";
import {
  HISTORY_READ,
  useNewestVersion,
  useTaskHistory,
  useTaskVersion,
} from "../tasks/use-history.js";
import { useWrite } from "../use-write.js";

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
 * screen stands, so a save lands at its head as it lands.
 */
export function HistoryScreen() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
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
        action={{ label: VERB.TRY_AGAIN, look: BUTTON_LOOK.BORDERED, onPress: history.retry }}
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
  // Whether the screen still stands, since a restore that lands after it was left must not go back from the screen in front.
  const standing = useRef(true);
  useEffect(() => {
    standing.current = true;

    return () => {
      standing.current = false;
    };
  }, []);
  const answer = version.data;
  const read = answer === undefined || "failure" in answer ? undefined : answer.revision;
  const { pictureSource, videoAt } = useDescriptionPictures(read?.document.body);

  const restore = () => {
    if (restoring) return;
    // Note that the Undo puts back the version that stood when the restore was pressed, as the panel's does.
    const undoTo = standingNow;
    setRestoring(true);

    const undo =
      undoTo === undefined || undoTo === seq
        ? undefined
        : () =>
            void write(() => acts[ACT_KIND.TASKS_RESTORE]({ taskId, seq: undoTo }), {
              refused: (restored) => (restored ? undefined : VERSION_HISTORY_WORDS.UNDO_REFUSED),
              unanswered: VERSION_HISTORY_WORDS.UNDO_REFUSED,
              went: BUZZ.SUCCESS,
            });

    void write(() => acts[ACT_KIND.TASKS_RESTORE]({ taskId, seq }), {
      refused: (restored) => (restored ? undefined : VERSION_HISTORY_WORDS.RESTORE_REFUSED),
      unanswered: VERSION_HISTORY_WORDS.RESTORE_REFUSED,
      went: BUZZ.SUCCESS,
    }).then((went) => {
      setRestoring(false);

      if (!went) return;
      notices.say({ kind: NOTICE_KIND.DONE, words: VERSION_HISTORY_WORDS.RESTORED, undo });

      // Note that a link pressed in the version while its restore was out stands in front of it, and is left where it is.
      if (standing.current && navigation.isFocused()) router.back();
    });
  };

  const body = version.isPending ? (
    <EmptyState title={readingWords("this version")} symbol={HISTORY_SYMBOL} loading />
  ) : read === undefined ? (
    <EmptyState
      title={VERSION_HISTORY_WORDS.VERSION_UNREAD}
      symbol={GLYPH.FAILED}
      action={{
        label: VERB.TRY_AGAIN,
        look: BUTTON_LOOK.BORDERED,
        onPress: () => void version.refetch(),
      }}
    />
  ) : (
    <RowList look={LIST_LOOK.PLAIN}>
      <ListSection>
        <WordsRow
          words={read.document.body}
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
