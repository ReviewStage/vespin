import {
  AGENT_MACHINE,
  type AgentRunsOnRequest,
  type AgentSummary,
  agentMachineOf,
  DEVICE_STANDING,
  type DeviceStanding,
} from "@repo/features/agent-wire";
import { DEVICE_PLATFORM, type DevicePlatform } from "@repo/features/device-agent-wire";
import { devicePlatformOf } from "@repo/features/device-platform";
import { machineName, type ThisMac } from "@repo/features/machine-name";
import type { MacOffer } from "@repo/features/models-wire";
import { agentRunsOnWords, RUNS_ON_WORDS } from "@repo/features/task-agents-model";
import type { TaskRunsOnRequest } from "@repo/features/task-wire";
import {
  type WorkspaceMachineLine,
  workspaceMachineStanding,
} from "@repo/features/workspace-machine-view";
import {
  CHIP_LOOK,
  CHIP_WIDTH,
  type ChipWidth,
  GAP,
  GlyphSlot,
  Inline,
  MENU_ROW_WHY,
  type MenuRow,
  POPOVER_ALIGN,
  POPOVER_WIDTH,
  STATUS_TONE,
  StatusGlyph,
  type StatusTone,
  useSecond,
} from "@repo/ui";
import { GLYPH, ICON_SIZE } from "@repo/ui/icons";
import { ReplayWords } from "@repo/ui/session-replay-marks";
import { useQuery } from "@tanstack/react-query";
import { Schema } from "effect";
import { useState } from "react";
import { type PresenceBook, presenceStanding, useDevicePresence } from "../device-presence.js";
import { workspaceOwnedMachinesQuery } from "../live-reads.js";
import { useThisMac } from "../machine-name.js";
import { useMemberDirectory } from "../member-directory.js";
import { Picker } from "../settings/picker-row.js";
import { keptKey, useKept } from "../use-kept.js";
import { MODELS_READ, type ModelsRead } from "./use-agents.js";

/**
 * runs-on.tsx -- where a coding agent runs: the cloud, or one of the member's own devices, chosen in a start's chip and shown read-only on each agent's row.
 *
 * Each agent runs where its Start put it, for its life (`agent-wire.ts`'s
 * `agentStartRequestFields`). New task's chip names it for the task and its
 * first agent, and a draft
 * agent's box wears the same chip (`draft-agent-tab.tsx`), a fork's and a
 * continue's among them (`useStartRunsOn`). The chip, a toolbar chip ending
 * in its chevron as the model chip beside it is, drops a menu: Cloud first, then
 * each device the member registered, as the models answer lists them, by what
 * every list of machines calls it (`machine-name.ts`), This Mac among them,
 * under the glyph of its platform, a Mac or a Linux server, each saying
 * whether it is online, held against the window's own clock, or, online,
 * that it is still getting ready for local agents or couldn't set them up.
 * Every device's glyph wears one dot at its corner rather than words, whose
 * hint says them: green online, gray away, amber where its standing can't
 * be checked, the working tone while it gets ready and red where it
 * couldn't set up; one that takes no agent is dimmed and unpicked too. The
 * dot stands on the glyph rather than at the row's end, which the check of
 * the one picked keeps. The menu stands at the regular width rather than a settings
 * picker's narrow one, so a device's whole name fits. A
 * device offline or not ready is listed but not picked, since the service
 * refuses a task set to one that has not beat lately or is not set up yet.
 * New task's chip starts on the member's last pick, kept in this window, and
 * on Cloud only where nothing is kept or that device is no longer listed. A
 * kept device that is offline, as a Mac is while the app restarts on it, or
 * still getting ready or not set up, stays picked and says so, so its start
 * is refused by name rather than sent quietly to the cloud. It stands on
 * every New task but an automation's or a child's, and lists Cloud alone
 * where the member has no device (`new-task-composer.tsx`). On
 * the task, each agent's row in its plan's head says Cloud, or the device
 * that agent runs on, named the same way, or that the device was removed
 * (`overview-agents.tsx`).
 *
 * After the member's devices, under Workspace machines, stand the machines
 * the workspace owns (`LIVE_READ.WORKSPACE_MACHINES`), which every member's
 * agents may run on, each in a VM of its own: each by its name under its
 * platform's glyph wearing its standing's dot, read off its own row
 * (`workspaceMachineStanding`), since the window's presence read names the
 * member's own devices alone, and one that takes no agent now dimmed and
 * unpicked, as a device is. A pick of one is a place of its own kind
 * (`OfferedPlace`), never a device: a Start sends it as the workspace's
 * machine, and the model menu reads it as the cloud, since its agents run
 * on the starter's own credentials. A pick kept in this window that the
 * workspace no longer lists falls back to Cloud.
 */

