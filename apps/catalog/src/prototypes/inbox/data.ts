/**
 * data.ts -- the prototype's synthetic world: one agent, its two Inbox
 * threads, its noisy chat, and the four states it may stand in.
 *
 * Every design reads the same world, so a reader comparing them compares the
 * designs and nothing else. Times count from a fixed "now", Nov 9, 2026,
 * 9:18 PM, so every draw says the same ages.
 */

import { STATUS_TONE, type StatusTone } from "@repo/ui";

/** The prototype's "now": Monday, Nov 9, 2026, 9:18 PM. */
export const NOW = new Date(2026, 10, 9, 21, 18).getTime();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** When the old thread opened: Nov 6, 3:18 PM, three days ago. */
const OPENED = NOW - 3 * DAY - 6 * HOUR;

/** When an idle or archived agent last did anything: Nov 6, 11:30 PM. */
const IDLE_SINCE = new Date(2026, 10, 6, 23, 30).getTime();

export const AGENT = {
  id: "agent-validate",
  name: "Validate newest external issues",
  task: "smolvm support",
  model: "Opus 5.5",
} as const;

export const MEMBER = { id: "user-dean", name: "Dean Stratakos" } as const;

/** The four states the agent may stand in, which the prototype's chrome switches between. */
export const AGENT_STATE = {
  WORKING: "working",
  IDLE: "idle",
  ARCHIVED: "archived",
  WAITING: "waiting",
} as const;

export type AgentState = (typeof AGENT_STATE)[keyof typeof AGENT_STATE];

export const AGENT_STATE_LABEL: Record<AgentState, string> = {
  [AGENT_STATE.WORKING]: "Working on something else",
  [AGENT_STATE.IDLE]: "Idle 3 days",
  [AGENT_STATE.ARCHIVED]: "Archived",
  [AGENT_STATE.WAITING]: "Waiting on you",
};

/** The states' names where a phone's chrome has room for a word or two. */
export const AGENT_STATE_SHORT: Record<AgentState, string> = {
  [AGENT_STATE.WORKING]: "Working",
  [AGENT_STATE.IDLE]: "Idle 3d",
  [AGENT_STATE.ARCHIVED]: "Archived",
  [AGENT_STATE.WAITING]: "Waiting",
};

/** What each state says about the agent: its dot, its one word, what it is on, and what a reply near the box will do. */
export interface StateWords {
  readonly tone: StatusTone;
  readonly word: string;
  readonly activity: string;
  readonly replyNote: string;
}

export const STATE_WORDS: Record<AgentState, StateWords> = {
  [AGENT_STATE.WORKING]: {
    tone: STATUS_TONE.WORKING,
    word: "Working",
    activity: "Fixing review comments on #2131",
    replyNote:
      "It's busy on #2131. Your reply steers it at its next step; hold Send to queue it until #2131 is done.",
  },
  [AGENT_STATE.IDLE]: {
    tone: STATUS_TONE.NEUTRAL,
    word: "Idle",
    activity: "Idle since Nov 6 · last worked on the smolvm 0.5 release notes",
    replyNote: "It's been idle 3 days. Replying wakes it with today's context.",
  },
  [AGENT_STATE.ARCHIVED]: {
    tone: STATUS_TONE.NEUTRAL,
    word: "Archived",
    activity: "Archived Nov 7 · last worked on the smolvm 0.5 release notes",
    replyNote: "This agent is archived. Replying will unarchive it.",
  },
  [AGENT_STATE.WAITING]: {
    tone: STATUS_TONE.ATTENTION,
    word: "Waiting on you",
    activity: "Waiting on your answer to Merge #2126?",
    replyNote: "It's waiting on this answer and picks it up at once.",
  },
};

/** The live-looking steps of the run on #2131, cycled while the agent works. */
export const LIVE_STEPS = [
  "Read grace's comment on packages/vm/src/boot.ts:88",
  "Edited packages/vm/src/boot.ts",
  "Ran pnpm exec vitest run packages/vm",
  "Replied to grace on #2131",
  "Read grace's comment on packages/vm/src/virtiofs.ts:41",
  "Pushed 4e1c9a2 to fix/smolvm-review",
] as const;

export const THREAD_ID = {
  MERGE: "thread-merge-2126",
  REVIEW: "thread-7887",
} as const;

export type ThreadId = (typeof THREAD_ID)[keyof typeof THREAD_ID];

export const ASK_KIND = {
  DECIDE: "Decide",
  NONE: "none",
} as const;

/** Who wrote a message: the agent, the member, or someone else. */
export const AUTHOR = {
  AGENT: "agent",
  MEMBER: "member",
} as const;

export type Author = (typeof AUTHOR)[keyof typeof AUTHOR];

