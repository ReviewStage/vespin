/**
 * manager-settings-dialog.tsx -- a Manager's Settings: the sectioned settings dialog its Settings button and its menu's Settings… open, its General section changing the Manager as it stands, each row saving itself.
 *
 * The dialog is `@repo/ui`'s `SettingsDialog`, named by the Manager and
 * listing its sections down its start; General alone stands so far. General
 * reads as the rest of Settings does, each row saving itself, so the card has
 * no Save. It opens as workspace Settings opens on its workspace: one row
 * leading with the Manager's face, picked from the face itself
 * (`ManagerFaceWell`, saved through `AgentsControl.onFace`), and its name,
 * renamed by pressing it (`RenamableName`), as a workspace's name and a
 * machine's are, through the agent's own rename. Under it every row is what
 * a coding agent shows of the same thing: its repositories, named, since an
 * agent's repositories are fixed once it starts, whatever its kind; and,
 * read off its own message box (`useAgentBox`), so they cannot drift from
 * it, where it runs, the box's place chip, moving it where a coder's moves,
 * and its model, the box's model chip with its permission mode and the
 * models its machine runs. A refusal is said under its row.
 *
 * Its second card holds what a Manager's menu offers beside Settings: its
 * Archive, or its Unarchive once archived, which puts the dialog away as it
 * acts, since the Manager it changes leaves the sidebar, and its Permanently
 * delete, whose question stands over the dialog, both through the same acts
 * the menu's items run (`agent-archive.tsx`, `agent-delete.tsx`). Anyone in
 * the workspace may delete a Manager, as with any agent.
 */

import type { AgentSummary } from "@repo/features/agent-wire";
import { MANAGER_FACE_FAILED, type ManagerFace } from "@repo/features/manager-face";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  BUTTON_VARIANT,
  Button,
  CHIP_LOOK,
  CHIP_WIDTH,
  RenamableName,
  SETTINGS_ROW_LEAD,
  SettingsDialog,
  type SettingsDialogSection,
  SettingsRow,
  SettingsRowValue,
  SettingsSection,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ManagerFaceWell } from "@repo/ui/manager-face-picker";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { useInlineRename } from "@repo/ui/use-inline-rename";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { refusedShown } from "../failure-report.js";
import { renameWrite } from "../rename-write.js";
import { replayMaskedError } from "../settings/marks.js";
import { type AgentBox, useAgentBox } from "../tasks/agent-box.js";
import { RENAME_FAILED } from "../tasks/agent-model.js";
import { AgentModelChip } from "../tasks/agent-model-chip.js";
import type { AgentsControl } from "../tasks/use-agents.js";
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

/** What the rows say. */
const WORDS = {
  NAME: "Manager name",
  REPOSITORIES: "Repositories",
  MACHINE: "Machine",
  MODEL: "Model",
  ARCHIVE: "Archive",
  ARCHIVE_LINE: "It stops and leaves the sidebar. Unarchive brings it back.",
  READING: "Reading",
  UNARCHIVE: "Unarchive",
  UNARCHIVE_LINE: "It comes back to the sidebar.",
  DELETE: "Delete",
  DELETE_ROW: "Permanently delete",
  DELETE_LINE: "It and its conversation go for good.",
} as const;

/** What a Manager's Settings reads of it. */
export type ManagerSettingsSubject = AgentSummary & {
  /** The workspace it is in; none where the surface does not know it. */
  readonly workspaceId?: string | undefined;
  /** Its checkout, the first repository it works in; none where the surface does not know it. */
  readonly repository?: string | null | undefined;
};

/** What a Manager's Settings saves through: the control its agent is listed in, as its box reads it. */
type ManagerSettingsDoors = AgentsControl;

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

/** The name a rename ends on, or none where it keeps the one standing: an Escape, an emptied name, or the same one. */
function renamedTo(typed: string | undefined, standing: string): string | undefined {
  const name = typed?.trim();

  return name === undefined || name === "" || name === standing ? undefined : name;
}

/**
 * The Manager's own row, as workspace Settings heads its page with its
 * workspace: its face, picked from the face, and its name, renamed by
 * pressing it. A refused rename or face is said under the row.
 */
