import {
  AVATAR_SIZE,
  Avatar,
  ChipPopover,
  type ChipPopoverFact,
  MENU_ROW_WHY,
  type MenuRow,
  STATUS_TONE,
  StatusGlyph,
  type StatusTone,
  StatusWords,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * chip-popovers.tsx -- a toolbar chip whose press opens a popover of facts:
 * a cloud sandbox off, booting, and running, its state on the chip's dot
 * and in the popover's Status, one with a menu section under the facts,
 * the places to move its agent to, and one with no title and no facts, a
 * task's followers as a checklist: a press adds or removes someone, the
 * other members listed only once something is searched, and the reader's
 * switch pinned under them.
 */

const STATES = [
  { id: "off", words: "Off", tone: STATUS_TONE.NEUTRAL },
  { id: "booting", words: "Booting", tone: STATUS_TONE.STARTING },
  { id: "running", words: "Running", tone: STATUS_TONE.COMPLETE },
] as const satisfies readonly { id: string; words: string; tone: StatusTone }[];

/** A sandbox's facts in a state: its status, its processors, and its memory. */
function sandboxFacts(words: string, tone: StatusTone): readonly ChipPopoverFact[] {
  return [
    {
      label: "Status",
      icon: <GLYPH.SANDBOX_STATE aria-hidden="true" />,
      value: <StatusWords tone={tone}>{words}</StatusWords>,
    },
    { label: "CPU", icon: <GLYPH.CPU aria-hidden="true" />, value: "4 vCPUs" },
    { label: "Memory", icon: <GLYPH.RAM aria-hidden="true" />, value: "8 GB" },
  ];
}

/** The cloud glyph wearing the state's dot. */
function cloudGlyph(words: string, tone: StatusTone): React.JSX.Element {
  return (
    <StatusGlyph tone={tone} label={words} hinted={false}>
      <GLYPH.CLOUD aria-hidden="true" />
    </StatusGlyph>
  );
}

const PLACES: readonly MenuRow[] = [
  { id: "cloud", label: "Cloud", icon: cloudGlyph("Running", STATUS_TONE.COMPLETE) },
  { id: "studio", label: "MacBook Pro", icon: <GLYPH.DESKTOP aria-hidden="true" /> },
  {
    id: "mini",
    label: "Mac mini",
    icon: <GLYPH.DESKTOP aria-hidden="true" />,
    detail: "Offline",
  },
];

/** The chip with Move to, its place kept in the cloud: a pick moves an agent elsewhere, which no example does. */
function WithMoveTo(): React.JSX.Element {
  return (
    <ChipPopover
      label="Runs on"
      glyph={cloudGlyph("Running", STATUS_TONE.COMPLETE)}
      words="Cloud"
      said="Running"
      title="Cloud sandbox"
      facts={sandboxFacts("Running", STATUS_TONE.COMPLETE)}
      menu={{
        heading: "Move to",
        rows: PLACES,
        value: "cloud",
        noMatch: "No places",
        onPick: () => undefined,
      }}
    />
  );
}

/** A person's face at a menu row's size. */
function face(id: string, name: string): React.JSX.Element {
  return <Avatar id={id} name={name} size={AVATAR_SIZE.INLINE} decorative />;
}

/** The workspace's members, the reader first, the assignee and whose machines agents may use marked. */
const MEMBERS = [
  { id: "ada", name: "You", assignee: true, machines: true },
  { id: "manuel", name: "Manuel Ruiz", assignee: false, machines: true },
  { id: "charles", name: "Charles Lin", assignee: false, machines: false },
  { id: "priya", name: "Priya Shah", assignee: false, machines: false },
  { id: "tomas", name: "Tomás Silva", assignee: false, machines: false },
] as const;

/** A member's row: their face, their name, and at its end a muted Assignee and a laptop where agents may use their machines; the assignee dimmed. */
function memberRow(member: (typeof MEMBERS)[number]): MenuRow {
  return {
    id: member.id,
    label: member.name,
    icon: face(member.id, member.name),
    end: (
      <>
        {member.assignee ? (
          <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            Assignee
          </Text>
        ) : null}
        {member.machines ? <GLYPH.DESKTOP aria-label="Agents may use their machines" /> : null}
      </>
    ),
    ...(member.assignee ? { disabled: "You're the assignee", why: MENU_ROW_WHY.MARK } : undefined),
  };
}

/** A task's followers as a checklist: followers checked, the rest found by a search, a press adding or removing one, and the reader's switch pinned under them. */
function Followers(): React.JSX.Element {
  const [machines, setMachines] = useState(true);

  const [following, setFollowing] = useState<ReadonlySet<string>>(
    new Set(["ada", "manuel", "charles"]),
  );

  // Note that anyone pressed stays listed, unchecked where removed, as the task page keeps them until its popover closes.
  const [listed, setListed] = useState<ReadonlySet<string>>(following);

  const toggle = (id: string) => {
    setListed((now) => new Set([...now, id]));
    setFollowing((now) => {
      const next = new Set(now);

      if (!next.delete(id)) next.add(id);

      return next;
    });
  };

  return (
    <ChipPopover
      label="Followers"
      glyph={<GLYPH.SHOW aria-hidden="true" />}
      words="Following"
      menu={{
        rows: MEMBERS.map((member) => ({
          ...memberRow(member),
          searchOnly: !listed.has(member.id),
        })),
        checked: following,
        placeholder: "Add or remove followers",
        noMatch: "No one matches",
        onPick: toggle,
        foot: [
          {
            id: "machines",
            label: "Let agents here use my machines",
            icon: <GLYPH.DESKTOP aria-hidden="true" />,
            toggle: { on: machines, onToggle: () => setMachines(!machines) },
          },
        ],
      }}
    />
  );
}

function ChipPopovers(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="chip-popover-states" title="A cloud sandbox in each state">
        <div className="catalog-glyph-line catalog-chip-popover-stage">
          {STATES.map((state) => (
            <ChipPopover
              key={state.id}
              label="Runs on"
              glyph={cloudGlyph(state.words, state.tone)}
              words="Cloud"
              said={state.words}
              title="Cloud sandbox"
              facts={sandboxFacts(state.words, state.tone)}
            />
          ))}
        </div>
      </CatalogSection>
      <CatalogSection id="chip-popover-menu" title="With a menu section under the facts">
        <div className="catalog-glyph-line catalog-chip-popover-stage">
          <WithMoveTo />
        </div>
      </CatalogSection>
      <CatalogSection
        id="chip-popover-rows"
        title="A checklist found by a search, with a pinned row"
      >
        <div className="catalog-glyph-line catalog-chip-popover-stage">
          <Followers />
        </div>
      </CatalogSection>
    </>
  );
}

export const CHIP_POPOVERS_EXAMPLE: Example = {
  id: "chip-popovers",
  title: "Chip popovers",
  Render: ChipPopovers,
};
