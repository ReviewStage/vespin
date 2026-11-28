// pull-request-files-screens.tsx -- the files one pull request changes, on a screen of its own pushed from the pull request's page: one list in the tree's order, each file its letter, name, lines and folder, and a search by path; each file's diff on a screen of its own, drawn natively, stepping to the file before or after it, its review threads standing under their lines, each opening on its own screen, and a comment asked on any line from its long press; a new comment on one line, added to the member's review or sent at once; and the member's pending review, finished or discarded.

import { DIFF_SIDE, type DiffSide } from "@repo/features/agent-wire";
import {
  CHANGES_WORDS,
  changesLine,
  fileNotice,
  filterFiles,
  folderAndName,
  gitHubFileDiffLink,
  startsCollapsed,
  treeOrder,
} from "@repo/features/changed-files";
import {
  iosPullRequestFileRoute,
  iosPullRequestLineCommentRoute,
  iosPullRequestReviewRoute,
  iosPullRequestThreadRoute,
} from "@repo/features/ios-app-links";
import { GITHUB_PAGE, gitHubPageLink } from "@repo/features/link-grammar";
import {
  REVIEW_EVENT_WORDS,
  REVIEW_PANEL_WORDS,
  reviewPlaceholderOf,
} from "@repo/features/pull-request-model";
import {
  PULL_REQUEST_ACTION,
  REVIEW_COMMENT_MODE,
  REVIEW_COMMENT_SIDE,
  REVIEW_EVENT,
  type ReviewCommentMode,
  type ReviewEvent,
} from "@repo/features/pull-request-write-wire";
import {
  BAR_TITLE,
  BUTTON_LOOK,
  ChangedFileRow,
  Composer,
  ConfirmAsk,
  DiffView,
  diffLineText,
  EmptyState,
  footerToneOf,
  GLYPH,
  GlassDock,
  glyphSymbol,
  LIST_LOOK,
  ListSection,
  MarkRow,
  MENU_CHIP_LOOK,
  MenuChip,
  RowList,
  Screen,
  ScriptRow,
  STATUS_TONE,
  StackSubtitle,
  useColors,
  useWindowSizeClass,
  WINDOW_SIZE_CLASS,
  WordsRow,
  WriteNoteRow,
  wordsHandedBack,
} from "@repo/ui-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { openInSafari, useOpenLink } from "../open-link.js";
import { type PullRequestKey, usePullRequestWrites } from "../pull-requests/use-pull-request.js";
import { usePullRequestChanges } from "../pull-requests/use-pull-request-changes.js";
import {
  usePendingReview,
  usePullRequestThreads,
} from "../pull-requests/use-pull-request-threads.js";
import { useFileViewed, usePullRequestViewed } from "../pull-requests/use-pull-request-viewed.js";
import { useOnOwnTab } from "../tab-route.js";

/** What the screen says in the panel's words, beyond the changes' own (`CHANGES_WORDS`). */
const FILES_WORDS = {
  TITLE: "Files changed",
  FIND: "Find a file",
  NONE_FOUND: "No files match.",
  MORE: "More",
  HIDE_VIEWED: "Hide viewed",
  ALL_VIEWED: "Every file is viewed.",
} as const;

/** What a file's screen says and offers, in the panel's words where it has them. */
const FILE_WORDS = {
  MORE: "More",
  VIEWED: "Viewed",
  PREVIOUS: "Previous file",
  NEXT: "Next file",
  WRAP: "Wrap lines",
  OPEN_ON_GITHUB: "Open on GitHub",
  NOT_FOUND: "This file isn't in the pull request's changes.",
  FOLDED: "Diff folded",
  FOLDED_WHY: "Deleted, generated, and very large files start folded.",
  SHOW_DIFF: "Show diff",
} as const;

/** The pull request a screen's route names, by its workspace, its repository's owner and name, and its number. */
function usePullRequestKey(): PullRequestKey {
  const {
    workspace = "",
    owner = "",
    name = "",
    number = "",
  } = useLocalSearchParams<{ workspace: string; owner: string; name: string; number: string }>();

  return { workspaceId: workspace, repository: `${owner}/${name}`, number: Number(number) };
}

