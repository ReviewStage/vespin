/**
 * manager-settings-dialog.tsx -- a Manager's Settings: the sectioned settings dialog its Settings button and its menu's Settings… open, its General section changing the Manager as it stands, each row saving itself.
 *
 * The dialog is `@repo/ui`'s `SettingsDialog`, named by the Manager and
 * listing its sections down its start; General alone stands so far. Its
 * first card holds the Manager's Name, its Face, its Repositories, its
 * Machine, and its Model, in New Manager's order (`new-manager-dialog.tsx`),
 * and each saves as it is set, as a Settings row does, so the card has no
 * Save: the name as Return is pressed in it or the caret leaves it, through
 * the agent's rename (`AgentsControl.rename`), the act a coder's Rename
 * sends, a name emptied going back to the one standing; the face as it is
 * picked (`AgentsControl.onFace`) and the model and effort as they are
 * chosen (`AgentsControl.onChoose`), which the host draws at once wherever
 * the Manager is drawn. Repositories and Machine stand as it was made, held
 * and saying so, since neither changes after; of those the client holds
 * only the first repository, its checkout (`ListedAgent.repository`), so
 * that is the one the row names. A refusal is said under its row, what was
 * typed kept for another try.
 *
 * Its second card holds what a Manager's menu offers beside Settings: its
 * Archive, or its Unarchive once archived, which puts the dialog away as it
 * acts, since the Manager it changes leaves the sidebar, and its Permanently
 * delete, whose question stands over the dialog, both through the same acts
 * the menu's items run (`agent-archive.tsx`, `agent-delete.tsx`). Anyone in
 * the workspace may delete a Manager, as with any agent.
 */

import { chooseFailureNote } from "@repo/features/agent-refusal-words";
import {
  AGENT_BOUNDS,
  AGENT_MACHINE,
  type AgentSummary,
  agentMachineOf,
} from "@repo/features/agent-wire";
import { MANAGER_FACE_FAILED, type ManagerFace } from "@repo/features/manager-face";
import type { MacOffer } from "@repo/features/models-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  BUTTON_VARIANT,
  Button,
  CHIP_LOOK,
  CHIP_WIDTH,
  SettingsDialog,
  type SettingsDialogSection,
  SettingsRow,
  SettingsSection,
  TextField,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ManagerFaceWell } from "@repo/ui/manager-face-picker";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { appPlatform } from "../app-platform.js";
import { refusedShown } from "../failure-report.js";
import { replayMaskedError } from "../settings/marks.js";
import { RENAME_FAILED } from "../tasks/agent-model.js";
import { AgentModelChip } from "../tasks/agent-model-chip.js";
import { CHIP_PLACE, RepositoriesChip, type RepositoryChooser } from "../tasks/repository-chip.js";
import { NewTaskRunsOnChip, type OfferedPlace } from "../tasks/runs-on.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import { appStateQuery, selectFixtureStaged } from "../use-app-state.js";
import type { MenuAction } from "./action-menu.js";

/** The sections a Manager's Settings list. */
const SECTION = {
  GENERAL: "general",
} as const;

type Section = (typeof SECTION)[keyof typeof SECTION];

const SECTIONS: readonly SettingsDialogSection<Section>[] = [
  { id: SECTION.GENERAL, title: "General", icon: <GLYPH.SETTINGS /> },
];

/** What the dialog is named for a Manager drawn with no name. */
const UNNAMED = "Manager settings";

/** What the Repositories and Machine rows say, where they stand as made. */
const FIXED_AFTER_CREATE = "Fixed once the Manager is made.";

/** What the Archive and Delete rows say. */
const ARCHIVE_WORDS = {
  ARCHIVE: "Archive",
  ARCHIVE_LINE: "It stops and leaves the sidebar. Unarchive brings it back.",
  READING: "Reading",
  UNARCHIVE: "Unarchive",
  UNARCHIVE_LINE: "It comes back to the sidebar.",
  DELETE: "Delete",
  DELETE_ROW: "Permanently delete",
  DELETE_LINE: "It and its conversation go for good.",
} as const;

/** No device, while the member's devices are not read. */
const NO_DEVICES: readonly MacOffer[] = [];

/** No repository, for a Manager the client holds none of. */
const NO_REPOSITORIES: readonly string[] = [];

/** What a Manager's Settings reads of it. */
export type ManagerSettingsSubject = Pick<
  AgentSummary,
  | "id"
  | "title"
  | "model"
  | "effort"
  | "contextWindow"
  | "runtime"
  | "machine"
  | "mac"
  | "face"
  | "archivedAt"
