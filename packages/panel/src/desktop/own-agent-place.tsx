/**
 * own-agent-place.tsx -- what an agent on no task's own page hands its pane, as a task's page hands its agents': the skills a `/` offers, what an `@` offers, the workspace's members, and the workspace its links are written under.
 *
 * A task's page reads each of these through its task: the skills its
 * repository keeps (`use-agents.ts`'s `readSkills`), its mentions
 * (`heldTaskMentions`), and its workspace's members and link slug. A
 * Manager stands on no task, so its page reads them through the agent's
 * own workspace and repository instead, as New task's composer and an
 * automation's prompt do (`tasklessMentions`): a `/` lists its
 * repository's skills and the member's installed ones, a skill a message
 * names opens its `SKILL.md` in a File tab beside the page, as a file it
 * names does, an `@` offers its repository's files, its skills, the servers,
 * and the workspace's coding agents, and a mention its transcript holds is
 * drawn as its chip, a file's opening in the panel beside the page
 * (`onOpenFile`). A dictation into its box listens for its repository
 * and its name rather than the last task opened.
 */

import type { ListedAgent } from "@repo/features/agent-wire";
import { dictationKeywords } from "@repo/features/dictation-keywords";
import { encodeMention, MENTION_KIND } from "@repo/features/mention-link";
import { EXPERIMENT } from "@repo/settings";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";
import { appPlatform } from "../app-platform.js";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import { MemberDirectory } from "../member-directory.js";
import { useTaskNames } from "../task-list-collections.js";
import { repositorySkillsQueryOptions } from "../tasks/agent-reads.js";
import type { MentionDoors } from "../tasks/mention-chip.js";
import { keptSkills } from "../tasks/repository-skills.js";
import { SkillFiles } from "../tasks/skill-chip.js";
import type { SkillSource } from "../tasks/skill-picker.js";
import type { SkillWithFile } from "../tasks/skill-ref.js";
import {
  TaskMentions,
  type TaskMentionsValue,
  tasklessMentions,
  useMentionAgentsReader,
} from "../tasks/task-mentions.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { appStateQuery, selectExperiment } from "../use-app-state.js";

/** What an agent on no task's page reads through the agent's own workspace and repository. */
export interface OwnAgentPlace {
  /** Where a `/` in its box reads the skills it offers; none while the Skills experiment is off. */
  readonly skills: SkillSource | undefined;
  /** The words a dictation into its box listens for. */
  readonly keywords: readonly string[];
  /** What an `@` in its box offers, and what draws the mentions its transcript holds. */
  readonly mentions: TaskMentionsValue;
  /** Its workspace as the account lists it, whose members its senders are read against; by its id alone until the list holds it. */
  readonly workspace: TasksControl["workspaces"][number] | { readonly id: string };
  /** The workspace its links are written under: its slug, or its id until the workspaces are read. */
  readonly linkWorkspace: string;
}

/** The place of the agent on no task, read through its workspace and repository. */
export function useOwnAgentPlace(
  tasks: TasksControl,
  agent: ListedAgent,
  models: AgentsControl["models"],
  onOpenFile: MentionDoors["onOpenFile"],
): OwnAgentPlace {
  const { workspaceId, repository } = agent;
  const listed = tasks.workspaces.find((each) => each.id === workspaceId);
  const linkWorkspace = listed?.slug ?? workspaceId;
  const queryClient = useQueryClient();

  const skillsOn =
    useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.SKILLS) }).data === true;

  // Note that the skills are kept for the workspace and repository as they stand, so another repository reads afresh.
  const skills = useMemo(
    () =>
      skillsOn
        ? keptSkills(() =>
            queryClient.fetchQuery(
              repositorySkillsQueryOptions(
                repository === null ? { workspaceId } : { workspaceId, repository },
              ),
            ),
          )
        : undefined,
    [queryClient, skillsOn, workspaceId, repository],
  );

  // The workspace's agents an `@` offers, named by the tasks the window lists.
  const readAgents = useMentionAgentsReader(workspaceId, useTaskNames(tasks.typedNames), models);

  const { onShowMention } = tasks;

  const mentions = useMemo(
    () =>
      tasklessMentions(
        { workspace: linkWorkspace, workspaceId, repository },
        onShowMention,
        readAgents,
        onOpenFile,
      ),
    [linkWorkspace, workspaceId, repository, onShowMention, readAgents, onOpenFile],
  );

  const { title } = agent;

  const keywords = useMemo(
    () => dictationKeywords({ repository, title: title ?? undefined, body: undefined }),
    [repository, title],
  );

  return {
    skills,
    keywords,
    mentions,
    workspace: listed ?? { id: workspaceId },
    linkWorkspace,
  };
}

/** Hands everything on an agent on no task's page its place: its links' workspace, its members, its mentions, and its skills' files. */
export function OwnAgentPlaceProvider({
  place,
  readerId,
  children,
}: {
  place: OwnAgentPlace;
  readerId: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const { mentions } = place;

  // A skill's chip opens its `SKILL.md` beside the page as a file its words name does, else on GitHub, as New task's does.
  const openSkill = (skill: SkillWithFile) => {
    if (mentions.repository === null) return;
    const { onOpenFile } = mentions.doors;

    if (onOpenFile !== undefined) return onOpenFile(skill.path, undefined);
    appPlatform().openGitHub(
      encodeMention({ kind: MENTION_KIND.FILE, path: skill.path }, mentions.doors.place),
    );
  };

  return (
    <LinkWorkspaceProvider value={place.linkWorkspace}>
      <MemberDirectory workspace={place.workspace} readerId={readerId}>
        <TaskMentions value={mentions}>
          <SkillFiles source={place.skills} onOpen={openSkill}>
            {children}
          </SkillFiles>
        </TaskMentions>
      </MemberDirectory>
    </LinkWorkspaceProvider>
  );
}
