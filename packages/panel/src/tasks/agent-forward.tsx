import {
  AGENT_PORTS_WORDS,
  hostedPorts,
  PORTS_LOOK_EVERY_MS,
  type SharedPort,
} from "@repo/features/agent-ports-model";
import { AGENT_MACHINE, type AgentSummary } from "@repo/features/agent-wire";
import {
  type AgentSharedPortAnswerView,
  PORT_FORWARD_STATE,
  type PortForwardingAnswer,
} from "@repo/features/port-forward-acts";
import { FAILURE_SURFACE, failureAboutOf } from "@repo/features/shown-failure";
import { ACT_KIND } from "@repo/host/acts";
import type { PortActKind } from "@repo/host/contract";
import { HOST_CAPABILITY } from "@repo/settings";
import {
  AnchoredPopover,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  ButtonLink,
  CHIP_LOOK,
  Chip,
  ChipName,
  IconButton,
  MenuSection,
  POPOVER_ALIGN,
  POPOVER_PANEL_LOOK,
  POPOVER_SIDE,
  POPOVER_WIDTH,
  PopoverPanel,
  PortTable,
  PortTableCell,
  type PortTableColumn,
  PortTableRow,
  STATUS_TONE,
  StatusGlyph,
  Tooltip,
} from "@repo/ui";
import { ArrowUpRight, GLYPH, LaptopIcon, LinkIcon, PlugIcon } from "@repo/ui/icons";
import { type QueryClient, queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { askAct, pressAct, toastActFailure } from "../act.js";
import { appPlatform } from "../app-platform.js";
import { useCopyToast } from "../copy-feedback.js";
import { QUERY_ROOT } from "../query-keys.js";
import { showToast, useToast } from "../toast.js";
import { appStateQuery, selectCapability, selectPortForwarding } from "../use-app-state.js";
import { turnUnderWay } from "./agent-model.js";
import { linkPressOf } from "./use-open-link.js";

/**
 * agent-forward.tsx -- an agent's cloud ports at a plug at its box's foot, its popover a table of them: each port opened on this Mac's localhost or shared by link in one press, its stop beside it once it is on; and a toast with Open as a server starts.
 *
 * Only an agent in a cloud sandbox has ports, so the plug stands nowhere
 * else. The popover is drawn from one view model (`PlugPorts`); only where
 * its ports come from differs:
 *
 * - Where the host listens on the Mac's loopback
 *   (`HOST_CAPABILITY.PORT_FORWARDS`), the desktop's, and has forwarded one
 *   of the agent's ports, the host follows the agent's ports and shared link
 *   itself and keeps them in app state (`portForwarding`), so the popover
 *   only reads them and asks the host to forward or let go of a port
 *   (`PORT_FORWARD_SET`) and to share one (`PORT_SHARE_SET`). The host
 *   forwards one agent at a time, and of it only the ports opened.
 * - Everywhere else, a browser tab's host and a desktop agent with no port
 *   forwarded among them, the popover asks the service for the ports and the
 *   shared link through the host (`AGENTS_PORTS`, `AGENTS_PORT_SHARED`),
 *   every few seconds while it stands open, and, on the desktop, while a turn
 *   runs so a server's start is heard, never waking a stopped sandbox; it
 *   shares or stops sharing one (`AGENTS_PORT_SHARE`, `AGENTS_PORT_UNSHARE`),
 *   laying the answer over what it read.
 *
 * The plug is its glyph alone after the Cloud chip, wearing a dot in the
 * complete tone while a port is forwarded or shared, its hint saying the
 * address or the port. Its popover is a `PortTable`: a line per port, its
 * number first and what serves it under, under This Mac (on the desktop)
 * and Team link. Each cell is one press that gets its place ready and acts:
 * Open forwards the port and opens it in the default browser, and Share
 * shares it by link and copies the link; the button spins while it gets
 * ready, its glyph wears the dot once its place is on, and a borderless ×
 * beside it stops it. One port is shared at a time, so Share on another
 * moves the link. Every button's hint says what its press does now. The
 * link itself is never drawn, so a screen recording shows the app's words,
 * port numbers among them, as they read, but what serves a port, made from
 * a command line, masked.
 *
 * On the desktop, once the ports are read, a port that starts listening
 * after says so in a toast whose Open forwards and opens it, as the
 * popover's Open does.
 */

/** What an agent with no port forwarded reads. */
const OFF: PortForwardingAnswer = { on: false, running: false, ports: [] };

/** The places a port reaches, one column each. */
const PLACE = {
  MAC: "mac",
  TEAM: "team",
} as const;

type Place = (typeof PLACE)[keyof typeof PLACE];

/** What the plug, its popover, and its toasts say. */
const WORDS = {
  ...AGENT_PORTS_WORDS,
  PORT: "Port",
  THIS_MAC: "This Mac",
  TEAM_LINK: "Team link",
  OPEN: "Open",
  FORWARDING_TO: "Forwarding to",
  WAITING: "Nothing is running yet. Ports show here once the agent starts a server.",
  READING: "Looking for ports…",
  NOT_READ: "Couldn't read the ports.",
  STOPPED: "The sandbox is asleep. Ports show here once it runs again.",
  FORWARDING: "Forwarding to this Mac",
  CREATING: "Creating the link",
  STOPPING: "Stopping",
  LINK_COPIED: "Team link copied",
  COPY_AGAIN: "Copy the team link again",
  CREATE_LINK: "Create a link your teammates can open, and copy it",
  NOT_LISTENING: "That port isn't listening in the sandbox anymore.",
  FROM_SANDBOX: "In the agent's sandbox",
} as const;

/** The two places' heads. */
const MAC_COLUMN: PortTableColumn = {
  key: PLACE.MAC,
  icon: <LaptopIcon />,
  label: WORDS.THIS_MAC,
};

const TEAM_COLUMN: PortTableColumn = {
  key: PLACE.TEAM,
  icon: <LinkIcon />,
  label: WORDS.TEAM_LINK,
};

/** One port the popover lists: the sandbox's, the local port this Mac reaches it at where it is forwarded, and what serves it where that was read. */
interface PlugPort {
  readonly port: number;
  readonly localPort: number | undefined;
  readonly label: string | undefined;
  /** Whether forwarding found no local port free for it. */
  readonly unavailable: boolean;
}

/**
 * What the popover draws its ports from, wherever they come from: the
 * ports, whether they have been read, the one shared by link, the line
 * drawn where none is listed, and a share or its close asked, a share
 * answering its link where it was made.
 */
interface PlugPorts {
  readonly ports: readonly PlugPort[];
  readonly read: boolean;
  readonly shared: SharedPort | undefined;
  readonly none: string;
  readonly share: (port: number) => Promise<string | undefined>;
  readonly unshare: () => Promise<void>;
}

/** The agent fields the plug reads: where it runs, and whether a turn of it runs. */
type PlugAgent = Pick<AgentSummary, "id" | "machine" | "status" | "stoppable">;

/** The local address a port is forwarded to. */
function localAddress(localPort: number): string {
  return `localhost:${localPort}`;
}

/** A port's address in the plug's hint, with what serves it where that was read. */
function served(address: string, label: string | undefined): string {
  return label === undefined ? address : `${address} (${label})`;
}

/** The address a forwarded port opens at in the default browser. */
function localHref(localPort: number): string {
  return `http://${localAddress(localPort)}`;
}

function openWeb(href: string): void {
  appPlatform().openWeb(href);
}

/** A port's act the host or the service did not take, said in a FAILED toast as a refused press is. */
function actFailed(kind: PortActKind, agentId: string, cause: unknown, words: string): void {
  showToast({
    words,
    tone: STATUS_TONE.DANGER,
    failure: { surface: FAILURE_SURFACE.ACT, act: kind, cause, about: failureAboutOf({ agentId }) },
  });
}

/** Where a port stands on this Mac as the host answered: its local port where it listens, or that it could not. */
function localOf(
  answer: PortForwardingAnswer,
  port: number,
): Pick<PlugPort, "localPort" | "unavailable"> {
  const each = answer.ports.find((candidate) => candidate.port === port);
  const unavailable = each?.state === PORT_FORWARD_STATE.UNAVAILABLE;
  const listens = each !== undefined && !unavailable && each.state !== PORT_FORWARD_STATE.OFF;

  return { localPort: listens ? each.localPort : undefined, unavailable };
}

/** Says a port could not open on this Mac: its local ports in use, or it no longer listening. */
function notOpened(port: number, unavailable: boolean): void {
  showToast({
    words: unavailable ? `Port ${port} is in use on this Mac.` : WORDS.NOT_LISTENING,
    tone: STATUS_TONE.ATTENTION,
    replayUnmasked: true,
  });
}

/** The port forwarded to this Mac and opened in the default browser, or why it was not said. */
async function forwardAndOpen(agentId: string, port: number): Promise<void> {
  const answer = await askAct(ACT_KIND.PORT_FORWARD_SET, { agentId, port, on: true }).catch(
    (cause: unknown) => ({ cause }),
  );

  if ("cause" in answer) {
    toastActFailure({
      surface: FAILURE_SURFACE.ACT,
      act: ACT_KIND.PORT_FORWARD_SET,
      cause: answer.cause,
      about: failureAboutOf({ agentId }),
    });

    return;
  }

  const { localPort, unavailable } = localOf(answer, port);

  if (localPort === undefined) notOpened(port, unavailable);
  else openWeb(localHref(localPort));
}

type UseForwardingResult = {
  cloud: boolean;
  offered: boolean;
  answer: PortForwardingAnswer;
};

/** How forwarding stands for the agent: whether it runs in the cloud, whether this Mac can forward, and what it forwards. */
function useForwarding(agent: Pick<AgentSummary, "id" | "machine">): UseForwardingResult {
  const capable =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.PORT_FORWARDS) }).data ===
    true;

  const forwarding = useQuery({ ...appStateQuery, select: selectPortForwarding }).data;
  const cloud = agent.machine !== AGENT_MACHINE.DEVICE;

  return {
    cloud,
    offered: capable && cloud,
    answer: forwarding?.agentId === agent.id ? forwarding : OFF,
  };
}

