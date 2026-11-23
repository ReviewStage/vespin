// agent-dock.tsx -- what stands over an agent's composer as one row of capsules (an approval waiting, its Inbox threads, its pull request, its queue), each opening what it holds on a press, as the agent page composes them.

import type { AgentPullRequest } from "@repo/features/agent-wire";
import type { AgentThreadsLine } from "@repo/features/inbox-list-model";
import {
  type DockChip,
  DockChips,
  DockPanel,
  GLYPH,
  HeldCallBanner,
  pullRequestChipLook,
  QueuedLines,
} from "@repo/ui-native";
import { type ReactNode, useState } from "react";
import type { AgentApprovals } from "./use-agent-approvals.js";
import type { AgentComposer } from "./use-agent-composer.js";

/** Which capsule of the row stands open in place. */
const OPENS = {
  APPROVAL: "approval",
  QUEUE: "queue",
} as const;

type Opens = (typeof OPENS)[keyof typeof OPENS];

/** The row's words, each a count and a noun, and what a press on each does, as VoiceOver hears it. */
const DOCK_WORDS = {
  approvals: (count: number) => (count === 1 ? "Approval" : "Approvals"),
  queued: (count: number) => `${count} queued`,
  PAUSED: "Queue paused",
  INBOX: "Inbox",
  APPROVAL_SHOW_HINT: "Shows the call waiting",
  APPROVAL_OPEN_HINT: "Shows or hides the call waiting",
  DENIES: "Sending a message denies it",
  INBOX_HINT: "Opens the thread in the Inbox",
  PULL_REQUEST_HINT: "Opens the pull request",
  QUEUE_HINT: "Shows or hides the queued messages",
} as const;

/** The agent's threads line and its press, while it has posted threads. */
export interface AgentThreadsDock {
  readonly line: AgentThreadsLine;
  readonly onOpen: (threadId: string) => void;
}

/** What the row reads: the composer's queue, the calls waiting, the agent's threads and its pull request, and where a press on each goes. */
export interface AgentDockReading {
  readonly composer: AgentComposer;
  readonly approvals: Pick<AgentApprovals, "waiting" | "banner">;
  /** Whether a message sent now denies the calls waiting, as it does unless Send queues it behind the turn. */
  readonly denies: boolean;
  /** Scrolls the transcript to the call waiting; none where no row draws one. */
  readonly onShowWaiting: (() => void) | undefined;
  readonly threads: AgentThreadsDock | undefined;
  readonly pullRequest: AgentPullRequest | undefined;
  readonly onOpenPullRequest: (url: string) => void;
}

/** The row's capsule for the calls waiting: it opens the banner where no row draws the oldest, and otherwise scrolls the transcript to its row. */
function approvalChip(
  { approvals, denies, onShowWaiting }: AgentDockReading,
  open: Opens | undefined,
  toggle: (opens: Opens) => void,
): readonly DockChip[] {
  const { waiting, banner } = approvals;

  if (waiting === undefined) return [];

  const opensInPlace = banner !== undefined;
  const hint = opensInPlace ? DOCK_WORDS.APPROVAL_OPEN_HINT : DOCK_WORDS.APPROVAL_SHOW_HINT;

  return [
    {
      id: OPENS.APPROVAL,
      glyph: GLYPH.ASK_FIRST,
      words: DOCK_WORDS.approvals(waiting.count),
      waiting: waiting.count,
      // Note that the capsule tells VoiceOver that a message sent now denies the calls, as the panel's composer says it in words over its field.
      hint: denies ? `${hint}. ${DOCK_WORDS.DENIES}` : hint,
      open: opensInPlace ? open === OPENS.APPROVAL : undefined,
      onPress: () => (opensInPlace ? toggle(OPENS.APPROVAL) : onShowWaiting?.()),
    },
  ];
}

/** The row's capsules for where the agent's work went: its Inbox threads, which open the thread the line names, and its pull request, wearing where it stands and how its checks went, which opens its page. */
function placeChips({ threads, pullRequest, onOpenPullRequest }: AgentDockReading): DockChip[] {
  const chips: DockChip[] = [];

  if (threads !== undefined) {
    const { line } = threads;

    chips.push({
      id: "inbox",
      glyph: GLYPH.INBOX,
      words: line.waiting > 0 ? DOCK_WORDS.INBOX : line.words,
      waiting: line.waiting,
      hint: DOCK_WORDS.INBOX_HINT,
      onPress: () => threads.onOpen(line.opens.id),
    });
  }

  if (pullRequest !== undefined) {
    // Note that the capsule reads the pull request as the task list holds it, live, so its state and checks move as GitHub's do, with no read of its own.
    chips.push({
      id: "pull-request",
      ...pullRequestChipLook(pullRequest),
      hint: DOCK_WORDS.PULL_REQUEST_HINT,
      onPress: () => onOpenPullRequest(pullRequest.url),
    });
  }

  return chips;
}

/** The row's capsule for the queue, which opens its messages, or why it stands paused, in place. */
function queueChip(
  { composer }: AgentDockReading,
  open: boolean,
  toggle: (opens: Opens) => void,
): readonly DockChip[] {
  const count = composer.queued.length;

  if (count === 0 && composer.paused === undefined) return [];

  return [
    {
      id: OPENS.QUEUE,
      glyph: GLYPH.QUEUED,
      words: count === 0 ? DOCK_WORDS.PAUSED : DOCK_WORDS.queued(count),
      hint: DOCK_WORDS.QUEUE_HINT,
      open,
      onPress: () => toggle(OPENS.QUEUE),
    },
  ];
}

/**
 * What stands over an agent's composer: one row of capsules, as the panel's
 * docks hold the same things, in the order they want the reader (the calls
 * waiting, the agent's Inbox threads, its pull request, its queue), and the
 * one a press opened in place standing under the row: the queue's messages
 * with Steer and Delete, or the banner of a call no row draws. A message
 * being edited holds the queue open, so its Cancel stays in reach. Note that
 * the row steps aside while a `/` or an `@` offers its list, so the list
 * stands alone over the field, and that nothing stands while nothing waits.
 */
export function useAgentDock(reading: AgentDockReading, picking: boolean): ReactNode {
  const [open, setOpen] = useState<Opens | undefined>(undefined);
  const toggle = (opens: Opens) => setOpen((was) => (was === opens ? undefined : opens));
  const { composer, approvals } = reading;
  const editing = composer.queued.some((line) => line.editing === true);
  const queues = composer.queued.length > 0 || composer.paused !== undefined;
  const queueOpen = (open === OPENS.QUEUE && queues) || editing;
  const banner = open === OPENS.APPROVAL ? approvals.banner : undefined;

  const chips = [
    ...approvalChip(reading, open, toggle),
    ...placeChips(reading),
    ...queueChip(reading, queueOpen, toggle),
  ];

  const opened = queueOpen ? (
    <QueuedLines
      lines={composer.queued}
      paused={composer.paused}
      onSteer={composer.steer}
      onDelete={composer.remove}
      onMove={composer.move}
      onResume={composer.resume}
      onEdit={composer.edit}
      onCancelEdit={composer.cancelEdit}
    />
  ) : banner === undefined ? undefined : (
    <DockPanel>
      <HeldCallBanner {...banner} />
    </DockPanel>
  );

  if (picking && opened === undefined) return undefined;

  return <DockChips chips={picking ? [] : chips} opened={opened} />;
}
