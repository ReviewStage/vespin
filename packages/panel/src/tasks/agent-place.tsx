import {
  AGENT_MACHINE,
  type AgentSummary,
  DEVICE_STANDING,
  type DeviceStanding,
} from "@repo/features/agent-wire";
import { sandboxMemoryGb } from "@repo/features/sandbox-size";
import { RUNS_ON_WORDS } from "@repo/features/task-agents-model";
import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import {
  CHIP_LOOK,
  CHIP_WIDTH,
  ChipName,
  ChipPopover,
  type ChipPopoverFact,
  type ChipPopoverMenu,
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  type MenuRow,
  POPOVER_ALIGN,
  POPOVER_WIDTH,
  STATUS_TONE,
  StaticChip,
  Tooltip,
  useSecond,
  VisuallyHidden,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import type { ReactNode } from "react";
import { presenceStanding, useDevicePresence } from "../device-presence.js";
import { machineName, useThisMac } from "../machine-name.js";
import { useOpenSettings } from "../open-settings.js";
import { Picker } from "../settings/picker-row.js";
import type { PlaceMove } from "./move-agent.js";
import { CLOUD_ROW, DeviceGlyph, DeviceStandingGlyph, rowRequest, runsOnRows } from "./runs-on.js";
import {
  SANDBOX_STATE_WORDS,
  SandboxStateGlyph,
  SandboxStateWords,
  useSandboxState,
} from "./sandbox-place.js";

/**
 * agent-place.tsx -- the chip an agent's message box wears saying where the agent runs: its device by name, or the cloud.
 *
 * It is a start's Runs on chip as the agent keeps it (`runs-on.tsx`): the
 * same toolbar chip, the same glyph by the device's platform, and the same
 * name every list of machines gives it (`machine-name.ts`), This Mac among
 * them, so an agent reads alike before and after it starts.
 *
 * An agent in a sandbox says "Cloud" alone beside the cloud glyph, which
 * wears a dot for where its sandbox stands, and a press opens its popover:
 * the sandbox's status and size, and where a move is offered
 * (`move-agent.tsx`'s `useMovePlace`), the places to move it to (`CloudChip`).
 *
 * An agent on a device is the move control where a move is offered, ending
 * in its chevron and dropping the places to move it to (`PlaceMenuChip`),
 * and otherwise ends in no chevron and takes no press (`StaticChip`). Either
 * way a rest on it, or a tap under a finger, hangs a card saying where the
 * agent runs and whether the device is online, and a reader hears "Runs
 * on:" before its words.
 *
 * While a device has not beaten lately, asleep or with the app closed,
 * judged from how long ago the service says it last beat, the label adds
 * that it is offline ("Charles's MacBook Pro · Offline"), as the Runs on
 * chips do, its glyph in the attention tone, since the agent's messages
 * wait for it to come back. The glyph wears the device's standing dot, as
 * its row in the menu of places does (`runs-on.tsx`'s
 * `DeviceStandingGlyph`), so the chip and the row it checks read alike. The beat comes from the window's shared presence
 * read (`device-presence.ts`), so a device that keeps beating never reads
 * offline for want of a read; where that read fails and the beat held is
 * old, the label says it cannot check rather than that the device is away.
 * A device the read does not name is a teammate's, which the window cannot
 * speak for, so its label is its name alone. Nothing is drawn for an agent
 * on a device the service no longer names, since it is neither in the cloud
 * nor anywhere that can be named. In a box too narrow for its words, the
 * chip draws its glyph alone in a square and keeps the words for a reader.
 */

/** What a reader hears before the name, which the glyph says to the eye. */
const RUNS_ON = "Runs on: ";

/** What a device the label names is said to be, where it is not simply there. */
const STANDING_WORDS = {
  [DEVICE_STANDING.OFFLINE]: RUNS_ON_WORDS.OFFLINE,
  [DEVICE_STANDING.UNKNOWN]: RUNS_ON_WORDS.UNKNOWN,
  [DEVICE_STANDING.SETTING_UP]: RUNS_ON_WORDS.SETTING_UP,
  [DEVICE_STANDING.FAILED]: RUNS_ON_WORDS.FAILED,
} as const;

/** The label's words, by where the device stands. */
function macWords(name: string, standing: DeviceStanding | undefined): string {
  if (standing === undefined || standing === DEVICE_STANDING.ONLINE) return name;

  if (standing === DEVICE_STANDING.CHECKING) return name;

  return `${name} · ${STANDING_WORDS[standing]}`;
}

/** What the card says under its head of an agent on a device. */
const DEVICE_NOTE = "This agent runs on this device. Set when it was started.";

/** What a Cloud chip's popover says: its title, its facts' labels, and its menu's heading. */
const CLOUD_WORDS = {
  TITLE: "Cloud sandbox",
  STATUS: "Status",
  CPU: "CPU",
  MEMORY: "Memory",
  MOVE_TO: "Move to",
} as const;

/** A cloud agent's facts: its sandbox's state, and where the service says it, its size. */
function cloudFacts(
  state: ReturnType<typeof useSandboxState>,
  vcpus: number | undefined,
): readonly ChipPopoverFact[] {
  const status: ChipPopoverFact = {
    label: CLOUD_WORDS.STATUS,
    icon: <GLYPH.SANDBOX_STATE aria-hidden="true" />,
    value: <SandboxStateWords state={state} />,
  };

  if (vcpus === undefined) return [status];

  return [
    status,
    { label: CLOUD_WORDS.CPU, icon: <GLYPH.CPU aria-hidden="true" />, value: `${vcpus} vCPUs` },
    {
      label: CLOUD_WORDS.MEMORY,
      icon: <GLYPH.RAM aria-hidden="true" />,
      value: `${sandboxMemoryGb(vcpus)} GB`,
    },
  ];
}

/**
 * A cloud agent's chip: the cloud glyph wearing its sandbox's dot, neutral
 * while off, starting while it boots, and complete while it runs
 * (`sandbox-place.tsx`), beside "Cloud" alone, the state said to a reader
 * and in the popover, never in a hint on the chip. A press opens its
 * popover (`@repo/ui`'s `ChipPopover`), headed "Cloud sandbox": the sandbox's Status, CPU, and Memory, and where a
 * move is offered, the places to move the agent to under "Move to", as the
 * move control lists them (`useMoveMenu`), its own Cloud row wearing the
 * chip's dot as each device's row wears its own.
 */
function CloudChip({
  sandbox,
  vcpus,
  move,
  narrow,
}: {
  sandbox: AgentSummary["sandbox"];
  /** The vCPUs its sandbox opens with, which the popover names with their memory; none from a service older than it. */
  vcpus: number | undefined;
  move: PlaceMove | undefined;
  narrow: boolean;
}): React.JSX.Element {
  const state = useSandboxState(sandbox);
  const menu = useMoveMenu(CLOUD_ROW, move);
  const stateWords = SANDBOX_STATE_WORDS[state];
  const glyph = <SandboxStateGlyph state={state} />;

  const moveMenu =
    menu === undefined
      ? undefined
      : {
          heading: CLOUD_WORDS.MOVE_TO,
          ...menu,
          rows: menu.rows.map((row) => (row.id === CLOUD_ROW ? { ...row, icon: glyph } : row)),
        };

  return (
    <ChipPopover
      label={RUNS_ON_WORDS.LABEL}
      glyph={glyph}
      words={RUNS_ON_WORDS.CLOUD}
      said={stateWords}
      iconOnly={narrow}
      title={CLOUD_WORDS.TITLE}
      facts={cloudFacts(state, vcpus)}
      menu={moveMenu}
    />
  );
}

export function AgentPlace({
  agent,
  move,
  narrow = false,
}: {
  agent: Pick<AgentSummary, "id" | "mac" | "machine" | "sandbox" | "sandboxVcpus">;
  /** The move the chip offers, which drops its menu of places (`move-agent.tsx`'s `useMovePlace`); none where it takes no press. */
  move?: PlaceMove | undefined;
  /** Whether the box is too narrow for the chip's words, so it draws its glyph alone. */
  narrow?: boolean;
}): React.JSX.Element | null {
  if (agent.machine !== AGENT_MACHINE.DEVICE) {
    return (
      <CloudChip sandbox={agent.sandbox} vcpus={agent.sandboxVcpus} move={move} narrow={narrow} />
    );
  }

  if (agent.mac === undefined) return null;

  return <MacChip mac={agent.mac} move={move} narrow={narrow} />;
}

/** The id of the row that opens Settings › Machines, which no place's id is. */
const SET_UP_ROW = "set-up-a-host";

/** What the row says that sends a member with no device to add one. */
const SET_UP_WORDS = { LABEL: "Set up a Mac", DETAIL: "Settings › Machines" } as const;

/**
 * The places a move offers, as a start's Runs on lists them
 * (`runs-on.tsx`'s `runsOnRows`): the agent's own checked, each other
 * saying what a move there does where it says anything
 * (`PlaceMove.detail`): that the agent is stopped first while it writes,
 * and that only pushed work comes along from a device; and, where the
 * member has no device, a row opening Settings › Hosts to add one; and
 * what a pick does: another place moves the agent there, its own does
 * nothing. None where no move is offered, which reads no presence.
 */
function useMoveMenu(
  here: string | undefined,
  move: PlaceMove | undefined,
): Omit<ChipPopoverMenu, "heading"> | undefined {
  const listed = move === undefined || (here === undefined && move.pushedOnly) ? [] : move.devices;
  const book = useDevicePresence(listed.length > 0);
  const thisMac = useThisMac();
  const openSettings = useOpenSettings();

  if (move === undefined) return undefined;

  const places = runsOnRows(listed, book, thisMac).map(
    (row): MenuRow =>
      row.id === here || move.detail === undefined ? row : { detail: move.detail, ...row },
  );

  const setUp: readonly MenuRow[] =
    move.devices.length > 0
      ? []
      : [
          {
            id: SET_UP_ROW,
            label: SET_UP_WORDS.LABEL,
            icon: <DeviceGlyph device={undefined} />,
            detail: SET_UP_WORDS.DETAIL,
          },
        ];

  return {
    rows: [...places, ...setUp],
    value: here,
    noMatch: RUNS_ON_WORDS.NO_MATCH,
    onPick: (id) => {
      if (id === SET_UP_ROW) return openSettings({ page: SETTINGS_VIEW.HOSTS });

      if (id !== here) move.moveTo(rowRequest(id));
    },
  };
}

/**
 * The chip as the move control: a toolbar picker ending in its chevron, its
 * menu the places a move offers (`useMoveMenu`). Its card stands as the
 * static chip's does while the menu is shut. Note that an offline
 * device keeps no attention tone here, since a picker takes none; its words
 * still say it is offline.
 */
function PlaceMenuChip({
  here,
  glyph,
  words,
  card,
  move,
  narrow,
}: {
  /** The agent's own place's row: its device's; none for a device the service no longer names, which lists the cloud alone. */
  here: string | undefined;
  glyph: ReactNode;
  words: string;
  card: ReactNode;
  move: PlaceMove;
  narrow: boolean;
}): React.JSX.Element {
  const menu = useMoveMenu(here, move);

  return (
    <Picker
      label={RUNS_ON_WORDS.LABEL}
      value={here}
      valueLabel={words}
      valueIcon={glyph}
      iconOnly={narrow}
      rows={menu?.rows ?? []}
      noMatch={RUNS_ON_WORDS.NO_MATCH}
      hint={`${RUNS_ON}${words}`}
      card={card}
      align={POPOVER_ALIGN.START}
      width={CHIP_WIDTH.AUTO}
      look={CHIP_LOOK.TOOLBAR}
      chevron
      menuWidth={POPOVER_WIDTH.REGULAR}
      onPick={(id) => menu?.onPick(id)}
    />
  );
}

/** The chip and its card: the glyph, the words a reader hears after "Runs on:", and the card's head and note; the move control where a move is offered (`PlaceMenuChip`). */
function PlaceChip({
  here,
  glyph,
  words,
  sub,
  note,
  quiet = true,
  move,
  narrow,
}: {
  here: string | undefined;
  glyph: ReactNode;
  words: string;
  sub: string | undefined;
  note: string;
  quiet?: boolean;
  move: PlaceMove | undefined;
  narrow: boolean;
}): React.JSX.Element {
  const card = (
    <HoverCard>
      <HoverCardHead glyph={glyph} name={words} sub={sub} />
      <HoverCardNote>{note}</HoverCardNote>
    </HoverCard>
  );

  if (move !== undefined) {
    return (
      <PlaceMenuChip
        here={here}
        glyph={glyph}
        words={words}
        card={card}
        move={move}
        narrow={narrow}
      />
    );
  }

  return (
    <Tooltip label={`${RUNS_ON}${words}`} card={card}>
      <StaticChip tone={quiet ? undefined : STATUS_TONE.ATTENTION} iconOnly={narrow}>
        {glyph}
        <VisuallyHidden>{RUNS_ON}</VisuallyHidden>
        <ChipName>{words}</ChipName>
      </StaticChip>
    </Tooltip>
  );
}

/** The chip of an agent on a device, held against the window's clock, so a Mac that goes quiet reads offline without another read. */
function MacChip({
  mac,
  move,
  narrow,
}: {
  mac: NonNullable<AgentSummary["mac"]>;
  move: PlaceMove | undefined;
  narrow: boolean;
}): React.JSX.Element {
  const presence = useDevicePresence(true);
  const thisMac = useThisMac();
  // Note that the clock only redraws the label as a beat ages, since the standing is read off the book's own monotonic clock.
  useSecond();
  const standing = presenceStanding(presence, mac.deviceId);

  const quiet =
    standing === undefined ||
    standing === DEVICE_STANDING.ONLINE ||
    standing === DEVICE_STANDING.CHECKING;

  const name = machineName({ deviceId: mac.deviceId, name: mac.name }, [], thisMac);
  // Note that the platform is read off the move's list, because the agent's own record names none.
  const listed = move?.devices.find((device) => device.deviceId === mac.deviceId);

  return (
    <PlaceChip
      here={mac.deviceId}
      move={move}
      glyph={
        standing === undefined ? (
          <DeviceGlyph device={listed} />
        ) : (
          <DeviceStandingGlyph device={listed} standing={standing} hinted={false} />
        )
      }
      words={macWords(name, standing)}
      sub={standing === DEVICE_STANDING.ONLINE ? RUNS_ON_WORDS.ONLINE : undefined}
      note={DEVICE_NOTE}
      quiet={quiet}
      narrow={narrow}
    />
  );
}
