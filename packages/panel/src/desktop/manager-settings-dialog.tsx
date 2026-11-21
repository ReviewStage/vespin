/**
 * manager-settings-dialog.tsx -- a Manager's Settings: New Manager's card in its edit look, which its menu's Settings… opens wherever its menu stands, to change the Manager as it stands.
 *
 * A Manager is configured in one place, so its menu offers Settings… where
 * a coder's offers Rename (`agent-actions.tsx`). The card is New Manager's
 * own (`ManagerCard`), filled from the Manager: its Name, the agent's title;
 * its Face, which any face may be picked for, another Manager's too; its Model and effort; and its Repositories and Machine, held as it was
 * made, saying so, since neither changes after. Of those the client holds
 * only the first repository, its checkout (`ListedAgent.repository`), so
 * that is the one the card names. Save sends what changed, the name through
 * the agent's rename (`AgentsControl.rename`), the act a coder's Rename
 * sends, the face through its own act (`AgentsControl.onFace`), which the
 * host draws at once wherever the Manager is drawn, and the model and effort
 * through the act the composer's model chip sends (`AgentsControl.onChoose`);
 * a Save that changed nothing sends nothing. A refusal stands in the card saying why, with what was typed
 * and picked kept for another try.
 */

import { chooseFailureNote } from "@repo/features/agent-refusal-words";
import { AGENT_MACHINE, type AgentSummary, agentMachineOf } from "@repo/features/agent-wire";
import type { ManagerFace } from "@repo/features/manager-face";
import type { MacOffer, ModelChoice } from "@repo/features/models-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { useConfirmDialog } from "@repo/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { appPlatform } from "../app-platform.js";
import { ANSWER_ACCEPTED, refusedWith, useConfirmAct } from "../confirm-act.js";
import { confirmFailure } from "../failure-report.js";
import { RENAME_FAILED } from "../tasks/agent-model.js";
import type { RepositoryChooser } from "../tasks/repository-chip.js";
import type { OfferedPlace } from "../tasks/runs-on.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import { appStateQuery, selectFixtureStaged } from "../use-app-state.js";
import { MANAGER_CARD, ManagerCard } from "./new-manager-dialog.js";
import { useFormDialog } from "./use-form-dialog.js";

/** What the card says where Save is pressed with no name. */
const NAME_ASKED = "Name the Manager.";

/** What the card says where the face was not saved. */
const FACE_FAILED = "Couldn't change the Manager's face.";

/** No device, while the member's devices are not read. */
const NO_DEVICES: readonly MacOffer[] = [];

/** No repository, for a Manager the client holds none of. */
const NO_REPOSITORIES: readonly string[] = [];

/** What a Manager's Settings reads of it. */
export type ManagerSettingsSubject = Pick<
  AgentSummary,
  "id" | "title" | "model" | "effort" | "contextWindow" | "runtime" | "machine" | "mac" | "face"
> & {
  /** The workspace it is in, whose repositories its card's chip names; none where the surface does not know it. */
  readonly workspaceId?: string | undefined;
  /** Its checkout, the first repository it works in; none where the surface does not know it. */
  readonly repository?: string | null | undefined;
};

/** A Manager's Settings: the press that opens the card, and the card. */
export interface ManagerSettingsAsk {
  readonly ask: () => void;
  readonly dialog: React.JSX.Element;
}

/** The choice a Manager runs on. */
function choiceOf(agent: ManagerSettingsSubject): ModelChoice {
  return {
    model: agent.model,
    effort: agent.effort,
    ...(agent.contextWindow === undefined ? undefined : { contextWindow: agent.contextWindow }),
  };
}

/** Whether two choices are one. */
function sameChoice(one: ModelChoice, other: ModelChoice): boolean {
  return (
    one.model === other.model &&
    one.effort === other.effort &&
    one.contextWindow === other.contextWindow
  );
}

/** Whether two faces are one; none is no face. */
function sameFace(one: ManagerFace | undefined, other: ManagerFace | undefined): boolean {
  return one?.character === other?.character && one?.color === other?.color;
}

/** Where a Manager runs: the device it runs on, from the member's devices where they list it, else as the Manager names it, or the workspace's machine as it names it; none for one in the cloud. */
function placeOf(
  agent: ManagerSettingsSubject,
  devices: readonly MacOffer[],
): OfferedPlace | undefined {
  const { mac } = agent;

  if (mac?.deviceId === undefined) return undefined;

  switch (agentMachineOf(agent)) {
    case AGENT_MACHINE.VERCEL:
      return undefined;
    case AGENT_MACHINE.DEVICE:
      return {
        machine: AGENT_MACHINE.DEVICE,
        device: devices.find((each) => each.deviceId === mac.deviceId) ?? {
          deviceId: mac.deviceId,
          name: mac.name,
          providers: [],
        },
      };
    case AGENT_MACHINE.WORKSPACE:
      return {
        machine: AGENT_MACHINE.WORKSPACE,
        deviceId: mac.deviceId,
        name: mac.name,
        owned: undefined,
      };
  }
}

