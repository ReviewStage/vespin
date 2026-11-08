import { AGENT_MACHINE, type AgentSummary } from "@repo/features/agent-wire";
import { PORT_FORWARD_STATE, type PortForwardingAnswer } from "@repo/features/port-forward-acts";
import { ACT_KIND } from "@repo/host/acts";
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
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { pressAct } from "../act.js";
import { appPlatform } from "../app-platform.js";
import { LINK_COPY, useCopyToast } from "../copy-feedback.js";
import { ActionMenu, type MenuAction, type MenuEntry } from "../desktop/action-menu.js";
import { useToast } from "../toast.js";
import { appStateQuery, selectCapability, selectPortForwarding } from "../use-app-state.js";

/**
 * agent-forward.tsx -- an agent's cloud ports forwarded to this Mac's localhost: a plug at its box's foot that says whether they are and turns them on or off, and a toast saying so once.
 *
 * Only the desktop's host listens on the Mac's loopback
 * (`HOST_CAPABILITY.PORT_FORWARDS`), and only an agent in a cloud sandbox
 * has ports to forward, so none of it stands anywhere else. The host
 * forwards one agent at a time and follows its sandbox's ports itself, which
 * it keeps in app state (`portForwarding`), so all of this only reads it and
 * asks the host to turn forwarding on or off.
 *
 * Nothing is forwarded on its own: the developer turns an agent's
 * forwarding on from its plug, and it stands until they turn it off or its
 * sandbox stops. As the first port reaches the Mac, a toast says its address
 * once, with Open.
 *
 * The box's foot wears a plug after the Cloud chip, its glyph alone, as
 * Cursor's cloud agents wear one: while the agent is forwarded it wears a
 * dot in the complete tone, and its hint says the address,
 * "Forwarding to localhost:3000". Its menu holds the Forward to localhost
 * switch and, while on, one row per port, "localhost:3000", whose submenu
 * beside it holds Open, which opens it in the default browser (saying where
 * it came from, "from :3000", where the Mac's port differs), and Share,
 * which shares it by a public link (`PORT_SHARE_SET`). The one shared port
 * wears a link glyph, and its submenu holds Open, Open link, Copy link, and
 * Stop sharing, as the host keeps the link beside the ports. The switch, a
 * setting, leaves the menu standing as every menu's switch does, so the
 * ports appear under it; every action in a port's submenu closes it. Every
 * word drawn is the app's own, port numbers among them, and the link is
 * never drawn, so a screen recording shows them as they read.
 */

/** What an agent forwarding is off for reads. */
const OFF: PortForwardingAnswer = { on: false, running: false, ports: [] };

/** What the plug, its menu, and the toast say. */
const WORDS = {
  SWITCH: "Forward to localhost",
  OFF: "Ports not forwarded",
  FORWARDING: "Forwarding to this Mac",
  FORWARDING_TO: "Forwarding to",
  PORTS: "Ports",
  WAITING: "Waiting for a port to listen",
  BUSY: "Port busy on this Mac",
  FORWARDED: "Forwarded",
  FROM_SANDBOX: "From the agent's sandbox",
  OPEN: "Open",
  SHARE: "Share",
  OPEN_LINK: "Open link",
  COPY_LINK: "Copy link",
  STOP_SHARING: "Stop sharing",
} as const;

