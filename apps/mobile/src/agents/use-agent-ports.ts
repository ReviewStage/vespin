/**
 * use-agent-ports.ts -- a cloud agent's listening ports as its Ports sheet lists them: each port and what serves it, the one shared by a public link, and Share, Open link, Copy link, and Stop sharing, as the panel's plug offers them where it forwards nothing.
 *
 * The ports, what stands where none is listed, and what each row offers are
 * the panel's (`@repo/features/agent-ports-model`), read through the host
 * (`AGENTS_PORTS`, `AGENTS_PORT_SHARED`) every few seconds while the sheet
 * stands, never waking a stopped sandbox. A shared port's link opens in
 * Safari or is copied. A share or its close
 * (`AGENTS_PORT_SHARE`, `AGENTS_PORT_UNSHARE`) lays its answer over the link
 * read, and one that did not go says why under the list, in the panel's
 * words. A phone reaches no port of the sandbox itself, so a port opens in
 * Safari by its shared link alone.
 */

import {
  AGENT_PORTS_WORDS,
  hostedPorts,
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
import { useState } from "react";
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

/** The ports of the agent `agentId` names, read every few seconds while the sheet stands. */
export function useAgentPorts(agentId: string): AgentPorts {
  const acts = useHostActs();
  const write = useWrite();
  const queries = useQueryClient();
  const [note, setNote] = useState<string | undefined>(undefined);
  const sharedKey = [QUERY_ROOT.SHARED, agentId];

  const { data: listed } = useQuery({
    queryKey: [QUERY_ROOT.PORTS, agentId],
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

  const view = hostedPorts(listed, linked);

  /** Lays what the service now shares over the link read. */
  const laid = (shared: AgentSharedPortAnswerView) => queries.setQueryData(sharedKey, shared);

  const share = (port: number | null) => {
    setNote(undefined);

    if (port === null) {
      void write(
        () =>
          acts[ACT_KIND.AGENTS_PORT_UNSHARE]({ agentId }).then((answer) => {
            if ("shared" in answer) laid(answer);

            return answer;
          }),
        {
          refused: (answer) => ("shared" in answer ? undefined : AGENT_PORTS_WORDS.NOT_UNSHARED),
          unanswered: AGENT_PORTS_WORDS.NOT_UNSHARED,
          inPlace: setNote,
          went: BUZZ.SUCCESS,
        },
      );

      return;
    }

    void write(
      () =>
        acts[ACT_KIND.AGENTS_PORT_SHARE]({ agentId, port }).then((answer) => {
          if ("url" in answer) laid({ shared: { port, url: answer.url } });

          return answer;
        }),
      {
        refused: (answer) => ("url" in answer ? undefined : AGENT_PORTS_WORDS.NOT_SHARED),
        unanswered: AGENT_PORTS_WORDS.NOT_SHARED,
        inPlace: setNote,
        went: BUZZ.SUCCESS,
      },
    );
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
    rows: portRows(view),
    none: view.none,
    linkNote: view.linkFailed ? AGENT_PORTS_WORDS.LINK_NOT_READ : undefined,
    share,
    copy,
    note,
  };
}
