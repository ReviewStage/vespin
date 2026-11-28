/**
 * use-managers.ts -- the chosen workspace's Managers as the Tasks tab and Search list them, and the reader's looks at a Manager's chat while its page stands open.
 *
 * A Manager is an agent on no task that its workspace shares, which the
 * task list's live read carries beside the tasks' agents, so the list is
 * the host's listed agents narrowed to the workspace's unarchived Managers,
 * in the account's sort for the workspace, newest started first until one is
 * chosen (`@repo/features/workspace-managers-model`, `manager-sort.ts`), as
 * the desktop's sidebar lists them. It stands only where the workspace has the
 * Managers experiment on, as the sidebar's does, and moves as the live read
 * hears a Manager made, renamed, archived, or at work. New Manager makes one
 * (`useCreateManager`), as the desktop's card does. Its chat heads each
 * message with its sender's face and name (`useChatFaces`).
 */

import { managerCreateRefusalWords, messageFailureWords } from "@repo/features/agent-refusal-words";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { AGENT_KIND, type ListedAgent } from "@repo/features/agent-wire";
import type { ManagerFace } from "@repo/features/manager-face";
import { agentName } from "@repo/features/model-label";
import type { ModelChoice } from "@repo/features/models-wire";
import type { PinPlace } from "@repo/features/pin-order";
import { READ_MARK, type ReadMark, unreadThroughOf } from "@repo/features/read-mark";
import {
  NO_TASK_SECTIONS,
  sectionEntries,
  sectionedTasks,
} from "@repo/features/task-sections-model";
import type { TaskAgentPin } from "@repo/features/task-wire";
import {
  type PlacedManager,
  pinnedManagersOf,
  sortedManagers,
  workspaceManagersOf,
} from "@repo/features/workspace-managers-model";
import { ACT_KIND } from "@repo/host/acts";
import { type FollowedAgent, selectWorkspaceExperiment } from "@repo/host/app-state-reads";
import { windowRows } from "@repo/host/read-window";
import { EXPERIMENT } from "@repo/settings";
import type { ChannelFaces } from "@repo/ui-native";
import { and, eq, isNull, isUndefined } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs, useTaskListCollections } from "../host/host-provider.js";
import { useWindow } from "../host/use-window.js";
import { useMemberFaces } from "../member-pictures.js";
import { runsOnOf, startRefusalWords } from "../tasks/use-start.js";
import { useWrite } from "../use-write.js";
import { useManagerSort } from "./manager-sort.js";

/** No Manager, the same array every render. */
const NO_MANAGERS: readonly ListedAgent[] = [];

/** No pin of an agent, the same array every render. */
const NO_AGENT_PINS: readonly TaskAgentPin[] = [];

/** Says on the console a look the host refused, which the next delivery of the document corrects. */
function lookRefused(cause: unknown): void {
  console.error("The look at a Manager's chat did not go.", cause);
}

/** Whether `workspaceId` has the Managers experiment on, which every place that lists or finds a Manager asks. */
export function useManagersListed(workspaceId: string | undefined): boolean {
  const { data: listed = false } = useQuery({
    ...appStateQuery,
    select: selectWorkspaceExperiment(workspaceId, EXPERIMENT.MANAGERS),
  });

  return listed;
}

/**
 * The unarchived Managers of `workspaceId`, in the account's sort for it
 * (`manager-sort.ts`), newest started first until one is chosen; none while
 * it has the Managers experiment off. Note that the live query holds the
 * workspace's unarchived Managers alone, as the panel's sidebar reads them,
 * so a step of any other agent's turn tells it nothing, and nothing is read
 * while the experiment is off.
 */
export function useWorkspaceManagers(workspaceId: string | undefined): readonly ListedAgent[] {
  const listed = useManagersListed(workspaceId);
  const { agents } = useTaskListCollections();

  const held = windowRows(
    useWindow((q) =>
      !listed || workspaceId === undefined
        ? undefined
        : q
            .from({ agent: agents })
            .where(({ agent }) =>
              and(
                eq(agent.kind, AGENT_KIND.MANAGER),
                isNull(agent.taskId),
                eq(agent.workspaceId, workspaceId),
                isUndefined(agent.archivedAt),
              ),
            ),
    ),
  );

  const { sort } = useManagerSort(listed ? workspaceId : undefined);

  return useMemo(
    () =>
      workspaceId === undefined
        ? NO_MANAGERS
        : sortedManagers(workspaceManagersOf(held, workspaceId), sort),
    [held, workspaceId, sort],
  );
}

