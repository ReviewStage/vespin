/**
 * inbox-widget-model.ts -- what the iOS app's Inbox widget draws, as the app writes it for the widget to read: how many threads wait on the member in the chosen workspace, and the newest few of them.
 *
 * The widget runs in its own process with no account and no network, so the
 * app writes this snapshot into the App Group container it shares with the
 * widget and its Notification Service Extension whenever the Inbox it reads
 * moves, and the widget draws only what it holds. The count is the Inbox
 * tab's badge (`waitsOnReaderNow`), every thread that waits on the reader
 * now, a notice among them, in the workspace the phone works in; the rows
 * are the newest of those threads, latest changed first, as the Inbox lists
 * them, each with its title, its task's name, and the kind of ask that waits
 * (`INBOX_LINE`), none for a notice; beside them, the ids of every thread
 * that waits, so a push or a settle can tell a thread of this workspace from
 * another's even past the rows shown. The widget's Swift decodes the keys
 * here exactly (`InboxWidgetSnapshot.swift`), so a key renamed here is a
 * widget that stops drawing. It holds no credential, no message's words, and
 * no address but the ids a tap opens.
 */

import { Schema as EffectSchema, Option } from "effect";
import {
  INBOX_LINE,
  type InboxGroup,
  inboxAtNow,
  inboxLineKind,
  waitsOnReaderNow,
} from "./inbox-list-model.js";
import { cardTitle } from "./plain-words.js";

const INBOX_WIDGET_BOUNDS = {
  /** The most rows the snapshot holds: the medium widget's three. */
  MAX_ROWS: 3,
  /** The most waiting threads' ids it keeps; past them a settle moves the count only by a push's badge. */
  MAX_IDS: 100,
  /** The most characters of a title or a task's name it keeps, since a widget draws one line of each. */
  MAX_TITLE_CHARS: 80,
} as const;

/** The ask a row's glyph says, as the Inbox's row says it (`INBOX_LINE`); a notice says none. */
export const INBOX_WIDGET_ASK = {
  DECIDE: INBOX_LINE.DECIDE,
  DO: INBOX_LINE.DO,
  ANSWER: INBOX_LINE.ANSWER,
} as const;

const title = EffectSchema.String.check(
  EffectSchema.isMaxLength(INBOX_WIDGET_BOUNDS.MAX_TITLE_CHARS),
);

/** One thread as a row of the widget: its id, which a tap opens, its title, its task's name, and the ask that waits. */
const inboxWidgetRowSchema = EffectSchema.Struct({
  id: EffectSchema.NonEmptyString,
  title,
  task: title,
  ask: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(INBOX_WIDGET_ASK))),
});

type InboxWidgetRow = typeof inboxWidgetRowSchema.Type;

/**
 * The snapshot: the chosen workspace's name, how many threads wait on the
 * reader in it, whether that is every thread of the account's that waits
 * (`wholeAccount`, the account's only workspace), so the Notification
 * Service Extension may take a push's badge, which counts the whole
 * account, as the count, the ids of the threads that wait, and the newest
 * rows.
 */
const inboxWidgetSnapshotSchema = EffectSchema.Struct({
  workspace: EffectSchema.String,
  waiting: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0)),
  wholeAccount: EffectSchema.Boolean,
  ids: EffectSchema.Array(EffectSchema.NonEmptyString).check(
    EffectSchema.isMaxLength(INBOX_WIDGET_BOUNDS.MAX_IDS),
  ),
  rows: EffectSchema.Array(inboxWidgetRowSchema).check(
    EffectSchema.isMaxLength(INBOX_WIDGET_BOUNDS.MAX_ROWS),
  ),
});

export type InboxWidgetSnapshot = typeof inboxWidgetSnapshotSchema.Type;

/** The snapshot as the JSON text the app keeps it in. */
const snapshotJsonSchema = EffectSchema.fromJsonString(inboxWidgetSnapshotSchema);
const readSnapshotJson = EffectSchema.decodeUnknownOption(snapshotJsonSchema);

/** What the snapshot is read from: the chosen workspace's name and its Inbox, how many workspaces the account has, the reader, and the time. */
export interface InboxWidgetSource {
  readonly workspace: string;
  readonly workspaces: number;
  readonly groups: readonly InboxGroup[];
  readonly readerId: string | undefined;
  readonly now: number;
}

/** The ask a row's glyph says, or none for a notice or a thread whose line leads with no ask. */
function rowAsk(kind: ReturnType<typeof inboxLineKind>): Pick<InboxWidgetRow, "ask"> {
  const ask = Object.values(INBOX_WIDGET_ASK).find((each) => each === kind);

  return ask === undefined ? {} : { ask };
}

/** The snapshot of the Inbox as it stands for the reader at `now`. */
export function inboxWidgetSnapshot(source: InboxWidgetSource): InboxWidgetSnapshot {
  const { workspace, workspaces, groups, readerId, now } = source;

  const waiting = inboxAtNow(groups, now)
    .flatMap(({ holder, items }) => items.map((item) => ({ holder, item })))
    .filter(({ item }) => waitsOnReaderNow(item, readerId, now))
    .toSorted((a, b) => b.item.updatedAt - a.item.updatedAt);

  const clipped = (words: string) => words.slice(0, INBOX_WIDGET_BOUNDS.MAX_TITLE_CHARS);

  const rows = waiting.slice(0, INBOX_WIDGET_BOUNDS.MAX_ROWS).map(({ holder, item }) => ({
    id: item.id,
    title: clipped(cardTitle(item.title)),
    task: clipped(holder.task.name),
    ...rowAsk(inboxLineKind(item)),
  }));

  const ids = waiting.slice(0, INBOX_WIDGET_BOUNDS.MAX_IDS).map(({ item }) => item.id);

  return { workspace, waiting: waiting.length, wholeAccount: workspaces === 1, ids, rows };
}

/**
 * The snapshot once a background push says the thread `itemId` settled,
 * while the app reads no Inbox of its own: its row gone, and the count less
 * it; or the push's badge as the count where it counts the workspace's
 * threads (`wholeAccount`), since it counts the whole account's. Note that a
 * thread the snapshot holds no id of moves no count but the badge, since
 * it may be another workspace's, and the rows left never outnumber the
 * count. The Notification Service Extension moves the snapshot by the
 * alerts the same way (`InboxWidgetSnapshot.swift`'s `taking(news:)`).
 */
export function inboxWidgetAfterSettle(
  snapshot: InboxWidgetSnapshot,
  itemId: string,
  badge: number | undefined,
): InboxWidgetSnapshot {
  const held = snapshot.ids.includes(itemId);

  const waiting =
    snapshot.wholeAccount && badge !== undefined
      ? Math.max(0, Math.trunc(badge))
      : held
        ? Math.max(0, snapshot.waiting - 1)
        : snapshot.waiting;

  const ids = snapshot.ids.filter((id) => id !== itemId);
  const rows = snapshot.rows.filter((row) => row.id !== itemId).slice(0, waiting);

  return { ...snapshot, waiting, ids, rows };
}

/** The snapshot as the JSON the widget's Swift decodes. */
export function inboxWidgetSnapshotJson(snapshot: InboxWidgetSnapshot): string {
  return EffectSchema.encodeSync(snapshotJsonSchema)(snapshot);
}

/** The snapshot a JSON kept holds, or none for one this build cannot read. */
export function inboxWidgetSnapshotOf(json: string): InboxWidgetSnapshot | undefined {
  return Option.getOrUndefined(readSnapshotJson(json));
}