/** The id the Cloud row is picked by, which no device's id is. */
export const CLOUD_ROW = "cloud";

/** Where New task keeps the member's last pick: Cloud's id, or a device's. */
const KEPT = { PICK: keptKey("app.newTaskRunsOn", Schema.String) } as const;

/** The cloud, as a request names it. */
const RUNS_ON_CLOUD: TaskRunsOnRequest = { machine: AGENT_MACHINE.VERCEL };

/** No machines of the workspace's, held steady for a workspace that owns none or before they are read. */
const NO_OWNED: readonly WorkspaceMachineLine[] = [];

/**
 * A place a Runs on chip offers beyond the cloud: one of the member's own
 * devices, or a machine the workspace owns, by its id and name, and as the
 * workspace's read lists it, none where that read does not, as before it
 * lands for a fork of an agent on one.
 */
export type OfferedPlace =
  | { readonly machine: typeof AGENT_MACHINE.DEVICE; readonly device: MacOffer }
  | {
      readonly machine: typeof AGENT_MACHINE.WORKSPACE;
      readonly deviceId: string;
      readonly name: string;
      readonly owned: WorkspaceMachineLine | undefined;
    };

/** The device a place picked names, none for the cloud or a workspace's machine. */
export function deviceOfPlace(place: OfferedPlace | undefined): MacOffer | undefined {
  return place?.machine === AGENT_MACHINE.DEVICE ? place.device : undefined;
}

/** The id of the device or the workspace's machine a place picked names, none for the cloud: what a press compares a later one by. */
export function placeIdOf(place: OfferedPlace | undefined): string | undefined {
  return place === undefined ? undefined : placeRowOf(place);
}

/** The id the Runs on row of a place is picked by: Cloud's, or the device's or the workspace's machine's. */
function placeRowOf(place: OfferedPlace | undefined): string {
  switch (place?.machine) {
    case undefined:
      return CLOUD_ROW;
    case AGENT_MACHINE.DEVICE:
      return place.device.deviceId;
    case AGENT_MACHINE.WORKSPACE:
      return place.deviceId;
  }
}

/** A workspace's machine as a chip offers it. */
function ownedPlace(machine: WorkspaceMachineLine): OfferedPlace {
  return {
    machine: AGENT_MACHINE.WORKSPACE,
    deviceId: machine.id,
    name: machine.name,
    owned: machine,
  };
}

/** The place a Runs on row's id names among those offered: a device of the member's, or a machine of the workspace's; none for Cloud or an id neither lists. */
function placeOfRow(
  row: string,
  devices: readonly MacOffer[],
  owned: readonly WorkspaceMachineLine[],
): OfferedPlace | undefined {
  const device = devices.find((each) => each.deviceId === row);

  if (device !== undefined) return { machine: AGENT_MACHINE.DEVICE, device };
  const machine = owned.find((each) => each.id === row);

  return machine === undefined ? undefined : ownedPlace(machine);
}

/**
 * The machines the workspace owns, which a Runs on chip offers after the
 * member's devices, followed while a chip draws them; none while they are
 * read, where the read failed, or where no workspace is named.
 */
export function useOwnedMachines(workspaceId: string | undefined): readonly WorkspaceMachineLine[] {
  return useQuery(workspaceOwnedMachinesQuery(workspaceId)).data ?? NO_OWNED;
}

/** A device's glyph by its platform (`devicePlatformOf`): a server's for Linux, a Mac's otherwise. */
export function DeviceGlyph({
  device,
}: {
  device: { readonly platform?: DevicePlatform } | undefined;
}): React.JSX.Element {
  return devicePlatformOf(device ?? {}) === DEVICE_PLATFORM.LINUX ? (
    <GLYPH.HOST />
  ) : (
    <GLYPH.DESKTOP />
  );
}