/** The Settings card for `agent`, a Manager, saved through `agents`; the card stands only while `shown`. */
export function useManagerSettingsDialog(
  agent: ManagerSettingsSubject,
  agents: Pick<
    AgentsControl,
    "rename" | "onChoose" | "onFace" | "models" | "modelsFailed" | "readModels" | "macs"
  >,
  shown: boolean,
): ManagerSettingsAsk {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<ModelChoice | undefined>(undefined);
  const [pickedFace, setPickedFace] = useState<ManagerFace | undefined>(undefined);
  const field = useRef<HTMLInputElement | null>(null);
  const renaming = useMutation(agents.rename.options);
  const staged = useQuery({ ...appStateQuery, select: selectFixtureStaged }).data === true;
  const trimmed = name.trim();
  const standing = choiceOf(agent);
  const choice = picked ?? standing;
  const face = pickedFace ?? agent.face;

  // Note that the name, the face, and the choice are sent one after the other, so a refused one leaves those after it as they stood.
  const saving = useMutation({
    mutationFn: async (): Promise<ActionResult> => {
      if (trimmed !== (agent.title ?? "")) {
        const renamed = await renaming.mutateAsync(agents.rename.ask(agent.id, trimmed));

        if (agents.rename.refused(renamed)) {
          return { status: ACTION_RESULT_STATUS.REJECTED, reason: RENAME_FAILED };
        }
      }

      if (face !== undefined && !sameFace(face, agent.face)) {
        const faced = await agents.onFace(agent.id, face);

        if ("failure" in faced)
          return { status: ACTION_RESULT_STATUS.REJECTED, reason: FACE_FAILED };
      }

      if (sameChoice(choice, standing)) return ANSWER_ACCEPTED;
      const chosen = await agents.onChoose(agent.id, choice);

      return "failure" in chosen
        ? { status: ACTION_RESULT_STATUS.REJECTED, reason: chooseFailureNote(chosen.failure) }
        : ANSWER_ACCEPTED;
    },
  });

  const confirmAct = useConfirmAct(saving, {
    refusedFirst: (): ActionResult | undefined =>
      trimmed === "" ? { status: ACTION_RESULT_STATUS.REJECTED, reason: NAME_ASKED } : undefined,
    send: () => saving.mutateAsync(),
    answered: (answer: ActionResult) => answer,
    failed: refusedWith,
  });

  const confirm = useConfirmDialog(
    { subject: true, surfaceOpen: shown },
    confirmAct,
    confirmFailure(FAILURE_SURFACE.MANAGER_SETTINGS),
  );

  const form = useFormDialog(confirm, trimmed !== "");

  // Note that a refusal alone holds the card up, so a change asks the question again rather than clearing it.
  const changed = () => {
    if (confirm.rejection !== undefined) confirm.ask();
  };

  const devices = agents.macs ?? NO_DEVICES;

  // Note that the chip is held, so its chooser lists the workspace's repositories only to name the one it holds.
  const chooser: RepositoryChooser = {
    recent: NO_REPOSITORIES,
    openGitHub: (url) => appPlatform().openWeb(url),
    pictures: !staged,
    scope: agent.workspaceId,
    manages: false,
  };

  const dialog = (
    <ManagerCard
      look={MANAGER_CARD.EDIT}
      form={form}
      field={field}
      name={{
        value: name,
        onChange: (next) => {
          setName(next);
          changed();
        },
      }}
      face={{
        value: face,
        onChange: (next) => {
          setPickedFace(next);
          changed();
        },
      }}
      repositories={{
        values: agent.repository == null ? NO_REPOSITORIES : [agent.repository],
        chooser,
        onToggle: () => undefined,
      }}
      machine={{ devices, place: placeOf(agent, devices), onChoose: () => undefined }}
      model={{
        choice,
        choose: (next) => {
          setPicked(next);
          changed();
        },
        runtime: agent.runtime,
        models: agents.models,
        modelsFailed: agents.modelsFailed,
        readModels: agents.readModels,
      }}
    />
  );

  return {
    ask: () => {
      setName(agent.title ?? "");
      setPicked(undefined);
      setPickedFace(undefined);
      saving.reset();
      // Note that the catalog is read as the card opens, so Model lists it as it stands.
      agents.readModels();
      confirm.ask();
    },
    dialog,
  };
}
