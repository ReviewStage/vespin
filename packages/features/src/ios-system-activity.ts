/**
 * ios-system-activity.ts -- what the iPhone app tells the system of what it shows: the activity each thread, task, agent, and pull request screen advertises for Handoff, the Spotlight items of the member's tasks and Inbox threads, and the screen a continued activity or a tapped item opens, each named by its vespin.dev link.
 *
 * A screen's activity is of our own type, `dev.vespin.viewing`, which the
 * app's `NSUserActivityTypes` declares and any app of ours on the same team
 * may, and carries its title and its page on vespin.dev, so
 * Handoff hands it to the Mac, where an app that takes our activity type
 * opens it and Safari opens its page otherwise, and to another of the
 * member's iPhones and iPads, where the app opens it through the same
 * routing a link takes (`iosContinuedRouteOf`). A pull request's page on
 * vespin.dev is its agent's Changes, which the app draws no screen for, so
 * its activity names its number beside the page and the app opens it on the
 * pull request's own screen.
 *
 * A Spotlight item is named by its vespin.dev link, which is also what the
 * app is handed when the item is tapped, so one string both finds the item
 * to update or remove and opens it. The app holds the index in step with the
 * lists the document holds (`spotlightChanges`), each change sent alone.
 */

import { type InboxListed, inboxMemberName, inboxPreview } from "./inbox-list-model.js";
import { iosAppRouteOf, iosPullRequestRoute } from "./ios-app-links.js";
import {
  LINK_DESTINATION,
  type LinkDestination,
  linkOf,
  linkWorkspaceStep,
  type ReadLink,
  readLink,
  taskLinkStep,
} from "./link-grammar.js";
import { cardTitle } from "./plain-words.js";
import { TASK_STATUS_WORDS } from "./task-standing-words.js";
import type { TaskPullRequests, TaskSummary } from "./task-wire.js";
import type { Workspace } from "./workspace-wire.js";

/** What a Spotlight item is: one of the member's tasks, or one of their Inbox threads. */
export const SPOTLIGHT_DOMAIN = {
  TASK: "task",
  THREAD: "thread",
} as const;

type SpotlightDomain = (typeof SPOTLIGHT_DOMAIN)[keyof typeof SPOTLIGHT_DOMAIN];

/** Our activity type, which the iPhone app declares in `NSUserActivityTypes` and the desktop advertises. */
export const HANDOFF_ACTIVITY_TYPE = "dev.vespin.viewing";

/** The `userInfo` key a pull request's activity names its number under, since its page is its agent's Changes. */
export const HANDOFF_PULL_REQUEST_KEY = "pullRequest";

/** What parts a Spotlight item's summary. */
const SUMMARY_PART = " · ";

/** The activity a screen advertises while it stands. */
export interface IosActivity {
  /** What the system names it by: the thread's, task's, agent's, or pull request's title. */
  readonly title: string;
  /** Its page on vespin.dev, which is also its identifier, so a screen drawn again advertises the same activity. */
  readonly webpageUrl: string;
  /** The pull request's number, on a pull request's activity, whose page is its agent's Changes. */
  readonly pullRequest?: number;
}

/** One of the member's tasks or Inbox threads as Spotlight finds it. */
export interface SpotlightItem {
  /** Its vespin.dev link, which the app is handed back when it is tapped. */
  readonly id: string;
  readonly domain: SpotlightDomain;
  readonly title: string;
  /** One line under its title: a task's status and workspace, a thread's latest words as its row says them. */
  readonly summary: string;
}

/** A continued activity or a tapped Spotlight item, as the app's native module hands it on. */
export interface ContinuedActivity {
  readonly link: string;
  readonly pullRequest?: number;
}

/** What the index must take to match the lists: the items new or changed, and the ids no longer listed. */
export interface SpotlightChanges {
  readonly index: readonly SpotlightItem[];
  readonly remove: readonly string[];
}

