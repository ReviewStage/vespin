import { expect, it } from "vitest";
import { DRAFT_KIND, type DraftKind, draftCopy, readDraft } from "./draft-text.js";

/**
 * draft-text.test.ts -- a draft copies as Slack and Mail paste it: a Slack
 * message's marks as their elements only where Slack would read them (never
 * inside a word, across a line, or inside a code span), its links as anchors
 * with the address after the label in the plain words, every line break a
 * `<br>`, words escaped; an email's subject is read off its first line and
 * left out of the body it copies. Expected values are written by hand.
 */

it.each<{ name: string; kind: DraftKind; text: string; html: string; plain: string }>([
  {
    name: "a Slack message's marks, nested and in a code span",
    kind: DRAFT_KIND.SLACK,
    text: "*bold _and italic_* ~gone~ `*kept*`",
    html: "<b>bold <i>and italic</i></b> <s>gone</s> <code>*kept*</code>",
    plain: "bold and italic gone *kept*",
  },
  {
    name: "a mark Slack would not read: inside a word, unclosed, or across a line",
    kind: DRAFT_KIND.SLACK,
    text: "snake_case_name 2*3 *open\nclose*",
    html: "snake_case_name 2*3 *open<br>close*",
    plain: "snake_case_name 2*3 *open\nclose*",
  },
  {
    name: "a Slack link labeled and bare, a bare address kept as written, and words to escape",
    kind: DRAFT_KIND.SLACK,
    text: "See <https://a.example/x?y=1&z=2|*the doc*> or <https://b.example/_x_> & <not a link>",
    html: 'See <a href="https://a.example/x?y=1&amp;z=2"><b>the doc</b></a> or <a href="https://b.example/_x_">https://b.example/_x_</a> &amp; &lt;not a link&gt;',
    plain: "See the doc (https://a.example/x?y=1&z=2) or https://b.example/_x_ & <not a link>",
  },
  {
    name: "an email's body under its subject, its marks left as written",
    kind: DRAFT_KIND.EMAIL,
    text: "Subject: Hi\n\n\nDear *Sam*,\n\nThanks",
    html: "Dear *Sam*,<br><br>Thanks",
    plain: "Dear *Sam*,\n\nThanks",
  },
])("$name", ({ kind, text, html, plain }) => {
  expect(draftCopy(readDraft(kind, text))).toEqual({ html, text: plain });
});

it("reads an email's subject from its first line alone", () => {
  expect(readDraft(DRAFT_KIND.EMAIL, "subject:  Hi there \nBody").subject).toBe("Hi there");
  expect(readDraft(DRAFT_KIND.EMAIL, "Hello\nSubject: no").subject).toBeUndefined();
});
