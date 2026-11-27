// pull-request-chapters-screens.tsx -- a pull request's chapters, on a screen of their own pushed from the pull request's page: each chapter in reading order with its summary, how risky it is and why, what to review, and its files, Generate where none stand, as the panel's Chapters view tells them.

import { PULL_REQUEST_PART } from "@repo/features/agent-view";
import { iosPullRequestFilesRoute } from "@repo/features/ios-app-links";
import type { Chapter } from "@repo/features/pull-request-chapters";
import {
  CHAPTER_RISK_WORDS,
  CHAPTERS_FAILURE_WORDS,
  CHAPTERS_SHOWN,
  CHAPTERS_WORDS,
  type ChapterRisk,
  type ChaptersShown,
  chaptersModelLabel,
  chaptersShown,
} from "@repo/features/pull-request-chapters-shown";
import { landedAnswer } from "@repo/host/app-state-reads";
import {
  BAR_TITLE,
  EmptyState,
  GLYPH,
  type Glyph,
  LIST_LOOK,
  LinkRow,
  ListSection,
  MarkRow,
  RowList,
  Screen,
  STATUS_TONE,
  type StatusTone,
  useColors,
  WORDS_EDGE,
  WordsRow,
} from "@repo/ui-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { ReactNode } from "react";
import { useOpenLink } from "../open-link.js";
import { type PullRequestKey, usePullRequestParts } from "../pull-requests/use-pull-request.js";
import { usePullRequestChapters } from "../pull-requests/use-pull-request-chapters.js";
import { useOnOwnTab } from "../tab-route.js";

/** The one part this screen holds live beside the chapters: the pull request, whose head says whether they are stale. */
const PULL_REQUEST_ONLY = [PULL_REQUEST_PART.PULL_REQUEST] as const;

/** A chapter's risk as its row marks it, in the tone the panel's risk chip takes. */
const RISK_LOOK = {
  high: { symbol: GLYPH.FAILED, tone: STATUS_TONE.DANGER },
  medium: { symbol: GLYPH.FAILED, tone: STATUS_TONE.ATTENTION },
  low: { symbol: GLYPH.RESOLVED, tone: STATUS_TONE.COMPLETE },
} as const satisfies Record<ChapterRisk, { readonly symbol: Glyph; readonly tone: StatusTone }>;

/** The id of a chapter's files row, by its place, which a press opens Files changed from. */
function filesRowOf(at: number): string {
  return `files-${at}`;
}

/** How many files a chapter holds, each it names once. */
function fileCount(chapter: Chapter): number {
  return new Set(chapter.hunkRefs.map((ref) => ref.path)).size;
}

/** What a chapter's risk says in Markdown: why, one reason to a line. */
function reasonsWords(reasons: readonly string[]): string {
  return reasons.map((reason) => `- ${reason}`).join("\n");
}

/** What a chapter's What to review says in Markdown: each change a reviewer should weigh, one to a line. */
function reviewWords(chapter: Chapter): string {
  return chapter.keyChanges.map((change) => `- ${change.content}`).join("\n");
}

/** The screen's empty state for every state but ready chapters: a wait, a failure with Try again, or no chapters with Generate where the member can make them. */
function emptyOf(
  shown: ChaptersShown,
  retry: () => void,
  generate: () => void,
): ReactNode | undefined {
  switch (shown.kind) {
    case CHAPTERS_SHOWN.READING:
      return <EmptyState title={CHAPTERS_WORDS.READING} symbol={GLYPH.CHAPTERS} loading />;
    case CHAPTERS_SHOWN.GENERATING:
      return <EmptyState title={CHAPTERS_WORDS.GENERATING} symbol={GLYPH.CHAPTERS} loading />;
    case CHAPTERS_SHOWN.FAILED:
      return <EmptyState title={CHAPTERS_WORDS.FAILED} symbol={GLYPH.FAILED} retry={retry} />;
    case CHAPTERS_SHOWN.NO_PULL_REQUEST:
      return <EmptyState title={CHAPTERS_WORDS.NO_PULL_REQUEST} symbol={GLYPH.CHAPTERS} />;
    case CHAPTERS_SHOWN.NONE:
      return (
        <EmptyState
          title={CHAPTERS_WORDS.NO_CHAPTERS}
          symbol={GLYPH.CHAPTERS}
          action={
            shown.generatable
              ? { label: CHAPTERS_WORDS.generate(shown.runsOn), onPress: generate }
              : undefined
          }
        />
      );
    case CHAPTERS_SHOWN.GENERATION_FAILED:
      return (
        <EmptyState
          title={CHAPTERS_FAILURE_WORDS[shown.failureKind]}
          symbol={GLYPH.FAILED}
          action={
            shown.generatable
              ? { label: CHAPTERS_WORDS.generate(undefined), onPress: generate }
              : undefined
          }
        />
      );
    case CHAPTERS_SHOWN.READY:
      return shown.chapters.length === 0 ? (
        <EmptyState title={CHAPTERS_WORDS.NOTHING} symbol={GLYPH.CHAPTERS} />
      ) : undefined;
  }
}

