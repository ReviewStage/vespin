/**
 * use-agent-model.ts -- an agent's model and effort as its page's picker changes them: the choice it runs on, the models and efforts it may move to, and why the last change did not take.
 *
 * The panel's chip (`@repo/panel`'s `use-agent-model.ts`) on the phone: a
 * pick is sent as the chip sends it (`AGENTS_CHOOSE`), and the host draws
 * the choice on the agent's row the moment it is asked, so the picker reads
 * it off the agent and a refusal the host takes back reads back too, its
 * words said under the picker until the next change. The models are the
 * ones New agent offers (`useModelCatalog`, `modelOptions`), narrowed to
 * what the agent's harness runs, as the chip narrows them
 * (`runtimeModels`); a pick of a model keeps the agent's effort where the
 * model lists it, else the nearest it lists (`effortFor`), its fast version
 * where the agent runs fast and the model has one, and its context window
 * where the model still offers a choice of one. Fast, the menu's switch, moves
 * the agent onto its model's fast version or back, offered only where the
 * harness runs one and the catalog lists one beside the model.
 */

import { chooseFailureNote } from "@repo/features/agent-refusal-words";
import { runtimeModels } from "@repo/features/agent-runtime-models";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { effortFor, effortsOf } from "@repo/features/model-effort";
import {
  type CatalogModel,
  MODEL_SPEED,
  MODEL_SPEED_SUFFIX,
  type ModelChoice,
  modelSpeedOf,
  standardModelIdOf,
} from "@repo/features/models-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { PickOption } from "@repo/ui-native";
import { useMemo, useRef, useState } from "react";
import { useHostActs } from "../host/host-provider.js";
import { effortOptions, modelOptions, useModelCatalog } from "../tasks/use-start.js";
import { useFollowedAgent } from "./use-agent.js";

/** No models read yet. */
const NO_MODELS: readonly CatalogModel[] = [];

/** The agent's model and effort, and the pickers that change them. */
export interface AgentModelPick {
  readonly models: readonly PickOption[];
  readonly efforts: readonly PickOption[];
  /** The model the agent runs, by its standard version's id, as the picker lists it; none before the agent is read. */
  readonly model: string | undefined;
  readonly effort: string | undefined;
  /** Why the last change did not take; none while none failed. */
  readonly note: string | undefined;
  readonly pickModel: (model: string) => void;
  readonly pickEffort: (effort: string) => void;
  /** Fast: whether the agent runs its model's fast version, and the switch; none where the model has none it may run. */
  readonly fast: { readonly on: boolean; readonly toggle: () => void } | undefined;
}

/** The catalog id a pick of a model sends: its version at the speed the agent runs, where the catalog offers one, else the model's own. */
function atSpeed(offered: readonly CatalogModel[], model: string, running: string): string {
  const speed = modelSpeedOf(running);
  if (speed === MODEL_SPEED.STANDARD) return model;
  const version = `${model}${MODEL_SPEED_SUFFIX[speed]}`;
  return offered.some(({ id }) => id === version) ? version : model;
}

/** The agent's model and effort, and the picks that change them from its next step. */
export function useAgentModelPick(agentId: string): AgentModelPick {
  const acts = useHostActs();
  const agent = useFollowedAgent(agentId);
  const read = useModelCatalog();
  const [note, setNote] = useState<string | undefined>(undefined);
  /** How many changes have been sent, so an answer to an earlier one is told apart from the latest. */
  const writes = useRef(0);
  const catalog = read?.models ?? NO_MODELS;
  const runtime = agent?.runtime;
  const offered = useMemo(() => runtimeModels(catalog, runtime), [catalog, runtime]);
  const models = useMemo(() => modelOptions(offered), [offered]);
  const model = agent === undefined ? undefined : standardModelIdOf(agent.model);

  const choose = (choice: ModelChoice) => {
    writes.current += 1;
    const write = writes.current;
    setNote(undefined);
    acts[ACT_KIND.AGENTS_CHOOSE]({ agentId, ...choice })
      .catch((error: unknown) => {
        console.error("The agent's model was not changed.", error);
        return { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;
      })
      .then((answer) => {
        if (write !== writes.current) return;
        setNote("failure" in answer ? chooseFailureNote(answer.failure) : undefined);
      });
  };

  // Note that the fast version is the catalog's, listed beside the model, so a model with none offers no switch.
  const fastId =
    model === undefined ? undefined : `${model}${MODEL_SPEED_SUFFIX[MODEL_SPEED.FAST]}`;
  const fastOffered = fastId !== undefined && offered.some(({ id }) => id === fastId);

  return {
    models,
    efforts: effortOptions(offered, model),
    model,
    effort: agent?.effort,
    note,
    pickModel: (picked) => {
      if (agent === undefined || picked === model) return;
      const id = atSpeed(offered, picked, agent.model);
      const effort = effortFor(effortsOf(offered, id), agent.effort);
      if (effort === undefined) return;
      const windows = offered.find((each) => each.id === id)?.contextWindows;
      choose({
        model: id,
        effort,
        ...(windows === undefined || agent.contextWindow === undefined
          ? undefined
          : { contextWindow: agent.contextWindow }),
      });
    },
    pickEffort: (effort) => {
      if (agent === undefined || effort === agent.effort) return;
      choose({
        model: agent.model,
        effort,
        ...(agent.contextWindow === undefined ? undefined : { contextWindow: agent.contextWindow }),
      });
    },
    fast:
      agent === undefined || model === undefined || fastId === undefined || !fastOffered
        ? undefined
        : {
            on: agent.model === fastId,
            toggle: () => {
              const id = agent.model === fastId ? model : fastId;
              const effort = effortFor(effortsOf(offered, id), agent.effort);
              if (effort === undefined) return;
              const windows = offered.find((each) => each.id === id)?.contextWindows;
              choose({
                model: id,
                effort,
                ...(windows === undefined || agent.contextWindow === undefined
                  ? undefined
                  : { contextWindow: agent.contextWindow }),
              });
            },
          },
  };
}