/** The ports as this Mac's host keeps them in app state, and a share asked of it. */
function forwardedPorts(agentId: string, answer: PortForwardingAnswer): PlugPorts {
  const share = async (port: number | null) => {
    const asked = await askAct(ACT_KIND.PORT_SHARE_SET, { agentId, port }).catch(
      (cause: unknown) => ({ cause }),
    );

    if (!("cause" in asked)) return asked.shared?.url;
    actFailed(
      ACT_KIND.PORT_SHARE_SET,
      agentId,
      asked.cause,
      port === null ? WORDS.NOT_UNSHARED : WORDS.NOT_SHARED,
    );

    return undefined;
  };

  return {
    ports: answer.ports.map(({ port, label }) => ({ port, label, ...localOf(answer, port) })),
    read: true,
    shared: answer.shared,
    none: answer.running ? WORDS.WAITING : WORDS.STOPPED,
    share: (port) => share(port),
    unshare: async () => void (await share(null)),
  };
}

/** The agent's listening ports, as the service answers them; read only while `reading`, every few seconds. */
function agentPortsQuery(agentId: string, reading: boolean) {
  return queryOptions({
    queryKey: [QUERY_ROOT.AGENT_PORTS, agentId],
    queryFn: () => askAct(ACT_KIND.AGENTS_PORTS, { agentId }),
    enabled: reading,
    refetchInterval: reading ? PORTS_LOOK_EVERY_MS : false,
    retry: false,
  });
}

