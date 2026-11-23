// pull-request-files-screens.tsx -- the files one pull request changes, on a screen of its own pushed from the pull request's page: each folder a section in the tree's order, each file its letter, name and lines, a search by path, and a press opening the file's diff on GitHub.

import {
  CHANGES_WORDS,
  filterFiles,
  folderSections,
  gitHubFileDiffLink,
} from "@repo/features/changed-files";
import { GITHUB_PAGE, gitHubPageLink } from "@repo/features/link-grammar";
import {
  BAR_TITLE,
  ChangedFileRow,
  EmptyState,
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
  /** The heading of the files at the repository's root, which stand in no folder. */
  ROOT: "Root",
} as const;

/** The minus sign a count of removed lines wears, as GitHub writes it. */
const MINUS = "−";

/** What the bar says under the title: how many files, and the lines they add and remove together, as GitHub's tab counts them. */
function summaryOf(files: readonly { readonly additions: number; readonly deletions: number }[]) {
  const added = files.reduce((sum, file) => sum + file.additions, 0);
  const removed = files.reduce((sum, file) => sum + file.deletions, 0);
  const noun = files.length === 1 ? "file" : "files";

  return `${files.length} ${noun} · +${added} ${MINUS}${removed}`;
}

/**
 * The files a pull request changes, by its workspace, its repository and
 * its number, read as the screen first shows (`usePullRequestChanges`) and
 * on a pull down. Each folder holding a changed file is a section, headed
 * by its path, in the order the desktop's tree lists them
 * (`folderSections`), each file a row (`ChangedFileRow`). The bar's search
 * keeps the files whose path holds what is typed, as the desktop's does
 * (`filterFiles`). A press opens the file's diff on GitHub, at its anchor
 * on the Files changed tab, until the app draws diffs itself. Where GitHub
 * listed more files than one read carries, the last section's footer says
 * so, in the panel's words.
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

  const kept = files === undefined ? [] : filterFiles(files, search);
  const sections = folderSections(kept);
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
          {sections.map((section, at) => (
            <ListSection
              key={section.folder}
              title={section.folder === "" ? FILES_WORDS.ROOT : section.folder}
              count={section.files.length}
              footer={
                changes.truncated && at === sections.length - 1
                  ? CHANGES_WORDS.TRUNCATED
                  : undefined
              }
            >
              {section.files.map((each) => (
                <ChangedFileRow key={each.file.path} file={each.file} name={each.name} />
              ))}
            </ListSection>
          ))}
        </RowList>
      </Screen>
    </>
  );
}
