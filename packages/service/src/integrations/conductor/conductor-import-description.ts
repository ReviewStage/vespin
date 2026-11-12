/**
 * conductor-import-description.ts -- the description a task imported from a Conductor workspace starts with, written from its facts alone.
 *
 * No model is called: the same workspace and chats always write the same
 * text. It says where the task came from (the workspace's name, its
 * creator, its dates, and its link in Conductor) and lists its chats, each
 * by name with the opening of its first message. Words from Conductor are
 * written as plain text, each on one line, so nothing in them opens a
 * heading, a list, or a link of its own. Where GitHub confirmed the branch
 * or the pull request its chats name (`conductor-import-published.ts`), it
 * names them; where it confirmed neither, it says so.
 */

import type { ConductorChat, ConductorWorkspace } from "./conductor-client.js";

/** The most of a chat's first message the description quotes. */
const FIRST_MESSAGE_MAX_CHARS = 280;

/** The marks Markdown reads that a quoted word is written past with a backslash. */
const MARKDOWN_MARKS = /[\\`*_[\]<>#|~]/gu;

/** A chat as the description lists it: its name, and the first message the developer sent it, where one was read. */
export interface DescribedChat {
  readonly chat: Pick<ConductorChat, "id" | "name">;
  readonly firstMessage: string | undefined;
}

/** The branch and pull request GitHub confirmed for the workspace, each where it did. */
export interface ConfirmedPublished {
  readonly branch?: string;
  readonly pullRequest?: { readonly number: number; readonly title: string; readonly url: string };
}

/** Words from Conductor as one line of plain text, cut at `max` characters where given. */
function plain(words: string, max?: number): string {
  const line = words.replace(/\s+/gu, " ").trim();
  const cut = max !== undefined && line.length > max ? `${line.slice(0, max).trimEnd()}…` : line;

  return cut.replace(MARKDOWN_MARKS, (mark) => `\\${mark}`);
}

/** An instant Conductor answered as the day it falls on in UTC, or none where it names no instant. */
function dayOf(instant: string | null | undefined): string | undefined {
  if (instant == null) return undefined;
  const parsed = new Date(instant);

  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

/** The lines naming the confirmed branch and pull request, or saying none was found. */
function publishedLines({ branch, pullRequest }: ConfirmedPublished): readonly string[] {
  if (branch === undefined && pullRequest === undefined) {
    return [
      "No branch or pull request was confirmed from its chats; an agent started on this task can look for them.",
    ];
  }

  const url = pullRequest === undefined || /[<>\s]/u.test(pullRequest.url) ? "" : pullRequest.url;

  return [
    ...(branch === undefined ? [] : [`- Branch: ${plain(branch)}`]),
    ...(pullRequest === undefined
      ? []
      : [
          url === ""
            ? `- Pull request: #${pullRequest.number} ${plain(pullRequest.title)}`
            : `- Pull request: [#${pullRequest.number} ${plain(pullRequest.title)}](<${url}>)`,
        ]),
  ];
}

/** The task's name: the workspace's, or its number where it has none. */
export function importedTaskName(workspace: ConductorWorkspace): string {
  const named = workspace.name == null ? "" : plain(workspace.name);

  if (named !== "") return named;

  return workspace.number == null
    ? "Conductor workspace"
    : `Conductor workspace ${workspace.number}`;
}

/** The description's text for the workspace and its chats, in the order Conductor lists them. */
export function importedTaskDescription(
  workspace: ConductorWorkspace,
  chats: readonly DescribedChat[],
  published: ConfirmedPublished,
): string {
  const facts = [
    workspace.creatorName == null ? undefined : `created by ${plain(workspace.creatorName)}`,
    dayOf(workspace.createdAt) === undefined ? undefined : `on ${dayOf(workspace.createdAt)}`,
    dayOf(workspace.lastActivityAt) === undefined
      ? undefined
      : `last active ${dayOf(workspace.lastActivityAt)}`,
  ].filter((fact) => fact !== undefined);

  const origin = `Imported from Conductor: the workspace **${importedTaskName(workspace)}**${
    facts.length === 0 ? "" : `, ${facts.join(", ")}`
  }.`;

  const href =
    workspace.deepLink == null || !URL.canParse(workspace.deepLink)
      ? undefined
      : new URL(workspace.deepLink).href;

  // Note that a link holding an angle bracket or a space is left out, since it would end the link's own brackets.
  const link = href === undefined || /[<>\s]/u.test(href) ? [] : [`[Open in Conductor](<${href}>)`];

  const listed =
    chats.length === 0
      ? ["No chats."]
      : chats.map(({ chat, firstMessage }) => {
          const name =
            chat.name == null || chat.name.trim() === "" ? "Untitled chat" : plain(chat.name);

          return firstMessage === undefined || firstMessage.trim() === ""
            ? `- **${name}**`
            : `- **${name}**: ${plain(firstMessage, FIRST_MESSAGE_MAX_CHARS)}`;
        });

  return [
    "## Imported from Conductor",
    "",
    origin,
    ...link.flatMap((line) => ["", line]),
    "",
    "## Branch and pull request",
    "",
    ...publishedLines(published),
    "",
    "## Chats",
    "",
    ...listed,
    "",
  ].join("\n");
}