/** What a Manager's page reads of the reader's mark: where New stands, and Mark as unread from one of its messages. */
export interface ManagerChatMark {
  /** The instant New stands after: the mark the page found as it opened where the chat then read unread, or the one Mark as unread left; none where nothing stood unread. */
  readonly newAfter: number | undefined;
  /** Whether New may stand over the reader's own message, as it does where they marked the chat unread from it; else it skips their own. */
  readonly newOverOwn: boolean;
  /** Moves the reader's mark back to just before the message, by its id and when it was sent, and holds it there while the page stands; none for an agent that is no Manager. */
  readonly markUnread: ((messageId: string, sentAt: number) => void) | undefined;
}

/** One stay on a Manager's page: the agent, where New stands, and whether it may stand over the reader's own message. */
interface ChatStay {
  readonly agentId: string | undefined;
  readonly newAfter: number | undefined;
  readonly newOverOwn: boolean;
}

/** The reader's mark of the chat as its row carries it, and when the Manager last said something. */
type ChatMarkRead = Pick<ListedAgent, "saidAt" | "readThrough" | "markedUnread">;

/** A stay as the page opens on the agent: New after the mark it finds, where the reader marked the chat unread, over their own message too, or where it said something after the mark. */
function openedStay(agentId: string | undefined, mark: ChatMarkRead | undefined): ChatStay {
  const said =
    mark?.saidAt !== undefined && mark.readThrough !== undefined && mark.saidAt > mark.readThrough;

  const marked = mark?.markedUnread === true;

  return {
    agentId,
    newAfter: marked || said ? mark?.readThrough : undefined,
    newOverOwn: marked,
  };
}

/** Where a section's entry stands among its rows, as the sidebar places it. */
function entryPlace(entry: {
  readonly position?: string | undefined;
  readonly addedAt: number;
}): PinPlace {
  return { position: entry.position, at: entry.addedAt };
}

/** Where the reader placed a workspace's Managers: those pinned, those kept in each of their sections, and the rest. */
export interface PlacedManagers {
  /** The pinned ones, each where its pin stands, in the order Pinned stands its pins. */
  readonly pinned: readonly PlacedManager<ListedAgent>[];
  /** Each section's, by the section's id, each where its entry stands, in the section's order. */
  readonly bySection: ReadonlyMap<string, readonly PlacedManager<ListedAgent>[]>;
  /** Where each task stands in its section, by the task's id, which places a section's Managers among its tasks. */
  readonly sectionPlaces: ReadonlyMap<string, PinPlace>;
  /** Those neither pinned nor in a section, which the Managers group lists. */
  readonly rest: readonly ListedAgent[];
}

/**
 * The workspace's Managers split by where the reader placed them, as the
 * panel's sidebar places them (`sidebar-managers.tsx`): one pinned stands
 * under Pinned alone (`pinnedManagersOf`); one put in a section, and not
 * pinned, stands in that section alone (`sectionedTasks`); the rest stand
 * in the Managers group.
 */
export function usePlacedManagers(
  managers: readonly ListedAgent[],
  workspaceId: string | undefined,
): PlacedManagers {
  const { data: pins = NO_AGENT_PINS } = useQuery({
    ...appStateQuery,
    select: (snapshot) => snapshot.tasks.taskAgentPins ?? NO_AGENT_PINS,
  });

  const { data: sections = NO_TASK_SECTIONS } = useQuery({
    ...appStateQuery,
    select: (snapshot) => snapshot.tasks.taskSections ?? NO_TASK_SECTIONS,
  });

  return useMemo(() => {
    const pinned = pinnedManagersOf(managers, pins);
    const pinnedIds = new Set(pinned.map(({ agent }) => agent.id));
    const unpinned = managers.filter(({ id }) => !pinnedIds.has(id));
    const sectioned = sectionedTasks(sections, workspaceId, [], unpinned);

    return {
      pinned,
      bySection: new Map(
        sectioned.sections.map((drawn) => [
          drawn.section.id,
          drawn.managers.map(({ agent, entry }) => ({ agent, place: entryPlace(entry) })),
        ]),
      ),
      sectionPlaces: new Map(
        [...sectionEntries(sections)].map(([taskId, entry]) => [taskId, entryPlace(entry)]),
      ),
      rest: unpinned.filter(({ id }) => !sectioned.agentIds.has(id)),
    };
  }, [managers, pins, sections, workspaceId]);
}

