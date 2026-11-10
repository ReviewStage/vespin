/**
 * data-f.ts -- design F's world on top of the shared one: the agent's
 * threads as Slack keeps them inside a channel, each posted at a point in
 * the chat and holding its own replies, one a long ask carrying a page, a
 * screenshot and a clip, one a topic with several exchanges while the chat
 * did other work in between, one an FYI that asks nothing, and one answered.
 */

import { AUTHOR, type Author, NOW } from "./data";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const F_THREAD = {
  MERGE: "f-merge",
  LAYOUT: "f-layout",
  REVIEW: "f-review",
  NOTES: "f-notes",
} as const;

export type FThreadId = (typeof F_THREAD)[keyof typeof F_THREAD];

/** What a thread's opening post holds beside its words. */
export const BLOCK = {
  TEXT: "text",
  PAGE: "page",
  SCREENSHOT: "screenshot",
  VIDEO: "video",
  PR: "pr",
} as const;

export type Block =
  | { readonly kind: typeof BLOCK.TEXT; readonly text: string }
  | { readonly kind: typeof BLOCK.PAGE; readonly title: string }
  | { readonly kind: typeof BLOCK.SCREENSHOT; readonly caption: string }
  | { readonly kind: typeof BLOCK.VIDEO; readonly name: string; readonly length: string }
  | { readonly kind: typeof BLOCK.PR; readonly title: string };

export interface FReply {
  readonly id: string;
  readonly author: Author;
  readonly at: number;
  readonly text: string;
}

export interface FThread {
  readonly id: FThreadId;
  readonly title: string;
  /** The one line an anchor and a sidebar row say of it. */
  readonly gist: string;
  readonly postedAt: number;
  readonly body: readonly Block[];
  /** Its answers to pick from, or none for an FYI that asks nothing. */
  readonly options: readonly string[];
  readonly recommended: string | undefined;
  /** The answer already given, for a thread settled before the prototype opened. */
  readonly answered: string | undefined;
  readonly replies: readonly FReply[];
}

/** The PR and the page a thread names, which open in the right panel on a desktop and a sheet on a phone. */
export const PR_TITLE = "#7887 feat(sandbox): add smolvm to the sandbox picker";
export const PAGE_TITLE = "Sandbox picker: two layouts";

