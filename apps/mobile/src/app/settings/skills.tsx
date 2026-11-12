// skills.tsx -- Settings' Skills page for the workspace the app works in: the workspace's skills, then the account's own, each opening its SKILL.md, and Delete, asked first, where the reader may; a skill is added from the desktop or the web, where its paste is read.

import { signedInAccountId } from "@repo/credentials/snapshot";
import type { InstalledSkillSummary } from "@repo/features/installed-skill-route-wire";
import { INSTALLED_SKILL_SCOPE } from "@repo/features/installed-skill-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import {
  failureLine,
  removeSkillQuestion,
  SKILLS_LINE,
  type SkillRow,
  skillGroups,
  workspaceGroupTitle,
} from "@repo/features/skills-settings-words";
import { readingWords, VERB } from "@repo/features/words";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { selectAccount, selectWorkspaces } from "@repo/host/app-state-reads";
import {
  ConfirmAsk,
  EmptyState,
  ListSection,
  NoteRow,
  Screen,
  SettingsForm,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { useChosenWorkspace } from "../../chosen-workspace.js";
import { appStateQuery } from "../../host/app-state-query.js";
import { useHostActs } from "../../host/host-provider.js";
import { useLiveFollow } from "../../host/live-follow.js";
import { SETTINGS_ROUTE } from "../../settings-button.js";
import { useWrite } from "../../use-write.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

/** The glyph a page of skills stands under, the panel's book. */
const SKILLS_SYMBOL = "book.closed";

/** What the page says while it reads the skills, as the panel names it. */
const READING = readingWords("your skills");

/** The skills and the workspace's people the host holds for one workspace, as a `select`; each none until read. */
function heldSkills(workspaceId: string) {
  return (state: AppStateSnapshot) => ({
    skills: state[LIVE_READ.INSTALLED_SKILLS][workspaceId],
    members: state[LIVE_READ.WORKSPACE_MEMBERS][workspaceId]?.rows?.members,
  });
}

export default function SkillsScreen() {
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { chosen } = useChosenWorkspace(workspaces);

  if (chosen === undefined) return null;

  // Note that the page is drawn anew for each workspace, so a question never carries into another.
  return <SkillsPage key={chosen.id} workspace={chosen} />;
}

function SkillsPage({ workspace }: { readonly workspace: Workspace }) {
  const acts = useHostActs();
  const write = useWrite();
  const router = useRouter();
  const workspaceId = workspace.id;
  const [asked, setAsked] = useState<InstalledSkillSummary | undefined>(undefined);
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  const readerId = account === undefined ? undefined : signedInAccountId(account);
  useLiveFollow(workspaceId, (id) => acts[ACT_KIND.INSTALLED_SKILLS_FOLLOW]({ workspaceId: id }));
  useLiveFollow(workspaceId, (id) => acts[ACT_KIND.WORKSPACE_MEMBERS_FOLLOW]({ workspaceId: id }));

  const { data: held } = useQuery({
    ...appStateQuery,
    select: useCallback(heldSkills(workspaceId), [workspaceId]),
  });

  const skills = held?.skills?.rows;

  const question = removeSkillQuestion(
    asked ?? { name: "", scope: INSTALLED_SKILL_SCOPE.PERSONAL },
    workspace,
  );

  const rowOf = (row: SkillRow) => (
    <NoteRow
      key={row.skill.id}
      words={row.skill.name}
      detail={row.skill.description}
      line={row.line}
      onPress={() =>
        router.push({
          pathname: SETTINGS_ROUTE.SKILL,
          params: { skill: row.skill.id, name: row.skill.name },
        })
      }
      remove={
        row.skill.manageable
          ? { label: SKILLS_LINE.REMOVE, onPress: () => setAsked(row.skill) }
          : undefined
      }
    />
  );

  const group = (title: string, rows: readonly SkillRow[]) => (
    <ListSection
      key={title}
      title={title}
      count={rows.length}
      footer={rows.length === 0 ? SKILLS_LINE.NONE : undefined}
    >
      {rows.length === 0 ? null : rows.map(rowOf)}
    </ListSection>
  );

  const groups = skills === undefined ? undefined : skillGroups(skills, readerId, held?.members);

  const body =
    groups === undefined ? (
      held?.skills?.failed === true ? (
        <EmptyState
          title={SKILLS_LINE.READ_FAILED}
          symbol="exclamationmark.triangle"
          action={{
            label: VERB.RETRY,
            onPress: () =>
              void acts[ACT_KIND.INSTALLED_SKILLS_RETRY]({ workspaceId }).catch((cause: unknown) =>
                console.error("Reading the skills again did not go.", cause),
              ),
          }}
        />
      ) : (
        <EmptyState title={READING} symbol={SKILLS_SYMBOL} loading />
      )
    ) : (
      <SettingsForm>
        {workspace.personal === true
          ? null
          : group(workspaceGroupTitle(workspace), groups.workspace)}
        {group(SKILLS_LINE.PERSONAL, groups.personal)}
      </SettingsForm>
    );

  return (
    <>
      <Screen>{body}</Screen>
      <ConfirmAsk
        title={question.title}
        message={question.body}
        act={question.verb}
        destructive
        presented={asked !== undefined}
        onDismiss={() => setAsked(undefined)}
        onAct={() => {
          if (asked === undefined) return;
          const skillId = asked.id;
          setAsked(undefined);
          void write(() => acts[ACT_KIND.INSTALLED_SKILLS_REMOVE]({ skillId }), {
            refused: (answer) => ("failure" in answer ? failureLine(answer) : undefined),
          });
        }}
      />
    </>
  );
}