/** The agent's port shared now and its link, as the service answers it; read as the plug is drawn, and every few seconds while `open`. */
function agentSharedPortQuery(agentId: string, drawn: boolean, open: boolean) {
  return queryOptions({
    queryKey: [QUERY_ROOT.AGENT_SHARED_PORT, agentId],
    queryFn: () => askAct(ACT_KIND.AGENTS_PORT_SHARED, { agentId }),
    enabled: drawn,
    refetchInterval: open ? PORTS_LOOK_EVERY_MS : false,
    retry: false,
  });
}

/** One of the agent's ports shared by link, its link laid over the link read and answered; or why not, said. */
async function shareAsked(
  queryClient: QueryClient,
  agentId: string,
  port: number,
): Promise<string | undefined> {
  const { queryKey } = agentSharedPortQuery(agentId, false, false);

  const answer = await askAct(ACT_KIND.AGENTS_PORT_SHARE, { agentId, port }).catch(
    (cause: unknown) => ({ error: cause }),
  );

  if (!("url" in answer)) {
    actFailed(ACT_KIND.AGENTS_PORT_SHARE, agentId, answer, WORDS.NOT_SHARED);

    return undefined;
  }

  const linked: AgentSharedPortAnswerView = { shared: { port, url: answer.url } };
  queryClient.setQueryData(queryKey, linked);

  return answer.url;
}