/** An agent's place, under its task where it is known, as the agent's page writes its address. */
function agentPlace(agentId: string, taskId: string | undefined): LinkDestination {
  return taskId === undefined
    ? { kind: LINK_DESTINATION.AGENT, agentId }
    : { kind: LINK_DESTINATION.AGENT, planId: taskId, agentId };
}

/** An Inbox thread's activity: its title and its page, under its task's workspace. */
export function threadActivity(listed: InboxListed, workspaces: readonly Workspace[]): IosActivity {
  const { holder, item } = listed;
  const step = linkWorkspaceStep(holder.task.workspaceId, workspaces);

  return {
    title: cardTitle(item.title),
    webpageUrl: linkOf({ kind: LINK_DESTINATION.INBOX_ITEM, itemId: item.id }, step),
  };
}

/**
 * A task's activity: its name and its page, by its id. Note that it is named
 * by its id rather than its number, because a number is its workspace's
 * alone and the app finds a task by number among every workspace's.
 */
export function taskActivity(task: TaskSummary, workspaces: readonly Workspace[]): IosActivity {
  const step = linkWorkspaceStep(task.workspaceId, workspaces);

  return {
    title: task.name,
    webpageUrl: linkOf({ kind: LINK_DESTINATION.TASK, planId: task.id }, step),
  };
}

/** An agent's activity: its title and its page, under its task where it is known. */
export function agentActivity(
  agent: {
    readonly id: string;
    readonly title: string;
    readonly workspaceId: string;
    readonly taskId?: string;
  },
  workspaces: readonly Workspace[],
): IosActivity {
  const step = linkWorkspaceStep(agent.workspaceId, workspaces);

  return { title: agent.title, webpageUrl: linkOf(agentPlace(agent.id, agent.taskId), step) };
}

/** A pull request's activity: its title, its agent's Changes on vespin.dev, and its number, which the app opens it by. */
export function pullRequestActivity(
  pullRequest: {
    readonly agentId: string;
    readonly taskId?: string;
    readonly workspaceId: string;
    readonly number: number;
    readonly title: string;
  },
  workspaces: readonly Workspace[],
): IosActivity {
  const step = linkWorkspaceStep(pullRequest.workspaceId, workspaces);
  const { agentId, taskId } = pullRequest;

  const place: LinkDestination =
    taskId === undefined
      ? { kind: LINK_DESTINATION.CHANGES, agentId }
      : { kind: LINK_DESTINATION.CHANGES, planId: taskId, agentId };

  return {
    title: pullRequest.title,
    webpageUrl: linkOf(place, step),
    pullRequest: pullRequest.number,
  };
}

/** What a desktop window advertises for Handoff: an activity as a screen's, less its title, which Electron sets none of. */
export type HandoffActivity = Omit<IosActivity, "title">;

/** What the window holds that a link names only by its number or its agent: its tasks, their workspaces, and the pull requests their agents opened. */
export interface HandoffReads {
  readonly tasks: readonly Pick<TaskSummary, "id" | "number" | "workspaceId">[];
  readonly workspaces: readonly Workspace[];
  readonly pullRequests: readonly TaskPullRequests[];
}

/**
 * The activity a desktop window advertises while `link` is what it shows,
 * as the phone's screen for the same thing advertises it, so the phone
 * opens it where it would open its own (`iosContinuedRouteOf`); none for a
 * place the phone draws no screen for. A task is named by its id, as the
 * phone's own activity names it, since a number is its workspace's alone. A
 * pull request is named by its agent's Changes and its number, and one the
 * window holds no number for is handed off as its agent.
 */
