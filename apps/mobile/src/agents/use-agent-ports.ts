/**
 * use-agent-ports.ts -- a cloud agent's listening ports as its Ports sheet lists them: each port and what serves it, the one shared by a public link, and Share, Open link, Copy link, and Stop sharing, as the panel's plug offers them where it forwards nothing.
 *
 * The ports, what stands where none is listed, and what each row offers are
 * the panel's (`@repo/features/agent-ports-model`), read through the host
 * (`AGENTS_PORTS`, `AGENTS_PORT_SHARED`) every few seconds while the sheet
 * stands, never waking a stopped sandbox. A shared port's link opens in
 * Safari or is copied. A share or its close
 * (`AGENTS_PORT_SHARE`, `AGENTS_PORT_UNSHARE`) draws at once, the port
 * standing shared with only Stop sharing until the service mints its link,
 * then lays its answer over the link read; one that did not go rolls back to
 * what the service holds and says why under the list, in the panel's words.
 * A phone reaches no port of the sandbox itself, so a port opens in Safari by
 * its shared link alone.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import {
  AGENT_PORTS_WORDS,
  type HostedPorts,
  hostedPorts,
  PORT_ACT,
  PORTS_LOOK_EVERY_MS,
  type PortRow,
  portRows,
} from "@repo/features/agent-ports-model";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import type { AgentSharedPortAnswerView } from "@repo/features/port-forward-acts";
import { ACT_KIND } from "@repo/host/acts";
import { BUZZ, buzz } from "@repo/ui-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { setStringAsync } from "expo-clipboard";
import { useRef, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useWrite } from "../use-write.js";
import { useFollowedAgent } from "./use-agent.js";

/** Where the reads this hook makes are kept among the app's queries. */
const QUERY_ROOT = {
  PORTS: "agent-ports",
  SHARED: "agent-shared-port",
} as const;

/** Whether the agent `agentId` names has ports to list: one that runs in the cloud, read once the list holds it. */
export function useAgentHasPorts(agentId: string): boolean {
  const agent = useFollowedAgent(agentId);

  return agent !== undefined && agent.machine !== AGENT_MACHINE.DEVICE;
}

/** The agent's ports as its sheet draws them. */
export interface AgentPorts {
  readonly rows: readonly PortRow[];
  /** What stands where no port is listed. */
  readonly none: string;
  /** Why the shared link could not be read, where it could not; none otherwise. */
  readonly linkNote: string | undefined;
  /** Shares `port` by a public link, or closes the shared one with `null`. */
  readonly share: (port: number | null) => void;
  /** Copies a shared port's link. */
  readonly copy: (url: string) => void;
  /** Why the last share, its close, or a copy did not go; none while none failed. */
  readonly note: string | undefined;
}

/** What a copy of a link that did not go says. */
const NOT_COPIED = "The link could not be copied.";

/** The link a port shared at once stands with until the service mints its own, which offers no Open or Copy. */
const LINK_UNMINTED = "";

/** A share or its close drawn before the service answers: the port picked, or `null` for none shared. */
interface PickedShare {
  readonly port: number | null;
}

/** The ports as the service holds them, with the pick not yet answered laid over them. */
function pickedView(view: HostedPorts, picked: PickedShare | undefined): HostedPorts {
  if (picked === undefined) return view;

  if (picked.port === null) return { ...view, shared: undefined, linkRead: true };

  return { ...view, shared: { port: picked.port, url: LINK_UNMINTED }, linkRead: true };
}

/** A row as the sheet draws it: a port shared at once offers only Stop sharing until its link is minted. */
function drawnRow(row: PortRow): PortRow {
  if (row.url !== LINK_UNMINTED) return row;

  return { ...row, acts: row.acts.filter((act) => act === PORT_ACT.STOP_SHARING) };
}

