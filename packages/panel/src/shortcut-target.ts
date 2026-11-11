/**
 * shortcut-target.ts -- what each shortcut acts on right now: the one answer a menu reads to print an item's key, held by the places that offer the keys.
 *
 * A menu item prints its key exactly where pressing the key would act on
 * what the menu acts on: the open task's ⌘⌫ on the open task's menu and on
 * no other task's, a sidebar row's U on that row's menu. So no menu works
 * out for itself whether its keys reach it. Each place that offers keys
 * says what they act on while it stands (`useShortcutTarget`), beside the
 * offers that run them (`useAppCommand`): the open task's page, the agent's
 * own page, the chosen tab of each strip, a sidebar row, the Inbox's chosen
 * item, the links ⇧⌘C copies. A menu names what it acts on
 * (`ShortcutSubject`), and its item prints a key where a target standing
 * now holds that key on that subject (`shortcutActsOn`), read as the menu
 * draws.
 *
 * A target may stand for one place a subject is drawn in (`SHORTCUT_PLACE`):
 * a sidebar row's U, P, and S act on its task only from the row, whose
 * focus a menu opened on it hands back as it closes, so they reach that
 * row's menu and no other menu of the task. A target named for no place
 * reaches every menu of its subject, wherever it is drawn.
 */

import type { KeyedCommand } from "@repo/settings/shortcuts";
import { useLayoutEffect, useSyncExternalStore } from "react";

/** What a menu acts on, by kind. */
export const SHORTCUT_SUBJECT = {
  TASK: "task",
  AGENT: "agent",
  /** A tab of a strip, by its key (`tabKey`), and what it shows. */
  TAB: "tab",
  /** An app link, which ⇧⌘C copies. */
  LINK: "link",
  /** A page on GitHub, by its address. */
  GITHUB_PAGE: "github-page",
  INBOX_ITEM: "inbox-item",
} as const;

type ShortcutSubjectKind = (typeof SHORTCUT_SUBJECT)[keyof typeof SHORTCUT_SUBJECT];

/** One place a subject is drawn in whose keys reach it there alone. */
export const SHORTCUT_PLACE = {
  /** Its row in the sidebar, whose keys act on it while the row has the keyboard. */
  SIDEBAR_ROW: "sidebar-row",
  /** Its tab in the side panel, whose keys act on what it shows while the tab is drawn. */
  SIDE_PANEL_TAB: "side-panel-tab",
} as const;

type ShortcutPlace = (typeof SHORTCUT_PLACE)[keyof typeof SHORTCUT_PLACE];

/** What a menu acts on, and where it is drawn where that decides which keys reach it. */
export interface ShortcutSubject {
  readonly kind: ShortcutSubjectKind;
  readonly id: string;
  readonly place?: ShortcutPlace | undefined;
}

/** One place's keys while it stands: what they act on. */
interface Target {
  readonly subject: ShortcutSubject;
  readonly commands: readonly KeyedCommand[];
}

/** The targets standing now. */
const targets = new Set<Target>();

/** Who hears the targets change: the menus drawn now, and the rows whose menus would print otherwise. */
const listeners = new Set<() => void>();

/** How many times the targets have changed, which a menu standing open is drawn again on. */
let version = 0;

function changed(): void {
  version += 1;
  for (const listen of listeners) listen();
}

function subscribe(listen: () => void): () => void {
  listeners.add(listen);
  return () => {
    listeners.delete(listen);
  };
}

/** Whether `target` is held on `subject`: the same thing, from anywhere where it names no place, or from that place. */
function heldOn(target: Target, subject: ShortcutSubject): boolean {
  const held = target.subject;
  if (held.kind !== subject.kind || held.id !== subject.id) return false;
  return held.place === undefined || held.place === subject.place;
}

/** What a subject is, its kind and id, drawn anywhere. */
export function shortcutSubject(kind: ShortcutSubjectKind, id: string): ShortcutSubject {
  return { kind, id };
}

/** A subject as one place draws it, whose keys there reach it there alone. */
export function placedSubject(subject: ShortcutSubject, place: ShortcutPlace): ShortcutSubject {
  return { ...subject, place };
}

/** Whether pressing `command`'s key now acts on `subject`, read at the moment it is asked. */
export function shortcutActsOn(command: KeyedCommand, subject: ShortcutSubject): boolean {
  for (const target of targets) {
    if (target.commands.includes(command) && heldOn(target, subject)) return true;
  }
  return false;
}

/** The keys acting on `subject` now, in one string, so an unchanged set reads the same. */
function keysOn(subject: ShortcutSubject | undefined): string {
  if (subject === undefined) return "";
  const keys = new Set<KeyedCommand>();
  for (const target of targets) {
    if (!heldOn(target, subject)) continue;
    for (const command of target.commands) keys.add(command);
  }
  return [...keys].toSorted().join();
}

/**
 * Holds `commands` on `subject` while it is given: a place's keys, said by
 * the place that offers them, so every menu of the subject prints them.
 * `commands` is a list the place keeps, never one made on each draw.
 */
export function useShortcutTarget(
  subject: ShortcutSubject | undefined,
  commands: readonly KeyedCommand[],
): void {
  const kind = subject?.kind;
  const id = subject?.id;
  const place = subject?.place;
  // Note that the target stands before the commit paints, so a menu opened at once reads it.
  useLayoutEffect(() => {
    if (kind === undefined || id === undefined) return;
    const target: Target = { subject: { kind, id, place }, commands };
    targets.add(target);
    changed();
    return () => {
      targets.delete(target);
      changed();
    };
  }, [kind, id, place, commands]);
}

/** Draws the caller again whenever the keys acting on `subject` change: a menu built on its draw, as a row's, which prints them. */
export function useShortcutTargetOn(subject: ShortcutSubject | undefined): void {
  useSyncExternalStore(subscribe, () => keysOn(subject));
}

/** What `command`'s key acts on now, in one string, so an unchanged set reads the same. */
function subjectsOf(command: KeyedCommand): string {
  const held: string[] = [];
  for (const target of targets) {
    if (target.commands.includes(command)) held.push(target.subject.id);
  }
  return held.toSorted().join();
}

/** Draws the caller again whenever what `command`'s key acts on changes: a surface whose items all print that one key, as Copy link's ⇧⌘C. */
export function useShortcutTargetsOf(command: KeyedCommand): void {
  useSyncExternalStore(subscribe, () => subjectsOf(command));
}

/** Draws the caller again whenever any target changes: a menu standing open, whatever its items act on. */
export function useShortcutTargets(): void {
  useSyncExternalStore(subscribe, () => version);
}