/** The pull request's address on GitHub: the one its changes' read answered with, so a file opens on the pull request as GitHub spells it, else one made from its repository and number. */
function gitHubAddressOf(key: PullRequestKey, read: string | undefined): string {
  return (
    read ??
    gitHubPageLink({
      kind: GITHUB_PAGE.PULL_REQUEST,
      repository: key.repository,
      number: key.number,
    })
  );
}

/** What the bar says under the title: how many files, and the lines they add and remove together, as GitHub's tab counts them. */
function summaryOf(
  files: readonly { readonly additions: number; readonly deletions: number }[],
  viewed: number,
) {
  const counted = changesLine({
    files: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  });

  return viewed === 0 ? counted : `${counted} · ${viewed} viewed`;
}

/**
 * The files a pull request changes, by its workspace, its repository and
 * its number, read as the screen first shows (`usePullRequestChanges`) and
 * on a pull down. The files stand in one list, in the order the desktop's
 * tree lists them (`treeOrder`), each a row naming the folder it stands in
 * under its name (`ChangedFileRow`), as Dean picked. The bar's search
 * keeps the files whose path holds what is typed, as the desktop's does
 * (`filterFiles`), and Hide viewed in its ⋯ leaves out the files the
 * member marked viewed (`usePullRequestViewed`), each standing faded and
 * ticked otherwise, their count in the bar's summary; a mark GitHub would
 * not take says so in the list's footer. Where the member holds a pending
 * review, its ⋯ leads with Finish your review and how many comments it
 * holds (`PullRequestReviewScreen`). A press opens the file's diff on a screen of its own
 * (`PullRequestFileScreen`). Where GitHub
 * listed more files than one read carries, the list's footer says so, in
 * the panel's words, as it says a read that failed after files were drawn,
 * which leaves them drawn.
 */