/** The ports of the agent `agentId` names, read every few seconds while the sheet stands. */
export function useAgentPorts(agentId: string): AgentPorts {
  const acts = useHostActs();
  const write = useWrite();
  const queries = useQueryClient();
  const [note, setNote] = useState<string | undefined>(undefined);
  const [picked, setPicked] = useState<PickedShare | undefined>(undefined);
  // Note that picks go to the service one after another, so two never race to say which port is shared; a pick a newer one replaced before it went is never sent.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const newest = useRef(0);

  // Note that the reads are kept under the account signed in, so another account's never draws from them.
  const { data: accountId } = useQuery({
    ...appStateQuery,
    select: (state) => signedInAccountId(state.account),
  });

  const sharedKey = [QUERY_ROOT.SHARED, accountId, agentId];

  const { data: listed } = useQuery({
    queryKey: [QUERY_ROOT.PORTS, accountId, agentId],
    refetchInterval: PORTS_LOOK_EVERY_MS,
    retry: false,
    queryFn: () => acts[ACT_KIND.AGENTS_PORTS]({ agentId }),
  });

  const { data: linked } = useQuery({
    queryKey: sharedKey,
    refetchInterval: PORTS_LOOK_EVERY_MS,
    retry: false,
    queryFn: () => acts[ACT_KIND.AGENTS_PORT_SHARED]({ agentId }),
  });

  const view = pickedView(hostedPorts(listed, linked), picked);

  /** Lays what the service now shares over the link read, a read still out let go first so it never lands over it. */
  const laid = (shared: AgentSharedPortAnswerView) =>
    queries
      .cancelQueries({ queryKey: sharedKey })
      .then(() => queries.setQueryData(sharedKey, shared));

  /** Sends one pick, laying the service's answer over the link read; whether it landed. */
  // Note that a refusal is said only while its pick is still the newest, so one a later pick overtook never stands beside what that pick shared.
  const sayFor = (turn: number) => (words: string) => {
    if (turn === newest.current) setNote(words);
  };

  const sent = (port: number | null, turn: number): Promise<boolean> => {
    if (port === null) {
      return write(
        () =>
          acts[ACT_KIND.AGENTS_PORT_UNSHARE]({ agentId }).then(async (answer) => {
            if ("shared" in answer) await laid(answer);

            return answer;
          }),
        {
          refused: (answer) => ("shared" in answer ? undefined : AGENT_PORTS_WORDS.NOT_UNSHARED),
          unanswered: AGENT_PORTS_WORDS.NOT_UNSHARED,
          inPlace: sayFor(turn),
          went: BUZZ.SUCCESS,
        },
      );
    }

    return write(
      () =>
        acts[ACT_KIND.AGENTS_PORT_SHARE]({ agentId, port }).then(async (answer) => {
          if ("url" in answer) await laid({ shared: { port, url: answer.url } });

          return answer;
        }),
      {
        refused: (answer) => ("url" in answer ? undefined : AGENT_PORTS_WORDS.NOT_SHARED),
        unanswered: AGENT_PORTS_WORDS.NOT_SHARED,
        inPlace: sayFor(turn),
        went: BUZZ.SUCCESS,
      },
    );
  };

  // Note that the pick draws at once and the newest one is what stands; once it is answered, landed or not, the overlay goes, so the service's own read draws.
  const share = (port: number | null) => {
    newest.current += 1;
    const turn = newest.current;
    setNote(undefined);
    setPicked({ port });

    queue.current = queue.current.then(async () => {
      if (turn !== newest.current) return;
      await sent(port, turn);

      if (turn === newest.current) setPicked(undefined);
    });
  };

  const copy = (url: string) => {
    setNote(undefined);
    setStringAsync(url)
      .then(() => buzz(BUZZ.SUCCESS))
      .catch((cause: unknown) => {
        console.error(NOT_COPIED, cause);
        setNote(NOT_COPIED);
      });
  };

  return {
    rows: portRows(view).map(drawnRow),
    none: view.none,
    linkNote: view.linkFailed ? AGENT_PORTS_WORDS.LINK_NOT_READ : undefined,
    share,
    copy,
    note,
  };
}
