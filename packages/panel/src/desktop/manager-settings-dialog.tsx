/**
 * manager-settings-dialog.tsx -- a Manager's Settings: the sectioned settings dialog its Settings button and its menu's Settings… open, its General section changing the Manager as it stands, each row saving itself.
 *
 * The dialog is `@repo/ui`'s `SettingsDialog`, named by the Manager and
 * listing its sections down its start: General; People
 * (`manager-people-section.tsx`), who follows it and may lend it their
 * machines; and Automations, the automations that send it work
 * (`AutomationsSection`). General
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
 *
 * Memory lists the Manager's own memories, those it alone recalls, with
 * workspace Settings › Memory's own section at the Manager's scope
 * (`MemorySection`), so a memory added there is kept for it alone.
 *
 * Every section reads the Manager's workspace as the dialog reads it once,
 * by the Manager's own read by id, whichever surface opened it, since only
 * the Manager's own page knows it beside the agent; none reads it on its own.
 * While that read is out each section stands on its own skeleton, and where
 * it failed every section but General offers Try again.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import type { AgentSummary } from "@repo/features/agent-wire";
import { DEFAULT_AUTOMATIONS_ORDER } from "@repo/features/automation-list-model";
import { AUTOMATION_TARGET, type AutomationSummary } from "@repo/features/automation-wire";
import { READING_AUTOMATIONS } from "@repo/features/automation-words";
import { ENTITY_KIND } from "@repo/features/entity-kind";
import { MANAGER_FACE_FAILED, type ManagerFace } from "@repo/features/manager-face";
import { MEMORY_SCOPE } from "@repo/features/memory-settings-words";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { EXPERIMENT } from "@repo/settings";
import {
  BUTTON_VARIANT,
  Button,
  CHIP_LOOK,
  CHIP_WIDTH,
  EmptyState,
  ErrorState,
  RenamableName,
  SETTINGS_ROW_LEAD,
  SETTINGS_SECTION_FRAME,
  SettingsDialog,
  type SettingsDialogSection,
  SettingsRow,
  SettingsRowValue,
  SettingsSection,
  Spinner,
} from "@repo/ui";
import { GLYPH, PlusIcon } from "@repo/ui/icons";
import { ManagerFaceWell } from "@repo/ui/manager-face-picker";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { useInlineRename } from "@repo/ui/use-inline-rename";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAutomationsOpen } from "../automations-route.js";
import { EntityGlyph } from "../entities/entity-glyph.js";
import { refusedShown, unreadShown } from "../failure-report.js";
import { renameWrite } from "../rename-write.js";
import { replayMaskedError } from "../settings/marks.js";
import { MemorySection } from "../settings/memory-page.js";
import { usePhoneRoom } from "../stage-room.js";
import { type AgentBox, useAgentBox } from "../tasks/agent-box.js";
import { RENAME_FAILED, teammateStarter } from "../tasks/agent-model.js";
import { AgentModelChip } from "../tasks/agent-model-chip.js";
import { agentPageQueryOptions } from "../tasks/agent-reads.js";
import { AUTOMATIONS_PAGE, type AutomationsPlace } from "../tasks/automations-place.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import { appStateQuery, selectAccount, selectWorkspaces } from "../use-app-state.js";
import { useWorkspaceExperiment } from "../workspace-experiments.js";
import type { MenuAction } from "./action-menu.js";
import { AutomationRows } from "./automations-page.js";
import { ManagerPeopleSection } from "./manager-people-section.js";
import { useAutomations } from "./use-automations.js";

/** The sections a Manager's Settings list. */
const SECTION = {
  GENERAL: "general",
  PEOPLE: "people",
  AUTOMATIONS: "automations",
  MEMORY: "memory",
} as const;

type Section = (typeof SECTION)[keyof typeof SECTION];

const SECTIONS: readonly SettingsDialogSection<Section>[] = [
  { id: SECTION.GENERAL, title: "General", icon: <GLYPH.SETTINGS /> },
  { id: SECTION.PEOPLE, title: "People", icon: <EntityGlyph kind={ENTITY_KIND.PERSON} /> },
  {
    id: SECTION.AUTOMATIONS,
    title: "Automations",
    icon: <EntityGlyph kind={ENTITY_KIND.AUTOMATIONS} />,
  },
  { id: SECTION.MEMORY, title: "Memory", icon: <GLYPH.MEMORY /> },
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
  AIMED: "Sent to this Manager",
  AIMED_CAPTION: "Every run of these is sent to it as a message, whoever made them.",
  ADD_AUTOMATION: "Add automation",
  NO_AUTOMATIONS: "No automations send it work yet.",
  AUTOMATIONS_UNREAD: "The automations could not be read.",
  MANAGER_UNREAD: "This Manager could not be read.",
  RUNS_ON_YOURS: "Runs on your subscriptions.",
  RUNS_ON_PREFIX: "Runs on ",
  RUNS_ON_SUFFIX: "'s subscriptions.",
  STARTS_ON_YOURS: " Agents it starts for you run on yours.",
} as const;

