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
  CHIP_LOOK,
  Chip,
  ChipName,
  MENU_DETAIL,
  MENU_ITEM_MARK,
  riseAbove,
  STATUS_TONE,
  StatusGlyph,
  Tooltip,
  useMenu,
} from "@repo/ui";
import { CopyIcon, GlobeIcon, LinkIcon, PlugIcon, UnlinkIcon } from "@repo/ui/icons";
import { type QueryClient, queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { askAct, pressAct } from "../act.js";
import { appPlatform } from "../app-platform.js";
import { LINK_COPY, useCopyToast } from "../copy-feedback.js";
import { ActionMenu, type MenuAction, type MenuEntry } from "../desktop/action-menu.js";
import { QUERY_ROOT } from "../query-keys.js";
import { showToast, useToast } from "../toast.js";
import { appStateQuery, selectCapability, selectPortForwarding } from "../use-app-state.js";

/**
 * agent-forward.tsx -- an agent's cloud ports at a plug at its box's foot: on every host, one of them shared by a public link; on the desktop, forwarded to this Mac's localhost too, turned on or off there, with a toast saying so once.
 *
 * Only an agent in a cloud sandbox has ports, so the plug stands nowhere
 * else. Both menus are drawn by one view model (`PlugPorts`, `portRows`);
 * only where its ports come from differs:
 *
 * - Where the host listens on the Mac's loopback
 *   (`HOST_CAPABILITY.PORT_FORWARDS`), the desktop's, and the agent's
 *   forwarding is on, the host forwards one agent at a time and follows its sandbox's ports and shared link itself, which
 *   it keeps in app state (`portForwarding`), so the plug only reads them
 *   and asks the host to turn forwarding on or off and to share a port
 *   (`PORT_SHARE_SET`). Nothing is forwarded on its own: the developer turns
 *   an agent's forwarding on from its plug, and it stands until they turn it
 *   off or its sandbox stops. As the first port reaches the Mac, a toast
 *   says its address once, with Open.
 * - Everywhere else, a browser tab's host and a desktop agent forwarding
 *   is off for among them, the plug asks the
 *   service for the ports and the shared link through the host
 *   (`AGENTS_PORTS`, `AGENTS_PORT_SHARED`), every few seconds while its menu
 *   stands open and the link once as it is drawn, never waking a stopped
 *   sandbox, and shares or stops sharing one (`AGENTS_PORT_SHARE`,
 *   `AGENTS_PORT_UNSHARE`), laying the answer over what it read.
 *
 * The box's foot wears a plug after the Cloud chip, its glyph alone, as
 * Cursor's cloud agents wear one: while the agent is forwarded, or on a
 * agent not forwarded while a port is shared, it wears a dot in the
 * complete tone, and its hint says the address, "Forwarding to
 * localhost:3000" or "Sharing :3000". Its menu holds the ports, so one can
 * be shared whether or not it is forwarded, and on the desktop the Forward
 * to localhost switch under them, beside the plug the menu rises from.
 * One row per port, "localhost:3000" where it reached this Mac
 * and ":3000" where it did not, with what serves it beside, such as
 * "storybook dev", has a submenu beside it holding Open, which
 * opens a forwarded port in the default browser (saying where it came from,
 * "from :3000", where the Mac's port differs), and Share, which shares it by
 * a public link. The one shared port wears a link glyph, and its submenu
 * holds Open link, Copy link, and Stop sharing. The switch, a setting,
 * leaves the menu standing as every menu's switch does, so the ports appear
 * under it, and so does every action in a port's submenu, so it redraws
 * with the link or with Share again; the menu closes only on a click
 * outside it or Escape. Every word drawn is the app's own, port numbers
 * among them, and the link is never drawn, so a screen recording shows them
 * as they read, but what serves a port, which is made from a command line
 * and kept masked. The plug's hint names it too, after the port it says.
 */

/** What an agent forwarding is off for reads. */
const OFF: PortForwardingAnswer = { on: false, running: false, ports: [] };

/** What the plug, its menu, and the toast say, beyond what every list of the ports says (`AGENT_PORTS_WORDS`). */
const WORDS = {
  ...AGENT_PORTS_WORDS,
  SWITCH: "Forward to localhost",
  OFF: "Ports not forwarded",
  FORWARDING: "Forwarding to this Mac",
  FORWARDING_TO: "Forwarding to",
  BUSY: "Port busy on this Mac",
  FORWARDED: "Forwarded",
  FROM_SANDBOX: "From the agent's sandbox",
  OPEN: "Open",
} as const;

/** One port the plug lists: the sandbox's, the local port this Mac reaches it at where it was forwarded to one, and what serves it where that was read. */
interface PlugPort {
  readonly port: number;
  readonly localPort: number | undefined;
  readonly label: string | undefined;
  /** Whether forwarding found no local port free for it. */
  readonly busy: boolean;
}

/**
 * What the plug's menu draws its ports from, wherever they come from: the
 * ports, the one shared by link, the line drawn where none is listed, and a
 * share or its close asked.
 */
interface PlugPorts {
  readonly ports: readonly PlugPort[];
  readonly shared: SharedPort | undefined;
  readonly none: string;
  readonly share: (port: number | null) => void;
}

/** The local address a port is forwarded to. */
function localAddress(localPort: number): string {
  return `localhost:${localPort}`;
}

/** A port's address in the plug's hint, with what serves it where that was read. */
function served(address: string, label: string | undefined): string {
  return label === undefined ? address : `${address} (${label})`;
}

/** The local ports that reached this Mac, the lowest sandbox port first. */
function reached(answer: PortForwardingAnswer): number[] {
  return answer.ports.flatMap((each) =>
    each.localPort === undefined || each.state === PORT_FORWARD_STATE.UNAVAILABLE
      ? []
      : [each.localPort],
  );
}

function setForwarding(agentId: string, on: boolean): void {
  void pressAct(ACT_KIND.PORT_FORWARD_SET, { agentId, on });
}

function openLocal(localPort: number): void {
  appPlatform().openWeb(`http://${localAddress(localPort)}`);
}

type UseForwardingResult = {
  cloud: boolean;
  offered: boolean;
  answer: PortForwardingAnswer;
};

/** How forwarding stands for the agent: whether it runs in the cloud, and whether this Mac forwards it. */
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

/** Says once, as the agent's first forwarded port reaches the Mac, where it opens. */
export function useForwardToast(agent: Pick<AgentSummary, "id" | "machine">): void {
  const { answer } = useForwarding(agent);
  // Note that the toast answers the first port reaching the Mac, not each read, so a forward that stands says nothing more.
  const toast = useToast();
  const ports = reached(answer);
  const first = ports[0];
  const hadPorts = useRef(first !== undefined);
  useEffect(() => {
    const had = hadPorts.current;
    hadPorts.current = first !== undefined;

    if (had || first === undefined) return;
    const more = ports.length - 1;
    toast({
      tone: STATUS_TONE.COMPLETE,
      glyph: () => <PlugIcon aria-hidden="true" />,
      words: `${WORDS.FORWARDED} ${localAddress(first)}`,
      detail: more > 0 ? `And ${more} more from the agent's sandbox` : WORDS.FROM_SANDBOX,
      replayUnmasked: true,
      action: { label: WORDS.OPEN, replayUnmasked: true, onPress: () => openLocal(first) },
    });
  }, [first, ports.length, toast]);
}

/** The ports as this Mac's host forwards them, kept in app state, and a share asked of it. */
function forwardedPorts(agentId: string, answer: PortForwardingAnswer): PlugPorts {
  return {
    ports: answer.ports.map(({ port, localPort, state, label }) => {
      const busy = localPort === undefined || state === PORT_FORWARD_STATE.UNAVAILABLE;

      return { port, localPort: busy ? undefined : localPort, label, busy };
    }),
    shared: answer.shared,
    none: WORDS.WAITING,
    share: (port) => void pressAct(ACT_KIND.PORT_SHARE_SET, { agentId, port }),
  };
}

/** The agent's listening ports, as the service answers them; read only while `open`, every few seconds. */
function agentPortsQuery(agentId: string, open: boolean) {
  return queryOptions({
    queryKey: [QUERY_ROOT.AGENT_PORTS, agentId],
    queryFn: () => askAct(ACT_KIND.AGENTS_PORTS, { agentId }),
    enabled: open,
    refetchInterval: open ? PORTS_LOOK_EVERY_MS : false,
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

/** A share or its close the service did not take, said in a FAILED toast as a refused press is. */
function shareFailed(kind: PortActKind, agentId: string, cause: unknown, words: string): void {
  showToast({
    words,
    tone: STATUS_TONE.DANGER,
    failure: { surface: FAILURE_SURFACE.ACT, act: kind, cause, about: failureAboutOf({ agentId }) },
  });
}

/** One of the agent's ports shared by link, or the shared one closed with `null`, its answer laid over the link read. */
async function shareAsked(
  queryClient: QueryClient,
  agentId: string,
  port: number | null,
): Promise<void> {
  const { queryKey } = agentSharedPortQuery(agentId, false, false);

  if (port === null) {
    const answer = await askAct(ACT_KIND.AGENTS_PORT_UNSHARE, { agentId }).catch(
      (cause: unknown) => ({ error: cause }),
    );

    if ("shared" in answer) queryClient.setQueryData(queryKey, answer);
    else shareFailed(ACT_KIND.AGENTS_PORT_UNSHARE, agentId, answer, WORDS.NOT_UNSHARED);

    return;
  }

  const answer = await askAct(ACT_KIND.AGENTS_PORT_SHARE, { agentId, port }).catch(
    (cause: unknown) => ({ error: cause }),
  );

  const linked: AgentSharedPortAnswerView | undefined =
    "url" in answer ? { shared: { port, url: answer.url } } : undefined;

  if (linked !== undefined) queryClient.setQueryData(queryKey, linked);
  else shareFailed(ACT_KIND.AGENTS_PORT_SHARE, agentId, answer, WORDS.NOT_SHARED);
}

/** The ports as the service answers them where this Mac forwards none of the agent's, and a share asked of it; nothing is read where `asked` is false. */
function useHostedPorts(agentId: string, asked: boolean, open: boolean): PlugPorts {
  const queryClient = useQueryClient();
  const listed = useQuery(agentPortsQuery(agentId, asked && open)).data;
  const linked = useQuery(agentSharedPortQuery(agentId, asked, asked && open)).data;
  const hosted = hostedPorts(listed, linked);

  return {
    ports: hosted.ports.map(({ port, label }) => ({
      port,
      localPort: undefined,
      label,
      busy: false,
    })),
    shared: hosted.shared,
    none: hosted.none,
    share: (port) => void shareAsked(queryClient, agentId, port),
  };
}

/** What a shared port's submenu offers beyond Open: its link, Copy, and Stop sharing. */
function sharedItems(
  view: PlugPorts,
  url: string,
  copy: (words: string, label: string) => void,
): MenuAction[] {
  return [
    {
      label: WORDS.OPEN_LINK,
      icon: <LinkIcon aria-hidden="true" />,
      stays: true,
      onSelect: () => appPlatform().openWeb(url),
    },
    {
      label: WORDS.COPY_LINK,
      icon: <CopyIcon aria-hidden="true" />,
      stays: true,
      onSelect: () => copy(url, LINK_COPY.COPIED),
    },
    {
      label: WORDS.STOP_SHARING,
      icon: <UnlinkIcon aria-hidden="true" />,
      stays: true,
      onSelect: () => view.share(null),
    },
  ];
}

/** A port's row that offers nothing: dimmed, saying why where it is busy on this Mac, and what serves it otherwise. */
function dimmedRow(port: number, busy: boolean, label: string | undefined): MenuEntry {
  const detail = busy ? WORDS.BUSY : label;

  return {
    key: port,
    label: `:${port}`,
    icon: <GlobeIcon aria-hidden="true" />,
    ...(detail !== undefined && { detail, detailPlace: MENU_DETAIL.BESIDE, detailMasked: !busy }),
    disabled: true,
    onSelect: () => {},
  };
}

/**
 * One row of the chip's menu per port, its actions in a submenu beside it:
 * Open where it reached this Mac, and Share while no port is, or, for the
 * shared port, its link, Copy link, and Stop sharing; a port that offers
 * none of them is a dimmed row, saying so where it is busy on this Mac, and
 * the line saying none is listed stands where none is.
 */
function portRows(view: PlugPorts, copy: (words: string, label: string) => void): MenuEntry[] {
  const { shared } = view;

  const rows = view.ports.map(({ port, localPort, label, busy }): MenuEntry => {
    const isShared = shared?.port === port;

    const open: MenuAction[] =
      localPort === undefined
        ? []
        : [
            {
              label: WORDS.OPEN,
              icon: <GlobeIcon aria-hidden="true" />,
              // Note that the submenu's row names the Mac's port, so where it differs Open says the sandbox's.
              ...(localPort !== port && {
                detail: `from :${port}`,
                detailPlace: MENU_DETAIL.BESIDE,
              }),
              stays: true,
              onSelect: () => openLocal(localPort),
            },
          ];

    const items: MenuAction[] =
      shared !== undefined && isShared
        ? [...open, ...sharedItems(view, shared.url, copy)]
        : shared !== undefined
          ? // Note that one port is shared at a time, so another offers Share only once the shared one stops, rather than moving the live link.
            open
          : [
              ...open,
              {
                label: WORDS.SHARE,
                icon: <LinkIcon aria-hidden="true" />,
                stays: true,
                onSelect: () => view.share(port),
              },
            ];

    if (items.length === 0 || (busy && !isShared)) return dimmedRow(port, busy, label);

    return {
      label: localPort === undefined ? `:${port}` : localAddress(localPort),
      detail: label,
      detailMasked: true,
      icon: isShared ? <LinkIcon aria-hidden="true" /> : <GlobeIcon aria-hidden="true" />,
      items,
    };
  });

  // Note that a shared port the sandbox no longer lists keeps a row, so its link can still be stopped.
  if (shared !== undefined && !view.ports.some(({ port }) => port === shared.port))
    rows.push({
      label: `:${shared.port}`,
      icon: <LinkIcon aria-hidden="true" />,
      items: sharedItems(view, shared.url, copy),
    });

  if (rows.length === 0) return [{ label: view.none, disabled: true, onSelect: () => {} }];

  return rows;
}

/**
 * The plug at the foot of a cloud agent's box: a dot in the complete tone
 * while this Mac forwards its ports, or, where it forwards none, while one
 * is shared, the address in its hint; its menu the ports, and the switch
 * under them where this Mac can forward.
 */
export function ForwardChip({
  agent,
}: {
  agent: Pick<AgentSummary, "id" | "machine">;
}): React.JSX.Element | null {
  const { cloud, offered, answer } = useForwarding(agent);
  const menu = useMenu(true);
  const copy = useCopyToast();
  // Note that while this Mac forwards none of the agent's ports the service lists them, so one can be shared without forwarding, and none offers Open.
  const forwarded = offered && answer.on;
  const hosted = useHostedPorts(agent.id, cloud && !forwarded, menu.drawn !== undefined);

  if (!cloud) return null;
  const view = forwarded ? forwardedPorts(agent.id, answer) : hosted;
  const first = reached(answer)[0];
  const labelOf = (port: number) => view.ports.find((each) => each.port === port)?.label;
  const firstLabel = view.ports.find((each) => each.localPort === first)?.label;
  const lit = forwarded || view.shared !== undefined;

  const words = forwarded
    ? first === undefined
      ? WORDS.FORWARDING
      : `${WORDS.FORWARDING_TO} ${served(localAddress(first), firstLabel)}`
    : view.shared !== undefined
      ? `${WORDS.SHARING} ${served(`:${view.shared.port}`, labelOf(view.shared.port))}`
      : offered
        ? WORDS.OFF
        : WORDS.PORTS;

  const groups: MenuEntry[][] = [
    portRows(view, copy),
    ...(offered
      ? [
          [
            {
              label: WORDS.SWITCH,
              icon: <PlugIcon aria-hidden="true" />,
              checked: answer.on,
              mark: MENU_ITEM_MARK.SWITCH,
              stays: true,
              onSelect: () => setForwarding(agent.id, !answer.on),
            },
          ],
        ]
      : []),
  ];

  const chip = (
    <Chip
      look={CHIP_LOOK.TOOLBAR}
      iconOnly
      aria-label={`${WORDS.PORTS}: ${words}`}
      {...menu.trigger(riseAbove)}
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
    <>
      {lit ? chip : <Tooltip label={words}>{chip}</Tooltip>}
      {menu.drawn === undefined ? null : (
        <ActionMenu
          replayUnmasked
          label={WORDS.PORTS}
          menu={menu.drawn}
          groups={groups}
          onClose={menu.close}
        />
      )}
    </>
  );
}
