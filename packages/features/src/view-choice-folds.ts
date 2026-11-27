/**
 * view-choice-folds.ts -- a press on one of the account's lists of folds (the sidebar's folded groups and sections, the tasks it opened), held until the account's own list is read, so a press never writes over folds it has not read.
 *
 * Each such list is one view choice, kept whole (`view-choice-wire.ts`), so
 * a press made before the device read the account's list would write a list
 * of that press alone over every fold another device kept. A press is
 * therefore one id folded in or out (`FoldPress`), laid over the list the
 * account keeps once it is read (`foldsToWrite`), and drawn meanwhile over
 * none (`foldsPressed`).
 */

/** One id folded in or out of a list of folds: a group folded, a section folded, a task opened. */
export interface FoldPress<Id> {
  readonly id: Id;
  readonly on: boolean;
}

/** `ids` with each press laid over it in turn: an id pressed on stands last, one pressed off is gone. */
export function foldsPressed<Id>(
  ids: readonly Id[],
  presses: readonly FoldPress<Id>[],
): readonly Id[] {
  return presses.reduce<readonly Id[]>((folds, { id, on }) => {
    const without = folds.filter((each) => each !== id);

    return on ? [...without, id] : without;
  }, ids);
}

/**
 * The list to write for `presses`: laid over the account's `saved` list
 * where it is read (`answered`), and none while it is not, the presses
 * waiting for it, since a list written then would stand over every fold the
 * account keeps.
 */
export function foldsToWrite<Id>(
  read: { readonly answered: boolean; readonly saved: readonly Id[] },
  presses: readonly FoldPress<Id>[],
): readonly Id[] | undefined {
  if (!read.answered || presses.length === 0) return undefined;

  return foldsPressed(read.saved, presses);
}
