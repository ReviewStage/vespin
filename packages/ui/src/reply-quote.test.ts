import assert from "node:assert/strict";
import { test } from "vitest";
import {
  MESSAGE_BLOCK,
  type MessageBlock,
  messageBlocks,
  messageText,
  replyOf,
} from "./reply-quote.js";

/**
 * reply-quote.test.ts -- words picked out of an agent's message are kept
 * tidy; a message holds them as blockquotes set apart from the
 * developer's lines by a blank line, and reads back as the same quotes and
 * lines, a fenced block's lines read as its code. Synthetic words.
 */

const quote = (words: string): MessageBlock => ({ kind: MESSAGE_BLOCK.QUOTE, words });
const lines = (...each: string[]): MessageBlock => ({ kind: MESSAGE_BLOCK.WORDS, lines: each });

test("words picked across a message's blocks keep one blank line between them, and none around them", () => {
  assert.equal(
    replyOf("\n  Run the migration first.  \n\n\n\nThen deploy.\r\n\n"),
    "Run the migration first.\n\nThen deploy.",
  );
  assert.equal(replyOf(" \n\t\n"), "", "nothing but space picked is no reply");
});

test("a fenced block's blank lines are kept as its code holds them", () => {
  assert.equal(replyOf("Run:\n\n\n```\na\n\n\nb\n```"), "Run:\n\n```\na\n\n\nb\n```");
});

test("quotes and the developer's lines between them are written apart by a blank line, every quoted line marked", () => {
  assert.equal(
    messageText([
      quote("Two options:\n\nA or B"),
      lines("B, please.", "Soon."),
      quote("Ship today?"),
      quote("Or wait?"),
      lines("Wait."),
    ]),
    "> Two options:\n>\n> A or B\n\nB, please.\nSoon.\n\n> Ship today?\n\n> Or wait?\n\nWait.",
  );
});

test("a message reads back as the quotes and lines it was written from, empty lines and all", () => {
  const messages: readonly (readonly MessageBlock[])[] = [
    [lines("")],
    [lines("Plain words", "", "on lines")],
    [quote("A or B"), lines("B.")],
    [lines("About this:"), quote("A or B")],
    [quote("A"), quote("B"), lines("Both.")],
    [quote("A"), lines("")],
    [lines("", ""), quote("A"), lines("", "Then")],
    [quote("Two options:\n\nA or B"), lines("B.")],
  ];
  for (const blocks of messages) assert.deepEqual(messageBlocks(messageText(blocks)), blocks);
});

test("a > line that runs into the lines beside it is words, as Markdown would not set it apart", () => {
  assert.deepEqual(messageBlocks("Above\n> not apart\nBelow"), [
    lines("Above", "> not apart", "Below"),
  ]);
  assert.deepEqual(messageBlocks(">no space"), [lines(">no space")]);
});

test("a > line set apart inside a fenced block is the block's code, not a quote", () => {
  const code = "```md\n\n> keep ``hi``\n\n```";
  assert.deepEqual(messageBlocks(`Run:\n${code}`), [lines("Run:", ...code.split("\n"))]);
});