/** Where a device offered stands now; one a service before beats said nothing of is online, as it listed only those, and one the presence read does not name, though it is the account's own, is gone. */
function offerStanding(device: MacOffer, book: PresenceBook): DeviceStanding {
  return (
    presenceStanding(book, device.deviceId) ??
    (device.seenAt === undefined ? DEVICE_STANDING.ONLINE : DEVICE_STANDING.OFFLINE)
  );
}

/** What each standing is called, as a list of places and a follower's card say it. */
export const STANDING_WORDS = {
  [DEVICE_STANDING.ONLINE]: RUNS_ON_WORDS.ONLINE,
  [DEVICE_STANDING.OFFLINE]: RUNS_ON_WORDS.OFFLINE,
  [DEVICE_STANDING.UNKNOWN]: RUNS_ON_WORDS.UNKNOWN,
  [DEVICE_STANDING.CHECKING]: RUNS_ON_WORDS.CHECKING,
  [DEVICE_STANDING.SETTING_UP]: RUNS_ON_WORDS.SETTING_UP,
  [DEVICE_STANDING.FAILED]: RUNS_ON_WORDS.FAILED,
} as const satisfies Record<DeviceStanding, string>;

/** The tone of each standing's dot: green online, working while setting up, danger where it failed, gray away or still being checked, the attention tone where it cannot be checked. */
const STANDING_TONE = {
  [DEVICE_STANDING.ONLINE]: STATUS_TONE.COMPLETE,
  [DEVICE_STANDING.OFFLINE]: STATUS_TONE.NEUTRAL,
  [DEVICE_STANDING.UNKNOWN]: STATUS_TONE.ATTENTION,
  [DEVICE_STANDING.CHECKING]: STATUS_TONE.NEUTRAL,
  [DEVICE_STANDING.SETTING_UP]: STATUS_TONE.WORKING,
  [DEVICE_STANDING.FAILED]: STATUS_TONE.DANGER,
} as const satisfies Record<DeviceStanding, StatusTone>;

/** The standings that take no agent, which a list draws dimmed and unpicked; one whose standing cannot be told yet is not among them. */
const TAKES_NO_AGENT: ReadonlySet<DeviceStanding> = new Set([
  DEVICE_STANDING.OFFLINE,
  DEVICE_STANDING.SETTING_UP,
  DEVICE_STANDING.FAILED,
]);

/** Why a device offered takes no agent now: away, setting up, or failed; none for one that takes an agent, and none for one whose standing cannot be told yet, which is not called away. */
function offerUnready(device: MacOffer, book: PresenceBook): string | undefined {
  const standing = offerStanding(device, book);

  return TAKES_NO_AGENT.has(standing) ? STANDING_WORDS[standing] : undefined;
}

/** A device's platform glyph wearing its standing's dot, its words to a reader, and on a rest where `hinted`: as a list of places draws its row, and an agent's place chip the device it runs on (`agent-place.tsx`). */
export function DeviceStandingGlyph({
  device,
  standing,
  hinted = true,
}: {
  device: { readonly platform?: DevicePlatform } | undefined;
  standing: DeviceStanding;
  /** Whether a rest on the glyph shows its words; false where the control it stands in says them. */
  hinted?: boolean;
}): React.JSX.Element {
  return (
    <StatusGlyph tone={STANDING_TONE[standing]} label={STANDING_WORDS[standing]} hinted={hinted}>
      <DeviceGlyph device={device} />
    </StatusGlyph>
  );
}

type DeviceMarkResult = { readonly icon: React.JSX.Element; readonly unready: string | undefined };

/** A device as a list of places draws it: its platform's glyph wearing one dot, its words on hover and to a reader, and why it takes no agent now, none where it does. */
export function deviceMark(device: MacOffer, book: PresenceBook): DeviceMarkResult {
  const icon = <DeviceStandingGlyph device={device} standing={offerStanding(device, book)} />;

  return { icon, unready: offerUnready(device, book) };
}

/** A device's row past its name, for every device alike (`deviceMark`); one that takes no agent is dimmed and unpicked too, its dot saying why. */
function offerMarks(
  device: MacOffer,
  book: PresenceBook,
): Pick<MenuRow, "icon" | "disabled" | "why"> {
  const { icon, unready } = deviceMark(device, book);

  return unready === undefined ? { icon } : { icon, disabled: unready, why: MENU_ROW_WHY.MARK };
}

