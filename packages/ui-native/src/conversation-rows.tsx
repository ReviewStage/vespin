// conversation-rows.tsx -- a pull request's conversation as rows of its page: each comment or review by who wrote it, where a review left them, and when, its words a short plain preview until opened whole in Markdown; and each review thread by its file and lines, opened to its comments.

import { HStack, RNHostView, Text, VStack } from "@expo/ui/swift-ui";
import {
  font,
  foregroundStyle,
  lineLimit,
  monospacedDigit,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import { BOT_TAG_WORDS } from "@repo/features/github-login";
import { markdownPlainText } from "@repo/features/markdown-plain-text";
import { agoText } from "@repo/features/time-format";
import { type ReactElement, useMemo } from "react";
import { useScaledSize } from "./accessibility.js";
import { GLYPH, type MarkLook } from "./glyph.js";
import { useRowInset } from "./layout-margin.js";
import { RowFrame, RowHead } from "./list-row.js";
import { Markdown } from "./markdown.js";
import { Avatar, type Face, ToneGlyph } from "./marks.js";
import { BotTag } from "./pull-request-page.js";
import type { RowAction, RowSubmenu } from "./row-menu-model.js";
import { STATUS_TONE, useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** The most of an entry's Markdown its folded preview reads, so a long comment's preview costs no more than a short one's. */
const PREVIEW_SOURCE_CHARS = 600;

/** How many lines a folded entry's preview stands at. */
const PREVIEW_LINES = 3;

/** What a thread's line says of its comments: "1 comment", "3 comments". */
function commentsWords(count: number): string {
  return `${count} ${count === 1 ? "comment" : "comments"}`;
}

/** Markdown's first words as plain text, for a folded preview: read from the start of it alone. */
function previewOf(markdown: string): string {
  return markdownPlainText(markdown.slice(0, PREVIEW_SOURCE_CHARS)).replaceAll("\n", " ").trim();
}

/** Where a review left its reviewer, beside their name: its mark and its words. */
export type EntryStanding = { readonly mark: MarkLook; readonly words: string };

/**
 * Words under a row's head, set in from the screen's edge as the page's
 * other words stand (`SPACE.EDGE`), since the row's own content starts at
 * the unread dot's inset.
 */
function UnderHead({ children }: { readonly children: ReactElement }) {
  const inset = useRowInset();

  return (
    <VStack
      alignment="leading"
      modifiers={[padding({ leading: SPACE.EDGE - inset.dotted, top: SPACE.TIGHT })]}
    >
      {children}
    </VStack>
  );
}

/** An entry's words: a muted plain preview of their first lines while folded, or the whole Markdown, hosted in the row, once opened. */
function EntryWords({
  words,
  open,
  repository,
  onOpenLink,
}: {
  readonly words: string;
  readonly open: boolean;
  readonly repository: string | null | undefined;
  readonly onOpenLink: (address: string) => void;
}) {
  const colors = useColors();
  // Note that the preview is read once per entry's words, never per redraw, so a long conversation scrolls without parsing it again.
  const preview = useMemo(() => (open ? "" : previewOf(words)), [open, words]);

  if (open) {
    return (
      <UnderHead>
        <RNHostView matchContents={{ vertical: true }}>
          <Markdown words={words} repository={repository} onOpenLink={onOpenLink} hidesHtml />
        </RNHostView>
      </UnderHead>
    );
  }

  if (preview === "") return null;

  return (
    <UnderHead>
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_LINE }),
          foregroundStyle(colors.TEXT_BODY),
          lineLimit(PREVIEW_LINES),
        ]}
      >
        {preview}
      </Text>
    </UnderHead>
  );
}

/** A row's time, muted, in the time's style, as a list row ends its line. */
function WhenWords({ at, now }: { readonly at: number; readonly now: number }) {
  const colors = useColors();

  return (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.TIME }),
        monospacedDigit(),
        foregroundStyle(colors.TEXT_MUTED),
        lineLimit(1),
      ]}
    >
      {agoText(at, now)}
    </Text>
  );
}

type ConversationEntryRowProps = {
  /** The row's id, which its list's `onSelect` is called with, as a press opens or folds it. */
  readonly id: string;
  /** Who wrote it, by their face. */
  readonly by: Face;
  /** Where a review left its reviewer; none on a comment. */
  readonly standing?: EntryStanding | undefined;
  readonly at: number;
  /** What its time counts from: the list's minute. */
  readonly now: number;
  /** Its words as Markdown; empty for a review that said nothing beside its threads. */
  readonly words: string;
  /** Whether it stands opened, its words drawn whole. */
  readonly open: boolean;
  readonly repository?: string | null | undefined;
  readonly onOpenLink: (address: string) => void;
  /** The reactions it wears as one line, such as "👍 2  ❤️ 1", under its words; none where it wears none. */
  readonly reactions?: string | undefined;
  /** Its long press menu's submenus, such as Add reaction; none where it offers none. */
  readonly submenus?: readonly RowSubmenu[] | undefined;
};

/**
 * One comment or review of a pull request's conversation as a row: who
 * wrote it, by their face and name, where a review left them by its mark
 * and words, and when; then their words, a short plain preview of the first
 * lines while folded, so a long conversation lays out no Markdown it does
 * not show, and the whole Markdown once a press opens it. A press folds it
 * again. The reactions it wears stand under its words in one muted line,
 * and its long press menu offers what is handed it, such as Add reaction. Heard as one element: who, where a review left them, when, and
 * the preview.
 */
