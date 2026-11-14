/**
 * people-filter.tsx -- a Settings list's Filter by person: its glyph alone with a dot while it keeps anyone, the people it can keep under the field's heading, and the chips under the search that lift them.
 *
 * Memory files its memories under who saved them, and Cloud environment its
 * variables under who last changed them; each hands the people its list
 * names, the reader first as Me and everyone who left as one last
 * (`filterPeople`), and draws the Filter beside its search and the chips
 * under it, as the Tasks page's Filter does.
 */

import {
  BUTTON_VARIANT,
  Button,
  CHIP_LOOK,
  Chip,
  ChipName,
  CornerDot,
  GAP,
  IconButton,
  Inline,
  LIST_MOTION_WAY,
  ListMotion,
  Tooltip,
  useLeaving,
  useMenu,
} from "@repo/ui";
import { ACTOR_KIND, type Actor, actorName } from "@repo/ui/actor-model";
import { GLYPH, ListFilterIcon } from "@repo/ui/icons";
import { type ReactNode, useRef, useState } from "react";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { PEOPLE_FILTER_WORDS } from "../member-rows.js";

/** What the Filter is called, on its tooltip and its menu. */
const FILTER = "Filter";

/** The key everyone who left the workspace is filed under, together. */
export const FORMER_PEOPLE_KEY = "former";

/** What everyone who left is called in the filter. */
const FORMER_WORDS = "Former members";

/** One person the filter offers: whom it files under, their name and face, and how many the list holds of theirs. */
export interface FilterPerson {
  readonly key: string;
  readonly label: string;
  readonly face: ReactNode;
  readonly count: number;
  /** Whether the label is a member's name rather than Me or the former members' words, kept masked in a screen recording. */
  readonly named: boolean;
}

/** One entry a list files under a person: the key it is kept under, `FORMER_PEOPLE_KEY` for anyone who left, and who they are. */
export interface FiledUnder {
  readonly key: string;
  readonly actor: Actor;
}

/** The people `filed` names, the reader first as Me, then each by name, everyone who left last. */
export function filterPeople(filed: readonly FiledUnder[]): readonly FilterPerson[] {
  const byKey = new Map<string, FilterPerson>();

  for (const { key, actor } of filed) {
    const known = byKey.get(key);

    if (known !== undefined) {
      byKey.set(key, { ...known, count: known.count + 1 });
      continue;
    }

    const former = key === FORMER_PEOPLE_KEY;
    const you = actor.kind === ACTOR_KIND.PERSON && actor.you;
    const label = former ? FORMER_WORDS : you ? PEOPLE_FILTER_WORDS.ME : actorName(actor);
    const face = former ? <GLYPH.PEOPLE /> : <ActorMark actor={actor} size={ACTOR_SIZE.INLINE} />;
    byKey.set(key, { key, label, face, count: 1, named: !former && !you });
  }

  const rank = (person: FilterPerson) =>
    person.label === PEOPLE_FILTER_WORDS.ME ? 0 : person.key === FORMER_PEOPLE_KEY ? 2 : 1;

  return [...byKey.values()].sort(
    (one, other) => rank(one) - rank(other) || one.label.localeCompare(other.label),
  );
}

/** Puts `key` in the set or takes it out. */
export function toggled(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);

  if (!next.delete(key)) next.add(key);

  return next;
}

/** The filter's props: the field's name, the people it offers, those it keeps, and what keeps others. */
interface PeopleFilterProps {
  /** The field the people are filed under, "Saved by". */
  field: string;
  people: readonly FilterPerson[];
  kept: ReadonlySet<string>;
  onKept: (kept: ReadonlySet<string>) => void;
}

/** The Filter: its glyph alone, named by its tooltip, a dot at its corner while it keeps anyone, and the field its one heading, its people listed under it in the menu itself. */
export function PeopleFilter({
  field,
  people,
  kept,
  onKept,
}: PeopleFilterProps): React.JSX.Element {
  const menu = useMenu(true);

  const rows: MenuAction[] = people.map((person) => ({
    label: person.label,
    replayMasked: person.named,
    icon: <>{person.face}</>,
    detail: String(person.count),
    checked: kept.has(person.key),
    stays: true,
    onSelect: () => onKept(toggled(kept, person.key)),
  }));

  return (
    <>
      <CornerDot shown={kept.size > 0}>
        <Tooltip label={FILTER}>
          <IconButton icon={<ListFilterIcon />} label={FILTER} {...menu.trigger()} />
        </Tooltip>
      </CornerDot>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={FILTER}
          menu={menu.drawn}
          // Note that the field is the filter's one, so its people stand in the menu itself under its heading rather than behind a submenu of their own.
          heading={field}
          groups={[rows]}
          replayUnmasked
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** The person a chip stands for, by which its chip leaves. */
const personChipKey = (person: FilterPerson): string => person.key;

/** The filter's chips and Clear, a chip lifted scaling out where it stood. */
function PeopleFilterLine({
  line,
  field,
  people,
  kept,
  onKept,
}: PeopleFilterProps & { line: React.RefObject<HTMLElement | null> }): React.JSX.Element | null {
  // Note that the people are read again on every render, so the list the chips leave by is kept until another person is kept.
  const listed = people.filter((person) => kept.has(person.key));
  const [stable, setStable] = useState(listed);

  const same =
    stable.length === listed.length &&
    stable.every(
      (person, at) => person.key === listed[at]?.key && person.label === listed[at]?.label,
    );

  if (!same) setStable(listed);
  const drawn = useLeaving(same ? stable : listed, personChipKey);

  if (drawn.length === 0) return null;

  return (
    <Inline gap={GAP.TIGHT} ref={line} moves>
      {drawn.map(({ key, value: person, leaving }) => {
        const name = `${field} ${person.label === PEOPLE_FILTER_WORDS.ME ? "me" : person.label}`;

        return (
          <Chip
            key={key}
            look={CHIP_LOOK.FILTER}
            motionKey={key}
            removeLabel={`Remove filter: ${name}`}
            onRemove={() => {
              if (!leaving) onKept(toggled(kept, person.key));
            }}
          >
            {person.face}
            <ChipName>{name}</ChipName>
          </Chip>
        );
      })}
      {kept.size === 0 ? null : (
        <Button variant={BUTTON_VARIANT.QUIET} onClick={() => onKept(new Set())}>
          Clear
        </Button>
      )}
    </Inline>
  );
}

/** What the filter keeps, a chip for each person, its × lifting them, and Clear, under a motion that scales a chip in and out (`ListMotion`). */
export function PeopleFilterChips(props: PeopleFilterProps): React.JSX.Element {
  const line = useRef<HTMLElement | null>(null);

  return (
    <ListMotion root={line} way={LIST_MOTION_WAY.SCALE}>
      <PeopleFilterLine line={line} {...props} />
    </ListMotion>
  );
}