/** A workspace's machine as a list of places draws it: its platform's glyph wearing its standing's dot, read off its own row, and why it takes no agent now, none where it does. */
export function ownedMark(machine: WorkspaceMachineLine): DeviceMarkResult {
  const standing = workspaceMachineStanding(machine);
  const icon = <DeviceStandingGlyph device={machine} standing={standing} />;

  return { icon, unready: TAKES_NO_AGENT.has(standing) ? STANDING_WORDS[standing] : undefined };
}

/** A workspace's machine's row past its name (`ownedMark`); one that takes no agent is dimmed and unpicked too, its dot saying why. */
function ownedMarks(machine: WorkspaceMachineLine): Pick<MenuRow, "icon" | "disabled" | "why"> {
  const { icon, unready } = ownedMark(machine);

  return unready === undefined ? { icon } : { icon, disabled: unready, why: MENU_ROW_WHY.MARK };
}

/**
 * Cloud, then each device by what the list calls it, its platform's glyph
 * wearing its standing's dot, one that takes no agent muted and unpicked,
 * then under Workspace machines each machine the workspace owns, drawn the
 * same way; an agent's place chip lists the same (`agent-place.tsx`).
 */
export function runsOnRows(
  devices: readonly MacOffer[],
  book: PresenceBook,
  thisMac: ThisMac,
  owned: readonly WorkspaceMachineLine[] = NO_OWNED,
): readonly MenuRow[] {
  return [
    { id: CLOUD_ROW, label: RUNS_ON_WORDS.CLOUD, icon: <GLYPH.CLOUD /> },
    ...devices.map(
      (device): MenuRow => ({
        id: device.deviceId,
        label: machineName(device, devices, thisMac),
        ...offerMarks(device, book),
      }),
    ),
    ...owned.map(
      (machine): MenuRow => ({
        id: machine.id,
        label: machine.name,
        section: RUNS_ON_WORDS.WORKSPACE_MACHINES,
        replayMasked: true,
        ...ownedMarks(machine),
      }),
    ),
  ];
}

/**
 * New task's pick, starting on the member's last where that device, or that
 * machine of the workspace's, is listed, ready or not, else Cloud, and kept
 * as it changes. Answers the place picked, none for the cloud, the setter,
 * and whether the pick kept is a device or a machine, listed or not, which a
 * start waits on the devices' read for.
 * Note that an offline device, or one still getting ready, stays picked
 * rather than falling back to Cloud, because a task's Runs on is fixed as it
 * starts, and one sent to the cloud while its Mac was away for a moment could
 * never be moved back.
 */
export function useNewTaskRunsOn(
  devices: readonly MacOffer[],
  owned: readonly WorkspaceMachineLine[] = NO_OWNED,
): readonly [OfferedPlace | undefined, (row: string | undefined) => void, boolean] {
  const [kept, keep] = useKept(KEPT.PICK, CLOUD_ROW);

  return [
    placeOfRow(kept, devices, owned),
    (row: string | undefined) => keep(row ?? CLOUD_ROW),
    kept !== CLOUD_ROW,
  ];
}

/** Where an agent runs, by the id its Runs on row is picked by: Cloud's, or its device's or its workspace's machine's; none for one on a machine the service no longer names. */
function placeRow(agent: Pick<AgentSummary, "machine" | "mac">): string | undefined {
  switch (agentMachineOf(agent)) {
    case AGENT_MACHINE.VERCEL:
      return CLOUD_ROW;
    case AGENT_MACHINE.DEVICE:
    case AGENT_MACHINE.WORKSPACE:
      return agent.mac?.deviceId;
  }
}

/** A Start's place by its Runs on row's id: the cloud, a machine of the workspace's where `owned` lists it, or else the device it names. */
export function rowRequest(
  row: string,
  owned: readonly WorkspaceMachineLine[] = NO_OWNED,
): AgentRunsOnRequest {
  if (row === CLOUD_ROW) return RUNS_ON_CLOUD;

  return owned.some((machine) => machine.id === row)
    ? { machine: AGENT_MACHINE.WORKSPACE, deviceId: row }
    : { machine: AGENT_MACHINE.DEVICE, deviceId: row };
}