export function PullRequestFilesScreen() {
  const key = usePullRequestKey();
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const colors = useColors();
  const regular = useWindowSizeClass() === WINDOW_SIZE_CLASS.REGULAR;
  const changes = usePullRequestChanges(key);
  const viewed = usePullRequestViewed(key);
  const pending = usePendingReview(key);
  const [search, setSearch] = useState("");
  const [hideViewed, setHideViewed] = useState(false);
  const files = changes.files;

  // Note that the files marked viewed are counted as they stand drawn, a press not yet settled among them.
  const viewedCount =
    files === undefined ? 0 : files.filter((file) => viewed.viewed(file.path)).length;

  const bar = (
    <>
      <Stack.Screen
        options={{
          title: FILES_WORDS.TITLE,
          headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
        }}
      >
        <Stack.SearchBar
          placeholder={FILES_WORDS.FIND}
          onChangeText={(event) => setSearch(event.nativeEvent.text)}
          onCancelButtonPress={() => setSearch("")}
        />
      </Stack.Screen>
      <StackSubtitle
        words={files === undefined ? "" : summaryOf(files, viewedCount)}
        leading={regular}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon={glyphSymbol(GLYPH.MORE)} accessibilityLabel={FILES_WORDS.MORE}>
          <Stack.Toolbar.Label>{FILES_WORDS.MORE}</Stack.Toolbar.Label>
          {pending === undefined ? null : (
            <Stack.Toolbar.MenuAction
              icon={glyphSymbol(GLYPH.COMMENT)}
              onPress={() => router.push(onOwnTab(iosPullRequestReviewRoute(key)))}
            >
              {`${REVIEW_PANEL_WORDS.TITLE} (${pending.comments})`}
            </Stack.Toolbar.MenuAction>
          )}
          <Stack.Toolbar.MenuAction isOn={hideViewed} onPress={() => setHideViewed(!hideViewed)}>
            {FILES_WORDS.HIDE_VIEWED}
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
    </>
  );

  const searched = files === undefined ? [] : filterFiles(treeOrder(files), search);
  const kept = hideViewed ? searched.filter((file) => !viewed.viewed(file.path)) : searched;

  // Note that a read failing after files were drawn keeps them, and says so under them, as a pull reads them again; a mark GitHub would not take says so there first.
  const refused =
    viewed.note ?? (files !== undefined && changes.failed ? CHANGES_WORDS.FAILED : undefined);

  const footer = refused ?? (changes.truncated ? CHANGES_WORDS.TRUNCATED : undefined);

  const byPath = new Map(kept.map((file) => [file.path, file]));

  const empty =
    files === undefined ? (
      changes.failed ? (
        <EmptyState
          title={CHANGES_WORDS.FAILED}
          symbol={GLYPH.FAILED}
          retry={() => void changes.refresh()}
        />
      ) : (
        <EmptyState title={CHANGES_WORDS.READING} symbol={GLYPH.CHANGES} loading />
      )
    ) : files.length === 0 ? (
      <EmptyState title={CHANGES_WORDS.EMPTY} symbol={GLYPH.CHANGES} />
    ) : kept.length === 0 && searched.length > 0 ? (
      <EmptyState title={FILES_WORDS.ALL_VIEWED} symbol={GLYPH.CHECK} />
    ) : kept.length === 0 ? (
      <EmptyState title={FILES_WORDS.NONE_FOUND} symbol={GLYPH.SEARCH} />
    ) : undefined;

  return (
    <>
      {bar}
      <Screen>
        <RowList
          look={LIST_LOOK.PLAIN}
          searched={search}
          empty={empty}
          onRefresh={changes.refresh}
          onSelect={(path) => {
            if (byPath.has(path)) router.push(onOwnTab(iosPullRequestFileRoute(key, path)));
          }}
        >
          <ListSection footer={footer} footerTone={footerToneOf(refused)}>
            {kept.map((file) => (
              <ChangedFileRow key={file.path} file={file} viewed={viewed.viewed(file.path)} />
            ))}
          </ListSection>
        </RowList>
      </Screen>
    </>
  );
}

/**
 * One file a pull request changes, its diff on a screen of its own, the
 * file named by its path in the route's query: its name in the bar, in the
 * ink, its folder under it, and the diff filling the screen
 * (`DiffView`), drawn natively and wrapped unless Wrap lines in the ⋯ says
 * not. Viewed in the ⋯ marks the file viewed on GitHub, or unmarks it, as
 * the desktop's box does (`useFileViewed`). The arrows beside the ⋯ step to the file before or after it in the
 * list's order, in place, as Mail steps between messages, an arrow at the
 * list's end standing dimmed; the ⋯ also opens the file's diff on GitHub.
 * A file with no diff to draw says why, in the panel's words
 * (`fileNotice`), with Open on GitHub; one that starts folded, as the
 * desktop folds a deleted, generated, or very large file
 * (`startsCollapsed`), says so with Show diff. Each review thread on the
 * file stands as a card under the line it is on (`usePullRequestThreads`),
 * and a press on it opens the thread whole on its own screen
 * (`pull-request-thread-screens.tsx`); a long press on a line offers
 * Comment on line (`PullRequestLineCommentScreen`). The files are the list's own
 * read (`usePullRequestChanges`), so the screen reads nothing of its own
 * where the list read them.
 */