export function ConversationEntryRow({
  id,
  by,
  standing,
  at,
  now,
  words,
  open,
  repository,
  onOpenLink,
  reactions,
  submenus = [],
}: ConversationEntryRowProps) {
  const colors = useColors();
  const faceSize = useScaledSize(MARK_SIZE.WRITER);

  const head = (
    <RowHead
      unread={false}
      faded={false}
      lead={<Avatar name={by.name} picture={by.picture} kind={by.kind} size={faceSize} />}
      title={by.name}
      after={by.bot === true ? <BotTag /> : undefined}
      ink={colors.TEXT}
      end={
        <HStack spacing={SPACE.TIGHT}>
          {standing === undefined ? null : (
            <ToneGlyph
              glyph={standing.mark.symbol}
              tone={standing.mark.tone}
              textStyle={TYPE_ROLE.TIME}
              hidden
            />
          )}
          <WhenWords at={at} now={now} />
        </HStack>
      }
    />
  );

  return (
    <RowFrame
      id={id}
      menuSubmenus={submenus}
      row={
        <VStack alignment="leading" spacing={0}>
          {head}
          <EntryWords words={words} open={open} repository={repository} onOpenLink={onOpenLink} />
          {reactions === undefined ? null : (
            <UnderHead>
              <Text
                modifiers={[
                  font({ textStyle: TYPE_ROLE.TIME }),
                  foregroundStyle(colors.TEXT_MUTED),
                ]}
              >
                {reactions}
              </Text>
            </UnderHead>
          )}
        </VStack>
      }
      heard={{
        label: by.name,
        value: [by.bot === true && BOT_TAG_WORDS, standing?.words, agoText(at, now), reactions],
      }}
    />
  );
}

/** One comment of a review thread: who wrote it, when, and its words as Markdown. */
export type ThreadComment = {
  /** Its own page on GitHub, which names it among the thread's comments. */
  readonly id: string;
  readonly by: Face;
  readonly at: number;
  readonly words: string;
};

type ThreadRowProps = {
  readonly id: string;
  /** The file it is on. */
  readonly path: string;
  /** Its lines, such as "L12–14"; none for a thread on the whole file. */
  readonly lines?: string | undefined;
  /** The states it is in, such as Resolved and Outdated, in the panel's words. */
  readonly states: readonly string[];
  /** Its comments read, oldest first. */
  readonly comments: readonly ThreadComment[];
  /** How many comments it holds, those GitHub kept back among them. */
  readonly count: number;
  readonly now: number;
  /** Whether it stands opened, every comment drawn whole. */
  readonly open: boolean;
  readonly repository?: string | null | undefined;
  readonly onOpenLink: (address: string) => void;
  /** What a member does on it, such as Resolve or Reopen, behind a swipe from its trailing edge and in its long press menu; none where it can be changed no further. */
  readonly acts?: readonly RowAction[] | undefined;
};

/**
 * A review thread as a row under the review that started it: its file and
 * lines in the code face, the states it stands in and how many comments it
 * holds; then, folded, a plain preview of its first comment by who wrote
 * it, and opened, each comment by who wrote it and when, in Markdown. A
 * resolved or outdated thread stands muted, as the panel folds one. Its
 * acts, such as Resolve, stand behind a swipe from its trailing edge and in
 * its long press menu, as a row's own acts do.
 */
export function ThreadRow({
  id,
  path,
  lines,
  states,
  comments,
  count,
  now,
  open,
  repository,
  onOpenLink,
  acts = [],
}: ThreadRowProps) {
  const colors = useColors();
  const first = comments[0];
  const where = lines === undefined ? path : `${path} ${lines}`;
  const settled = states.length > 0;

  const head = (
    <RowHead
      unread={false}
      faded={settled}
      lead={
        <ToneGlyph
          glyph={GLYPH.THREAD}
          tone={STATUS_TONE.NEUTRAL}
          textStyle={TYPE_ROLE.ROW_TITLE}
        />
      }
      title={where}
      ink={colors.TEXT_BODY}
      end={
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.TIME }),
            foregroundStyle(colors.TEXT_MUTED),
            lineLimit(1),
          ]}
        >
          {[...states, commentsWords(count)].join(" · ")}
        </Text>
      }
    />
  );

  const shown = open ? comments : first === undefined ? [] : [first];

  return (
    <RowFrame
      id={id}
      trailingActions={acts}
      row={
        <VStack alignment="leading" spacing={SPACE.TIGHT}>
          {head}
          {shown.map((comment) => (
            <VStack key={comment.id} alignment="leading" spacing={0}>
              <UnderHead>
                <HStack spacing={SPACE.TIGHT}>
                  <Text
                    modifiers={[
                      font({ textStyle: TYPE_ROLE.TIME, weight: "medium" }),
                      foregroundStyle(colors.TEXT_MUTED),
                      lineLimit(1),
                    ]}
                  >
                    {comment.by.name}
                  </Text>
                  {comment.by.bot === true ? <BotTag /> : null}
                  <Text
                    modifiers={[
                      font({ textStyle: TYPE_ROLE.TIME }),
                      foregroundStyle(colors.TEXT_MUTED),
                      lineLimit(1),
                    ]}
                  >
                    {agoText(comment.at, now)}
                  </Text>
                </HStack>
              </UnderHead>
              <EntryWords
                words={comment.words}
                open={open}
                repository={repository}
                onOpenLink={onOpenLink}
              />
            </VStack>
          ))}
        </VStack>
      }
      heard={{
        label: where,
        value: [...states, commentsWords(count), first === undefined ? undefined : first.by.name],
      }}
    />
  );
}