/** The agent's shared link closed, the answer laid over the link read; or why not, said. */
async function unshareAsked(queryClient: QueryClient, agentId: string): Promise<void> {
  const { queryKey } = agentSharedPortQuery(agentId, false, false);

  const answer = await askAct(ACT_KIND.AGENTS_PORT_UNSHARE, { agentId }).catch(
    (cause: unknown) => ({ error: cause }),
  );

  if ("shared" in answer) queryClient.setQueryData(queryKey, answer);
  else actFailed(ACT_KIND.AGENTS_PORT_UNSHARE, agentId, answer, WORDS.NOT_UNSHARED);
}

/** The ports as the service answers them where this Mac forwards none of the agent's, and a share asked of it; nothing is read where `asked` is false. */
function useHostedPorts(
  agentId: string,
  asked: boolean,
  reading: boolean,
  open: boolean,
): PlugPorts {
  const queryClient = useQueryClient();
  const listed = useQuery(agentPortsQuery(agentId, asked && reading)).data;
  const linked = useQuery(agentSharedPortQuery(agentId, asked, asked && open)).data;
  const hosted = hostedPorts(listed, linked);
  const read = listed === undefined || "failure" in listed ? undefined : listed;

  return {
    ports: hosted.ports.map(({ port, label }) => ({
      port,
      localPort: undefined,
      label,
      unavailable: false,
    })),
    read: read !== undefined,
    shared: hosted.shared,
    // Note that the popover says what stands in its own sentences, longer than a menu's line.
    none:
      listed === undefined
        ? WORDS.READING
        : read === undefined
          ? WORDS.NOT_READ
          : read.running
            ? WORDS.WAITING
            : WORDS.STOPPED,
    share: (port) => shareAsked(queryClient, agentId, port),
    unshare: () => unshareAsked(queryClient, agentId),
  };
}

type UsePlugPortsResult = {
  cloud: boolean;
  offered: boolean;
  forwarded: boolean;
  view: PlugPorts;
};

/**
 * The agent's ports wherever they come from: the host's while it forwards
 * one of them, else the service's, read while the popover is `open` and,
 * where this Mac can forward, while a turn runs.
 */
function usePlugPorts(agent: PlugAgent, open: boolean): UsePlugPortsResult {
  const { cloud, offered, answer } = useForwarding(agent);
  const forwarded = offered && answer.on;
  const reading = open || (offered && turnUnderWay(agent));
  const hosted = useHostedPorts(agent.id, cloud && !forwarded, reading, open);

  return { cloud, offered, forwarded, view: forwarded ? forwardedPorts(agent.id, answer) : hosted };
}

/** Says once, as a port starts listening in the agent's sandbox after its ports were read, that it runs, with Open. */
export function useForwardToast(agent: PlugAgent): void {
  const { offered, view } = usePlugPorts(agent, false);
  const toast = useToast();
  const seen = useRef<ReadonlySet<number> | undefined>(undefined);
  useEffect(() => {
    if (!offered || !view.read) return;
    const listed = new Set(view.ports.map(({ port }) => port));
    const had = seen.current;
    seen.current = listed;
    // Note that the first read only learns what runs, so a server already up when the tab opens says nothing.
    const started = had === undefined ? undefined : view.ports.find(({ port }) => !had.has(port));

    if (started === undefined) return;
    toast({
      tone: STATUS_TONE.COMPLETE,
      glyph: () => <PlugIcon aria-hidden="true" />,
      words:
        started.label === undefined
          ? `Port ${started.port} is listening`
          : `${started.label} is running on ${started.port}`,
      detail: WORDS.FROM_SANDBOX,
      action: {
        label: WORDS.OPEN,
        replayUnmasked: true,
        onPress: () => void forwardAndOpen(agent.id, started.port),
      },
    });
  }, [offered, view, toast, agent.id]);
}

/** A press under way on one of a port's places. */
interface Pending {
  readonly port: number;
  readonly place: Place;
}

/** A cell's glyph, wearing the complete dot while its place is on for the port. */
function Lit({
  on,
  label,
  children,
}: {
  on: boolean;
  label: string;
  children: React.ReactNode;
}): React.ReactNode {
  return on ? (
    <StatusGlyph tone={STATUS_TONE.COMPLETE} label={label} hinted={false}>
      {children}
    </StatusGlyph>
  ) : (
    children
  );
}

