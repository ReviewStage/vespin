// pull-request-files-screens.tsx -- the files one pull request changes, on a screen of its own pushed from the pull request's page: one list in the tree's order, each file its letter, name, lines and folder, a search by path, and a press opening the file's diff on GitHub.

import {
  CHANGES_WORDS,
  changesLine,
  filterFiles,
  gitHubFileDiffLink,
  treeOrder,
} from "@repo/features/changed-files";
import { GITHUB_PAGE, gitHubPageLink } from "@repo/features/link-grammar";
import {
  BAR_TITLE,
  ChangedFileRow,
  EmptyState,
  footerToneOf,
  GLYPH,
  LIST_LOOK,
  ListSection,
  RowList,
  Screen,
  StackSubtitle,
  useColors,
  useWindowSizeClass,
  WINDOW_SIZE_CLASS,
} from "@repo/ui-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { openInSafari } from "../open-link.js";
import type { PullRequestKey } from "../pull-requests/use-pull-request.js";
import { usePullRequestChanges } from "../pull-requests/use-pull-request-changes.js";

/** What the screen says in the panel's words, beyond the changes' own (`CHANGES_WORDS`). */
const FILES_WORDS = {
  TITLE: "Files changed",
  FIND: "Find a file",
  NONE_FOUND: "No files match.",
} as const;

/** What the bar says under the title: how many files, and the lines they add and remove together, as GitHub's tab counts them. */
function summaryOf(files: readonly { readonly additions: number; readonly deletions: number }[]) {
  return changesLine({
    files: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  });
}

/**
 * The files a pull request changes, by its workspace, its repository and
 * its number, read as the screen first shows (`usePullRequestChanges`) and
 * on a pull down. The files stand in one list, in the order the desktop's
 * tree lists them (`treeOrder`), each a row naming the folder it stands in
 * under its name (`ChangedFileRow`), as Dean picked. The bar's search
 * keeps the files whose path holds what is typed, as the desktop's does
 * (`filterFiles`). A press opens the file's diff on GitHub, at its anchor
 * on the Files changed tab, until the app draws diffs itself. Where GitHub
 * listed more files than one read carries, the list's footer says so, in
 * the panel's words, as it says a read that failed after files were drawn,
 * which leaves them drawn.
 */
export function PullRequestFilesScreen() {
  const {
    workspace = "",
    owner = "",
    name = "",
    number = "",
  } = useLocalSearchParams<{ workspace: string; owner: string; name: string; number: string }>();

  const key: PullRequestKey = {
    workspaceId: workspace,
    repository: `${owner}/${name}`,
    number: Number(number),
  };

  const colors = useColors();
  const regular = useWindowSizeClass() === WINDOW_SIZE_CLASS.REGULAR;
  const changes = usePullRequestChanges(key);
  const [search, setSearch] = useState("");
  const files = changes.files;

  // Note that the address GitHub answered with is used where the read gave one, so a file opens on the pull request as GitHub spells it.
  const url =
    changes.url ??
    gitHubPageLink({
      kind: GITHUB_PAGE.PULL_REQUEST,
      repository: key.repository,
      number: key.number,
    });

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
      <StackSubtitle words={files === undefined ? "" : summaryOf(files)} leading={regular} />
    </>
  );

  const kept = files === undefined ? [] : filterFiles(treeOrder(files), search);
  // Note that a read failing after files were drawn keeps them, and says so under them, as a pull reads them again.
  const refreshFailed = files !== undefined && changes.failed ? CHANGES_WORDS.FAILED : undefined;
  const footer = refreshFailed ?? (changes.truncated ? CHANGES_WORDS.TRUNCATED : undefined);
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
            if (!byPath.has(path)) return;

            void gitHubFileDiffLink(url, path).then(openInSafari);
          }}
        >
          <ListSection footer={footer} footerTone={footerToneOf(refreshFailed)}>
            {kept.map((file) => (
              <ChangedFileRow key={file.path} file={file} />
            ))}
          </ListSection>
        </RowList>
      </Screen>
    </>
  );
}
