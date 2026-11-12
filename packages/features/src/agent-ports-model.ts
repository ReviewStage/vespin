/**
 * agent-ports-model.ts -- a cloud agent's listening ports as every client lists them from the service: each port with what serves it, the one shared by a public link, what stands where none is listed, and what each port's row offers.
 *
 * The panel's plug (`@repo/panel`'s `agent-forward.tsx`) and the iOS agent
 * page's Ports sheet both read the ports and the shared link through the
 * host (`AGENTS_PORTS`, `AGENTS_PORT_SHARED`), every few seconds while they
 * stand open, and share or stop sharing one (`AGENTS_PORT_SHARE`,
 * `AGENTS_PORT_UNSHARE`). One port is shared at a time, so while one is,
 * another offers nothing until it stops, rather than moving the live link;
 * and a shared port the sandbox no longer lists keeps its row, so its link
 * can still be stopped. Nothing here draws.
 */

import type { AgentPortsAnswerView, AgentSharedPortAnswerView } from "./port-forward-acts.js";

/** What a list of an agent's ports says, in the panel's words. */
export const AGENT_PORTS_WORDS = {
  PORTS: "Ports",
  SHARING: "Sharing",
  WAITING: "Waiting for a port to listen",
  READING: "Looking for ports",
  NOT_READ: "Couldn't read the ports",
  STOPPED: "Sandbox not running",
  SHARE: "Share",
  OPEN_LINK: "Open link",
  COPY_LINK: "Copy link",
  STOP_SHARING: "Stop sharing",
  NOT_SHARED: "Couldn't share this port.",
  NOT_UNSHARED: "Couldn't stop sharing this port.",
} as const;

/** How often a list of the ports standing open is read again, as often as the desktop's host looks. */
export const PORTS_LOOK_EVERY_MS = 3_000;

/** One port the sandbox listens on, and what serves it where that was read. */
export interface ListedPort {
  readonly port: number;
  readonly label: string | undefined;
}

/** The port shared by public link and its link. */
export interface SharedPort {
  readonly port: number;
  readonly url: string;
}

/** The ports as the service answers them: each port, the one shared by link, and the line standing where none is listed. */
export interface HostedPorts {
  readonly ports: readonly ListedPort[];
  readonly shared: SharedPort | undefined;
  readonly none: string;
}

/**
 * The ports and the shared link as the service answered them, `undefined`
 * for a read not answered yet: what serves each port beside it, and what
 * stands where none is listed, by whether the list is read yet, could not
 * be, or found the sandbox running or stopped.
 */
export function hostedPorts(
  listed: AgentPortsAnswerView | undefined,
  linked: AgentSharedPortAnswerView | undefined,
): HostedPorts {
  const read = listed === undefined || "failure" in listed ? undefined : listed;
  const labels = new Map((read?.labels ?? []).map(({ port, label }) => [port, label]));

  return {
    ports: (read?.ports ?? []).map((port) => ({ port, label: labels.get(port) })),
    shared: linked === undefined || "failure" in linked ? undefined : (linked.shared ?? undefined),
    none:
      listed === undefined
        ? AGENT_PORTS_WORDS.READING
        : read === undefined
          ? AGENT_PORTS_WORDS.NOT_READ
          : read.running
            ? AGENT_PORTS_WORDS.WAITING
            : AGENT_PORTS_WORDS.STOPPED,
  };
}

/** What a port's row offers: its link shared, opened, copied, or closed. */
export const PORT_ACT = {
  SHARE: "share",
  OPEN_LINK: "open-link",
  COPY_LINK: "copy-link",
  STOP_SHARING: "stop-sharing",
} as const;

export type PortAct = (typeof PORT_ACT)[keyof typeof PORT_ACT];

/** One port's row: the port, what serves it, its link where it is the one shared, and what it offers. */
export interface PortRow extends ListedPort {
  readonly url: string | undefined;
  readonly acts: readonly PortAct[];
}

/** What the shared port's row offers. */
const SHARED_ACTS: readonly PortAct[] = [
  PORT_ACT.OPEN_LINK,
  PORT_ACT.COPY_LINK,
  PORT_ACT.STOP_SHARING,
];

/**
 * One row per port, in the sandbox's order: the shared one offering its
 * link, Copy link, and Stop sharing; each other offering Share while none
 * is shared and nothing while one is; and the shared port last where the
 * sandbox no longer lists it, so its link can still be stopped.
 */
export function portRows(view: Pick<HostedPorts, "ports" | "shared">): readonly PortRow[] {
  const { shared } = view;

  const rows = view.ports.map(({ port, label }): PortRow => {
    if (shared?.port === port) return { port, label, url: shared.url, acts: SHARED_ACTS };

    return { port, label, url: undefined, acts: shared === undefined ? [PORT_ACT.SHARE] : [] };
  });

  if (shared === undefined || view.ports.some(({ port }) => port === shared.port)) return rows;

  return [...rows, { port: shared.port, label: undefined, url: shared.url, acts: SHARED_ACTS }];
}