/** What a draft's Runs on starts on before a pick: where its source runs, else the member's newest agent on the task. */
interface StartPlaceSeed {
  /** The agent a fork or a continue starts from, whose place it keeps unless picked otherwise. */
  readonly source: Pick<AgentSummary, "machine" | "mac"> | undefined;
  /** The task's agents, archived ones among them, of which the member's newest decides. */
  readonly agents: readonly Pick<AgentSummary, "machine" | "mac" | "createdAt" | "startedBy">[];
  /** The signed-in member, whose agents alone decide, since a device is one member's. */
  readonly me: string | undefined;
}

/**
 * A draft agent's Runs on: the place `picked` names, else the one the
 * service gives a Start naming none (`machineOfStart`) as far as the window
 * can tell it, where the source runs for a fork or a continue, else where
 * the member's newest agent on the task runs, else the member's last pick
 * kept in this window, which a pick here keeps too, else Cloud. Answers the
 * place it shows, none for the cloud, and the setter, which hands `onPick` the place picked. Note that the last pick is
 * this window's, while the service keeps the account's (`runs-on-pick.ts`),
 * so a pick made in another window, or a task's own place where no pick was
 * ever made, can run an untouched draft elsewhere than its chip says; a
 * Start sends a place only once one is picked, so the service still decides
 * the rest. A default device the member's list does not name, a teammate's
 * a fork's source runs on, or one before the list is read, is named as the
 * agent it came from names it, rather than said to be Cloud, as is a
 * workspace's machine before the workspace's machines are read.
 */
export function useStartRunsOn(
  devices: readonly MacOffer[],
  picked: AgentRunsOnRequest | undefined,
  seed: StartPlaceSeed,
  onPick: (runsOn: AgentRunsOnRequest) => void,
  owned: readonly WorkspaceMachineLine[] = NO_OWNED,
): readonly [OfferedPlace | undefined, (row: string | undefined) => void] {
  const [kept, keep] = useKept(KEPT.PICK, CLOUD_ROW);

  const newest = seed.agents
    .filter((agent) => seed.me !== undefined && agent.startedBy?.userId === seed.me)
    .reduce<(typeof seed.agents)[number] | undefined>(
      (was, agent) => (was === undefined || agent.createdAt > was.createdAt ? agent : was),
      undefined,
    );

  const seeded = seed.source ?? newest;

  const row =
    picked === undefined
      ? ((seeded === undefined ? undefined : placeRow(seeded)) ?? kept)
      : picked.machine === AGENT_MACHINE.VERCEL
        ? CLOUD_ROW
        : picked.deviceId;

  return [
    placeOfRow(row, devices, owned) ?? unlistedSeed(picked === undefined ? seeded : undefined, row),
    (chosen: string | undefined) => {
      const pickedRow = chosen ?? CLOUD_ROW;
      keep(pickedRow);
      onPick(rowRequest(pickedRow, owned));
    },
  ];
}

/**
 * The place a draft's source or the member's newest agent runs on where no
 * list names it yet, as the agent names it, by its name alone: a device as
 * an offer of no model, its standing unread, or a workspace's machine not
 * yet read; none where the seed runs elsewhere than `row`.
 */
function unlistedSeed(
  seeded: Pick<AgentSummary, "machine" | "mac"> | undefined,
  row: string,
): OfferedPlace | undefined {
  const mac = seeded?.mac;

  if (seeded === undefined || mac === undefined || mac.deviceId !== row) return undefined;

  switch (agentMachineOf(seeded)) {
    case AGENT_MACHINE.VERCEL:
      return undefined;
    case AGENT_MACHINE.DEVICE:
      return {
        machine: AGENT_MACHINE.DEVICE,
        device: { deviceId: row, name: mac.name, providers: [] },
      };
    case AGENT_MACHINE.WORKSPACE:
      return { machine: AGENT_MACHINE.WORKSPACE, deviceId: row, name: mac.name, owned: undefined };
  }
}

/** What New task's chip says of the device picked, by what the list calls it: that alone while it takes an agent, and why it does not, or that its standing cannot be told, otherwise. */
function offerStateWords(device: MacOffer, book: PresenceBook, name: string): string {
  const unready = offerUnready(device, book);

  if (unready !== undefined) return `${name} · ${unready}`;
  const standing = offerStanding(device, book);

  return standing === DEVICE_STANDING.ONLINE ? name : `${name} · ${STANDING_WORDS[standing]}`;
}