export function desktopHandoffOf(link: ReadLink, reads: HandoffReads): HandoffActivity | undefined {
  const { place, workspace } = link;

  switch (place.kind) {
    case LINK_DESTINATION.INBOX_ITEM:
    case LINK_DESTINATION.AGENT:
      return { webpageUrl: linkOf(place, workspace) };
    case LINK_DESTINATION.TASK: {
      const task = reads.tasks.find(
        (each) =>
          taskLinkStep(each) === place.planId &&
          linkWorkspaceStep(each.workspaceId, reads.workspaces) === workspace,
      );

      const planId = task?.id ?? place.planId;

      return { webpageUrl: linkOf({ kind: LINK_DESTINATION.TASK, planId }, workspace) };
    }

    case LINK_DESTINATION.CHANGES: {
      const number = reads.pullRequests
        .flatMap((each) => each.pullRequests)
        .find((each) => each.agentId === place.agentId)?.number;

      if (number === undefined) {
        const agent: LinkDestination = { ...place, kind: LINK_DESTINATION.AGENT };

        return { webpageUrl: linkOf(agent, workspace) };
      }

      return { webpageUrl: linkOf(place, workspace), pullRequest: number };
    }

    default:
      return undefined;
  }
}

/**
 * The Spotlight items of one workspace's tasks and Inbox threads: each task
 * by its name, its status and workspace under it, and each thread by its
 * title, its row's latest words under it, as `readerId` reads them.
 */
export function spotlightItems(read: {
  readonly workspace: Workspace;
  readonly tasks: readonly TaskSummary[];
  readonly threads: readonly InboxListed[];
  readonly readerId: string | undefined;
}): readonly SpotlightItem[] {
  const { workspace, readerId } = read;
  const workspaces = [workspace];

  const tasks = read.tasks
    .filter((task) => task.workspaceId === workspace.id)
    .map((task): SpotlightItem => {
      const status = task.status === undefined ? [] : [TASK_STATUS_WORDS[task.status]];

      return {
        id: taskActivity(task, workspaces).webpageUrl,
        domain: SPOTLIGHT_DOMAIN.TASK,
        title: task.name,
        summary: [...status, workspace.name].join(SUMMARY_PART),
      };
    });

  const threads = read.threads
    .filter(({ holder }) => holder.task.workspaceId === workspace.id)
    .map((listed): SpotlightItem => {
      const activity = threadActivity(listed, workspaces);

      return {
        id: activity.webpageUrl,
        domain: SPOTLIGHT_DOMAIN.THREAD,
        title: activity.title,
        summary: inboxPreview(listed.item, (member) => inboxMemberName(member, readerId)),
      };
    });

  return [...tasks, ...threads];
}

/** Whether two items read the same in Spotlight. */
function sameItem(one: SpotlightItem, other: SpotlightItem): boolean {
  return one.domain === other.domain && one.title === other.title && one.summary === other.summary;
}

/** What the index holding `indexed` must take to hold `next`: what is new or reads otherwise, and what is no longer listed. */
export function spotlightChanges(
  indexed: ReadonlyMap<string, SpotlightItem>,
  next: readonly SpotlightItem[],
): SpotlightChanges {
  const listed = new Set(next.map(({ id }) => id));

  const index = next.filter((item) => {
    const held = indexed.get(item.id);

    return held === undefined || !sameItem(held, item);
  });

  const remove = [...indexed.keys()].filter((id) => !listed.has(id));

  return { index, remove };
}

/**
 * The app's route for a continued activity or a tapped Spotlight item: a
 * pull request's on its own screen, by its agent's Changes and its number,
 * and any other link where the app draws its place; none for a link it
 * leaves to the web.
 */
export function iosContinuedRouteOf(continued: ContinuedActivity): string | undefined {
  const read = readLink(continued.link);

  if (read === undefined) return undefined;
  const { place } = read;
  const { pullRequest } = continued;

  if (place.kind === LINK_DESTINATION.CHANGES && pullRequest !== undefined)
    return Number.isSafeInteger(pullRequest) && pullRequest > 0
      ? iosPullRequestRoute(place.agentId, pullRequest)
      : undefined;

  return iosAppRouteOf(place);
}