export interface ThreadMessage {
  readonly id: string;
  readonly author: Author;
  readonly at: number;
  readonly text: string;
  /** Whether the member's message was also sent into the agent's chat, as every reply is. */
  readonly sentToChat?: boolean;
}

export interface Ask {
  readonly question: string;
  readonly options: readonly { readonly label: string; readonly detail: string }[];
  readonly recommended: string;
}

export interface Thread {
  readonly id: ThreadId;
  readonly title: string;
  readonly openedAt: number;
  readonly messages: readonly ThreadMessage[];
  readonly ask: Ask | undefined;
}

export const MERGE_ASK: Ask = {
  question: "Bypass branch protection and merge #2126, or wait for a review?",
  options: [
    { label: "Bypass and merge", detail: "Checks are green; I merge it now as an admin." },
    { label: "Wait for a review", detail: "I ask grace for a review and merge once approved." },
  ],
  recommended: "Wait for a review",
};

export const THREADS: readonly Thread[] = [
  {
    id: THREAD_ID.MERGE,
    title: "Merge #2126?",
    openedAt: OPENED,
    ask: MERGE_ASK,
    messages: [
      {
        id: "m1",
        author: AUTHOR.AGENT,
        at: OPENED,
        text: "#2126 (smolvm: boot from a virtiofs root) fixes the two external issues that reproduced, #2101 and #2104. CI is green on Linux. No one has reviewed it yet.",
      },
      {
        id: "m2",
        author: AUTHOR.MEMBER,
        at: OPENED + 30 * MINUTE,
        text: "Did the macOS job run on it?",
        sentToChat: true,
      },
      {
        id: "m3",
        author: AUTHOR.AGENT,
        at: OPENED + 40 * MINUTE,
        text: "No: the macOS job runs only for apps/mobile. I booted the image by hand on this Mac and it came up in 1.4s. Branch protection wants one approval, so I need you to decide.",
      },
    ],
  },
  {
    id: THREAD_ID.REVIEW,
    title: "#7887 ready for review",
    openedAt: NOW - 12 * MINUTE,
    ask: undefined,
    messages: [
      {
        id: "r1",
        author: AUTHOR.AGENT,
        at: NOW - 12 * MINUTE,
        text: "#7887 adds smolvm to the sandbox picker behind the smolvm flag. CI is green and the screenshots are in the description. Ready for your review.",
      },
    ],
  },
];

/** What a line of the agent's chat is. */
export const CHAT_KIND = {
  MEMBER: "member",
  TEAMMATE: "teammate",
  OTHER_AGENT: "other-agent",
  GITHUB: "github",
  TURN: "turn",
  THREAD_CARD: "thread-card",
  THREAD_REPLY: "thread-reply",
  TOPIC: "topic",
} as const;

export type ChatKind = (typeof CHAT_KIND)[keyof typeof CHAT_KIND];

export interface ChatItem {
  readonly id: string;
  readonly kind: ChatKind;
  readonly at: number;
  /** Who it is from, where someone other than the member or the agent wrote it. */
  readonly from?: string;
  readonly text: string;
  /** The steps of an agent's turn, folded under it. */
  readonly steps?: readonly string[];
  /** The thread a card, a reply, or an answer belongs to. */
  readonly thread?: ThreadId;
}

