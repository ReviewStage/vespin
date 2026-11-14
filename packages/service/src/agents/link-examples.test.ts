import assert from "node:assert/strict";
import { LINK_DESTINATION, readLink } from "@repo/features/link-grammar";
import { decodeMention, isMentionLabel, MENTION_KIND } from "@repo/features/mention-link";
import { test } from "vitest";
import { EDIT_DESCRIPTION_TOOL } from "./coder-host/description-edit.js";
import { INBOX_TOOLS } from "./coder-host/inbox.js";
import { linkRuleWords } from "./link-rule.js";

/**
 * link-examples.test.ts -- the link every author is shown how to write a
 * file, a pull request, or an issue with is one the app draws as a chip: the
 * link rule, and the coding agent's inbox and plan tools. An example spelled with `<owner>/<name>` and `<path>` is
 * read as an author fills it in. Synthetic repository.
 */

const REPOSITORY = "Acme/Relay";

/** What an author fills an example's placeholders in with. */
const FILLED: ReadonlyMap<string, string> = new Map([
  ["<owner>/<name>", REPOSITORY],
  ["<path>", "apps/web/store.ts"],
  ["<commit>", "3f9c2e1d5b7a4c6e8f0a2b4c6d8e0f1a3b5c7d9e"],
  ["<page-id>", "page-1"],
  ["<number>", "7"],
  ["<agent-id>", "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f"],
  ["<automation-id>", "4e3d2c1b-0a9f-4e8d-9c7b-6a5f4e3d2c1b"],
  ["<task-id>", "5f3c2a1e-9b8d-4c7a-8e6f-1a2b3c4d5e6f"],
  ["<user-id>", "user-sam"],
  ["<issue-id>", "3f0e6f5c-7d1a-4f6e-9a55-000000000042"],
  ["<item-id>", "9b2e4c6a-1d3f-4e5a-8b7c-0d1e2f3a4b5c"],
]);

/** Every Markdown link to a web page the words show, its label and its target, the placeholders filled in as an author would. */
function linksIn(words: string): { label: string; target: string }[] {
  return [...words.matchAll(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/gu)].map(([, label, target]) => ({
    label: label ?? "",
    target: filled(target ?? ""),
  }));
}

/** Every placeholder of an address filled in as an author would. */
function filled(target: string): string {
  return [...FILLED].reduce((each, [hole, value]) => each.replace(hole, value), target);
}

/** Every Markdown link to a web page the words show, its placeholders filled in as an author would. */
function examplesIn(words: string): string[] {
  return linksIn(words).map(({ target }) => target);
}

/** What each example link is drawn as: the kind of mention its chip names, else the kind of place in the app it names, or nothing where it stays a link. */
function drawnAs(words: string): (string | undefined)[] {
  return examplesIn(words).map(
    (target) => decodeMention(target, REPOSITORY)?.kind ?? readLink(target)?.place.kind,
  );
}

test("every address the link rule shows an author how to build is one Vespin draws as its chip, a page under its task", () => {
  // Note that only a shape with a placeholder to fill is an address an author builds; the workspace's own address stands alone.
  const addresses = [
    ...linkRuleWords("https://vespin.dev/acme").matchAll(/`(https:\/\/[^`\s]*<[^`\s]+)`/gu),
  ];

  assert.deepEqual(
    addresses.map(
      ([, target]) =>
        decodeMention(filled(target ?? ""), REPOSITORY)?.kind ??
        readLink(filled(target ?? ""))?.place.kind,
    ),
    [
      MENTION_KIND.AGENT,
      MENTION_KIND.TASK,
      LINK_DESTINATION.AUTOMATION,
      MENTION_KIND.PERSON,
      LINK_DESTINATION.INBOX_ITEM,
      LINK_DESTINATION.PAGE,
    ],
  );
});

test("the thread post tool and the plan's edit tool show a file's link Vespin draws as its chip, written as a mention", () => {
  for (const description of [INBOX_TOOLS.POST.description, EDIT_DESCRIPTION_TOOL.description]) {
    assert.deepEqual(drawnAs(description), [MENTION_KIND.FILE]);
    assert.ok(
      linksIn(description).every(({ label }) => isMentionLabel(label)),
      description,
    );
  }
});
