import { AGENT_TOOL } from "@repo/features/agent-tools";
import {
  AGENT_MACHINE,
  type AgentSummary,
  DEVICE_STANDING,
  type DeviceStanding,
} from "@repo/features/agent-wire";
import { RUNS_ON_WORDS } from "@repo/features/task-agents-model";
import { RUN_ON_MAC_REASON_WORDS } from "@repo/features/workspace-tools-model";
import {
  MAC_COMMAND_MODE_LABEL,
  MAC_COMMAND_MODE_LIST,
  MAC_COMMANDS_LABEL,
  type MacCommandMode,
} from "@repo/settings";
import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import {
  CHIP_LOOK,
  CHIP_WIDTH,
  CHOICE_BAR_LOOK,
  CHOICE_BAR_SIZE,
  ChipName,
  ChoiceBar,
  type ChoiceItem,
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  HoverCardRow,
  HoverCardRule,
  type MenuRow,
  POPOVER_ALIGN,
  POPOVER_WIDTH,
  STATUS_TONE,
  StaticChip,
  StatusGlyph,
  Tooltip,
  useSecond,
  VisuallyHidden,
} from "@repo/ui";
import { type Actor, actorName, personActor } from "@repo/ui/actor-model";
import { GLYPH } from "@repo/ui/icons";
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useId } from "react";
import { settingMutation } from "../act-mutations.js";
import { ActorLine, ActorRef } from "../actor-ref.js";
import { presenceStanding, useDevicePresence } from "../device-presence.js";
import { machineName, useThisMac } from "../machine-name.js";
import { useMemberDirectory } from "../member-directory.js";
import { useOpenSettings } from "../open-settings.js";
import { Picker } from "../settings/picker-row.js";
import { MOVE_WORDS, type PlaceMove } from "./move-agent.js";
import { type RunOnMacRead, useRunOnMac } from "./run-on-mac.js";
import { CLOUD_ROW, DeviceGlyph, rowRequest, runsOnRows } from "./runs-on.js";

/**
 * agent-place.tsx -- the chip an agent's message box wears saying where the agent runs: its device by name, or the cloud.
 *
 * It is a start's Runs on chip as the agent keeps it (`runs-on.tsx`): the
 * same toolbar chip, the same glyph by the device's platform, and the same
 * name every list of machines gives it (`machine-name.ts`), This Mac among
 * them, so an agent reads alike before and after it starts. Where a move is
 * offered (`move-agent.tsx`'s `useMovePlace`), it is the move control,
 * ending in its chevron and dropping the places to move the agent to
 * (`PlaceMenuChip`); otherwise it ends in no chevron and takes no press
 * (`StaticChip`). Either way a rest on it, or a tap under a finger,
 * hangs a card saying where the agent runs and whether the
 * device is online, and a reader hears "Runs on:" before its words. An
 * agent in a sandbox says "Cloud" beside the cloud glyph, and its card names
 * under a rule whose Mac its `run_on_mac` runs shell commands on, the task's
 * assignee's or else its starter's, by their person chip, its glyph wearing
 * a dot for how it stands: online, offline, or off in this
 * Mac's Settings (`run-on-mac.ts`), which a reader hears after "Cloud".
 *
 * While a device has not beaten lately, asleep or with the app closed,
 * judged from how long ago the service says it last beat, the label adds
 * that it is offline ("Charles's MacBook Pro · Offline"), as the Runs on
 * chips do, its glyph in the attention tone, since the agent's messages
 * wait for it to come back. The beat comes from the window's shared presence
 * read (`device-presence.ts`), so a device that keeps beating never reads
 * offline for want of a read; where that read fails and the beat held is
 * old, the label says it cannot check rather than that the device is away.
 * A device the read does not name is a teammate's, which the window cannot
 * speak for, so its label is its name alone. Nothing is drawn for an agent
 * on a device the service no longer names, since it is neither in the cloud
 * nor anywhere that can be named. In a box too narrow for its words, the
 * chip draws its glyph alone in a square and keeps the words for a reader and its hint.
 */

/** What a reader hears before the name, which the glyph says to the eye. */
const RUNS_ON = "Runs on: ";

/** What the card adds where the chip moves the agent, since its note says the place was set as it started. */
const MOVE_NOTE = "Pick another place to move it there: a new agent goes on from its conversation.";

/** The label's words, by where the device stands. */
function macWords(name: string, standing: DeviceStanding | undefined): string {
  if (standing === undefined || standing === DEVICE_STANDING.ONLINE) return name;
  if (standing === DEVICE_STANDING.CHECKING) return name;
  return standing === DEVICE_STANDING.OFFLINE
    ? `${name} · Offline`
    : `${name} · Can't check status`;
}