/** Whether a start waits on the member's devices: still unread since the card opened, and whether that read failed. */
interface DevicesRead {
  readonly unread: boolean;
  readonly failed: boolean;
}

/**
 * Whether a start waits on the devices' read, where `held` (the member's
 * last pick is a device): until a read made since the card opened lands,
 * since a start before then would name none. Note that a pick of the cloud,
 * every member's with no device among them, holds nothing, because a start
 * before the read runs in the cloud as the pick would after it; that a list
 * read before the card opened does not count, because it may be one read
 * before a device was added, and a failed read leaves it standing; and that
 * a read is told by the generation it took, never by its list, which a read
 * listing the same devices hands back as it was. A card opens on the
 * generation standing as it mounts, or, for one that stays mounted between
 * openings, on `openedOn`, the generation its opening read before it asked
 * the devices again, since that ask takes the next generation at once.
 */
export function useDevicesRead(
  modelsRead: ModelsRead,
  held: boolean,
  openedOn?: number,
): DevicesRead {
  const [mountedOn] = useState(modelsRead.generation);
  // The opening a read since has landed for, which a later read failing does not take back.
  const [landedFor, setLandedFor] = useState<number | undefined>(undefined);
  const since = openedOn ?? mountedOn;
  const readSince = modelsRead.generation > since;
  const landed = landedFor === since || (readSince && modelsRead.state === MODELS_READ.READ);

  if (landed && landedFor !== since) setLandedFor(since);
  const unread = held && !landed;

  return { unread, failed: unread && readSince && modelsRead.state === MODELS_READ.FAILED };
}

/** What a start sends of New task's pick: the device or the workspace's machine it names, or the cloud. */
export function newTaskRunsOn(place: OfferedPlace | undefined): TaskRunsOnRequest {
  switch (place?.machine) {
    case undefined:
      return RUNS_ON_CLOUD;
    case AGENT_MACHINE.DEVICE:
      return { machine: AGENT_MACHINE.DEVICE, deviceId: place.device.deviceId };
    case AGENT_MACHINE.WORKSPACE:
      return { machine: AGENT_MACHINE.WORKSPACE, deviceId: place.deviceId };
  }
}

/** What New task's chip says of a workspace's machine picked: its name alone while it takes an agent, and why it does not otherwise; its name alone before the workspace's machines are read. */
function ownedStateWords(place: Extract<OfferedPlace, { machine: "workspace" }>): string {
  if (place.owned === undefined) return place.name;
  const standing = workspaceMachineStanding(place.owned);

  return standing === DEVICE_STANDING.ONLINE
    ? place.name
    : `${place.name} · ${STANDING_WORDS[standing]}`;
}

/** New task's Runs on chip: Cloud, the device, or the workspace's machine picked, its glyph alone in a card too narrow for its words, dropping the menu. */
export function NewTaskRunsOnChip({
  devices,
  owned = NO_OWNED,
  place,
  disabled,
  narrow,
  look = CHIP_LOOK.TOOLBAR,
  width = CHIP_WIDTH.AUTO,
  onChoose,
}: {
  devices: readonly MacOffer[];
  /** The machines the workspace owns, offered after the member's devices. */
  owned?: readonly WorkspaceMachineLine[] | undefined;
  place: OfferedPlace | undefined;
  disabled: boolean;
  /** The chip's look: a composer's toolbar chip, or a form row's field. */
  look?: typeof CHIP_LOOK.FIELD | typeof CHIP_LOOK.TOOLBAR;
  /** How wide the chip stands; its words' own width where none is named. */
  width?: ChipWidth;
  /** Whether the card is too narrow for its words, so it draws its glyph alone. */
  narrow: boolean;
  onChoose: (row: string | undefined) => void;
}): React.JSX.Element {
  // Note that the clock only redraws the chip as a beat ages, since the standing is read off the book's own monotonic clock.
  useSecond();
  // Note that a chip offering Cloud alone reads no beats, because it draws no device.
  const book = useDevicePresence(devices.length > 0);
  const thisMac = useThisMac();

  return (
    <Picker
      label={RUNS_ON_WORDS.LABEL}
      value={placeRowOf(place)}
      valueLabel={placeWords(place, book, devices, thisMac)}
      valueReplayMasked={place?.machine === AGENT_MACHINE.WORKSPACE}
      valueIcon={placeIcon(place)}
      iconOnly={narrow}
      rows={runsOnRows(devices, book, thisMac, owned)}
      noMatch={RUNS_ON_WORDS.NO_MATCH}
      align={POPOVER_ALIGN.START}
      width={width}
      look={look}
      chevron
      menuWidth={POPOVER_WIDTH.REGULAR}
      disabled={disabled}
      onPick={(id) => onChoose(id === CLOUD_ROW ? undefined : id)}
    />
  );
}