export function PullRequestFileScreen() {
  const key = usePullRequestKey();
  const { path = "" } = useLocalSearchParams<{ path: string }>();
  const router = useRouter();
  const colors = useColors();
  const regular = useWindowSizeClass() === WINDOW_SIZE_CLASS.REGULAR;
  const changes = usePullRequestChanges(key);
  const viewed = useFileViewed(key, path);
  const threads = usePullRequestThreads(key);
  const onOwnTab = useOnOwnTab();
  const [wrap, setWrap] = useState(true);
  // The files whose folded diff was asked for by Show diff, by path, held while the screen stands.
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const ordered = changes.files === undefined ? [] : treeOrder(changes.files);
  const at = ordered.findIndex((file) => file.path === path);
  const file = ordered[at];
  const { folder, name } = folderAndName(path);
  const url = gitHubAddressOf(key, changes.url);
  const openOnGitHub = () => void gitHubFileDiffLink(url, path).then(openInSafari);

  // Note that a step moves the route's query in place, so the stack holds one file's screen however many files are stepped through.
  const stepTo = (next: string | undefined) => {
    if (next !== undefined) router.setParams({ path: next });
  };

  const bar = (
    <>
      <Stack.Screen
        options={{ title: name, headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT } }}
      />
      <StackSubtitle words={folder} leading={regular} />
      <Stack.Toolbar placement="right">
        {/* Note that the arrows and ⋯ stand in one bar, as an Inbox thread's do, an arrow at the list's end dimmed rather than gone, so the other never moves under the thumb. */}
        <Stack.Toolbar.Button
          accessibilityLabel={FILE_WORDS.PREVIOUS}
          disabled={at <= 0}
          icon={glyphSymbol(GLYPH.PREVIOUS_ITEM)}
          onPress={() => stepTo(ordered[at - 1]?.path)}
        >
          {FILE_WORDS.PREVIOUS}
        </Stack.Toolbar.Button>
        <Stack.Toolbar.Button
          accessibilityLabel={FILE_WORDS.NEXT}
          disabled={at === -1 || at >= ordered.length - 1}
          icon={glyphSymbol(GLYPH.NEXT_ITEM)}
          onPress={() => stepTo(ordered[at + 1]?.path)}
        >
          {FILE_WORDS.NEXT}
        </Stack.Toolbar.Button>
        <Stack.Toolbar.Menu icon={glyphSymbol(GLYPH.MORE)} accessibilityLabel={FILE_WORDS.MORE}>
          <Stack.Toolbar.Label>{FILE_WORDS.MORE}</Stack.Toolbar.Label>
          <Stack.Toolbar.MenuAction
            isOn={viewed.viewed}
            disabled={viewed.toggle === undefined || file === undefined}
            onPress={() => viewed.toggle?.()}
          >
            {FILE_WORDS.VIEWED}
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction isOn={wrap} onPress={() => setWrap(!wrap)}>
            {FILE_WORDS.WRAP}
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            icon={glyphSymbol(GLYPH.OPEN_EXTERNALLY)}
            onPress={openOnGitHub}
          >
            {FILE_WORDS.OPEN_ON_GITHUB}
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
    </>
  );

  const notice = file === undefined ? undefined : fileNotice(file);
  const folded = file !== undefined && startsCollapsed(file) && !unfolded.has(file.path);

  // Note that the diff stands as the screen's root rather than in its SwiftUI host, as the agent's transcript does, since it is a native view that scrolls by itself and sizes itself to the screen.
  if (file !== undefined && notice === undefined && !folded && file.patch !== null) {
    return (
      <>
        {bar}
        <DiffView
          patch={file.patch}
          path={file.path}
          wrap={wrap}
          threads={threads}
          onThreadPress={(thread) => {
            const first = thread.comments[0]?.url;

            // Note that a thread read from a service before GitHub's own ids rode with it opens on GitHub, since the thread's screen names it by that id.
            if (thread.id !== undefined)
              router.push(onOwnTab(iosPullRequestThreadRoute(key, thread.id)));
            else if (first !== undefined) openInSafari(first);
          }}
          onLineComment={(target) =>
            router.push(
              onOwnTab(iosPullRequestLineCommentRoute(key, { path: file.path, ...target })),
            )
          }
          testID="pull-request-diff"
        />
      </>
    );
  }

  const state =
    changes.files === undefined ? (
      changes.failed ? (
        <EmptyState
          title={CHANGES_WORDS.FAILED}
          symbol={GLYPH.FAILED}
          retry={() => void changes.refresh()}
        />
      ) : (
        <EmptyState title={CHANGES_WORDS.READING} symbol={GLYPH.CHANGES} loading />
      )
    ) : file === undefined ? (
      <EmptyState title={FILE_WORDS.NOT_FOUND} symbol={GLYPH.CHANGES} />
    ) : notice !== undefined ? (
      <EmptyState
        title={notice}
        symbol={GLYPH.FILE}
        action={{
          label: FILE_WORDS.OPEN_ON_GITHUB,
          onPress: openOnGitHub,
          look: BUTTON_LOOK.BORDERED,
        }}
      />
    ) : (
      <EmptyState
        title={FILE_WORDS.FOLDED}
        description={FILE_WORDS.FOLDED_WHY}
        symbol={GLYPH.CHANGES}
        action={{
          label: FILE_WORDS.SHOW_DIFF,
          onPress: () => setUnfolded(new Set([...unfolded, file.path])),
          look: BUTTON_LOOK.BORDERED,
        }}
      />
    );

  return (
    <>
      {bar}
      <Screen>{state}</Screen>
    </>
  );
}

