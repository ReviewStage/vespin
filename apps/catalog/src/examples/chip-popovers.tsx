import {
  AVATAR_SIZE,
  Avatar,
  ChipPopover,
  type ChipPopoverFact,
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
 * task's followers, whose rows open a person and each teammate's ⋯ holds
 * Remove follower, with rows pinned under them: a switch, Unfollow, and Add
 * a follower's submenu of members.
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

/** A follower's row: their face, their name, a muted Assignee, a laptop where agents may use their machines, and Remove follower behind a ⋯ on a teammate who is not the assignee. */
function followerRow(id: string, name: string, assignee: boolean, machines: boolean): MenuRow {
  const removable = !assignee && id !== "ada";

  return {
    id,
    label: name,
    icon: face(id, name),
    actions: removable
      ? {
          thing: "Follower",
          rows: [{ id: "remove", label: "Remove follower" }],
          onPick: () => undefined,
        }
      : undefined,
    end: (
      <>
        {assignee ? (
          <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            Assignee
          </Text>
        ) : null}
        {machines ? <GLYPH.DESKTOP aria-label="Agents may use their machines" /> : null}
      </>
    ),
  };
}

/** The members not yet following, as Add a follower lists them. */
const NOT_FOLLOWING: readonly MenuRow[] = [
  { id: "priya", label: "Priya Shah", icon: face("priya", "Priya Shah"), detail: "priya@acme.dev" },
  {
    id: "tomas",
    label: "Tomás Silva",
    icon: face("tomas", "Tomás Silva"),
    detail: "tomas@acme.dev",
  },
];

/** A task's followers, the reader first: rows that open a person, then the reader's switch, Unfollow, and Add a follower pinned under them. */
function Followers(): React.JSX.Element {
  const [machines, setMachines] = useState(true);

  return (
    <ChipPopover
      label="Followers"
      glyph={<GLYPH.SHOW aria-hidden="true" />}
      words="Following"
      menu={{
        rows: [
          followerRow("ada", "You", true, machines),
          followerRow("manuel", "Manuel Ruiz", false, true),
          followerRow("charles", "Charles Lin", false, false),
        ],
        noMatch: "No followers",
        onPick: () => undefined,
        foot: [
          {
            id: "machines",
            label: "Let agents here use my machines",
            icon: <GLYPH.DESKTOP aria-hidden="true" />,
            toggle: { on: machines, onToggle: () => setMachines(!machines) },
          },
          {
            id: "unfollow",
            label: "Unfollow",
            icon: <GLYPH.HIDE aria-hidden="true" />,
            disabled: "You're the assignee",
          },
          {
            id: "add-follower",
            label: "Add a follower",
            icon: <GLYPH.ADD aria-hidden="true" />,
            submenu: {
              label: "Add a follower",
              rows: NOT_FOLLOWING,
              value: undefined,
              onPick: () => undefined,
              stays: true,
            },
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
        title="Rows that open a person, with row acts and pinned rows"
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