/** What New task's chip says of the place picked: Cloud, or the device's or the workspace's machine's name and, where it takes no agent now, why. */
function placeWords(
  place: OfferedPlace | undefined,
  book: PresenceBook,
  devices: readonly MacOffer[],
  thisMac: ThisMac,
): string {
  switch (place?.machine) {
    case undefined:
      return RUNS_ON_WORDS.CLOUD;
    case AGENT_MACHINE.DEVICE:
      return offerStateWords(place.device, book, machineName(place.device, devices, thisMac));
    case AGENT_MACHINE.WORKSPACE:
      return ownedStateWords(place);
  }
}

/** The glyph New task's chip wears for the place picked: the cloud's, or the platform's of the device or the workspace's machine. */
function placeIcon(place: OfferedPlace | undefined): React.JSX.Element {
  switch (place?.machine) {
    case undefined:
      return <GLYPH.CLOUD />;
    case AGENT_MACHINE.DEVICE:
      return <DeviceGlyph device={place.device} />;
    case AGENT_MACHINE.WORKSPACE:
      return <DeviceGlyph device={place.owned} />;
  }
}

/**
 * Where an agent runs, as its row says it: the cloud's glyph and Cloud, or
 * the device's glyph by its platform, where the member's devices list it,
 * and what every list of machines calls it, or that the device was removed;
 * or the workspace's machine's glyph by its platform, where the
 * workspace's read of its machines lists it, a Linux server's otherwise, and
 * its name, or that it was removed. Note that it is the agent's own, read
 * off its summary, since each agent is placed as it starts.
 */
export function RunsOnPlace({
  agent,
  devices,
}: {
  agent: Pick<AgentSummary, "machine" | "mac">;
  /** The member's devices, which give a device's platform; a teammate's device is drawn as a Mac. */
  devices: readonly MacOffer[] | undefined;
}): React.JSX.Element {
  const thisMac = useThisMac();
  const { mac } = agent;
  const machine = agentMachineOf(agent);
  // Note that the workspace's machines are the directory's around the row, read only for an agent on one.
  const { workspaceId } = useMemberDirectory();
  const owned = useOwnedMachines(machine === AGENT_MACHINE.WORKSPACE ? workspaceId : undefined);

  // Note that the agent names its device alone, so This Mac is told by its device and no name is twinned.
  const words = agentRunsOnWords(agent, (named) =>
    machineName({ deviceId: named.deviceId, name: named.name }, [], thisMac),
  );

  const placed = (each: { readonly id: string } | { readonly deviceId: string }) =>
    mac?.deviceId !== undefined && ("id" in each ? each.id : each.deviceId) === mac.deviceId;

  const glyph = (() => {
    switch (machine) {
      case AGENT_MACHINE.VERCEL:
        return <GLYPH.CLOUD />;
      case AGENT_MACHINE.DEVICE:
        return <DeviceGlyph device={devices?.find(placed)} />;
      case AGENT_MACHINE.WORKSPACE:
        return (
          <DeviceGlyph
            device={{ platform: owned.find(placed)?.platform ?? DEVICE_PLATFORM.LINUX }}
          />
        );
    }
  })();

  return (
    <Inline gap={GAP.ICON} wrap={false}>
      <GlyphSlot size={ICON_SIZE.SMALL}>{glyph}</GlyphSlot>
      {/* Note that a machine is named as its owner or its admins named it, so only Cloud and a removed one show. */}
      <span>
        <ReplayWords unmasked={machine === AGENT_MACHINE.VERCEL || mac === undefined}>
          {words}
        </ReplayWords>
      </span>
    </Inline>
  );
}
