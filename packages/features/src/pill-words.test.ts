// pill-words.test.ts -- every pill the panel writes reads into the editor's runs and back out byte for byte, and what is no pill stays words.

import { describe, expect, it } from "vitest";
import {
  filePill,
  mentionPill,
  PILL_KIND,
  PILL_RUN,
  pillRuns,
  runsMarkdown,
  typedPillRuns,
  typedRunsMarkdown,
} from "./pill-words.js";

const HELD = new Set(["Picture 1", "spec.pdf"]);

describe("pillRuns", () => {
  it.each([
    ["a person", "Dean Stratakos", "https://vespin.dev/stage/person/u1"],
    ["an agent", "Fix the refresh", "https://vespin.dev/stage/agent/a1"],
    ["a task", "iOS app", "https://vespin.dev/stage/task/t1"],
    ["a page", "Rollout plan", "https://vespin.dev/stage/task/t1/page/p1"],
    ["a thread", "Attachments in the composer", "https://vespin.dev/stage/task/t1/inbox/i1"],
    ["a pull request", "#42 Fix the refresh", "https://github.com/ReviewStage/vespin/pull/42"],
    ["a date", "Nov 20, 2026", "mention://date/2026-11-20"],
  ])(
    "reads %s's mention as one pill and writes it back as the panel wrote it",
    (_, name, target) => {
      const markdown = `Ask [@${name}](${target}) today`;

      const runs = pillRuns(markdown, HELD);

      expect(runs).toEqual([
        { kind: PILL_RUN.WORDS, text: "Ask " },
        {
          kind: PILL_RUN.PILL,
          pill: { kind: PILL_KIND.MENTION, name, target, markdown: `[@${name}](${target})` },
        },
        { kind: PILL_RUN.WORDS, text: " today" },
      ]);
      expect(runsMarkdown(runs)).toBe(markdown);
      expect(mentionPill(name, target).markdown).toBe(`[@${name}](${target})`);
    },
  );

  it("reads a held picture's and a held file's marker as pills, and writes them back", () => {
    const markdown = "this [Picture 1] next to [File: spec.pdf]";

    const runs = pillRuns(markdown, HELD);

    expect(runs).toEqual([
      { kind: PILL_RUN.WORDS, text: "this " },
      {
        kind: PILL_RUN.PILL,
        pill: { kind: PILL_KIND.FILE, name: "Picture 1", markdown: "[Picture 1]" },
      },
      { kind: PILL_RUN.WORDS, text: " next to " },
      {
        kind: PILL_RUN.PILL,
        pill: { kind: PILL_KIND.FILE, name: "spec.pdf", markdown: "[File: spec.pdf]" },
      },
    ]);
    expect(runsMarkdown(runs)).toBe(markdown);
    expect(filePill("Picture 1").markdown).toBe("[Picture 1]");
    expect(filePill("spec.pdf").markdown).toBe("[File: spec.pdf]");
  });

  it("keeps as words a marker of no held file, a mention in code, a marker inside a link's label, and plain brackets", () => {
    const markdown = [
      "[Picture 2] is gone, [a link](https://example.com), [@not closed",
      "`[@Ada](https://vespin.dev/stage/person/u1)` and **bold** stay",
      "```",
      "[File: spec.pdf]",
      "```",
    ].join("\n");

    const runs = pillRuns(markdown, HELD);

    expect(runs).toEqual([{ kind: PILL_RUN.WORDS, text: markdown }]);
    expect(runsMarkdown(runs)).toBe(markdown);
  });

  it("reads a marker spelled inside a mention's label as the mention's words", () => {
    const markdown = "[@Picture 1](https://vespin.dev/stage/person/u1)";

    expect(pillRuns(markdown, HELD)).toEqual([
      {
        kind: PILL_RUN.PILL,
        pill: {
          kind: PILL_KIND.MENTION,
          name: "Picture 1",
          target: "https://vespin.dev/stage/person/u1",
          markdown,
        },
      },
    ]);
  });

  it("writes a label's escapes and an angled target back exactly as they were read", () => {
    const markdown = "[@Ada \\[ops\\]](<https://vespin.dev/stage/person/u1>)\nnext line";

    const runs = pillRuns(markdown, HELD);

    expect(runs[0]).toEqual({
      kind: PILL_RUN.PILL,
      pill: {
        kind: PILL_KIND.MENTION,
        name: "Ada [ops]",
        target: "https://vespin.dev/stage/person/u1",
        markdown: "[@Ada \\[ops\\]](<https://vespin.dev/stage/person/u1>)",
      },
    });
    expect(runsMarkdown(runs)).toBe(markdown);
  });
});

describe("typedPillRuns", () => {
  it("keeps a held picture's marker typed as words from becoming its pill, sending it escaped as the panel's box does", () => {
    const typed = [
      { kind: PILL_RUN.WORDS, text: "typed [Picture 1] beside " },
      { kind: PILL_RUN.PILL, pill: filePill("Picture 1") },
    ] as const;

    const markdown = typedRunsMarkdown(typed);

    expect(markdown).toBe("typed \\[Picture 1] beside [Picture 1]");
    expect(typedPillRuns(markdown, HELD)).toEqual(typed);
  });
});
