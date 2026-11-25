// agent-dock.tsx -- what stands over an agent's composer as one row of capsules (an approval waiting, the apps it uses on the reader's Mac, its Inbox threads, its pull request, its queue), each opening what it holds on a press, and the call waiting that no row draws, which stands inside the composer, as the agent page composes them.

import type { ComputerApp } from "@repo/features/agent-parts";
import type { AgentPullRequest } from "@repo/features/agent-wire";
import type { AppsInUse } from "@repo/features/apps-in-use";
import type { AgentThreadsLine } from "@repo/features/inbox-list-model";
import {
  type DockChip,
  DockChips,
  GLYPH,
  HeldCallBanner,
  pullRequestChipLook,
  QueuedLines,
  usePicturesView,
} from "@repo/ui-native";
import { type ReactNode, useState } from "react";
import type { AgentApprovals } from "./use-agent-approvals.js";
import type { AgentComposer } from "./use-agent-composer.js";

/** The row's words, each a count and a noun, and what a press on each does, as VoiceOver hears it. */
const DOCK_WORDS = {
  approvals: (count: number) => (count === 1 ? "Approval" : "Approvals"),
  queued: (count: number) => `${count} queued`,
  PAUSED: "Queue paused",
  INBOX: "Inbox",
  APPROVAL_SHOW_HINT: "Shows the call waiting",
  APPROVAL_OPEN_HINT: "Shows or hides the call waiting in the box",
  DENIES: "Sending a message denies it",
  INBOX_HINT: "Opens the thread in the Inbox",
  PULL_REQUEST_HINT: "Opens the pull request",
  QUEUE_HINT: "Shows or hides the queued messages",
  APP_HINT: "Opens its newest window",
  ON_MACHINE: " on ",
} as const;

/** The agent's threads line and its press, while it has posted threads. */
export interface AgentThreadsDock {
  readonly line: AgentThreadsLine;
  readonly onOpen: (threadId: string) => void;
}

/** The apps the agent uses on the reader's Mac this turn, and what each one's icon and window are drawn from, by id, where they were read. */
export interface AppsDock {
  readonly inUse: AppsInUse;
  readonly source: (pictureId: string) => string | null | undefined;
}

/** The pictures the apps' capsules draw and open: each app's icon and its newest window, by id, which the page reads as it reads the transcript's. */
export function appsDockMediaIds(inUse: AppsInUse | undefined): readonly string[] {
  return (inUse?.apps ?? []).flatMap((app) => [
    ...(app.icon === undefined ? [] : [app.icon]),
    ...(app.window === undefined ? [] : [app.window.id]),
  ]);
}

/** What an app's capsule says: its name, and the machine it is on where another app in use shares its name on another machine ("Simulator on Mac mini"), so the two never read alike, as the panel's stack titles it. */
function appWords(app: ComputerApp, apps: readonly ComputerApp[]): string {
  const folded = app.name.toLowerCase();

  const twinned = apps.some(
    (other) =>
      other !== app && other.name.toLowerCase() === folded && other.machine?.id !== app.machine?.id,
  );

  return twinned && app.machine !== undefined
    ? `${app.name}${DOCK_WORDS.ON_MACHINE}${app.machine.name}`
    : app.name;
}

/** What the row reads: the composer's queue, the calls waiting, the apps the agent uses, the agent's threads and its pull request, and where a press on each goes. */
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
  /** The apps the agent uses on the reader's Mac this turn; none where its turn used none. */
  readonly apps: AppsDock | undefined;
}

type PicturesView = ReturnType<typeof usePicturesView>;

/**
 * The row's capsules for the apps the agent uses on the reader's Mac this
 * turn, as the panel's stack floats them over its box: the one it used last
 * first, each led by its app's icon and named by the app, the one the agent
 * is in now in copper while it works; a press opens the newest window of
 * each app read so far in the picture viewer, from the one pressed, as the
 * panel's stack opens its viewer walking every app's newest window. Note
 * that the viewer draws no cursor, as the panel's enlarged window draws
 * none, since it is the window held still to be read.
 */