export const CHAT: readonly ChatItem[] = [
  {
    id: "c1",
    kind: CHAT_KIND.MEMBER,
    at: NOW - 4 * DAY,
    text: "Validate the newest external issues on smolvm, and open PRs for the ones that are real.",
  },
  {
    id: "c2",
    kind: CHAT_KIND.TURN,
    at: NOW - 4 * DAY + 40 * MINUTE,
    text: "Triaged 6 issues: 2 reproduce (#2101, #2104), 4 are duplicates or config. Opened #2126 for both.",
    steps: ["Read 6 issues", "Booted smolvm 0.4.1 in a sandbox", "Opened #2126"],
  },
  {
    id: "c3",
    kind: CHAT_KIND.THREAD_CARD,
    at: OPENED,
    text: "Merge #2126?",
    thread: THREAD_ID.MERGE,
  },
  {
    id: "c4",
    kind: CHAT_KIND.THREAD_REPLY,
    at: OPENED + 30 * MINUTE,
    text: "Did the macOS job run on it?",
    thread: THREAD_ID.MERGE,
  },
  {
    id: "c5",
    kind: CHAT_KIND.TURN,
    at: OPENED + 40 * MINUTE,
    text: "The macOS job doesn't run for packages/vm, so I booted the image by hand on this Mac.",
    steps: ["Read ci.yml", "Booted the image on this Mac"],
    thread: THREAD_ID.MERGE,
  },
  {
    id: "c6",
    kind: CHAT_KIND.TEAMMATE,
    at: NOW - 2 * DAY - 5 * HOUR,
    from: "Ada Lovelace",
    text: "While you're in there, can you check #2119? It's the Android user's crash on resume.",
  },
  {
    id: "c7",
    kind: CHAT_KIND.TURN,
    at: NOW - 2 * DAY - 4 * HOUR,
    text: "#2119 is a duplicate of #2101; #2126 fixes it. Commented on the issue.",
    steps: ["Read #2119", "Commented on #2119"],
  },
  {
    id: "c8",
    kind: CHAT_KIND.OTHER_AGENT,
    at: NOW - 2 * DAY,
    from: "Tracking BinBin He support for smol machines",
    text: "BinBin's repro is on smolvm 0.4.2, not 0.4.1. Please retest #2104 there.",
  },
  {
    id: "c9",
    kind: CHAT_KIND.TURN,
    at: NOW - 2 * DAY + 30 * MINUTE,
    text: "Retested #2104 on 0.4.2: still fixed by #2126.",
    steps: ["Booted smolvm 0.4.2", "Ran the repro"],
  },
  {
    id: "c10",
    kind: CHAT_KIND.GITHUB,
    at: NOW - 1 * DAY - 3 * HOUR,
    from: "grace",
    text: "Reviewed #2131 (smolvm: cache kernel images): 3 comments.",
  },
  {
    id: "c11",
    kind: CHAT_KIND.TURN,
    at: NOW - 1 * DAY - 2 * HOUR,
    text: "Fixed 2 of grace's 3 comments on #2131 and pushed 9b03d1e; asked about the third.",
    steps: ["Read 3 review comments", "Edited packages/vm/src/cache.ts", "Pushed 9b03d1e"],
  },
  {
    id: "c12",
    kind: CHAT_KIND.TOPIC,
    at: NOW - 6 * HOUR,
    text: "Switching gears: draft the smolvm 0.5 release notes from the merged PRs.",
  },
  {
    id: "c13",
    kind: CHAT_KIND.TURN,
    at: NOW - 5 * HOUR,
    text: "Drafted the 0.5 release notes in CHANGELOG.md: 9 entries, 2 flagged for you.",
    steps: ["Listed 14 merged PRs", "Wrote CHANGELOG.md"],
  },
  {
    id: "c14",
    kind: CHAT_KIND.THREAD_CARD,
    at: NOW - 12 * MINUTE,
    text: "#7887 ready for review",
    thread: THREAD_ID.REVIEW,
  },
  {
    id: "c15",
    kind: CHAT_KIND.GITHUB,
    at: NOW - 6 * MINUTE,
    from: "grace",
    text: "Replied on #2131: the third comment still stands.",
  },
];

/** What the agent answers on a thread a beat after the member replies, by the state it was in. */
export const AGENT_ANSWER: Record<AgentState, string> = {
  [AGENT_STATE.WORKING]: "Got it. I'll finish this step on #2131, then take it up.",
  [AGENT_STATE.IDLE]: "Back on it. I've caught up on the last 3 days first: #2126 is still green.",
  [AGENT_STATE.ARCHIVED]: "Unarchived and back on it. #2126 is still green.",
  [AGENT_STATE.WAITING]: "Thanks, on it now.",
};

/** What the agent says after a Decide option is chosen. */
export function decidedAnswer(label: string): string {
  return label === "Bypass and merge"
    ? "Merging #2126 now as an admin."
    : "Asked grace for a review on #2126. I'll merge once it's approved.";
}

/**
 * When `at` happened in `state`'s world. An agent working or waiting has
 * kept going for three days since the old thread; one idle or archived
 * stopped on Nov 6, so everything after the thread is pressed into that
 * evening, the fresh thread too, and the chat reads true in every state.
 */
export function timeIn(state: AgentState, at: number): number {
  const active = state === AGENT_STATE.WORKING || state === AGENT_STATE.WAITING;
  if (active || at <= OPENED) return at;
  return OPENED + ((at - OPENED) * (IDLE_SINCE - OPENED)) / (NOW - OPENED);
}

