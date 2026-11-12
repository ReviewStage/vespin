import {
  entityKindName,
  entityName,
  entityOfDestination,
  type KnownNames,
  NOTHING_SAID,
} from "./entity-kind.js";
import { LINK_DESTINATION, type LinkDestination } from "./link-grammar.js";

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

  return "planId" in place ? place.planId : undefined;
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