/** The local address a port is forwarded to. */
function localAddress(localPort: number): string {
  return `localhost:${localPort}`;
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

/** How forwarding stands for the agent, where it is offered: this Mac forwards, and the agent runs in the cloud. */
function useForwarding(agent: Pick<AgentSummary, "id" | "machine">): {
  offered: boolean;
  /** The one agent forwarded and how it stands; none while no agent is, and unknown until app state is read. */
  forwarding: ReturnType<typeof selectPortForwarding> | undefined;
  answer: PortForwardingAnswer;
} {
  const capable =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.PORT_FORWARDS) }).data ===
    true;
  const forwarding = useQuery({ ...appStateQuery, select: selectPortForwarding }).data;
  return {
    offered: capable && agent.machine !== AGENT_MACHINE.DEVICE,
    forwarding,
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

/** What a shared port's submenu offers beyond Open: its link, Copy, and Stop sharing. */
function sharedItems(
  agentId: string,
  url: string,
  copy: (words: string, label: string) => void,
): MenuAction[] {
  return [
    {
      label: WORDS.OPEN_LINK,
      icon: <LinkIcon aria-hidden="true" />,
      onSelect: () => appPlatform().openWeb(url),
    },
    {
      label: WORDS.COPY_LINK,
      icon: <CopyIcon aria-hidden="true" />,
      onSelect: () => copy(url, LINK_COPY.COPIED),
    },
    {
      label: WORDS.STOP_SHARING,
      icon: <UnlinkIcon aria-hidden="true" />,
      onSelect: () => void pressAct(ACT_KIND.PORT_SHARE_SET, { agentId, port: null }),
    },
  ];
}

/**
 * One row of the chip's menu per port, its actions in a submenu beside it:
 * Open, and Share where `share` is offered, or, for the shared port, its
 * link, Copy link, and Stop sharing; a busy port that is not shared is a
 * dimmed row, and the line saying none listens yet stands where none does.
 */
function portRows(
  agentId: string,
  answer: PortForwardingAnswer,
  copy: (words: string, label: string) => void,
  share: ((port: number) => void) | undefined,
): MenuEntry[] {
  const { shared } = answer;
  const rows = answer.ports.map(({ port, localPort, state }): MenuEntry => {
    const reachable = localPort !== undefined && state !== PORT_FORWARD_STATE.UNAVAILABLE;
    const isShared = shared?.port === port;
    if (!reachable && !isShared)
      return {
        key: port,
        label: `:${port}`,
        icon: <GlobeIcon aria-hidden="true" />,
        detail: WORDS.BUSY,
        detailPlace: MENU_DETAIL.BESIDE,
        disabled: true,
        onSelect: () => {},
      };
    const open: MenuAction[] = reachable
      ? [
          {
            label: WORDS.OPEN,
            icon: <GlobeIcon aria-hidden="true" />,
            // Note that the submenu's row names the Mac's port, so where it differs Open says the sandbox's.
            ...(localPort === port
              ? {}
              : { detail: `from :${port}`, detailPlace: MENU_DETAIL.BESIDE }),
            onSelect: () => openLocal(localPort),
          },
        ]
      : [];
    return {
      label: reachable ? localAddress(localPort) : `:${port}`,
      icon: isShared ? <LinkIcon aria-hidden="true" /> : <GlobeIcon aria-hidden="true" />,
      items:
        shared !== undefined && isShared
          ? [...open, ...sharedItems(agentId, shared.url, copy)]
          : share === undefined
            ? open
            : [
                ...open,
                {
                  label: WORDS.SHARE,
                  icon: <LinkIcon aria-hidden="true" />,
                  onSelect: () => share(port),
                },
              ],
    };
  });
  // Note that a shared port the sandbox no longer lists keeps a row, so its link can still be stopped.
  if (shared !== undefined && !answer.ports.some(({ port }) => port === shared.port))
    rows.push({
      label: `:${shared.port}`,
      icon: <LinkIcon aria-hidden="true" />,
      items: sharedItems(agentId, shared.url, copy),
    });
  if (rows.length === 0) return [{ label: WORDS.WAITING, disabled: true, onSelect: () => {} }];
  return rows;
}

/**
 * The plug at the agent's box's foot, for an agent whose ports this Mac
 * can forward: a dot in the complete tone while they are, the address in
 * its hint; its menu the switch and, while on, the ports.
 */
export function ForwardChip({
  agent,
}: {
  agent: Pick<AgentSummary, "id" | "machine">;
}): React.JSX.Element | null {
  const { offered, answer } = useForwarding(agent);
  const menu = useMenu(true);
  const copy = useCopyToast();
  const [sharing, setSharing] = useState(false);
  if (!offered) return null;
  const first = reached(answer)[0];
  const words = !answer.on
    ? WORDS.OFF
    : first === undefined
      ? WORDS.FORWARDING
      : `${WORDS.FORWARDING_TO} ${localAddress(first)}`;
  // Note that one port is shared at a time, so no port offers Share while one is or while a share is on its way, rather than moving the live link; the host sets `shared` before the act settles.
  const share =
    answer.shared !== undefined || sharing
      ? undefined
      : (port: number) => {
          setSharing(true);
          void pressAct(ACT_KIND.PORT_SHARE_SET, { agentId: agent.id, port }).then(() =>
            setSharing(false),
          );
        };
  const groups: MenuEntry[][] = [
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
    ...(answer.on ? [portRows(agent.id, answer, copy, share)] : []),
  ];
  const chip = (
    <Chip
      look={CHIP_LOOK.TOOLBAR}
      iconOnly
      aria-label={`${WORDS.PORTS}: ${words}`}
      {...menu.trigger(riseAbove)}
    >
      {answer.on ? (
        // Note that the dot's hint is the chip's, the address it forwards to, so no hint of its own hangs over it.
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
      {answer.on ? chip : <Tooltip label={words}>{chip}</Tooltip>}
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