/** What Open's hint says it does now. */
function openHint(port: PlugPort): string {
  if (port.unavailable) return `Port ${port.port} and the ports near it are in use on this Mac`;

  if (port.localPort === undefined) return `Forward ${port.port} to this Mac and open it`;

  return port.localPort === port.port
    ? `Open ${localAddress(port.localPort)}`
    : `Open ${localAddress(port.localPort)}, since ${port.port} is in use on this Mac`;
}

/** What Share's hint says it does now. */
function shareHint(port: number, shared: SharedPort | undefined): string {
  if (shared === undefined) return WORDS.CREATE_LINK;

  if (shared.port === port) return WORDS.COPY_AGAIN;

  return `Share ${port} instead of ${shared.port}. The link moves, and is copied.`;
}

/**
 * The plug at the foot of a cloud agent's box: a dot in the complete tone
 * while this Mac forwards one of its ports or one is shared, the address in
 * its hint; its popover the ports' table.
 */
export function ForwardChip({ agent }: { agent: PlugAgent }): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<readonly Pending[]>([]);
  const { cloud, offered, forwarded, view } = usePlugPorts(agent, open);
  const copy = useCopyToast();
  const popoverId = useId();
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  if (!cloud) return null;

  const isPending = (port: number, place: Place) =>
    pending.some((each) => each.port === port && each.place === place);

  // Note that a press is pending until its answer, so its button spins and takes no second press.
  const pressing = async (port: number, place: Place, act: () => Promise<void>) => {
    setPending((was) => [...was, { port, place }]);
    await act();
    setPending((was) => was.filter((each) => each.port !== port || each.place !== place));
  };

  const forwardPort = (port: number) =>
    void pressing(port, PLACE.MAC, () => forwardAndOpen(agent.id, port));

  const sharePort = (port: number) => {
    const { shared } = view;

    if (shared?.port === port) return copy(shared.url, WORDS.LINK_COPIED);
    void pressing(port, PLACE.TEAM, async () => {
      const url = await view.share(port);

      if (url !== undefined) copy(url, WORDS.LINK_COPIED);
    });
  };

  const stopForwarding = (port: number) =>
    void pressing(port, PLACE.MAC, () =>
      pressAct(ACT_KIND.PORT_FORWARD_SET, { agentId: agent.id, port, on: false }),
    );

  const stopSharing = (port: number) => void pressing(port, PLACE.TEAM, view.unshare);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const { shared } = view;

  // Note that a shared port the sandbox no longer lists keeps a line, so its link can still be stopped.
  const rows: readonly PlugPort[] =
    shared === undefined || view.ports.some(({ port }) => port === shared.port)
      ? view.ports
      : [
          ...view.ports,
          { port: shared.port, localPort: undefined, label: undefined, unavailable: false },
        ];

  const first = view.ports.find((each) => each.localPort !== undefined);
  const lit = forwarded || shared !== undefined;

  const words =
    forwarded && first?.localPort !== undefined
      ? `${WORDS.FORWARDING_TO} ${served(localAddress(first.localPort), first.label)}`
      : shared !== undefined
        ? `${WORDS.SHARING} ${served(String(shared.port), rows.find((each) => each.port === shared.port)?.label)}`
        : WORDS.PORTS;

  const macCell = (port: PlugPort) => {
    const { localPort } = port;
    const on = localPort !== undefined;
    // Note that a port with no local port free is still forwarded, so it keeps its stop.
    const stoppable = on || port.unavailable;
    const busy = isPending(port.port, PLACE.MAC);

    const glyph = (
      <Lit on={on} label={WORDS.THIS_MAC}>
        <ArrowUpRight />
      </Lit>
    );

    return (
      <PortTableCell
        key={PLACE.MAC}
        stop={
          stoppable ? (
            <Tooltip label={`Stop forwarding ${port.port} to this Mac`}>
              <IconButton
                label={`Stop forwarding ${port.port} to this Mac`}
                icon={<GLYPH.CLOSE />}
                size={BUTTON_SIZE.COMPACT}
                keepFocus
                {...(busy ? { busy: true, busyLabel: WORDS.STOPPING } : {})}
                onClick={() => stopForwarding(port.port)}
              />
            </Tooltip>
          ) : undefined
        }
      >
        <Tooltip label={busy ? WORDS.FORWARDING : openHint(port)}>
          {localPort === undefined ? (
            // Note that a port not yet forwarded is a press, which forwards it and then opens it.
            <Button
              variant={BUTTON_VARIANT.OUTLINE}
              size={BUTTON_SIZE.COMPACT}
              keepFocus
              icon={glyph}
              {...(busy ? { busy: true, busyLabel: WORDS.FORWARDING } : {})}
              onClick={() => forwardPort(port.port)}
            >
              {WORDS.OPEN}
            </Button>
          ) : (
            <ButtonLink
              variant={BUTTON_VARIANT.OUTLINE}
              size={BUTTON_SIZE.COMPACT}
              icon={glyph}
              href={localHref(localPort)}
              onClick={linkPressOf(openWeb, localHref(localPort))}
            >
              {WORDS.OPEN}
            </ButtonLink>
          )}
        </Tooltip>
      </PortTableCell>
    );
  };

  const teamCell = (port: PlugPort) => {
    const on = shared?.port === port.port;
    const busy = isPending(port.port, PLACE.TEAM);

    return (
      <PortTableCell
        key={PLACE.TEAM}
        stop={
          on ? (
            <Tooltip label={`Stop sharing ${port.port}. The link stops working.`}>
              <IconButton
                label={`Stop sharing ${port.port}`}
                icon={<GLYPH.CLOSE />}
                size={BUTTON_SIZE.COMPACT}
                keepFocus
                {...(busy ? { busy: true, busyLabel: WORDS.STOPPING } : {})}
                onClick={() => stopSharing(port.port)}
              />
            </Tooltip>
          ) : undefined
        }
      >
        <Tooltip label={busy ? WORDS.CREATING : shareHint(port.port, shared)}>
          <Button
            variant={BUTTON_VARIANT.OUTLINE}
            size={BUTTON_SIZE.COMPACT}
            keepFocus
            icon={
              <Lit on={on} label={WORDS.TEAM_LINK}>
                <LinkIcon />
              </Lit>
            }
            {...(busy ? { busy: true, busyLabel: WORDS.CREATING } : {})}
            onClick={() => sharePort(port.port)}
          >
            {WORDS.SHARE}
          </Button>
        </Tooltip>
      </PortTableCell>
    );
  };

  const chip = (
    <Chip
      ref={trigger}
      look={CHIP_LOOK.TOOLBAR}
      iconOnly
      aria-label={`${WORDS.PORTS}: ${words}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? popoverId : undefined}
      onClick={() => setOpen(!open)}
    >
      {lit ? (
        // Note that the dot's hint is the chip's, the address it forwards to or the port it shares, so no hint of its own hangs over it.
        <StatusGlyph tone={STATUS_TONE.COMPLETE} label={words}>
          <PlugIcon aria-hidden="true" />
        </StatusGlyph>
      ) : (
        <PlugIcon aria-hidden="true" />
      )}
      <ChipName>{words}</ChipName>
    </Chip>
  );

  return (
    <span className="agent-forward relative inline-flex min-w-0" ref={root}>
      {lit ? chip : <Tooltip label={words}>{chip}</Tooltip>}
      <AnchoredPopover
        open={open}
        align={POPOVER_ALIGN.START}
        side={POPOVER_SIDE.ABOVE}
        width={POPOVER_WIDTH.WIDE}
      >
        <PopoverPanel
          open={open}
          id={popoverId}
          look={POPOVER_PANEL_LOOK.MENU}
          title={WORDS.PORTS}
          replayUnmasked
          onDismiss={close}
          onLeave={(left) => {
            if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
          }}
        >
          <div className="agent-forward-ports p-menu-inset">
            <MenuSection heading={WORDS.PORTS}>
              <PortTable
                label={WORDS.PORTS}
                portLabel={WORDS.PORT}
                columns={offered ? [MAC_COLUMN, TEAM_COLUMN] : [TEAM_COLUMN]}
                empty={rows.length === 0 ? view.none : undefined}
              >
                {rows.map((port) => (
                  <PortTableRow key={port.port} port={port.port} detail={port.label}>
                    {offered ? macCell(port) : null}
                    {teamCell(port)}
                  </PortTableRow>
                ))}
              </PortTable>
            </MenuSection>
          </div>
        </PopoverPanel>
      </AnchoredPopover>
    </span>
  );
}