/**
 * Moves the reader's mark of a Manager's chat while its page stands open, as
 * the panel's page does (`manager-chat-looks.ts`): read through as it opens,
 * seen as it is left, and seen again whenever the chat says something while
 * it stands open, so the unread dot its row draws is one the phone clears;
 * and offers Mark as unread, which moves the mark back to just before any
 * message of the chat, marks it unread by hand, and holds the mark there
 * for the rest of the stay, so the chat stays unread, New over that
 * message, until the reader opens it again. Nothing for an agent that is no
 * Manager. Note that each look goes quietly, whatever comes back, since no
 * person pressed for it.
 */
export function useManagerChatLooks(
  agent: Pick<ListedAgent, "id" | "kind" | "saidAt" | "readThrough" | "markedUnread"> | undefined,
): ManagerChatMark {
  const acts = useHostActs();
  const write = useWrite();
  const agentId = agent?.kind === AGENT_KIND.MANAGER ? agent.id : undefined;
  const saidAt = agent?.saidAt;
  const [stay, setStay] = useState(() => openedStay(agentId, agent));

  // Note that a page opening on another agent is a stay of its own, found before its first look moves the mark.
  if (stay.agentId !== agentId) setStay(openedStay(agentId, agent));

  // Note that the closing look reads whether the reader marked the chat unread as it runs, after the stay's last render.
  const markedUnread = useRef(false);

  useEffect(() => {
    if (agentId === undefined) return;
    markedUnread.current = false;

    const look = (readMark: ReadMark) => {
      if (markedUnread.current) return;
      acts[ACT_KIND.AGENTS_MARK_READ]({ agentId, readMark }).catch(lookRefused);
    };

    look(READ_MARK.READ);

    return () => look(READ_MARK.SEEN);
  }, [acts, agentId]);

  // Note that what the chat said as the page opened is read by the look opening it, so only a message during the stay is a look of its own.
  const seen = useRef<{ agentId: string; saidAt: number | undefined } | undefined>(undefined);

  useEffect(() => {
    const was = seen.current;
    seen.current = agentId === undefined ? undefined : { agentId, saidAt };

    if (agentId === undefined || was?.agentId !== agentId || was.saidAt === saidAt) return;

    if (markedUnread.current) return;
    acts[ACT_KIND.AGENTS_MARK_READ]({ agentId, readMark: READ_MARK.SEEN }).catch(lookRefused);
  }, [acts, agentId, saidAt]);

  const markUnread = useCallback(
    (messageId: string, sentAt: number) => {
      if (agentId === undefined) return;
      const before = stay;
      const held = markedUnread.current;
      markedUnread.current = true;
      setStay({ agentId, newAfter: unreadThroughOf(sentAt), newOverOwn: true });

      void write(
        () =>
          acts[ACT_KIND.AGENTS_MARK_READ]({
            agentId,
            readMark: READ_MARK.UNREAD,
            unreadFrom: { messageId, sentAt },
          }),
        {
          refused: (answer) =>
            "failure" in answer ? messageFailureWords(answer.failure) : undefined,
          unanswered: messageFailureWords(AGENT_CALL_FAILURE.UNANSWERED),
        },
      ).then((went) => {
        if (went) return;

        // Note that a mark the service did not take is let go, as the host lets its drawn mark go, back to the stay as it stood: one marked unread earlier in it stays held, and one that held nothing catches the looks it held up by one.
        markedUnread.current = held;
        setStay((standing) => (standing.agentId === agentId ? before : standing));

        if (held) return;
        acts[ACT_KIND.AGENTS_MARK_READ]({ agentId, readMark: READ_MARK.SEEN }).catch(lookRefused);
      });
    },
    [acts, agentId, stay, write],
  );

  const current = stay.agentId === agentId;

  return {
    newAfter: current ? stay.newAfter : undefined,
    newOverOwn: current && stay.newOverOwn,
    markUnread: agentId === undefined ? undefined : markUnread,
  };
}