/** What a new comment's screen says, in the panel's words where it has them. */
const COMMENT_WORDS = {
  PLACEHOLDER: "Leave a comment",
  line: (line: number) => `Comment on line ${line}`,
  where: (name: string, line: number) => `${name} · line ${line}`,
  SENDS_AS: "Sends as",
  NO_LINE: "This line isn't in the file's diff anymore.",
} as const;

/** What each way of sending a comment is called, as its capsule says it: added to the member's pending review, as GitHub's Start a review, or sent at once. */
const MODE_WORDS = {
  [REVIEW_COMMENT_MODE.REVIEW]: "Add to review",
  [REVIEW_COMMENT_MODE.SINGLE]: "Comment now",
} as const satisfies Record<ReviewCommentMode, string>;

/** The side a comment is written on, as GitHub takes it, for the side a diff's line counts on. */
const COMMENT_SIDE_OF = {
  [DIFF_SIDE.LEFT]: REVIEW_COMMENT_SIDE.LEFT,
  [DIFF_SIDE.RIGHT]: REVIEW_COMMENT_SIDE.RIGHT,
} as const satisfies Record<DiffSide, string>;

/**
 * A new review comment on one line of a pull request's file, named by the
 * file's path, the line, and the side it counts on in the route's query,
 * opened from the line's long press in its diff: the line quoted in the
 * monospaced face under the file's name, and the comment field docked under
 * it, taking the keyboard as it opens. Its capsule says how Send sends it,
 * Add to review by default, as Dean picked, which adds it to the member's
 * pending review on GitHub, or Comment now, which posts it alone. A comment
 * GitHub took closes the screen, the conversation read again behind it; one
 * it would not take says why above the line and keeps the words.
 */
