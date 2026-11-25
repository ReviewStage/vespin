import { SERVER_HANDED } from "@repo/features/agent-servers-model";
import { AUTOMATION_EDITOR_WORDS } from "@repo/features/automation-editor-words";
import { AUTOMATION_BOUNDS } from "@repo/features/automation-wire";
import { encodeMention, MENTION_KIND } from "@repo/features/mention-link";
import type { Workspace } from "@repo/features/workspace-wire";
import { EXPERIMENT } from "@repo/settings";
import { cssCustomProperties } from "@repo/ui";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { appPlatform } from "../app-platform.js";
import { useIntegrationStatuses } from "../integration-statuses.js";
import { useTaskListCollections } from "../task-list-collections.js";
import { repositorySkillsQueryOptions } from "../tasks/agent-reads.js";
import { useHandedWords } from "../tasks/box-words.js";
import { MENTION_MENU_SIDE } from "../tasks/mention-picker.js";
import { useMentionedPlace } from "../tasks/mentioned-place.js";
import { MessageField, useMessageBox } from "../tasks/message-box.js";
import { keptSkills } from "../tasks/repository-skills.js";
import { SkillFiles } from "../tasks/skill-chip.js";
import type { SkillSource } from "../tasks/skill-picker.js";
import type { SkillWithFile } from "../tasks/skill-ref.js";
import { TaskMentions, tasklessMentions, useMentionAgentsReader } from "../tasks/task-mentions.js";
import { useOpenTask } from "../tasks/use-open-link.js";
import { appStateQuery, selectExperiment } from "../use-app-state.js";

/**
 * automation-prompt.tsx -- an automation's prompt, written in the composer's own field, as New task's words are.
 *
 * The prompt is the first message every run's agent is handed, so it takes
 * what New task's box takes (`../tasks/new-task-composer.tsx`): an `@`
 * opens what the words may mention in the automation's workspace, its
 * people, tasks, agents, threads, and the account's connected servers among
 * them, and, once a repository is chosen, that repository's files and
 * folders; a `/` opens the repository's skills. A pick is written into the
 * prompt as its link, or a skill as its `/name`, so a run's agent reads it
 * as any message's, and a server the prompt names is handed to every run
 * whatever the automation switched off (`automation-runs.ts`). Note that
 * the prompt is kept rather than sent, so a bare Enter writes a new line,
 * as the text area it replaced did, ⌘ or Ctrl with Enter saves the
 * automation, as it finishes a document's text, and Escape lets go of the caret and
 * reaches the window marked taken, as every field's on the page does.
 */

/** The tasks of a window that lists none yet. */
const NO_TASKS: readonly { readonly id: string; readonly name: string }[] = [];

/** What a press on a mention's chip does with no opener at hand: nothing. */
const OPEN_NOTHING = (): void => undefined;

/** The prompt's field, under the mentions and skills the automation's place hands it. */
function PromptField({
  value,
  label,
  rows,
  invalid,
  skills,
  disabledServers,
  onChange,
  onSave,
}: {
  value: string;
  label: string;
  rows: number;
  invalid: boolean;
  skills: SkillSource | undefined;
  disabledServers: readonly string[];
  onChange: (text: string) => void;
  onSave: () => void;
}): React.JSX.Element {
  const statuses = useIntegrationStatuses();

  const box = useMessageBox({
    draft: useHandedWords(value),
    setDraft: onChange,
    placeholder: AUTOMATION_EDITOR_WORDS.PROMPT_PLACEHOLDER,
    label,
    maxLength: AUTOMATION_BOUNDS.MAX_PROMPT_CHARS,
    onSubmit: onSave,
    enterWrites: true,
    takesFiles: false,
    takesFocus: false,
    skills,
    // A server's chip says each run opens with it, as the automation's switches leave it.
    servers: { statuses, place: { disabled: disabledServers, handed: SERVER_HANDED.OPENS } },
    // Note that the field stands in a form under the page's toolbar, so a list opens under the caret's line.
    side: MENTION_MENU_SIDE.BELOW,
    // Escape lets go of the caret and reaches the window marked taken, as every field's here does, so the page stays; a list standing takes it first.
    escapeClimbs: true,
    aria: { "aria-invalid": invalid ? "true" : undefined },
  });

  return (
    <MessageField
      box={box}
      className="automation-prompt"
      invalid={invalid}
      style={cssCustomProperties({ "--automation-prompt-rows": String(rows) })}
      // Note that an input method's Escape is the editor's to leave alone, so it is marked taken here, keeping the caret, as it climbs to the window.
      onKeyDown={(event) => {
        if (event.key === "Escape") event.preventDefault();
      }}
    />
  );
}

/** An automation's prompt as the composer's field, offering what its workspace and repository hold; `repository` is null before one is chosen. */
export function AutomationPrompt({
  workspace,
  repository,
  disabledServers,
  value,
  label,
  rows,
  invalid,
  onChange,
  onSave,
}: {
  workspace: Workspace | undefined;
  repository: string | null;
  /** The servers the automation switched off for its runs, which a server's chip reads. */
  disabledServers: readonly string[];
  value: string;
  label: string;
  /** The lines the field stands before it grows. */
  rows: number;
  /** Whether the prompt is what stops a save. */
  invalid: boolean;
  onChange: (text: string) => void;
  /** Saves the automation, which ⌘ or Ctrl with Enter asks for, as it finishes a document's text. */
  onSave: () => void;
}): React.JSX.Element {
  const workspaceId = workspace?.id;
  const slug = workspace?.slug;
  const onOpenTask = useOpenTask() ?? OPEN_NOTHING;
  // An `@` offers the workspace's coding agents, each named by its task, which is the workspace's too.
  const collections = useTaskListCollections();

  const tasks =
    useLiveQuery((q) =>
      workspaceId === undefined
        ? undefined
        : q
            .from({ task: collections.tasks })
            .where(({ task }) => eq(task.workspaceId, workspaceId)),
    ).data ?? NO_TASKS;

  const readAgents = useMentionAgentsReader(workspaceId, tasks, useMentionedPlace().models);

  const mentions = useMemo(
    () =>
      workspaceId === undefined
        ? undefined
        : tasklessMentions(
            { workspace: slug ?? workspaceId, workspaceId, repository },
            onOpenTask,
            readAgents,
          ),
    [workspaceId, slug, repository, onOpenTask, readAgents],
  );

  // A `/` offers the repository's skills, none while the Skills experiment is off.
  const queryClient = useQueryClient();

  const skillsOn =
    useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.SKILLS) }).data === true;

  const skills = useMemo(
    () =>
      workspaceId === undefined || !skillsOn
        ? undefined
        : keptSkills(() =>
            queryClient.fetchQuery(
              repositorySkillsQueryOptions(
                repository === null ? { workspaceId } : { workspaceId, repository },
              ),
            ),
          ),
    [queryClient, workspaceId, repository, skillsOn],
  );

  // A skill's chip opens its `SKILL.md` on GitHub, as New task's does.
  const openSkill = (skill: SkillWithFile) => {
    if (mentions === undefined || repository === null) return;
    appPlatform().openGitHub(
      encodeMention({ kind: MENTION_KIND.FILE, path: skill.path }, mentions.doors.place),
    );
  };

  return (
    <TaskMentions value={mentions}>
      <SkillFiles source={skills} onOpen={openSkill}>
        <PromptField
          value={value}
          label={label}
          rows={rows}
          invalid={invalid}
          skills={skills}
          disabledServers={disabledServers}
          onChange={onChange}
          onSave={onSave}
        />
      </SkillFiles>
    </TaskMentions>
  );
}
