/**
 * use-agent-move.ts -- an agent's Move to on its page: the places it may be moved to in place, the cloud and the member's devices, and the move itself, stopping the agent first while it writes.
 *
 * The panel's Move to › (`@repo/panel`'s `move-agent.tsx`) on the phone,
 * behind the member's Move agents experiment as there, and only for an
 * agent the task list holds and that is not archived. The places are the
 * panel's (`@repo/features/agent-move-model`): the cloud for an agent on a
 * device, and each device of the member's but its own, named as every list
 * of machines names it, each saying under its name that the agent is
 * stopped first or that only pushed work comes along. A move of an agent
 * still writing sends Stop first and moves it only once the Stop took, so
 * its session ends on a whole step; a Stop refused, or with nothing to stop
 * yet, moves nothing. The move is sent as the panel sends it
 * (`AGENTS_MOVE`), and why it did not go is said over the composer.
 */

import {
  type MovedAgent,
  moveDetail,
  movePlaces,
  TO_THE_CLOUD,
} from "@repo/features/agent-move-model";
import { MOVE_FAILED, STOP_FAILED, STOP_NOTHING_YET } from "@repo/features/agent-refusal-words";
import type { AgentRunsOnRequest } from "@repo/features/agent-wire";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { machineName } from "@repo/features/machine-name";
import { agentStillWriting, RUNS_ON_WORDS } from "@repo/features/task-agents-model";
import { ACT_KIND } from "@repo/host/acts";
import { selectExperiment } from "@repo/host/app-state-reads";
import { EXPERIMENT } from "@repo/settings";
import { BUZZ, type Glyph, runsOnGlyph } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useModelCatalog } from "../tasks/use-start.js";
import { useWrite } from "../use-write.js";

/** One place Move to offers: its name, its glyph, what it says under its name, and the move there. */
export interface MovePlace {
  readonly key: string;
  readonly label: string;
  readonly glyph: Glyph;
  readonly detail: string | undefined;
  readonly onPress: () => void;
}

/** An agent's Move to: the places it offers, and why the last move did not go. */
export interface AgentMove {
  /** The places, the cloud first; none where no move is offered or the agent has nowhere to go. */
  readonly places: readonly MovePlace[] | undefined;
  readonly note: string | undefined;
}

/** The agents a move is out for, from its Stop to its answer, so a second pick meanwhile is dropped, as the panel drops it. */
const MOVING = new Set<string>();

/**
 * The Move to of the agent `agent` names, the task list's own row of it,
 * none before it is read: its places, and the move to each.
 */
export function useAgentMove(agent: MovedAgent | undefined): AgentMove {
  const acts = useHostActs();
  const write = useWrite();
  const [note, setNote] = useState<string | undefined>(undefined);

  const on =
    useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.MOVE_AGENTS) }).data === true;

  const catalog = useModelCatalog();

  if (!on || agent === undefined || agent.archivedAt !== undefined) {
    return { places: undefined, note };
  }

  const agentId = agent.id;
  // Note that a device still setting itself up takes no agent, so it is not offered, as Runs on leaves it out.
  const devices = (catalog?.macs ?? []).filter((device) => device.setup === undefined);
  const places = movePlaces(agent, devices);
  const detail = moveDetail(agent);
  const writing = agentStillWriting(agent.status);

  // Note that the Stop's answer is read before the move goes, so a Stop with nothing to stop yet moves nothing.
  const stopped = (): Promise<boolean> =>
    acts[ACT_KIND.AGENTS_STOP]({ agentId }).then(
      (answer) => {
        if ("failure" in answer) {
          setNote(STOP_FAILED);

          return false;
        }

        if (agentStillWriting(answer.agent.status)) {
          setNote(STOP_NOTHING_YET);

          return false;
        }

        return true;
      },
      () => {
        setNote(STOP_FAILED);

        return false;
      },
    );

  const move = (runsOn: AgentRunsOnRequest) => async () => {
    if (MOVING.has(agentId)) return;
    MOVING.add(agentId);
    setNote(undefined);

    try {
      if (writing && !(await stopped())) return;
      await write(() => acts[ACT_KIND.AGENTS_MOVE]({ agentId, runsOn }), {
        refused: (answer) => ("failure" in answer ? MOVE_FAILED : undefined),
        unanswered: MOVE_FAILED,
        inPlace: setNote,
        went: BUZZ.SUCCESS,
      });
    } finally {
      MOVING.delete(agentId);
    }
  };

  const listed: readonly MovePlace[] = [
    ...(places.cloud
      ? [
          {
            key: AGENT_MACHINE.VERCEL,
            label: RUNS_ON_WORDS.CLOUD,
            glyph: runsOnGlyph({ cloud: true }),
            detail,
            onPress: () => void move(TO_THE_CLOUD)(),
          },
        ]
      : []),
    ...places.devices.map((device) => ({
      key: device.deviceId,
      label: machineName(device, devices, undefined),
      glyph: runsOnGlyph({ cloud: false, platform: device.platform }),
      detail,
      onPress: () => void move({ machine: AGENT_MACHINE.DEVICE, deviceId: device.deviceId })(),
    })),
  ];

  return { places: listed.length === 0 ? undefined : listed, note };
}