> & {
  /** The workspace it is in, whose repositories its chip names; none where the surface does not know it. */
  readonly workspaceId?: string | undefined;
  /** Its checkout, the first repository it works in; none where the surface does not know it. */
  readonly repository?: string | null | undefined;
};

/** What a Manager's Settings acts through beyond its own rows: its menu's Archive or Unarchive, and its Permanently delete. */
export interface ManagerSettingsActs {
  /** Its Archive, or its Unarchive once archived, as its menu offers it. */
  readonly archive: MenuAction;
  /** Whether its Archive is reading the Manager again before it acts, which holds the button busy. */
  readonly archiving: boolean;
  readonly deletion: MenuAction;
}

/** A Manager's Settings: the press that opens the dialog, and the dialog. */
export interface ManagerSettingsAsk {
  readonly ask: () => void;
  readonly dialog: React.JSX.Element;
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

/** The Name row: a field holding the Manager's name, saved as Return is pressed or the caret leaves it; an emptied name goes back to the one standing. */
function NameRow({
  agent,
  rename,
}: {
  agent: ManagerSettingsSubject;
  rename: AgentsControl["rename"];
}): React.JSX.Element {
  const standing = agent.title ?? "";
  // Note that what was typed stands until its rename lands, so a refused one is kept for another try.
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const [refused, setRefused] = useState(false);
  const renaming = useMutation(rename.options);

  const save = () => {
    if (typed === undefined) return;
    const name = typed.trim();

    if (name === "" || name === standing) {
      setTyped(undefined);
      setRefused(false);

      return;
    }

    setRefused(false);
    renaming.mutate(rename.ask(agent.id, name), {
      onSuccess: (answer) => {
        if (rename.refused(answer)) setRefused(true);
        else setTyped(undefined);
      },
      onError: () => setRefused(true),
    });
  };

  return (
    <SettingsRow
      label="Name"
      error={replayMaskedError(
        refusedShown(refused ? RENAME_FAILED : undefined, FAILURE_SURFACE.MANAGER_SETTINGS, {
          agentId: agent.id,
        }),
      )}
    >
      {(control) => (
        <TextField
          label="Name"
          describedBy={control["aria-describedby"]}
          invalid={refused}
          spellCheck={false}
          maxLength={AGENT_BOUNDS.MAX_TITLE_CHARS}
          value={typed ?? standing}
          disabled={renaming.isPending}
          onChange={setTyped}
          onEnter={save}
          onBlur={save}
          onEscape={() => {
            setTyped(undefined);
            setRefused(false);
          }}
        />
      )}
    </SettingsRow>
  );
}

/** The Face row: the Manager's face, saved as one is picked. */
function FaceRow({
  agent,
  onFace,
}: {
  agent: ManagerSettingsSubject;
  onFace: AgentsControl["onFace"];
}): React.JSX.Element {
  const [picking, setPicking] = useState(false);
  const [refused, setRefused] = useState(false);

  const pick = (face: ManagerFace) => {
    setRefused(false);
    void onFace(agent.id, face).then((answer) => setRefused("failure" in answer));
  };

  return (
    <SettingsRow
      label="Face"
      error={refusedShown(refused ? MANAGER_FACE_FAILED : undefined, FAILURE_SURFACE.MANAGER_FACE, {
        agentId: agent.id,
      })}
    >
      {() => (
        <ManagerFaceWell
          face={agent.face}
          open={picking}
          onOpenChange={setPicking}
          onChange={pick}
        />
      )}
    </SettingsRow>
  );
}

/** The Model row: the Manager's model and effort, saved as they are chosen. */
function ModelRow({
  agent,
  agents,
}: {
  agent: ManagerSettingsSubject;
  agents: Pick<AgentsControl, "onChoose" | "models" | "modelsFailed" | "readModels">;
}): React.JSX.Element {
  const [refusal, setRefusal] = useState<string | undefined>(undefined);

  const choice = {
    model: agent.model,
    effort: agent.effort,
    ...(agent.contextWindow === undefined ? undefined : { contextWindow: agent.contextWindow }),
  };

  return (
    <SettingsRow
      label="Model"
      error={refusedShown(refusal, FAILURE_SURFACE.MANAGER_SETTINGS, { agentId: agent.id })}
    >
      {() => (
        <AgentModelChip
          model={{
            choice,
            note: undefined,
            runtime: agent.runtime,
            choose: (next) => {
              setRefusal(undefined);
              void agents.onChoose(agent.id, next).then((answer) => {
                if ("failure" in answer) setRefusal(chooseFailureNote(answer.failure));
              });
            },
          }}
          models={agents.models}
          modelsFailed={agents.modelsFailed}
          readModels={agents.readModels}
          usage={undefined}
          look={CHIP_LOOK.FIELD}
          width={CHIP_WIDTH.FIELD}
        />
      )}
    </SettingsRow>
  );
}

/** General: the Manager's own rows, then its Archive and its Permanently delete. */
function GeneralSection({
  agent,
  agents,
  acts,
  onClose,
}: {
  agent: ManagerSettingsSubject;
  agents: Pick<
    AgentsControl,
    "rename" | "onChoose" | "onFace" | "models" | "modelsFailed" | "readModels" | "macs"
  >;
  acts: ManagerSettingsActs;
  onClose: () => void;
}): React.JSX.Element {
  const staged = useQuery({ ...appStateQuery, select: selectFixtureStaged }).data === true;
  const devices = agents.macs ?? NO_DEVICES;
  const archived = agent.archivedAt !== undefined;

  // Note that the chip is held, so its chooser lists the workspace's repositories only to name the one it holds.
  const chooser: RepositoryChooser = {
    recent: NO_REPOSITORIES,
    openGitHub: (url) => appPlatform().openWeb(url),
    pictures: !staged,
    scope: agent.workspaceId,
    manages: false,
  };

  return (
    <>
      <SettingsSection>
        <NameRow agent={agent} rename={agents.rename} />
        <FaceRow agent={agent} onFace={agents.onFace} />
        <SettingsRow label="Repositories" description={FIXED_AFTER_CREATE}>
          {(control) => (
            <RepositoriesChip
              place={CHIP_PLACE.FIELD}
              width={CHIP_WIDTH.FIELD}
              describedBy={control["aria-describedby"]}
              held={FIXED_AFTER_CREATE}
              values={agent.repository == null ? NO_REPOSITORIES : [agent.repository]}
              chooser={chooser}
              onToggle={() => undefined}
            />
          )}
        </SettingsRow>
        <SettingsRow label="Machine" description={FIXED_AFTER_CREATE}>
          {() => (
            <NewTaskRunsOnChip
              devices={devices}
              place={placeOf(agent, devices)}
              disabled
              narrow={false}
              look={CHIP_LOOK.FIELD}
              width={CHIP_WIDTH.FIELD}
              onChoose={() => undefined}
            />
          )}
        </SettingsRow>
        <ModelRow agent={agent} agents={agents} />
      </SettingsSection>
      <SettingsSection>
        <SettingsRow
          label={archived ? ARCHIVE_WORDS.UNARCHIVE : ARCHIVE_WORDS.ARCHIVE}
          description={archived ? ARCHIVE_WORDS.UNARCHIVE_LINE : ARCHIVE_WORDS.ARCHIVE_LINE}
        >
          {() => (
            <Button
              variant={BUTTON_VARIANT.OUTLINE}
              busy={acts.archiving}
              busyLabel={ARCHIVE_WORDS.READING}
              onClick={() => {
                // Note that the dialog goes as the Manager leaves the sidebar, so a question its stop asks stands alone.
                onClose();
                acts.archive.onSelect();
              }}
            >
              {archived ? ARCHIVE_WORDS.UNARCHIVE : ARCHIVE_WORDS.ARCHIVE}
            </Button>
          )}
        </SettingsRow>
        <SettingsRow label={ARCHIVE_WORDS.DELETE_ROW} description={ARCHIVE_WORDS.DELETE_LINE}>
          {() => (
            <Button variant={BUTTON_VARIANT.DANGER_OUTLINE} onClick={acts.deletion.onSelect}>
              {ARCHIVE_WORDS.DELETE}
            </Button>
          )}
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

/** The Settings dialog for `agent`, a Manager, saved through `agents` and archived or deleted through `acts`; it stands only while `shown`. */
export function useManagerSettingsDialog(
  agent: ManagerSettingsSubject,
  agents: Pick<
    AgentsControl,
    "rename" | "onChoose" | "onFace" | "models" | "modelsFailed" | "readModels" | "macs"
  >,
  acts: ManagerSettingsActs,
  shown: boolean,
): ManagerSettingsAsk {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>(SECTION.GENERAL);
  const close = () => setOpen(false);

  const dialog = (
    <SettingsDialog
      open={open && shown}
      title={agent.title ?? UNNAMED}
      titleReplayMasked={agent.title !== undefined}
      sections={SECTIONS}
      current={section}
      onChoose={setSection}
      onDismiss={close}
    >
      {section === SECTION.GENERAL ? (
        <GeneralSection agent={agent} agents={agents} acts={acts} onClose={close} />
      ) : null}
    </SettingsDialog>
  );

  return {
    ask: () => {
      setSection(SECTION.GENERAL);
      // Note that the catalog is read as the dialog opens, so Model lists it as it stands.
      agents.readModels();
      setOpen(true);
    },
    dialog,
  };
}
