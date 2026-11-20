/**
 * new-manager-dialog.tsx -- New Manager: the card the Managers head's + opens, which makes a Manager and opens its page.
 *
 * A Manager is an agent of kind `manager` on no task that its workspace
 * shares (`manager-wire.ts`). The card asks its name, kept as typed, since
 * no generated title ever replaces a Manager's; the repositories it works
 * in, one or more, picked from New task's own list (`RepositoriesChip`),
 * the first its checkout, which stands on New task's own default until a
 * pick (`repository-default.ts`); its Face, none picked until a press, so
 * the service picks one no other Manager of the workspace wears unless the
 * member picks one, which then stands whoever else wears it; its Machine, where it runs, New task's
 * Runs on chip on the member's last pick (`runs-on.tsx`); and its model and effort, the
 * agent box's model chip on the account's default until one is picked. It
 * asks no charter: the Manager introduces itself on its first turn. Create
 * makes it in the sidebar's workspace (`AGENTS_CREATE_MANAGER`), which the
 * live task list then carries to the Managers list, and opens the new Manager's page; a refusal stands
 * in the card saying why, with what was picked kept for another try, under
 * the same key until a field changes or the place it runs on moves, when
 * the request takes a new one.
 * After that only its model and effort change, from its own box. Where the
 * member's last pick is a device, Create waits on a read of the member's
 * devices made since the card opened (`useDevicesRead`), as New task's
 * Start does, since a Create before it would name none. The card itself is
 * `ManagerCard`, which a Manager's Settings draws too in its edit look
 * (`manager-settings-dialog.tsx`), so the two never look apart.
 */

import { startFailureWords } from "@repo/features/agent-refusal-words";
import { AGENT_CALL_FAILURE, type AgentCallFailure } from "@repo/features/agent-view";
import { AGENT_BOUNDS, type AgentRuntime } from "@repo/features/agent-wire";
import type { ManagerFace } from "@repo/features/manager-face";
import type { CatalogModel, MacOffer, ModelChoice } from "@repo/features/models-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { TaskRunsOnRequest } from "@repo/features/task-wire";
import { readFailedWords, readingWords } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import {
  CHIP_LOOK,
  CHIP_WIDTH,
  DIALOG_TONE,
  Dialog,
  DialogActions,
  ErrorState,
  FormField,
  Spinner,
  Stack,
  TextField,
  useConfirmDialog,
} from "@repo/ui";
import { ManagerFacePicker } from "@repo/ui/manager-face-picker";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useAgentDefault } from "../account-choices.js";
import { askAct } from "../act.js";
import { refusedWith, useConfirmAct } from "../confirm-act.js";
import { confirmFailure, unreadShown } from "../failure-report.js";
import { modelsRunOn } from "../tasks/agent-model.js";
import { AgentModelChip } from "../tasks/agent-model-chip.js";
import { CHIP_PLACE, RepositoriesChip, type RepositoryChooser } from "../tasks/repository-chip.js";
import { useRepositoryDefault } from "../tasks/repository-default.js";
import {
  NewTaskRunsOnChip,
  newTaskRunsOn,
  useDevicesRead,
  useNewTaskRunsOn,
} from "../tasks/runs-on.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { type FormDialog, useFormDialog } from "./use-form-dialog.js";

/** The card's title, and what its + is named. */
export const NEW_MANAGER = "New Manager";

/** No device, before the member's devices are read. */
const NO_DEVICES: readonly never[] = [];

/** What the card says where Create is pressed with no name or no repository. */
const NAME_ASKED = "Name the Manager.";
const REPOSITORY_ASKED = "Choose a repository for the Manager.";

/** What a refused Create says, by why: a Start's words, but for the refusals a Manager's Create means otherwise. */
function createFailureWords(failure: AgentCallFailure): string {
  switch (failure) {
    case AGENT_CALL_FAILURE.NOT_FOUND:
      return "This workspace can't be reached.";
    case AGENT_CALL_FAILURE.NOT_PERMITTED:
      return "Managers are off for this workspace.";
    default:
      return startFailureWords(failure);
  }
}

