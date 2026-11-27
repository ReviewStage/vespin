import {
  AGENT_MACHINE,
  type AgentRunsOnRequest,
  type AgentSummary,
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
import {
  hashKey,
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useAccountKey } from "../account-choices.js";
import { type PresenceBook, presenceStanding, useDevicePresence } from "../device-presence.js";
import { accountPreferencesQuery, accountPreferencesRetryMutation } from "../live-reads.js";
import { useThisMac } from "../machine-name.js";
import { QUERY_ROOT } from "../query-keys.js";
import { Picker } from "../settings/picker-row.js";
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
 * New task's chip starts on the member's last pick, the place the account's
 * last Start named, which the service keeps (`runs-on-pick.ts`) and every
 * client follows on the account's preferences, and on Cloud only where no
 * Start named one or that device is no longer listed. A pick made in this
 * window draws on every chip of it at once, until the account's pick moves
 * from where it was made, by a Start here or on another device. A
 * picked device that is offline, as a Mac is while the app restarts on it, or
 * still getting ready or not set up, stays picked and says so, so its start
 * is refused by name rather than sent quietly to the cloud. It stands on
 * every New task but an automation's or a child's, and lists Cloud alone
 * where the member has no device (`new-task-composer.tsx`). On
 * the task, each agent's row in its plan's head says Cloud, or the device
 * that agent runs on, named the same way, or that the device was removed
 * (`overview-agents.tsx`).
 */

/** The id the Cloud row is picked by, which no device's id is. */
export const CLOUD_ROW = "cloud";

/** The cloud, as a request names it. */
const RUNS_ON_CLOUD: TaskRunsOnRequest = { machine: AGENT_MACHINE.VERCEL };

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

/** Cloud, then each device by what the list calls it, its platform's glyph wearing its standing's dot, one that takes no agent muted and unpicked; an agent's place chip lists the same (`agent-place.tsx`). */
export function runsOnRows(
  devices: readonly MacOffer[],
  book: PresenceBook,
  thisMac: ThisMac,
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
  ];
}

/** A pick made in this window: the row picked, and the account's pick it was made over, which it stands over only while the account's stays there. */
interface WindowPick {
  readonly over: string;
  readonly row: string;
}

/**
 * This window's pick, held in the window's Query client, so every chip of
 * the window draws it and it lives as long as the window does. Note that
 * nothing is fetched: a pick is laid here as it is made, and none stands
 * until one is.
 */
const windowPickQuery = queryOptions({
  queryKey: [QUERY_ROOT.RUNS_ON_PICK],
  queryFn: (): WindowPick | null => null,
  staleTime: Infinity,
  gcTime: Infinity,
});

/** A place's Runs on row: Cloud's id, or its device's. */
function requestRow(runsOn: AgentRunsOnRequest): string {
  return runsOn.machine === AGENT_MACHINE.DEVICE ? runsOn.deviceId : CLOUD_ROW;
}

/** The account's last pick as a Runs on row: Cloud's id where no Start named a place. */
function accountRow(stored: AgentRunsOnRequest | undefined): string {
  return stored === undefined ? CLOUD_ROW : requestRow(stored);
}

/**
 * Lets `pick` go once the account's pick moves from the one it was made
 * over: a Start here moves it to what was picked, and one on another device
 * is newer. Note that it is let go for good, heard on the window's Query
 * cache whether or not a chip is drawn, because a later move back to where
 * it was made must not bring an older pick back over a newer Start.
 */
function expireOnMove(
  queries: QueryClient,
  preferences: ReturnType<typeof accountPreferencesQuery>,
  pick: WindowPick,
): void {
  const hash = hashKey(preferences.queryKey);

  const stop = queries.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.query.queryHash !== hash) return;
    const read = queries.getQueryData(preferences.queryKey);

    if (read === undefined) return;
    const moved = accountRow(read.runsOn);

    if (moved === pick.over) return;
    stop();
    // Note that the pick standing is read by what it was made over, never by identity, because the cache shares structure and may hold a copy of it.
    const standing = queries.getQueryData(windowPickQuery.queryKey);

    if (standing !== undefined && standing !== null && standing.over !== moved) {
      queries.setQueryData(windowPickQuery.queryKey, null);
    }
  });
}

