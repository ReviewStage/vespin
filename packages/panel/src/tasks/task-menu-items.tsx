import { LINK_DESTINATION, linkOf, taskLinkStep } from "@repo/features/link-grammar";
import type { MentionPlace } from "@repo/features/mention-link";
import type { TaskSummary } from "@repo/features/task-wire";
import type { Workspace } from "@repo/features/workspace-wire";
import { createStore, useSelector } from "@tanstack/react-store";
import { useEffect } from "react";
import { commandAction, PANEL_COMMAND } from "../command-items.js";
import { linkItems, openInTabOf } from "../copy-link-item.js";
import type { MenuAction } from "../desktop/action-menu.js";
import type { ShortcutSubject } from "../shortcut-target.js";

/**
 * task-menu-items.tsx -- the items a task's ⋯ menu and the ⋯ beside its title both offer: Copy link, Mark as unread, Rename, and Version history, and the open task's one rename door ⌘K reaches.
 *
 * Each menu says what pressing one does where it is drawn, so the sidebar's
 * Rename edits the row and the title's edits the title, but both draw the
 * item the same way, as the window's one list words and marks it
 * (`command-items.tsx`). The link is the task's own address on vespin.dev,
 * naming it by its number where it has one (`taskLinkStep`), so it opens the
 * task in the app as a mention's chip does; in a browser, Open in new tab
 * stands under Copy link and opens it in a tab of its own.
 * Mark as unread turns to Mark as read on a task already unread, as Mail,
 * Slack, and Linear offer it (`use-description-looks.ts`).
 */

/** Where a task's links are written: its workspace by slug, or by id until the workspaces are read, and its repository. */
export function taskLinkDestination(
  workspaces: readonly Workspace[],
  task: Pick<TaskSummary, "workspaceId" | "repository">,
): MentionPlace {
  const home = workspaces.find((each) => each.id === task.workspaceId);

  return { workspace: home?.slug ?? task.workspaceId, repository: task.repository };
}

/** A task's link: its own address, naming it by its number where it has one. */
function taskLink(task: Pick<TaskSummary, "id" | "number">, place: MentionPlace): string {
  return linkOf({ kind: LINK_DESTINATION.TASK, planId: taskLinkStep(task) }, place.workspace);
}

/** Opens a task in a tab of its own, which a middle-click on its row or card takes; none where the window opens no tabs. */
export function openTaskInTab(
  workspaces: readonly Workspace[],
  task: Pick<TaskSummary, "id" | "number" | "workspaceId" | "repository">,
): (() => void) | undefined {
  return openInTabOf(taskLink(task, taskLinkDestination(workspaces, task)));
}

/**
 * Copy link, the task's, through `copy`, the window's menu copy
 * (`useCopyToast`), which says so in a toast, and Open in new tab under it
 * where the window opens tabs (`linkItems`). Note that Copy link prints ⇧⌘C
 * only while the chord would copy this link, because the chord copies the
 * most specific link at hand, an agent's tab's over its task's
 * (`links-at-hand.ts`), so the open task's item need not be its target.
 */
export function taskLinkItems(
  copy: (words: string, label: string) => void,
  task: Pick<TaskSummary, "id" | "number">,
  place: MentionPlace,
): MenuAction[] {
  return linkItems(copy, taskLink(task, place));
}

/** Whether a task is unread, as its sidebar row's weight says, and the mark that makes it unread or read. */
export interface ReadMark {
  readonly unread: boolean;
  readonly onMark: (unread: boolean) => void;
}

/** Mark as unread, or Mark as read on a thing already unread, printing U where the key marks `subject`: a focused sidebar row's, the open thing's, the Inbox's chosen item's. */
export function markReadItem(
  { unread, onMark }: ReadMark,
  subject: ShortcutSubject | undefined,
): MenuAction {
  return unread
    ? commandAction(PANEL_COMMAND.MARK_READ, () => onMark(false), subject)
    : commandAction(PANEL_COMMAND.MARK_UNREAD, () => onMark(true), subject);
}

/** Rename, editing the name where the menu's door draws it. */
export function renameTaskItem(rename: () => void): MenuAction {
  return commandAction(PANEL_COMMAND.RENAME_TASK, rename, undefined);
}

/** The open task's rename door, by the task it renames: what its page offers while it stands. */
export interface OpenTaskRename {
  readonly taskId: string;
  readonly begin: () => void;
}

/** The rename door the open task's page offers, none while no task's page stands. */
const openTaskRenameStore = createStore<OpenTaskRename | undefined>(undefined);

/**
 * Offers the open task's rename door for as long as its page stands, so a
 * place drawn apart from the page, ⌘K, asks for the name where the page
 * draws it, as the page's own ⋯ and its title's do. Note that `begin` is
 * read as it is called, so it should be a steady door.
 */
export function useOfferTaskRename(taskId: string | undefined, begin: () => void): void {
  useEffect(() => {
    if (taskId === undefined) return;
    const offered = { taskId, begin };
    openTaskRenameStore.setState(() => offered);

    return () => openTaskRenameStore.setState((held) => (held === offered ? undefined : held));
  }, [taskId, begin]);
}

/** The rename door the open task's page offers now, none while no task's page stands. */
export function useTaskRenameOffer(): OpenTaskRename | undefined {
  return useSelector(openTaskRenameStore);
}

/** Version history, opening the description's versions over the window, printing ⌥⇧⌘H where the chord opens `subject`'s: the open task's. */
export function versionHistoryItem(open: () => void, subject: ShortcutSubject): MenuAction {
  return commandAction(PANEL_COMMAND.VERSION_HISTORY, open, subject);
}