/** "3 days ago", "12m ago": an age as the Inbox says it. */
export function ageOf(at: number): string {
  const minutes = Math.round((NOW - at) / MINUTE);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

/** "Nov 6, 7:18 PM": a moment as a message line says it. */
export function momentOf(at: number): string {
  return new Date(at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/*
 * Design E (Threadbear's model) lists agents rather than threads, and puts
 * the agent's asks in a Needs you card over the message box. What follows is
 * the rest of that world: the other agents in the list, the asks, the ones
 * answered before, and what a done turn leaves open.
 */

/** Where an agent stands in E's list. */
export const LIST_SECTION = {
  INBOX: "Inbox",
  RUNNING: "Running",
  HIBERNATING: "Hibernating",
  ARCHIVED: "Archived",
} as const;

export type ListSection = (typeof LIST_SECTION)[keyof typeof LIST_SECTION];

/** What a row says at its right. */
export const ROW_MARK = {
  /** Done, waiting on the member, unread: the blue dot. */
  NEEDS_YOU: "needs-you",
  /** Done, nothing needed, unread: the tick. */
  DONE: "done",
  /** Working now: a spinner and a timer. */
  WORKING: "working",
  /** The turn ended, its helpers are still going. */
  SUB_AGENTS: "sub-agents",
  /** A booked wakeup. */
  WAKES: "wakes",
  /** Put away. */
  ARCHIVED: "archived",
} as const;

export type RowMark = (typeof ROW_MARK)[keyof typeof ROW_MARK];

export interface ListedAgent {
  readonly id: string;
  readonly name: string;
  readonly project: string;
  readonly section: ListSection;
  readonly mark: RowMark;
  /** What the row says at its right: a time, a timer's start, "2 sub-agents", "wakes 11:40 PM". */
  readonly detail: string;
}

/** The other agents in E's list; the prototype's own agent is placed by its state. */
export const OTHER_AGENTS: readonly ListedAgent[] = [
  {
    id: "agent-secrets",
    name: "Audit secrets",
    project: "Observability",
    section: LIST_SECTION.INBOX,
    mark: ROW_MARK.DONE,
    detail: "8:52 PM",
  },
  {
    id: "agent-binbin",
    name: "Tracking BinBin He support for smol machines",
    project: AGENT.task,
    section: LIST_SECTION.RUNNING,
    mark: ROW_MARK.WORKING,
    detail: "",
  },
  {
    id: "agent-webkit",
    name: "Fix the flaky WebKit spec",
    project: "Panel",
    section: LIST_SECTION.RUNNING,
    mark: ROW_MARK.SUB_AGENTS,
    detail: "2 sub-agents",
  },
  {
    id: "agent-ci",
    name: "Watch smolvm CI on main",
    project: AGENT.task,
    section: LIST_SECTION.HIBERNATING,
    mark: ROW_MARK.WAKES,
    detail: "wakes 11:40 PM",
  },
  {
    id: "agent-notes",
    name: "Write the 0.4 release notes",
    project: AGENT.task,
    section: LIST_SECTION.ARCHIVED,
    mark: ROW_MARK.ARCHIVED,
    detail: "Oct 28",
  },
  {
    id: "agent-flag",
    name: "Rename the sandbox flag",
    project: "Sandbox",
    section: LIST_SECTION.ARCHIVED,
    mark: ROW_MARK.ARCHIVED,
    detail: "Oct 21",
  },
];

/** One thing the agent asked: its question, its answers, and which it recommends. */
export interface CardAsk {
  readonly id: string;
  readonly topic: string;
  readonly question: string;
  readonly options: readonly string[];
  readonly recommended: string;
}

/** The asks open on the agent's last reply, which the Needs you card pages through. */
export const OPEN_ASKS: readonly CardAsk[] = [
  {
    id: "ask-merge",
    topic: "Merge #2126?",
    question: MERGE_ASK.question,
    options: MERGE_ASK.options.map((option) => option.label),
    recommended: MERGE_ASK.recommended,
  },
  {
    id: "ask-review",
    topic: "#7887 ready for review",
    question: "#7887 adds smolvm to the sandbox picker. Who reviews it?",
    options: ["I'll review it", "Ask grace"],
    recommended: "Ask grace",
  },
  {
    id: "ask-notes",
    topic: "smolvm 0.5 release notes",
    question:
      "The 0.5 notes are drafted in CHANGELOG.md, 2 entries flagged. Ship them as they are?",
    options: ["Ship them", "Hold for my edits"],
    recommended: "Hold for my edits",
  },
];

/** Asks answered before, which Highlights keeps beside the open ones. */
export const ANSWERED_ASKS: readonly {
  readonly id: string;
  readonly topic: string;
  readonly answer: string;
  readonly at: string;
}[] = [
  { id: "ask-version", topic: "Which smolvm version to target?", answer: "0.4.x", at: "Nov 5" },
  { id: "ask-split", topic: "One PR for #2101 and #2104, or two?", answer: "One PR", at: "Nov 5" },
];

/** What a done turn leaves open, as the Done card lists it. */
export const STILL_OPEN: readonly string[] = [
  "#2131: 1 failing check (vm-macos)",
  "2 unpushed commits on fix/smolvm-review",
  "1 sub-agent running: retest #2104 on 0.4.2",
  "Wakes 11:40 PM to check grace's review",
];

/** Follow-ups a done turn offers, each ticked to go with the next message. */
export const CARRY_ON: readonly string[] = [
  "Close #2119 as a duplicate of #2101",
  "Draft the smolvm 0.5 announcement",
];

/** What the agent answers once the member sends their picks. */
export const PICKS_ANSWER =
  "Thanks. I've acted on your picks and posted on each PR. Nothing else needs you for now.";