/** The member's last pick as a Runs on row, and the door that picks another, with whether the account's is unread or could not be read, and Try again on it. */
interface LastPick {
  readonly row: string;
  readonly choose: (row: string) => void;
  /** Whether the account's pick is not read, still out or failed, which a start waits on, since it may name a device. */
  readonly unread: boolean;
  /** Whether the account's pick could not be read, which a card says with Retry. */
  readonly failed: boolean;
  readonly retry: () => void;
}

/**
 * The member's last pick: this window's, where one was made over the
 * account's pick as it stands, else the account's, else Cloud. A window's
 * pick gives way for good once the account's moves (`expireOnMove`).
 */
function useLastPick(): LastPick {
  const preferencesRead = accountPreferencesQuery(useAccountKey());
  const preferences = useQuery(preferencesRead);
  const account = accountRow(preferences.data?.runsOn);
  const queries = useQueryClient();
  const mine = useQuery(windowPickQuery).data;
  const { mutate: retry } = useMutation(accountPreferencesRetryMutation());

  const choose = useCallback(
    (row: string) => {
      const pick: WindowPick = { over: account, row };
      queries.setQueryData(windowPickQuery.queryKey, pick);
      expireOnMove(queries, preferencesRead, pick);
    },
    [queries, account, preferencesRead],
  );

  // Note that a read that failed before it ever answered holds a start as one still out does, since the pick it would have named may be a device.
  const failed = preferences.data === undefined && preferences.isError;

  return {
    row: mine?.over === account ? mine.row : account,
    choose,
    unread: preferences.isLoading || failed,
    failed,
    retry: () => retry(),
  };
}

/** New task's pick and the door that changes it, with what a start waits on. */
export interface NewTaskRunsOn {
  /** The device picked; none for the cloud, or a device no longer listed. */
  readonly device: MacOffer | undefined;
  readonly choose: (deviceId: string | undefined) => void;
  /** Whether the pick is a device, listed or not, which a start waits on the devices' read for. */
  readonly onDevice: boolean;
  /** Whether the account's last pick is not read, still out or failed, which a start waits on, since it may name a device. */
  readonly unread: boolean;
  /** Whether the account's last pick could not be read, which a card says with Retry. */
  readonly failed: boolean;
  /** Try again on the account's last pick. */
  readonly retry: () => void;
}

/**
 * New task's pick, starting on the member's last where that device is
 * listed, ready or not, else Cloud (`useLastPick`). Note that an offline
 * device, or one still getting ready, stays picked rather than falling back
 * to Cloud, because a task's Runs on is fixed as it starts, and one sent to
 * the cloud while its Mac was away for a moment could never be moved back;
 * and a start waits on the account's pick for the same reason.
 */
export function useNewTaskRunsOn(devices: readonly MacOffer[]): NewTaskRunsOn {
  const last = useLastPick();

  return {
    device: devices.find((each) => each.deviceId === last.row),
    choose: (deviceId: string | undefined) => last.choose(deviceId ?? CLOUD_ROW),
    onDevice: last.row !== CLOUD_ROW,
    unread: last.unread,
    failed: last.failed,
    retry: last.retry,
  };
}

/** Where an agent runs, by the id its Runs on row is picked by: Cloud's, or its device's; none for one on a device the service no longer names. */
function placeRow(agent: Pick<AgentSummary, "machine" | "mac">): string | undefined {
  return agent.machine === AGENT_MACHINE.DEVICE ? agent.mac?.deviceId : CLOUD_ROW;
}