/** What New Manager makes: its name, its repositories, the first its checkout, where it runs (`CLOUD` or a device's id), its model and effort, and its face, the service's pick where none is named. */
export interface ManagerAsk {
  readonly name: string;
  readonly repositories: readonly [string, ...string[]];
  readonly runsOn: string;
  readonly choice: ModelChoice;
  readonly face?: ManagerFace | undefined;
}

/** What a New Manager's Create came to: the Manager made, or why it was not. */
export type ManagerMade = { readonly agentId: string } | { readonly refused: string };

/** Whether two asks name the same Manager, so a Create sent again unchanged makes one. */
function sameAsk(one: ManagerAsk, other: ManagerAsk): boolean {
  return (
    one.name === other.name &&
    one.runsOn === other.runsOn &&
    one.choice.model === other.choice.model &&
    one.choice.effort === other.choice.effort &&
    one.face?.character === other.face?.character &&
    one.face?.color === other.face?.color &&
    one.repositories.length === other.repositories.length &&
    one.repositories.every((repository, at) => repository === other.repositories[at])
  );
}

/**
 * New Manager's Create in `workspaceId` (`AGENTS_CREATE_MANAGER`), as the
 * desktop's card sends it, wearing the face picked, or the service's pick
 * where none is: under one
 * key while what it names stands, so a Create sent again after no answer
 * makes one Manager, and a new key once anything it names changed. A
 * refusal says why in the desktop's words for a Manager's Create, else a
 * Start's.
 */
export function useCreateManager(
  workspaceId: string | undefined,
): (ask: ManagerAsk) => Promise<ManagerMade> {
  const acts = useHostActs();
  const sent = useRef<{ readonly ask: ManagerAsk; readonly key: string } | undefined>(undefined);

  return async (ask) => {
    if (workspaceId === undefined) {
      return { refused: startRefusalWords({ failure: AGENT_CALL_FAILURE.UNANSWERED }) };
    }

    const was = sent.current;
    const key = was !== undefined && sameAsk(was.ask, ask) ? was.key : randomUUID();
    sent.current = { ask, key };

    const answer = await acts[ACT_KIND.AGENTS_CREATE_MANAGER]({
      idempotencyKey: key,
      workspaceId,
      name: ask.name,
      repositories: [...ask.repositories],
      runsOn: runsOnOf(ask.runsOn),
      model: ask.choice.model,
      effort: ask.choice.effort,
      // Note that a face is sent only once picked, so one left alone is the service's pick, as the desktop's card sends it.
      ...(ask.face === undefined ? undefined : { face: ask.face }),
    }).catch((cause: unknown) => {
      console.error("The Manager's Create did not go.", cause);

      return { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;
    });

    if ("failure" in answer) {
      return { refused: managerCreateRefusalWords(answer.failure) ?? startRefusalWords(answer) };
    }

    return { agentId: answer.agent.id };
  };
}

/** What a Manager's chat heads its messages with: its faces, and the names of the Manager and the reader, whose messages on their way carry none of their own yet. */
export interface ChatFaces {
  readonly faces: ChannelFaces;
  readonly managerName: string;
  readonly readerName: string | undefined;
}

/**
 * The faces and names a Manager's chat (`manager`) heads its messages
 * with, as the panel's channel heads them: the Manager's face, and each
 * person's picture as the members of its workspace hold it; none for an
 * agent that is no Manager.
 */
export function useChatFaces(
  manager: FollowedAgent | undefined,
  readerId: string | undefined,
): ChatFaces | undefined {
  const memberOf = useMemberFaces(manager?.workspaceId);
  const face = manager?.face;
  const managerName = manager === undefined ? undefined : agentName(manager);
  const readerName = readerId === undefined ? undefined : memberOf(readerId)?.name;

  return useMemo(
    () =>
      managerName === undefined
        ? undefined
        : {
            faces: {
              manager: face,
              picture: (userId) => (userId === undefined ? undefined : memberOf(userId)?.picture),
            },
            managerName,
            readerName,
          },
    [face, managerName, readerName, memberOf],
  );
}