function IdentityRow({
  agent,
  agents,
}: {
  agent: ManagerSettingsSubject;
  agents: Pick<AgentsControl, "rename" | "onFace">;
}): React.JSX.Element {
  const name = agent.title ?? "";
  const renaming = useMutation(agents.rename.options);
  const rename = useInlineRename(agent.id, renameWrite(renaming, agents.rename));
  const [picking, setPicking] = useState(false);
  const [faceRefused, setFaceRefused] = useState(false);

  const pick = (face: ManagerFace) => {
    setFaceRefused(false);
    void agents.onFace(agent.id, face).then((answer) => setFaceRefused("failure" in answer));
  };

  // Note that a rename's refusal is the rename's own, so a face picked meanwhile does not erase it.
  const refusal = rename.refused ? RENAME_FAILED : faceRefused ? MANAGER_FACE_FAILED : undefined;

  return (
    <SettingsRow
      lead={SETTINGS_ROW_LEAD.FACE}
      leading={
        <ManagerFaceWell
          face={agent.face}
          open={picking}
          onOpenChange={setPicking}
          onChange={pick}
        />
      }
      label={
        <ReplayMask>
          <RenamableName
            value={rename.asked ?? name}
            label={WORDS.NAME}
            editing={rename.editing}
            onBegin={rename.begin}
            onEnd={({ value }) => rename.end(renamedTo(value, name))}
          />
        </ReplayMask>
      }
      editing={rename.editing}
      error={replayMaskedError(
        refusedShown(refusal, FAILURE_SURFACE.MANAGER_SETTINGS, { agentId: agent.id }),
      )}
    />
  );
}

/** The Model row: the agent box's own model chip, as the box draws it. */
function ModelRow({ agentId, box }: { agentId: string; box: AgentBox }): React.JSX.Element {
  const { model } = box;

  return (
    <SettingsRow
      label={WORDS.MODEL}
      error={refusedShown(model?.note, FAILURE_SURFACE.MANAGER_SETTINGS, { agentId })}
    >
      {() =>
        model === undefined ? null : (
          <AgentModelChip
            model={model}
            models={box.models}
            modelsFailed={box.modelsFailed}
            readModels={box.readModels}
            usage={undefined}
            owner={box.owner}
            permissions={box.mode}
            look={CHIP_LOOK.FIELD}
            width={CHIP_WIDTH.FIELD}
          />
        )
      }
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
  agents: ManagerSettingsDoors;
  acts: ManagerSettingsActs;
  onClose: () => void;
}): React.JSX.Element {
  const archived = agent.archivedAt !== undefined;
  // Note that the rows draw the agent's own box's chips, so they cannot drift from its box.
  const box = useAgentBox({ agentId: agent.id, agent, agents });

  return (
    <>
      <SettingsSection>
        <IdentityRow agent={agent} agents={agents} />
        {agent.repository == null ? null : (
          <SettingsRow label={WORDS.REPOSITORIES}>
            {() => (
              <SettingsRowValue>
                <ReplayMask>{agent.repository}</ReplayMask>
              </SettingsRowValue>
            )}
          </SettingsRow>
        )}
        <SettingsRow label={WORDS.MACHINE}>{() => box.place(false)}</SettingsRow>
        <ModelRow agentId={agent.id} box={box} />
      </SettingsSection>
      <SettingsSection>
        <SettingsRow
          label={archived ? WORDS.UNARCHIVE : WORDS.ARCHIVE}
          description={archived ? WORDS.UNARCHIVE_LINE : WORDS.ARCHIVE_LINE}
        >
          {() => (
            <Button
              variant={BUTTON_VARIANT.OUTLINE}
              busy={acts.archiving}
              busyLabel={WORDS.READING}
              onClick={() => {
                // Note that the dialog goes as the Manager leaves the sidebar, so a question its stop asks stands alone.
                onClose();
                acts.archive.onSelect();
              }}
            >
              {archived ? WORDS.UNARCHIVE : WORDS.ARCHIVE}
            </Button>
          )}
        </SettingsRow>
        <SettingsRow label={WORDS.DELETE_ROW} description={WORDS.DELETE_LINE}>
          {() => (
            <Button variant={BUTTON_VARIANT.DANGER_OUTLINE} onClick={acts.deletion.onSelect}>
              {WORDS.DELETE}
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
  agents: ManagerSettingsDoors,
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
