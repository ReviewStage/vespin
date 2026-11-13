/**
 * slack-markdown.ts -- an agent's words as Slack draws Markdown, in a `markdown` block, and a plain line as a `mrkdwn` field reads it literally.
 */

import { mentionLinksIn, mentionName } from "@repo/features/mention-link";
import type { SlackBlock } from "./slack-bot.js";

/** Slack's bound on the text of every `markdown` block in one message together; each message holds one. */
const SLACK_MARKDOWN_CHARS = 12_000;

/** What the cut end of words too long for Slack says; the message's link reads the rest. */
const CUT_MARK = "…";

/** The line an agent's final message parts its Slack messages with: `---` alone, outside a code fence. */
const MESSAGE_BREAK = /^\s*---\s*$/u;

/** A line that opens or closes a Markdown code fence: its marker, three or more of one fence character, and what follows it. */
const CODE_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/u;

/** The most messages one final message is posted as; what runs past the last is posted in it. */
const SLACK_MESSAGES = 6;

/** A target Slack opens as a link; an app-only one, a date's among them, leads nowhere there. */
const WEB_LINK = /^https?:\/\//iu;

/** Text as Slack reads it literally in a `mrkdwn` field: its three control characters escaped. */
export function slackEscaped(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** The words cut to the bound, the cut mark where they ran past it. */
export function slackClipped(words: string, bound: number): string {
  return words.length <= bound ? words : `${words.slice(0, bound - CUT_MARK.length)}${CUT_MARK}`;
}

/** The words with each mention chip written as a plain link without its `@`, or its name alone where its target is no web address. */
function withPlainMentions(markdown: string): string {
  let out = "";
  let at = 0;

  for (const link of mentionLinksIn(markdown)) {
    // Note that the link is kept as written but for its `@`, so a label's escapes still hold.
    const written = WEB_LINK.test(link.target)
      ? `[${markdown.slice(link.start + 2, link.end)}`
      : mentionName(link.label);

    out += markdown.slice(at, link.start) + written;
    at = link.end;
  }

  return out + markdown.slice(at);
}

/**
 * An agent's final message as the Slack messages it is posted as, in order:
 * its parts between lines of `---` alone outside a code fence, as a person
 * sends a few short messages rather than one long one, each trimmed and an
 * empty one dropped, the parts past the bound joined into the last; the
 * whole as one where it holds no such line.
 */
export function slackMessagesOf(markdown: string): readonly string[] {
  const parts: string[][] = [[]];
  // The marker of the fence the line stands in; none outside one.
  let opened: string | undefined;

  for (const line of markdown.split("\n")) {
    const fence = CODE_FENCE.exec(line);

    if (opened === undefined && MESSAGE_BREAK.test(line)) parts.push([]);
    else parts.at(-1)?.push(line);

    // Note that a fence closes only on a bare marker of its own character at least as long, as CommonMark closes one.
    if (fence === null) continue;
    const [, marker = "", after = ""] = fence;

    if (opened === undefined) opened = marker;
    else if (marker[0] === opened[0] && marker.length >= opened.length && after.trim() === "") {
      opened = undefined;
    }
  }

  const messages = parts.flatMap((lines) => {
    const part = lines.join("\n").trim();

    return part === "" ? [] : [part];
  });

  const kept = messages.slice(0, SLACK_MESSAGES - 1);
  const rest = messages.slice(SLACK_MESSAGES - 1);

  return rest.length === 0 ? kept : [...kept, rest.join("\n\n")];
}

/** An agent's Markdown as one `markdown` block, which Slack draws as standard Markdown, clipped to the bound given, else Slack's own. */
export function slackMarkdownBlock(markdown: string, bound = SLACK_MARKDOWN_CHARS): SlackBlock {
  return {
    type: "markdown",
    text: slackClipped(withPlainMentions(markdown), Math.min(bound, SLACK_MARKDOWN_CHARS)),
  };
}