/**
 * A pull request's chapters, by its workspace, its repository and its
 * number, held live while the screen is in focus and read again on a pull
 * down, as the panel's Chapters view tells them (`chaptersShown`): each
 * chapter in reading order under its place and title, "Other changes"
 * last, with its summary, how risky it is and why, what to review, and a
 * row counting its files that opens Files changed. Chapters made for an
 * older head say so first, with Regenerate where the member can make them.
 * Where none stand, the screen offers Generate; while they are made, it
 * waits; a generation that failed says why. The model that told them is
 * named at the foot.
 */
export function PullRequestChaptersScreen() {
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
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const openLink = useOpenLink(key.workspaceId);
  const parts = usePullRequestParts(key, PULL_REQUEST_ONLY);
  const chapters = usePullRequestChapters(key);
  const head = landedAnswer(parts.pullRequest)?.pullRequest?.merging?.headSha;

  const shown = chaptersShown(chapters.answer, chapters.generating, {
    pullRequest: head,
    files: head,
  });

  // Note that with the pull request's head not read yet nothing says the chapters are out of date, as the panel's tab counts them.
  const stale = shown.kind === CHAPTERS_SHOWN.READY && shown.stale && head !== undefined;
  const ready = shown.kind === CHAPTERS_SHOWN.READY ? shown : undefined;
  // Each chapter's files row, which a press opens Files changed from.
  const filesRows = new Set((ready?.chapters ?? []).map((_, at) => filesRowOf(at)));

  return (
    <>
      <Stack.Screen
        options={{
          title: CHAPTERS_WORDS.CHAPTERS,
          headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
        }}
      />
      <Screen>
        <RowList
          look={LIST_LOOK.PLAIN}
          empty={emptyOf(shown, () => void chapters.retry(), chapters.generate)}
          onRefresh={chapters.retry}
          onSelect={(row) => {
            if (filesRows.has(row)) router.push(onOwnTab(iosPullRequestFilesRoute(key)));
          }}
        >
          {stale && ready !== undefined ? (
            <ListSection footer={ready.generatable ? undefined : CHAPTERS_WORDS.STALE}>
              {ready.generatable ? (
                <LinkRow
                  symbol={GLYPH.RESTORE}
                  label={CHAPTERS_WORDS.REGENERATE_CHAPTERS}
                  detail={CHAPTERS_WORDS.STALE}
                  onPress={chapters.generate}
                />
              ) : null}
            </ListSection>
          ) : null}
          {(ready?.chapters ?? []).map((chapter, at) => (
            <ListSection
              key={`${at}${chapter.title}`}
              title={`${CHAPTERS_WORDS.place(at + 1)}${chapter.title}`}
              footer={
                at === (ready?.chapters.length ?? 0) - 1 && ready !== undefined
                  ? CHAPTERS_WORDS.credit(chaptersModelLabel(ready.model))
                  : undefined
              }
            >
              <WordsRow
                words={chapter.summary}
                repository={key.repository}
                onOpenLink={openLink}
                edge={WORDS_EDGE.ROWS}
              />
              {chapter.risk === null ? null : (
                <MarkRow
                  id={`risk-${at}`}
                  mark={RISK_LOOK[chapter.risk]}
                  title={CHAPTER_RISK_WORDS[chapter.risk]}
                />
              )}
              {chapter.riskReasons.length === 0 ? null : (
                <WordsRow
                  words={reasonsWords(chapter.riskReasons)}
                  repository={key.repository}
                  onOpenLink={openLink}
                  edge={WORDS_EDGE.ROWS}
                />
              )}
              {chapter.keyChanges.length === 0 ? null : (
                <WordsRow
                  words={`**${CHAPTERS_WORDS.WHAT_TO_REVIEW}**\n\n${reviewWords(chapter)}`}
                  repository={key.repository}
                  onOpenLink={openLink}
                  edge={WORDS_EDGE.ROWS}
                />
              )}
              <MarkRow
                id={filesRowOf(at)}
                mark={{ symbol: GLYPH.CHANGES, tone: STATUS_TONE.NEUTRAL }}
                title={CHAPTERS_WORDS.files(fileCount(chapter))}
                pushes
              />
            </ListSection>
          ))}
        </RowList>
      </Screen>
    </>
  );
}