export const F_THREADS: readonly FThread[] = [
  {
    id: F_THREAD.MERGE,
    title: "Merge #2126?",
    gist: "Green on Linux, unreviewed; branch protection wants one approval.",
    postedAt: NOW - 3 * DAY - 6 * HOUR,
    body: [
      {
        kind: BLOCK.TEXT,
        text: "#2126 (smolvm: boot from a virtiofs root) fixes the two external issues that reproduced, #2101 and #2104. CI is green on Linux. No one has reviewed it, and branch protection wants one approval.",
      },
      { kind: BLOCK.TEXT, text: "Should I bypass and merge as an admin, or wait for a review?" },
    ],
    options: ["Bypass and merge", "Wait for a review"],
    recommended: "Wait for a review",
    answered: undefined,
    replies: [
      {
        id: "fm1",
        author: AUTHOR.MEMBER,
        at: NOW - 3 * DAY - 5 * HOUR - 30 * MINUTE,
        text: "Did the macOS job run on it?",
      },
      {
        id: "fm2",
        author: AUTHOR.AGENT,
        at: NOW - 3 * DAY - 5 * HOUR - 20 * MINUTE,
        text: "No: the macOS job runs only for apps/mobile. I booted the image by hand on this Mac and it came up in 1.4s.",
      },
      {
        id: "fm3",
        author: AUTHOR.MEMBER,
        at: NOW - 1 * DAY - 30 * MINUTE,
        text: "Ada says #2119 is the same crash on resume. Does #2126 cover it too?",
      },
      {
        id: "fm4",
        author: AUTHOR.AGENT,
        at: NOW - 1 * DAY - 20 * MINUTE,
        text: "Yes: #2119 is a duplicate of #2101, and I retested #2104 on 0.4.2 too. The merge is still your call.",
      },
    ],
  },
  {
    id: F_THREAD.NOTES,
    title: "Ship the 0.5 release notes?",
    gist: "9 entries drafted in CHANGELOG.md, 2 flagged.",
    postedAt: NOW - 5 * HOUR + 5 * MINUTE,
    body: [
      {
        kind: BLOCK.TEXT,
        text: "The smolvm 0.5 notes are drafted in CHANGELOG.md: 9 entries, 2 flagged where I wasn't sure of the wording. Ship them as they are?",
      },
    ],
    options: ["Ship them", "Hold for my edits"],
    recommended: "Hold for my edits",
    answered: "Hold for my edits",
    replies: [
      { id: "fn1", author: AUTHOR.MEMBER, at: NOW - 4 * HOUR, text: "Chose “Hold for my edits”." },
      {
        id: "fn2",
        author: AUTHOR.AGENT,
        at: NOW - 4 * HOUR + 2 * MINUTE,
        text: "Holding. I'll leave CHANGELOG.md alone until you've edited it.",
      },
    ],
  },
  {
    id: F_THREAD.LAYOUT,
    title: "Pick the sandbox picker layout",
    gist: "A page with two layouts, today's picker, and a boot clip.",
    postedAt: NOW - 40 * MINUTE,
    body: [
      {
        kind: BLOCK.TEXT,
        text: "Before I polish the PR, which layout should the sandbox picker use? Here are both on one page, a screenshot of today's picker, and a clip of a smolvm machine booting from it.",
      },
      { kind: BLOCK.PAGE, title: PAGE_TITLE },
      { kind: BLOCK.SCREENSHOT, caption: "Today's picker: one row per provider, smolvm missing." },
      { kind: BLOCK.VIDEO, name: "smolvm-boot.webm", length: "0:14" },
      { kind: BLOCK.PR, title: PR_TITLE },
      {
        kind: BLOCK.TEXT,
        text: "The grid reads faster with few machines; the list shows disk and RAM, which BinBin asked about.",
      },
    ],
    options: ["Grid of machines", "List with sizes"],
    recommended: "List with sizes",
    answered: undefined,
    replies: [
      {
        id: "fl1",
        author: AUTHOR.MEMBER,
        at: NOW - 30 * MINUTE,
        text: "Does the list show disk size too?",
      },
      {
        id: "fl2",
        author: AUTHOR.AGENT,
        at: NOW - 28 * MINUTE,
        text: "Yes: disk, RAM and vCPUs per machine, as on the page.",
      },
    ],
  },
  {
    id: F_THREAD.REVIEW,
    title: "#7887 ready for review",
    gist: "smolvm in the sandbox picker, behind the smolvm flag. CI is green.",
    postedAt: NOW - 12 * MINUTE,
    body: [
      {
        kind: BLOCK.TEXT,
        text: "#7887 adds smolvm to the sandbox picker behind the smolvm flag. CI is green and the screenshots are in its description. Nothing needed from you unless you want to review it.",
      },
      { kind: BLOCK.PR, title: PR_TITLE },
    ],
    options: [],
    recommended: undefined,
    answered: undefined,
    replies: [],
  },
];

/** What the agent answers on a thread a beat after the member replies there. */
export const F_THREAD_ANSWER = "Got it, I'll take that into this thread's next step.";

/** What the agent answers once an option is chosen on a thread. */
export function fDecidedAnswer(label: string): string {
  if (label === "Bypass and merge") return "Merging #2126 now as an admin.";
  if (label === "Wait for a review")
    return "Asked grace for a review on #2126. I'll merge once it's approved.";
  if (label === "List with sizes")
    return "Going with the list. I'll update #7887 and post new screenshots here.";
  if (label === "Grid of machines")
    return "Going with the grid. I'll update #7887 and post new screenshots here.";
  return "Noted, I'll go with that.";
}