export function PullRequestLineCommentScreen() {
  const key = usePullRequestKey();

  const {
    path = "",
    line = "",
    side = "",
  } = useLocalSearchParams<{ path: string; line: string; side: string }>();

  const router = useRouter();
  const colors = useColors();
  const regular = useWindowSizeClass() === WINDOW_SIZE_CLASS.REGULAR;
  const changes = usePullRequestChanges(key);
  const writes = usePullRequestWrites(key);
  const [words, setWords] = useState("");
  const [mode, setMode] = useState<ReviewCommentMode>(REVIEW_COMMENT_MODE.REVIEW);
  const lineNumber = Number(line);
  const diffSide = side === DIFF_SIDE.LEFT ? DIFF_SIDE.LEFT : DIFF_SIDE.RIGHT;
  const file = changes.files?.find((each) => each.path === path);
  const patch = file?.patch ?? null;
  const quoted = patch === null ? undefined : diffLineText(patch, lineNumber, diffSide);
  const { name } = folderAndName(path);
  const headSha = changes.headSha;

  // Note that Send hands the words it took out of the field, and they go back in it where GitHub refused them, as a thread's reply does.
  const send = (typed: string) => {
    const body = typed.trim();

    if (headSha === undefined || body === "" || writes.pending !== undefined) return false;

    void writes
      .write({
        action: PULL_REQUEST_ACTION.ADD_REVIEW_COMMENT,
        mode,
        path,
        line: lineNumber,
        side: COMMENT_SIDE_OF[diffSide],
        body,
        headSha,
      })
      .then((went) => {
        if (went) router.back();
        else setWords((now) => wordsHandedBack(typed, now));
      });

    return true;
  };

  const modeChip = (
    <MenuChip
      look={MENU_CHIP_LOOK.COMPOSER}
      label={MODE_WORDS[mode]}
      menu={{
        groups: [
          {
            title: COMMENT_WORDS.SENDS_AS,
            choices: [REVIEW_COMMENT_MODE.REVIEW, REVIEW_COMMENT_MODE.SINGLE].map((each) => ({
              label: MODE_WORDS[each],
              on: each === mode,
              onPress: () => setMode(each),
            })),
          },
        ],
      }}
    />
  );

  const quote =
    quoted !== undefined ? (
      <ScriptRow name={COMMENT_WORDS.where(name, lineNumber)} script={quoted} />
    ) : changes.files === undefined ? (
      <EmptyState title={CHANGES_WORDS.READING} symbol={GLYPH.CHANGES} loading />
    ) : (
      <EmptyState title={COMMENT_WORDS.NO_LINE} symbol={GLYPH.CHANGES} />
    );

  return (
    <>
      <Stack.Screen
        options={{
          title: COMMENT_WORDS.line(lineNumber),
          headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
        }}
      />
      <StackSubtitle words={name} leading={regular} />
      <GlassDock
        bar={
          <Composer
            placeholder={COMMENT_WORDS.PLACEHOLDER}
            autoFocus
            words={words}
            onWords={setWords}
            sendable={words.trim() !== "" && headSha !== undefined && writes.pending === undefined}
            onSend={send}
            tools={modeChip}
          />
        }
      >
        <Screen>
          <RowList look={LIST_LOOK.PLAIN}>
            <ListSection>
              {writes.note === undefined ? null : (
                <WriteNoteRow words={writes.note.words} said={writes.note.said} />
              )}
              {quote}
            </ListSection>
          </RowList>
        </Screen>
      </GlassDock>
    </>
  );
}

/** What the review screen's ⋯ and its Discard ask say, in the panel's words. */
const FINISH_WORDS = {
  MORE: "More",
  SAYS: "The review says",
  DISCARD_QUESTION: "Discard your pending review?",
  DISCARD_WHY: "This deletes every pending comment you added to it.",
  DISCARD_REVIEW: "Discard review",
  NONE: "You have no pending review on this pull request.",
  where: (path: string, line: number | null) =>
    line === null ? folderAndName(path).name : `${folderAndName(path).name} · line ${line}`,
} as const;

/** What a review may say, in the order GitHub's own review box offers it. */
const REVIEW_EVENTS: readonly ReviewEvent[] = [
  REVIEW_EVENT.COMMENT,
  REVIEW_EVENT.APPROVE,
  REVIEW_EVENT.REQUEST_CHANGES,
];

/**
 * The member's pending review on a pull request, finished from the phone as
 * the desktop's Finish your review panel finishes it: its comments listed,
 * each with the file and line it is on and its words, and the summary field
 * docked at its foot, whose capsule says what the review says (Comment,
 * Approve, or Request changes, as GitHub's own review box offers them) and
 * whose Send submits it on GitHub as the member. Discard in the ⋯ asks
 * first, then throws the review and its comments away. A review GitHub took
 * closes the screen, the conversation read again behind it; one it would not
 * take, such as an approval of the member's own pull request, says why.
 */