/** A Start's place by its Runs on row's id: the cloud, or the device it names. */
export function rowRequest(row: string): AgentRunsOnRequest {
  return row === CLOUD_ROW ? RUNS_ON_CLOUD : { machine: AGENT_MACHINE.DEVICE, deviceId: row };
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
 * (`useLastPick`), which a pick here makes too, else Cloud. Answers the
 * device it shows, none for the cloud, and the setter, which hands `onPick`
 * the place picked. Note that a pick made in this window stands over the
 * account's until a Start, so an untouched draft can run elsewhere than its
 * chip says; a Start sends a place only once one is picked, so the service
 * still decides the rest. A default device the member's list does not name, a teammate's
 * a fork's source runs on, or one before the list is read, is named as the
 * agent it came from names it, rather than said to be Cloud.
 */
export function useStartRunsOn(
  devices: readonly MacOffer[],
  picked: AgentRunsOnRequest | undefined,
  seed: StartPlaceSeed,
  onPick: (runsOn: AgentRunsOnRequest) => void,
): readonly [MacOffer | undefined, (deviceId: string | undefined) => void] {
  const last = useLastPick();

  const newest = seed.agents
    .filter((agent) => seed.me !== undefined && agent.startedBy?.userId === seed.me)
    .reduce<(typeof seed.agents)[number] | undefined>(
      (was, agent) => (was === undefined || agent.createdAt > was.createdAt ? agent : was),
      undefined,
    );

  const seeded = seed.source ?? newest;

  const row =
    picked === undefined
      ? ((seeded === undefined ? undefined : placeRow(seeded)) ?? last.row)
      : requestRow(picked);

  // Note that the agent names its device by its name alone, so it stands as an offer of no model, its standing unread.
  const unlisted =
    picked === undefined && seeded?.mac?.deviceId !== undefined && seeded.mac.deviceId === row
      ? { deviceId: row, name: seeded.mac.name, providers: [] }
      : undefined;

  return [
    devices.find((each) => each.deviceId === row) ?? unlisted,
    (deviceId: string | undefined) => {
      const chosen = deviceId ?? CLOUD_ROW;
      last.choose(chosen);
      onPick(rowRequest(chosen));
    },
  ];
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

/** What a start sends of New task's pick: the device it names, or the cloud. */
export function newTaskRunsOn(device: MacOffer | undefined): TaskRunsOnRequest {
  return device === undefined
    ? RUNS_ON_CLOUD
    : { machine: AGENT_MACHINE.DEVICE, deviceId: device.deviceId };
}

/** New task's Runs on chip: Cloud or the device picked, its glyph alone in a card too narrow for its words, dropping the menu. */
export function NewTaskRunsOnChip({
  devices,
  device,
  disabled,
  narrow,
  look = CHIP_LOOK.TOOLBAR,
  width = CHIP_WIDTH.AUTO,
  onChoose,
}: {
  devices: readonly MacOffer[];
  device: MacOffer | undefined;
  disabled: boolean;
  /** The chip's look: a composer's toolbar chip, or a form row's field. */
  look?: typeof CHIP_LOOK.FIELD | typeof CHIP_LOOK.TOOLBAR;
  /** How wide the chip stands; its words' own width where none is named. */
  width?: ChipWidth;
  /** Whether the card is too narrow for its words, so it draws its glyph alone. */
  narrow: boolean;
  onChoose: (deviceId: string | undefined) => void;
}): React.JSX.Element {
  // Note that the clock only redraws the chip as a beat ages, since the standing is read off the book's own monotonic clock.
  useSecond();
  // Note that a chip offering Cloud alone reads no beats, because it draws no device.
  const book = useDevicePresence(devices.length > 0);
  const thisMac = useThisMac();

  return (
    <Picker
      label={RUNS_ON_WORDS.LABEL}
      value={device?.deviceId ?? CLOUD_ROW}
      valueLabel={
        device === undefined
          ? RUNS_ON_WORDS.CLOUD
          : offerStateWords(device, book, machineName(device, devices, thisMac))
      }
      valueIcon={device === undefined ? <GLYPH.CLOUD /> : <DeviceGlyph device={device} />}
      iconOnly={narrow}
      rows={runsOnRows(devices, book, thisMac)}
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

/**
 * Where an agent runs, as its row says it: the cloud's glyph and Cloud, or
 * the device's glyph by its platform, where the member's devices list it,
 * and what every list of machines calls it, or that the device was removed.
 * Note that it is the agent's own, read off its summary, since each agent
 * is placed as it starts.
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
  const cloud = agent.machine !== AGENT_MACHINE.DEVICE;

  // Note that the agent names its device alone, so This Mac is told by its device and no name is twinned.
  const words = agentRunsOnWords(agent, (named) =>
    machineName({ deviceId: named.deviceId, name: named.name }, [], thisMac),
  );

  const device = devices?.find(
    (each) => mac?.deviceId !== undefined && each.deviceId === mac.deviceId,
  );

  return (
    <Inline gap={GAP.ICON} wrap={false}>
      <GlyphSlot size={ICON_SIZE.SMALL}>
        {cloud ? <GLYPH.CLOUD /> : <DeviceGlyph device={device} />}
      </GlyphSlot>
      {/* Note that a device is named as its owner named it, so only Cloud and a removed device show, a teammate's device among the masked though the member's own list names it not. */}
      <span>
        <ReplayWords unmasked={cloud || mac === undefined}>{words}</ReplayWords>
      </span>
    </Inline>
  );
}
