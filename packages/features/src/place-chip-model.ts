import {
  type Entity,
  entityKindName,
  entityName,
  entityOfDestination,
  type KnownNames,
  NOTHING_SAID,
} from "./entity-kind.js";
import {
  LINK_DESTINATION,
  type LinkDestination,
  type ReadLink,
  readLink,
  taskNumberOf,
  withTaskId,
} from "./link-grammar.js";
import { bareAddressesIn, type NumberedTaskIdOf } from "./mention-link.js";

/**
 * place-chip-model.ts -- a link of ours drawn in words as its chip says it: the name of the place it opens, as the window already knows it, and the task it stands under.
 *
 * A link to a place in the app an agent or a teammate writes bare, an agent's
 * or a page's address say, is drawn as a chip (the desktop's `mention-chip.tsx`), and the
 * chip is named from what the window already holds: the task's title, the
 * page's, the agent's, the Inbox item's, the member's, the automation's.
 * Nothing is read for it but an automation's, whose chip reads its
 * workspace's automations, so a place the window holds no name for, an agent
 * the window does not hold, is called by its kind until it does.
 * A plan, a page, an agent, an Inbox item, an automation, or a person is
 * called by the name the window holds for it now even where its link was
 * labeled, since the
 * label is the name it had when it was written and the card beside the chip
 * says the name now; the label stands in only where the window holds none,
 * or holds the plan Untitled. Any other place someone labeled keeps the
 * words they gave it. The card under it says the task the place stands
 * under, where the window knows the task.
 */

/** What a chip says of a place: its name, and the task it stands under where that is known and is not the place itself. */
export interface PlaceChipLook {
  readonly name: string;
  readonly under: string | undefined;
}

/** The task a place stands under, by its id, where it stands under one and is not the task itself. */
function taskOf(place: LinkDestination): string | undefined {
  if (place.kind === LINK_DESTINATION.TASK || place.kind === LINK_DESTINATION.VERSION)
    return undefined;

  return "taskId" in place ? place.taskId : undefined;
}

/**
 * What a chip says of the place a link of ours opens: for an entity named live
 * (`ENTITY_NAME`), the name the window holds for it, else the words it was
 * labeled with; for any other, the words first, then the name held; else
 * its kind; and the task it stands under, by the name the window holds for it.
 */
export function placeChipLook(
  place: LinkDestination,
  label: string | undefined,
  known: KnownNames,
): PlaceChipLook {
  const taskId = taskOf(place);
  const under = taskId === undefined ? undefined : known.tasks.get(taskId);
  const entity = entityOfDestination(place);
  const { live, held } = entityName(entity, known, NOTHING_SAID);
  const name = (live ? (held ?? label) : (label ?? held)) ?? entityKindName(entity.kind);

  return { name, under };
}

/**
 * What a chip drawn from words says once the client finds the entity it
 * names among what it holds, as `placeChipLook` reads a place: the name
 * held where the entity is named live, or where the link was written bare;
 * else `shown`, the name the words gave it, which also stands where the
 * client holds no name of it yet: one still read, one the reader may not
 * open, or one deleted.
 */
export function heldChipName(
  entity: Entity,
  shown: string,
  bare: boolean,
  known: KnownNames,
): string {
  const { live, held } = entityName(entity, known, NOTHING_SAID);

  if (held === undefined) return shown;

  return live || bare ? held : shown;
}

/** What a client holds to name a place of ours in plain words: the names it holds now, and the id of a task a link names by its number, where it lists one. */
export interface PlainLinkNames {
  readonly known: KnownNames;
  readonly taskIdOf: NumberedTaskIdOf;
}

/** The place a link opens, a task it names by its number named by the id the client found for it, where it found one. */
function foundPlace(link: ReadLink, taskIdOf: NumberedTaskIdOf): LinkDestination {
  const number = taskNumberOf(link.place);

  if (number === undefined) return link.place;
  const taskId = taskIdOf({ workspace: link.workspace, number });

  return taskId === undefined ? link.place : withTaskId(link.place, taskId);
}

/** Every place of ours the words spell bare, in the order they stand, which a client reads the names of before it says the words (`namedPlainLinks`). */
export function placesSpelledIn(words: string): readonly ReadLink[] {
  return bareAddressesIn(words).flatMap((link) => {
    const read = readLink(link.target);

    return read === undefined ? [] : [read];
  });
}

/**
 * Plain words, as a line too short to draw a chip reads them, a row's
 * preview or a title, with each place of ours an address spells bare said
 * by the name its chip shows (`placeChipLook`): the name the client holds
 * now, a task named by its number found by its id first, and its kind
 * ("Task") where the client holds none, as for a task it does not list, one
 * the reader may not open, or one deleted. Every other address stays as
 * written, since only a chip of ours is drawn by a name.
 */
export function namedPlainLinks(words: string, names: PlainLinkNames): string {
  let said = "";
  let from = 0;

  for (const link of bareAddressesIn(words)) {
    const read = readLink(link.target);

    if (read === undefined) continue;
    const place = foundPlace(read, names.taskIdOf);
    said += words.slice(from, link.start) + placeChipLook(place, undefined, names.known).name;
    from = link.end;
  }

  return said + words.slice(from);
}
