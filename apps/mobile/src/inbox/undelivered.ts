/**
 * undelivered.ts -- the reader's Inbox replies that did not go, kept on the phone across launches for the account that sent them, as the panel keeps them (`@repo/panel`'s `inbox-undelivered.ts`).
 *
 * What one is, its words, and which a thread draws are
 * `@repo/features/inbox-undelivered`'s. The lines are held in memory and
 * written to the app's `NSUserDefaults` through React Native's `Settings`
 * on every change, each with its account's id, and read back once at
 * launch, so a relaunch draws them again; a line is read only for the
 * account that wrote it. Note that only this module writes the key, and it
 * never reads it back after launch, since that module's copy of the
 * defaults may report an older value over a newer write
 * (`chosen-workspace.ts`). A line's files stay in memory alone, since they
 * may run to megabytes, so one a relaunch took its files from offers Edit
 * rather than Retry (`filesLost`).
 */

import {
  keptUndelivered,
  keptUndeliveredSchema,
  type UndeliveredReply,
  undeliveredFromKept,
  undeliveredSettled,
} from "@repo/features/inbox-undelivered";
import type { InboxItem } from "@repo/features/inbox-wire";
import { heldValue, useHeldValue } from "@repo/ui-native";
import { Option, Predicate, Schema } from "effect";
import { useMemo } from "react";
import { Settings } from "react-native";

/** The defaults key the lines are kept under. */
const UNDELIVERED_KEY = "inboxUndelivered";

/** One line as the phone holds it: the account that sent it, and the line. */
interface HeldLine {
  readonly accountId: string;
  readonly line: UndeliveredReply;
}

/** The lines as the defaults keep them, as JSON text. */
const keptLines = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ accountId: Schema.String, line: keptUndeliveredSchema })),
);

/** No lines, one array so an account with none hands down the same one. */
const NO_LINES: readonly UndeliveredReply[] = [];

/** The lines kept at launch, or none where none were kept or what was kept no longer reads. */
function launchLines(): readonly HeldLine[] {
  const kept: unknown = Settings.get(UNDELIVERED_KEY);

  if (!Predicate.isString(kept)) return [];

  return Option.match(Schema.decodeUnknownOption(keptLines)(kept), {
    onNone: () => [],
    onSome: (lines) =>
      lines.map(({ accountId, line }) => ({ accountId, line: undeliveredFromKept(line) })),
  });
}

/** Every line the phone holds, every account's, in the order they failed. */
const held = heldValue<readonly HeldLine[]>(launchLines());

/** Holds `next` and keeps it for the next launch. */
function keep(next: readonly HeldLine[]): void {
  held.set(next);
  const kept = next.map(({ accountId, line }) => ({ accountId, line: keptUndelivered(line) }));
  Settings.set({ [UNDELIVERED_KEY]: Schema.encodeSync(keptLines)(kept) });
}

/** Keeps `line` for `accountId`, in place of one under its key, so a reply that failed again stands where it stood. */
export function keepUndelivered(accountId: string, line: UndeliveredReply): void {
  const lines = held.read();
  const at = lines.findIndex((each) => each.line.key === line.key);

  keep(
    at === -1
      ? [...lines, { accountId, line }]
      : lines.map((each, index) => (index === at ? { accountId, line } : each)),
  );
}

/** Lets go of the line under `key`, whichever account it is. */
export function dropUndelivered(key: string): void {
  const lines = held.read();

  if (!lines.some((each) => each.line.key === key)) return;
  keep(lines.filter((each) => each.line.key !== key));
}

/** The line under `key`, where the phone holds one. */
export function undeliveredLine(key: string): UndeliveredReply | undefined {
  return held.read().find((each) => each.line.key === key)?.line;
}

/** Lets go of every line a read of `items` shows went after all (`undeliveredSettled`). */
export function settleUndelivered(items: readonly InboxItem[]): void {
  const lines = held.read();

  if (lines.length === 0) return;

  const settled = undeliveredSettled(
    lines.map((each) => each.line),
    items,
  );

  if (settled.size === 0) return;
  keep(lines.filter((each) => !settled.has(each.line.key)));
}

/** The lines `accountId` sent, in the order they failed; none while no account is known. */
export function useUndelivered(accountId: string | undefined): readonly UndeliveredReply[] {
  const lines = useHeldValue(held);

  return useMemo(() => {
    const theirs = lines.filter((each) => each.accountId === accountId).map((each) => each.line);

    return theirs.length === 0 ? NO_LINES : theirs;
  }, [lines, accountId]);
}

/** The lines on `itemId`, every account's, in the order they failed, which the thread's files are drawn from. */
export function undeliveredOnItem(itemId: string): readonly UndeliveredReply[] {
  return held
    .read()
    .filter((each) => each.line.itemId === itemId)
    .map((each) => each.line);
}