function appChips(apps: AppsDock | undefined, view: PicturesView): readonly DockChip[] {
  if (apps === undefined) return [];
  const { inUse, source } = apps;

  const windows = inUse.apps.flatMap((app) => {
    const drawn = app.window === undefined ? undefined : source(app.window.id);

    return drawn == null
      ? []
      : [{ app: app.id, source: drawn, title: appWords(app, inUse.apps), subtitle: undefined }];
  });

  return inUse.apps.map((app, at) => {
    const index = windows.findIndex((each) => each.app === app.id);

    return {
      id: app.id,
      glyph: GLYPH.COMPUTER_USE,
      icon: app.icon === undefined ? undefined : (source(app.icon) ?? undefined),
      words: appWords(app, inUse.apps),
      active: inUse.using && at === 0,
      hint: DOCK_WORDS.APP_HINT,
      onPress: () => (index < 0 ? undefined : view?.(windows, index)),
    };
  });
}

/** The row's capsule for the calls waiting: it shows or folds the banner in the composer where no row draws the oldest, and otherwise scrolls the transcript to its row. */
function approvalChip(
  { approvals, denies, onShowWaiting }: AgentDockReading,
  shown: boolean,
  toggle: () => void,
): readonly DockChip[] {
  const { waiting, banner } = approvals;

  if (waiting === undefined) return [];

  const opensInPlace = banner !== undefined;
  const hint = opensInPlace ? DOCK_WORDS.APPROVAL_OPEN_HINT : DOCK_WORDS.APPROVAL_SHOW_HINT;

  return [
    {
      id: "approval",
      glyph: GLYPH.ASK_FIRST,
      words: DOCK_WORDS.approvals(waiting.count),
      waiting: waiting.count,
      // Note that the capsule tells VoiceOver that a message sent now denies the calls, as the panel's composer says it in words over its field.
      hint: denies ? `${hint}. ${DOCK_WORDS.DENIES}` : hint,
      open: opensInPlace ? shown : undefined,
      onPress: () => (opensInPlace ? toggle() : onShowWaiting?.()),
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
  toggle: () => void,
): readonly DockChip[] {
  const count = composer.queued.length;

  if (count === 0 && composer.paused === undefined) return [];

  return [
    {
      id: "queue",
      glyph: GLYPH.QUEUED,
      words: count === 0 ? DOCK_WORDS.PAUSED : DOCK_WORDS.queued(count),
      hint: DOCK_WORDS.QUEUE_HINT,
      open,
      onPress: toggle,
    },
  ];
}

/** What the agent page stands around its composer: the capsules over it, and the call waiting inside it. */
export interface AgentDock {
  /** The row of capsules over the composer, with the queue a press opened under it; none while nothing waits. */
  readonly above: ReactNode;
  /** The banner of a call waiting that no row draws, which stands in the composer's head over its field; none while none waits, the reader folded it, or a `/` or an `@` offers its list. */
  readonly held: ReactNode;
}

/**
 * What stands over an agent's composer: one row of capsules, as the panel's
 * docks hold the same things, in the order they want the reader (the calls
 * waiting, the apps it uses on the reader's Mac, the agent's Inbox threads,
 * its pull request, its queue), and the queue's messages with Steer and
 * Delete under the row once its capsule is pressed; a message being edited
 * holds the queue open, so its Cancel stays in reach. A call waiting that no
 * row draws, such as a subagent's, stands inside the composer instead
 * (`held`), as the panel stands such a call in its conversation rather than
 * behind a press, while its capsule folds it away and back. Note that the
 * row and the call step aside while a `/` or an `@` offers its list, so the
 * list stands alone over the field, and that nothing stands while nothing
 * waits.
 */
export function useAgentDock(reading: AgentDockReading, picking: boolean): AgentDock {
  const [queueOpened, setQueueOpened] = useState(false);
  const [heldFolded, setHeldFolded] = useState(false);
  const { composer, approvals } = reading;
  const editing = composer.queued.some((line) => line.editing === true);
  const queues = composer.queued.length > 0 || composer.paused !== undefined;
  const queueOpen = (queueOpened && queues) || editing;

  // Note that a fold lasts only while calls wait, so the next call that waits stands in the composer again rather than behind a press.
  if (heldFolded && approvals.banner === undefined) setHeldFolded(false);

  const heldShown = approvals.banner !== undefined && !heldFolded;
  const view = usePicturesView();

  const chips = [
    ...approvalChip(reading, heldShown, () => setHeldFolded((was) => !was)),
    ...appChips(reading.apps, view),
    ...placeChips(reading),
    ...queueChip(reading, queueOpen, () => setQueueOpened((was) => !was)),
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
  ) : undefined;

  const held =
    heldShown && !picking && approvals.banner !== undefined ? (
      <HeldCallBanner {...approvals.banner} />
    ) : undefined;

  if (picking && opened === undefined) return { above: undefined, held };

  return { above: <DockChips chips={picking ? [] : chips} opened={opened} />, held };
}