/** Whether two places are one: the cloud, or the same device. */
function sameRunsOn(one: TaskRunsOnRequest, other: TaskRunsOnRequest): boolean {
  return (
    one.machine === other.machine &&
    ("deviceId" in one ? one.deviceId : undefined) ===
      ("deviceId" in other ? other.deviceId : undefined)
  );
}

function refused(reason: string): ActionResult {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** Which card a Manager's card is: New Manager, which makes one, or a Manager's Settings, which changes one. */
export const MANAGER_CARD = {
  CREATE: "create",
  EDIT: "edit",
} as const;

type ManagerCardLook = (typeof MANAGER_CARD)[keyof typeof MANAGER_CARD];

/** What each card is titled and what its act says. */
const CARD_WORDS = {
  [MANAGER_CARD.CREATE]: {
    title: NEW_MANAGER,
    verb: "Create Manager",
    running: "Creating Manager",
  },
  [MANAGER_CARD.EDIT]: { title: "Manager settings", verb: "Save", running: "Saving" },
} as const satisfies Record<ManagerCardLook, { title: string; verb: string; running: string }>;

/** What the Face row says in New Manager while no face is picked, where the service picks one. */
const FACE_PICKED_FOR_YOU =
  "One no other Manager here wears is picked for you, unless you choose one.";

/** What the Repositories and Machine rows say in a Manager's Settings, where they stand as made. */
const FIXED_AFTER_CREATE = "Fixed once the Manager is made.";

/** What a Manager's card draws its Model row from: the choice standing, how it changes, and the catalog it is picked from. */
export interface ManagerCardModel {
  readonly choice: ModelChoice | undefined;
  readonly choose: (next: ModelChoice) => void;
  /** The harness the Manager runs on, which narrows the models offered; none before it is made. */
  readonly runtime: AgentRuntime | undefined;
  readonly models: readonly CatalogModel[] | undefined;
  readonly modelsFailed: boolean;
  readonly readModels: () => void;
  /** The account's default model's read, which the choice stands on until one is read; none where the choice is the Manager's own. */
  readonly defaultRead?:
    | { readonly failed: boolean; readonly retry: () => Promise<void> }
    | undefined;
}

/**
 * A Manager's card, New Manager's and a Manager's Settings' alike, so the
 * two never look apart: its Name, its Face, its Repositories, its Machine,
 * and its Model, in that order. In a Manager's Settings (`MANAGER_CARD.EDIT`) its
 * Repositories and Machine stand as it was made, held and saying so, and its
 * act is Save; a field added to a Manager slots in here for both.
 */
export function ManagerCard({
  look,
  form,
  field,
  name,
  face,
  repositories,
  machine,
  model,
}: {
  look: ManagerCardLook;
  form: FormDialog;
  field: React.RefObject<HTMLInputElement | null>;
  name: { readonly value: string; readonly onChange: (next: string) => void };
  /** The face standing, none until a pick at New Manager, and how a pick changes it. */
  face: {
    readonly value: ManagerFace | undefined;
    readonly onChange: (next: ManagerFace) => void;
  };
  repositories: {
    readonly values: readonly string[];
    readonly chooser: RepositoryChooser;
    readonly onToggle: (repository: string) => void;
    readonly onListed?: ((repositories: readonly string[]) => void) | undefined;
  };
  machine: {
    readonly devices: readonly MacOffer[];
    readonly device: MacOffer | undefined;
    readonly onChoose: (deviceId: string | undefined) => void;
  };
  model: ManagerCardModel;
}): React.JSX.Element {
  const words = CARD_WORDS[look];
  const fixed = look === MANAGER_CARD.EDIT;
  const { choice, defaultRead } = model;

  return (
    <Dialog
      open={form.open}
      title={words.title}
      replayUnmasked
      busy={form.settling}
      refused={form.refusal !== undefined}
      initialFocus={field}
      onDismiss={form.dismiss}
      actions={
        <DialogActions
          onCancel={form.dismiss}
          act={{
            verb: words.verb,
            tone: DIALOG_TONE.PRIMARY,
            running: words.running,
            ...form.act,
          }}
        />
      }
    >
      <Stack>
        <FormField label="Name" error={form.refusal}>
          {(control) => (
            <TextField
              ref={field}
              field={control}
              spellCheck={false}
              placeholder="Release captain"
              maxLength={AGENT_BOUNDS.MAX_TITLE_CHARS}
              value={name.value}
              disabled={form.settling}
              onEnter={form.submit}
              onChange={name.onChange}
            />
          )}
        </FormField>
        <FormField
          label="Face"
          description={face.value === undefined ? FACE_PICKED_FOR_YOU : undefined}
        >
          {(control) => (
            <ManagerFacePicker
              face={face.value}
              disabled={form.settling}
              describedBy={control["aria-describedby"]}
              onChange={face.onChange}
            />
          )}
        </FormField>
        <FormField label="Repositories" description={fixed ? FIXED_AFTER_CREATE : undefined}>
          {(control) => (
            <RepositoriesChip
              place={CHIP_PLACE.FIELD}
              width={CHIP_WIDTH.FIELD}
              describedBy={control["aria-describedby"]}
              held={fixed ? FIXED_AFTER_CREATE : undefined}
              values={repositories.values}
              chooser={repositories.chooser}
              onToggle={repositories.onToggle}
              onListed={repositories.onListed}
            />
          )}
        </FormField>
        <FormField label="Machine" description={fixed ? FIXED_AFTER_CREATE : undefined}>
          {() => (
            <NewTaskRunsOnChip
              devices={machine.devices}
              device={machine.device}
              disabled={fixed || form.settling}
              narrow={false}
              look={CHIP_LOOK.FIELD}
              width={CHIP_WIDTH.FIELD}
              onChoose={machine.onChoose}
            />
          )}
        </FormField>
        <FormField label="Model">
          {() =>
            choice !== undefined ? (
              <AgentModelChip
                model={{ choice, note: undefined, choose: model.choose, runtime: model.runtime }}
                models={model.models}
                modelsFailed={model.modelsFailed}
                readModels={model.readModels}
                usage={undefined}
                look={CHIP_LOOK.FIELD}
                width={CHIP_WIDTH.FIELD}
                startsNew={!fixed}
              />
            ) : defaultRead?.failed === true ? (
              <ErrorState
                failure={unreadShown(FAILURE_SURFACE.AGENT_DEFAULTS_READ)}
                onRetry={() => void defaultRead.retry()}
              >
                {readFailedWords("your default model")}
              </ErrorState>
            ) : (
              <Spinner delay label={readingWords("your default model")} />
            )
          }
        </FormField>
      </Stack>
    </Dialog>
  );
}

/** New Manager: the press that opens the card, and the card. */
export interface NewManagerAsk {
  readonly ask: () => void;
  readonly dialog: React.JSX.Element;
}

/** The New Manager card for the sidebar's workspace, opening the Manager made through `onOpen`. */
export function useNewManagerDialog({
  tasks,
  onOpen,
}: {
  tasks: Pick<TasksControl, "newTask" | "workspace" | "signedIn">;
  /** Opens a Manager's page by its agent's id. */
  onOpen: (agentId: string) => void;
}): NewManagerAsk {
  const { newTask } = tasks;
  const workspaceId = tasks.workspace?.id;
  const [name, setName] = useState("");
  const chooser = newTask.repositoriesIn(workspaceId);
  const workspace = newTask.workspaces.find((each) => each.id === workspaceId);
  // Note that the first repository stands on New task's own default until a pick, and the rest are picked.
  const repositoryDefault = useRepositoryDefault(chooser, workspace, undefined);
  const [picks, setPicks] = useState<readonly string[] | undefined>(undefined);
  const [picked, setPicked] = useState<ModelChoice | undefined>(undefined);
  const [face, setFace] = useState<ManagerFace | undefined>(undefined);

  const repositories =
    picks ?? (repositoryDefault.repository === null ? [] : [repositoryDefault.repository]);

  const field = useRef<HTMLInputElement | null>(null);
  // Note that one key stands for each request, so a Create sent again unchanged after no answer makes one Manager.
  const key = useRef(crypto.randomUUID());
  // Where the last Create under `key` ran, so a place that moved with no field changed, a device leaving the list, takes a new key too.
  const sentOn = useRef<TaskRunsOnRequest | undefined>(undefined);

  const drawnDefault = useAgentDefault();
  const choice = picked ?? drawnDefault.choice;
  const devices = newTask.devices ?? NO_DEVICES;
  const [device, chooseDevice, keptDevice] = useNewTaskRunsOn(devices);
  // Note that the card stays mounted between openings, so each waits on a devices' read made since it opened.
  const [openedOn, setOpenedOn] = useState<number | undefined>(undefined);
  const devicesUnread = useDevicesRead(newTask.modelsRead, keptDevice, openedOn).unread;
  // Note that a model nothing of the account's pays for runs all the same on a picked device that runs its harness, on the device's own sign-in.
  const models = useMemo(() => modelsRunOn(newTask.models, device), [newTask.models, device]);

  const creating = useMutation({
    mutationKey: [ACT_KIND.AGENTS_CREATE_MANAGER, workspaceId],
    mutationFn: async (): Promise<ActionResult> => {
      const [first, ...rest] = repositories;
      const trimmed = name.trim();

      if (trimmed === "") return refused(NAME_ASKED);

      if (first === undefined) return refused(REPOSITORY_ASKED);

      if (workspaceId === undefined || choice === undefined) {
        return refused(createFailureWords(AGENT_CALL_FAILURE.UNANSWERED));
      }

      const runsOn = newTaskRunsOn(device);

      if (sentOn.current !== undefined && !sameRunsOn(sentOn.current, runsOn)) {
        key.current = crypto.randomUUID();
      }

      sentOn.current = runsOn;

      const answer = await askAct(ACT_KIND.AGENTS_CREATE_MANAGER, {
        idempotencyKey: key.current,
        workspaceId,
        name: trimmed,
        repositories: [first, ...rest],
        runsOn,
        model: choice.model,
        effort: choice.effort,
        // Note that a face is sent only once picked, so one left alone is the service's pick.
        ...(face === undefined ? undefined : { face }),
      });

      if (!("agent" in answer)) return refused(createFailureWords(answer.failure));
      onOpen(answer.agent.id);

      return { status: ACTION_RESULT_STATUS.ACCEPTED };
    },
  });

  const confirmAct = useConfirmAct(creating, {
    send: () => creating.mutateAsync(),
    answered: (answer: ActionResult) => answer,
    failed: refusedWith,
  });

  const confirm = useConfirmDialog(
    { subject: tasks.signedIn, surfaceOpen: true },
    confirmAct,
    confirmFailure(FAILURE_SURFACE.MANAGER_CREATE),
  );

  const valid =
    name.trim() !== "" &&
    repositories.length > 0 &&
    choice !== undefined &&
    workspaceId !== undefined &&
    !devicesUnread;

  const form = useFormDialog(confirm, valid);

  // Note that a change is a new request under a key of its own, so a retry after an edit never answers
  // the Manager an earlier, unanswered Create made; and that a refusal alone holds the card up, so a
  // change asks the question again rather than clearing it.
  const changed = () => {
    key.current = crypto.randomUUID();
    sentOn.current = undefined;

    if (confirm.rejection !== undefined) confirm.ask();
  };

  const toggle = (repository: string) => {
    const wanted = repository.toLowerCase();

    setPicks(
      repositories.some((each) => each.toLowerCase() === wanted)
        ? repositories.filter((each) => each.toLowerCase() !== wanted)
        : [...repositories, repository],
    );
    changed();
  };

  const dialog = (
    <ManagerCard
      look={MANAGER_CARD.CREATE}
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
          setFace(next);
          changed();
        },
      }}
      repositories={{
        values: repositories,
        chooser,
        onToggle: toggle,
        onListed: repositoryDefault.onListed,
      }}
      machine={{
        devices,
        device,
        onChoose: (deviceId) => {
          chooseDevice(deviceId);
          changed();
        },
      }}
      model={{
        choice,
        choose: (next) => {
          setPicked(next);
          changed();
        },
        runtime: undefined,
        models,
        modelsFailed: newTask.modelsFailed,
        readModels: newTask.readModels,
        defaultRead: drawnDefault,
      }}
    />
  );

  return {
    ask: () => {
      key.current = crypto.randomUUID();
      sentOn.current = undefined;
      setOpenedOn(newTask.modelsRead.generation);
      setName("");
      setPicks(undefined);
      setPicked(undefined);
      setFace(undefined);
      // Note that the devices and the catalog are read as the card opens, so Machine and Model list them as they stand.
      newTask.readModels();
      confirm.ask();
    },
    dialog,
  };
}
