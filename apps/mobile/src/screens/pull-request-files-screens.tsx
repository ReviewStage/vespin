// pull-request-files-screens.tsx -- the files one pull request changes, on a screen of its own pushed from the pull request's page: one list in the tree's order, each file its letter, name, lines and folder, and a search by path; and each file's diff on a screen of its own, drawn natively, stepping to the file before or after it.

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
import { iosPullRequestFileRoute } from "@repo/features/ios-app-links";
import { GITHUB_PAGE, gitHubPageLink } from "@repo/features/link-grammar";
import {
  BAR_TITLE,
  BUTTON_LOOK,
  ChangedFileRow,
  DiffView,
  EmptyState,
  footerToneOf,
  GLYPH,
  glyphSymbol,
  LIST_LOOK,
  ListSection,
  RowList,
  Screen,
  StackSubtitle,
  useColors,
  useWindowSizeClass,
  WINDOW_SIZE_CLASS,
} from "@repo/ui-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { openInSafari } from "../open-link.js";
import type { PullRequestKey } from "../pull-requests/use-pull-request.js";
import { usePullRequestChanges } from "../pull-requests/use-pull-request-changes.js";
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
 * not take says so in the list's footer. A press opens the file's diff on a screen of its own
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
 * (`startsCollapsed`), says so with Show diff. The files are the list's own
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
        <DiffView patch={file.patch} path={file.path} wrap={wrap} testID="pull-request-diff" />
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