export function PullRequestReviewScreen() {
  const key = usePullRequestKey();
  const router = useRouter();
  const colors = useColors();
  const regular = useWindowSizeClass() === WINDOW_SIZE_CLASS.REGULAR;
  const pending = usePendingReview(key);
  const writes = usePullRequestWrites(key);
  const openLink = useOpenLink(key.workspaceId);
  const [body, setBody] = useState("");
  const [event, setEvent] = useState<ReviewEvent>(REVIEW_EVENT.COMMENT);
  const [discarding, setDiscarding] = useState(false);
  const busy = writes.pending !== undefined;

  // Note that asking for changes wants its summary, as GitHub's own box does; every other review may go with none.
  const sendable = !busy && (event !== REVIEW_EVENT.REQUEST_CHANGES || body.trim() !== "");

  // Note that Send hands the summary it took out of the field, which may stand empty but for a request for changes, and it goes back in the field where GitHub refused the review.
  const submit = (typed: string) => {
    if (busy || (event === REVIEW_EVENT.REQUEST_CHANGES && typed.trim() === "")) return false;

    void writes
      .write({ action: PULL_REQUEST_ACTION.SUBMIT_REVIEW, event, body: typed })
      .then((went) => {
        if (went) router.back();
        else setBody((now) => wordsHandedBack(typed, now));
      });

    return true;
  };

  const discard = () => {
    setDiscarding(false);
    void writes.write({ action: PULL_REQUEST_ACTION.DISCARD_REVIEW }).then((went) => {
      if (went) router.back();
    });
  };

  const eventChip = (
    <MenuChip
      look={MENU_CHIP_LOOK.COMPOSER}
      label={REVIEW_EVENT_WORDS[event]}
      menu={{
        groups: [
          {
            title: FINISH_WORDS.SAYS,
            choices: REVIEW_EVENTS.map((each) => ({
              label: REVIEW_EVENT_WORDS[each],
              on: each === event,
              onPress: () => setEvent(each),
            })),
          },
        ],
      }}
    />
  );

  const bar = (
    <>
      <Stack.Screen
        options={{
          title: REVIEW_PANEL_WORDS.TITLE,
          headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
        }}
      />
      <StackSubtitle
        words={pending === undefined ? "" : REVIEW_PANEL_WORDS.pending(pending.comments)}
        leading={regular}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon={glyphSymbol(GLYPH.MORE)} accessibilityLabel={FINISH_WORDS.MORE}>
          <Stack.Toolbar.Label>{FINISH_WORDS.MORE}</Stack.Toolbar.Label>
          <Stack.Toolbar.MenuAction
            destructive
            disabled={busy || pending === undefined}
            onPress={() => setDiscarding(true)}
          >
            {REVIEW_PANEL_WORDS.DISCARD}
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
    </>
  );

  const list = (
    <Screen>
      <RowList
        look={LIST_LOOK.PLAIN}
        empty={
          pending === undefined ? (
            <EmptyState title={FINISH_WORDS.NONE} symbol={GLYPH.COMMENT} />
          ) : undefined
        }
      >
        {writes.note === undefined ? null : (
          <ListSection>
            <WriteNoteRow words={writes.note.words} said={writes.note.said} />
          </ListSection>
        )}
        {(pending?.drafts ?? []).map((draft) => (
          <ListSection key={draft.id}>
            <MarkRow
              id={draft.id}
              mark={{ symbol: GLYPH.COMMENT, tone: STATUS_TONE.NEUTRAL }}
              title={FINISH_WORDS.where(draft.path, draft.line)}
            />
            <WordsRow
              words={draft.body}
              repository={key.repository}
              onOpenLink={openLink}
              hidesHtml
            />
          </ListSection>
        ))}
      </RowList>
    </Screen>
  );

  return (
    <>
      {bar}
      <GlassDock
        bar={
          <Composer
            placeholder={reviewPlaceholderOf(event)}
            words={body}
            onWords={setBody}
            sendable={sendable}
            onSend={submit}
            tools={eventChip}
          />
        }
      >
        {list}
      </GlassDock>
      <ConfirmAsk
        title={FINISH_WORDS.DISCARD_QUESTION}
        message={FINISH_WORDS.DISCARD_WHY}
        act={FINISH_WORDS.DISCARD_REVIEW}
        destructive
        presented={discarding}
        onAct={discard}
        onDismiss={() => setDiscarding(false)}
      />
    </>
  );
}