/** This Mac's command setting's choices, as Settings › This Mac words them. */
const MAC_COMMAND_CHOICES: readonly ChoiceItem<MacCommandMode>[] = MAC_COMMAND_MODE_LIST.map(
  (mode) => ({ value: mode, label: MAC_COMMAND_MODE_LABEL[mode] }),
);

/** What the card says under its head of the agent, in the cloud or on a device. */
const SHARED_NOTE = {
  CLOUD: "This agent runs in a cloud sandbox. Set when it was started.",
  DEVICE: "This agent runs on this device. Set when it was started.",
} as const;

/** How the Mac the agent's `run_on_mac` runs on stands, in the words its dot says: Online, Offline, or Off in Settings. */
function runOnMacStands(read: RunOnMacRead): string {
  return read.reason === undefined ? RUNS_ON_WORDS.ONLINE : RUN_ON_MAC_REASON_WORDS[read.reason];
}

/**
 * A cloud agent's chip, whose card names under a rule the Mac its
 * `run_on_mac` runs shell commands on, drawn as the Runs on menu draws a
 * device: the Mac's glyph wearing its standing's dot, green while it
 * listens and gray while it is offline or off in Settings, beside
 * "run_on_mac" and its owner's person chip, "You" for the reader. Where it
 * is the reader's own Mac and the window reads on one, this Mac's command
 * setting stands under it as Settings › This Mac offers it (Ask every time,
 * Always allow, Never), changed there and then. The chip takes no focus, so
 * a reader hears the same after "Cloud". Note that the
 * Mac is named by its owner, since any of their Macs that listens runs the
 * commands; nothing is said while it is read, or for an agent offered none.
 */
function CloudChip({
  agentId,
  readerId,
  move,
  narrow,
}: {
  agentId: string;
  readerId: string | undefined;
  move: PlaceMove | undefined;
  narrow: boolean;
}): React.JSX.Element {
  const read = useRunOnMac(agentId, (userId) => userId === readerId);
  const { members, former } = useMemberDirectory();
  const { mutate: writeSetting } = useMutation(settingMutation());
  const owner: Actor | undefined =
    read.standing === undefined
      ? undefined
      : personActor(read.standing.owner, members, readerId, former);
  const stands = runOnMacStands(read);
  return (
    <PlaceChip
      here={CLOUD_ROW}
      move={move}
      glyph={<GLYPH.CLOUD aria-hidden="true" />}
      words={RUNS_ON_WORDS.CLOUD}
      sub={undefined}
      note={SHARED_NOTE.CLOUD}
      said={
        owner === undefined
          ? undefined
          : `, ${AGENT_TOOL.RUN_ON_MAC} on ${actorName(owner, { sentence: true, possessive: true })} Mac, ${stands}`
      }
      more={
        owner === undefined ? undefined : (
          <>
            <HoverCardRule />
            <HoverCardRow
              glyph={
                <StatusGlyph
                  tone={read.reason === undefined ? STATUS_TONE.COMPLETE : STATUS_TONE.NEUTRAL}
                  label={stands}
                >
                  <DeviceGlyph device={undefined} />
                </StatusGlyph>
              }
              label={
                <ActorLine>
                  {`${AGENT_TOOL.RUN_ON_MAC} `}
                  <ActorRef actor={owner} />
                </ActorLine>
              }
            />
            {read.mode !== undefined && read.standing?.owner.userId === readerId ? (
              <ChoiceBar<MacCommandMode>
                label={MAC_COMMANDS_LABEL}
                items={MAC_COMMAND_CHOICES}
                value={read.mode}
                look={CHOICE_BAR_LOOK.SEGMENTED}
                size={CHOICE_BAR_SIZE.COMPACT}
                stretch
                onChange={(mode) => writeSetting({ field: "macCommands", value: mode })}
              />
            ) : null}
          </>
        )
      }
      narrow={narrow}
    />
  );
}

export function AgentPlace({
  agent,
  readerId,
  move,
  narrow = false,
}: {
  agent: Pick<AgentSummary, "id" | "mac" | "machine">;
  /** The reader's account, whose own Mac the card calls "Your Mac". */
  readerId: string | undefined;
  /** The move the chip offers, which drops its menu of places (`move-agent.tsx`'s `useMovePlace`); none where it takes no press. */
  move?: PlaceMove | undefined;
  /** Whether the box is too narrow for the chip's words, so it draws its glyph alone. */
  narrow?: boolean;
}): React.JSX.Element | null {
  if (agent.machine !== AGENT_MACHINE.DEVICE) {
    return <CloudChip agentId={agent.id} readerId={readerId} move={move} narrow={narrow} />;
  }
  if (agent.mac === undefined) return null;
  return <MacChip mac={agent.mac} move={move} narrow={narrow} />;
}