/** What a Manager's Settings is handed of it by the surface that opens it. */
export type ManagerSettingsSubject = AgentSummary & {
  /** Its checkout, the first repository it works in; none where the surface does not know it. */
  readonly repository?: string | null | undefined;
};

/**
 * The Manager as every section reads it: what the surface handed, and the
 * workspace it stands in, read once by the dialog by the Manager's own read
 * by id; none until that read answers.
 */
type SettingsManager = ManagerSettingsSubject & {
  readonly workspaceId: string | undefined;
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
  agent: SettingsManager;
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

/**
 * Who pays for the Manager's turns, said under its Model: its starter's
 * subscriptions, named as the reader's own where they started it. With the
 * Manager acting for whoever asks (`MANAGER_ACTS_FOR_ASKER`), what it starts
 * for a reader who is not its starter runs on that reader's, as the experiment's own line says; its starter hears nothing more, since everything already runs on theirs.
 */
function PayerLine({
  agent,
  me,
}: {
  agent: SettingsManager;
  me: string | undefined;
}): React.JSX.Element {
  const owner = teammateStarter(agent.startedBy, me);
  const forAsker = useWorkspaceExperiment(agent.workspaceId, EXPERIMENT.MANAGER_ACTS_FOR_ASKER);

  return (
    <>
      {owner === undefined ? (
        WORDS.RUNS_ON_YOURS
      ) : (
        <>
          {WORDS.RUNS_ON_PREFIX}
          <ReplayMask>{owner}</ReplayMask>
          {WORDS.RUNS_ON_SUFFIX}
        </>
      )}
      {forAsker && owner !== undefined ? WORDS.STARTS_ON_YOURS : null}
    </>
  );
}

/** The Model row: the agent box's own model chip, as the box draws it, over who pays for the Manager's turns. */
function ModelRow({
  agent,
  me,
  box,
}: {
  agent: SettingsManager;
  me: string | undefined;
  box: AgentBox;
}): React.JSX.Element {
  const { model } = box;
  const agentId = agent.id;

  return (
    <SettingsRow
      label={WORDS.MODEL}
      description={<PayerLine agent={agent} me={me} />}
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
  agent: SettingsManager;
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
        <ModelRow agent={agent} me={agents.me} box={box} />
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

/** Whether an automation sends every run to the agent `agentId`. */
function aimedAt(automation: AutomationSummary, agentId: string): boolean {
  const { target } = automation;

  return target?.kind === AUTOMATION_TARGET.SAME_AGENT && target.agentId === agentId;
}

/**
 * Automations: the workspace's automations that send every run to this
 * Manager, whoever made them, drawn by the Automations page's own rows
 * (`AutomationRows`), each opening its page there, and Add automation, which
 * opens a new automation's page aimed at the Manager; each puts the dialog
 * away as it opens the page. Note that the list is the reader's, as the
 * Automations page's is, so a teammate's own automation stands only for a
 * reader who may read it there.
 */
function AutomationsSection({
  agent,
  onClose,
}: {
  agent: SettingsManager;
  onClose: () => void;
}): React.JSX.Element {
  const automations = useAutomations(agent.workspaceId);
  // Note that the rows answer the room as the Automations page's do, the dialog then taking the phone's whole width.
  const phone = usePhoneRoom();
  const { onOpen } = useAutomationsOpen();
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data;
  const workspace = workspaces?.find((each) => each.id === agent.workspaceId);
  const { read, reload } = automations;
  const listed = read !== undefined && "automations" in read ? read.automations : [];
  const aimed = listed.filter((automation) => aimedAt(automation, agent.id));

  // Opens one of the workspace's Automations pages, putting the dialog away, since the page stands where the Manager's did.
  const open = (place: AutomationsPlace) => {
    if (workspace === undefined) return;
    onClose();
    onOpen(place, workspace.slug ?? workspace.id);
  };

  const add = (
    <Button
      variant={BUTTON_VARIANT.OUTLINE}
      icon={<PlusIcon />}
      disabled={workspace === undefined}
      onClick={() => open({ kind: AUTOMATIONS_PAGE.NEW, target: agent.id })}
    >
      {WORDS.ADD_AUTOMATION}
    </Button>
  );

  return (
    <SettingsSection
      title={WORDS.AIMED}
      caption={WORDS.AIMED_CAPTION}
      action={add}
      frame={SETTINGS_SECTION_FRAME.NONE}
    >
      {read === undefined ? (
        <Spinner delay label={READING_AUTOMATIONS} />
      ) : "failure" in read ? (
        <ErrorState failure={unreadShown(FAILURE_SURFACE.AUTOMATIONS_READ)} onRetry={reload}>
          {WORDS.AUTOMATIONS_UNREAD}
        </ErrorState>
      ) : (
        <>
          {aimed.length === 0 ? (
            <EmptyState icon={<EntityGlyph kind={ENTITY_KIND.AUTOMATIONS} />}>
              {WORDS.NO_AUTOMATIONS}
            </EmptyState>
          ) : null}
          {/* Note that the rows stand while none is listed, since a deletion's question and its refusal are theirs. */}
          <AutomationRows
            listed={aimed}
            order={DEFAULT_AUTOMATIONS_ORDER}
            workspace={workspace}
            narrow={phone}
            automations={automations}
            onOpen={(automation) =>
              open({ kind: AUTOMATIONS_PAGE.EDIT, automationId: automation.id })
            }
            onDeleted={() => undefined}
          />
        </>
      )}
    </SettingsSection>
  );
}

/** Memory: the Manager's own memories, in the workspace it stands in, as workspace Settings › Memory lists the workspace's. */
function MemoryOfManager({ agent }: { agent: SettingsManager }): React.JSX.Element {
  const account = useQuery({ ...appStateQuery, select: selectAccount }).data;
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data;
  const readerId = signedInAccountId(account);
  // Note that Memory stands on its skeleton until the Manager's own read names its workspace.
  const workspace = workspaces?.find((each) => each.id === agent.workspaceId);

  return (
    <MemorySection
      signedIn={readerId !== undefined}
      scope={{ kind: MEMORY_SCOPE.MANAGER, managerId: agent.id }}
      workspace={workspace}
      readerId={readerId}
      workspacesFailed={false}
      onRetryWorkspaces={undefined}
    />
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
  const [chosen, setSection] = useState<Section>(SECTION.GENERAL);
  const close = () => setOpen(false);

  // Note that the Manager's workspace is read once, by its own read by id, which answers for every Manager, an archived one's included, and is already held on its page, whichever surface opened the dialog; it is handed to every section, so none reads it on its own.
  const read = useQuery({ ...agentPageQueryOptions(agent.id), enabled: open && shown });
  const answer = read.data;

  const workspaceId =
    answer === undefined || "failure" in answer ? undefined : answer.agent.workspaceId;

  const unread = read.isError || (answer !== undefined && "failure" in answer);

  const manager: SettingsManager = { ...agent, workspaceId };
  // Memory stands only where the workspace has Memory on, as workspace Settings lists it.
  const memoryOn = useWorkspaceExperiment(workspaceId, EXPERIMENT.MEMORY);
  const sections = memoryOn ? SECTIONS : SECTIONS.filter((each) => each.id !== SECTION.MEMORY);
  const section = chosen === SECTION.MEMORY && !memoryOn ? SECTION.GENERAL : chosen;

  const dialog = (
    <SettingsDialog
      open={open && shown}
      title={agent.title ?? UNNAMED}
      titleReplayMasked={agent.title !== undefined}
      sections={sections}
      current={section}
      onChoose={setSection}
      onDismiss={close}
    >
      {section !== SECTION.GENERAL && unread ? (
        <ErrorState
          failure={unreadShown(FAILURE_SURFACE.AGENTS_READ)}
          onRetry={() => void read.refetch()}
        >
          {WORDS.MANAGER_UNREAD}
        </ErrorState>
      ) : null}
      {section === SECTION.GENERAL ? (
        <GeneralSection agent={manager} agents={agents} acts={acts} onClose={close} />
      ) : null}
      {section === SECTION.PEOPLE && !unread ? (
        <ManagerPeopleSection agentId={agent.id} workspaceId={workspaceId} />
      ) : null}
      {section === SECTION.AUTOMATIONS && !unread ? (
        <AutomationsSection agent={manager} onClose={close} />
      ) : null}
      {section === SECTION.MEMORY && !unread ? <MemoryOfManager agent={manager} /> : null}
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