/** The id of the row that opens Settings › Hosts, which no place's id is. */
const SET_UP_ROW = "set-up-a-host";

/** What the row says that sends a member with no device to add one. */
const SET_UP_WORDS = { LABEL: "Set up a Mac", DETAIL: "Settings › Hosts" } as const;

/**
 * The chip as the move control: a toolbar picker ending in its chevron, its
 * menu the places a start's Runs on lists (`runs-on.tsx`'s `runsOnRows`),
 * the agent's own checked, each other saying only pushed work comes along
 * where the agent runs on a device, and, where the member has no device, a
 * row opening Settings › Hosts to add one. Picking another place moves the
 * agent there; picking its own does nothing. Its card stands as the static
 * chip's does while the menu is shut, and what the static chip says to a
 * reader after its words describes the picker. Note that an offline device
 * keeps no attention tone here, since a picker takes none; its words still
 * say it is offline.
 */
function PlaceMenuChip({
  here,
  glyph,
  words,
  card,
  said,
  move,
  narrow,
}: {
  /** The agent's own place's row: Cloud's, or its device's; none for a device the service no longer names, which lists the cloud alone. */
  here: string | undefined;
  glyph: ReactNode;
  words: string;
  card: ReactNode;
  said: string | undefined;
  move: PlaceMove;
  narrow: boolean;
}): React.JSX.Element {
  const saidId = useId();
  const listed = here === undefined && move.pushedOnly ? [] : move.devices;
  const book = useDevicePresence(listed.length > 0);
  const thisMac = useThisMac();
  const openSettings = useOpenSettings();
  const places = runsOnRows(listed, book, thisMac).map(
    (row): MenuRow =>
      row.id === here || !move.pushedOnly ? row : { detail: MOVE_WORDS.PUSHED_ONLY, ...row },
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
  return (
    <>
      {said === undefined ? null : <VisuallyHidden id={saidId}>{said}</VisuallyHidden>}
      <Picker
        label={RUNS_ON_WORDS.LABEL}
        describedBy={said === undefined ? undefined : saidId}
        value={here}
        valueLabel={words}
        valueIcon={glyph}
        iconOnly={narrow}
        rows={[...places, ...setUp]}
        noMatch={RUNS_ON_WORDS.NO_MATCH}
        hint={`${RUNS_ON}${words}`}
        card={card}
        align={POPOVER_ALIGN.START}
        width={CHIP_WIDTH.AUTO}
        look={CHIP_LOOK.TOOLBAR}
        chevron
        menuWidth={POPOVER_WIDTH.REGULAR}
        onPick={(id) => {
          if (id === SET_UP_ROW) return openSettings({ page: SETTINGS_VIEW.HOSTS });
          if (id !== here) move.moveTo(rowRequest(id));
        }}
      />
    </>
  );
}

/** The chip and its card: the glyph, the words a reader hears after "Runs on:", and the card's head and note; the move control where a move is offered (`PlaceMenuChip`). */
function PlaceChip({
  here,
  glyph,
  words,
  sub,
  note,
  said,
  more,
  quiet = true,
  move,
  narrow,
}: {
  here: string | undefined;
  glyph: ReactNode;
  words: string;
  sub: string | undefined;
  note: string;
  /** What a reader hears after the words, which the card says to the eye; none where it says nothing more. */
  said?: string | undefined;
  /** What the card lists after its note, where it lists anything. */
  more?: ReactNode;
  quiet?: boolean;
  move: PlaceMove | undefined;
  narrow: boolean;
}): React.JSX.Element {
  const card = (
    <HoverCard>
      <HoverCardHead glyph={glyph} name={words} sub={sub} />
      <HoverCardNote>{move === undefined ? note : `${note} ${MOVE_NOTE}`}</HoverCardNote>
      {more}
    </HoverCard>
  );
  if (move !== undefined) {
    return (
      <PlaceMenuChip
        here={here}
        glyph={glyph}
        words={words}
        card={card}
        said={said}
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
        {said === undefined ? null : <VisuallyHidden>{said}</VisuallyHidden>}
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
  return (
    <PlaceChip
      here={mac.deviceId}
      move={move}
      glyph={<DeviceGlyph device={undefined} />}
      words={macWords(name, standing)}
      sub={standing === DEVICE_STANDING.ONLINE ? RUNS_ON_WORDS.ONLINE : undefined}
      note={SHARED_NOTE.DEVICE}
      quiet={quiet}
      narrow={narrow}
    />
  );
}
