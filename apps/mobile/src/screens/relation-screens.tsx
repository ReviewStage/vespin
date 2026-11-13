// relation-screens.tsx -- the Task relation sheet: the four kinds a task may be related to another as, then the workspace's other tasks, searched by name or key, a pick relating them at once, as the panel's Task relation menu does.

import { searchTokens } from "@repo/features/search-tokens";
import {
  NO_TASKS_MATCH,
  relationWhyNot,
  TASK_RELATION_MENU,
  TASK_RELATION_ORDER,
  TASK_RELATION_SEARCH,
  TASK_RELATION_VERBS,
  type TaskRelationSubject,
} from "@repo/features/task-relation-model";
import { searchedTasks } from "@repo/features/task-tree-model";
import {
  TASK_RELATION_KIND,
  type TaskRelationKind,
  type TaskSummary,
} from "@repo/features/task-wire";
import { readingWords } from "@repo/features/words";
import { taskKey } from "@repo/features/workspace-key";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import {
  BAR_TITLE,
  EmptyState,
  GLYPH,
  type Glyph,
  LIST_LOOK,
  LinkRow,
  ListSection,
  RelationRow,
  RowList,
  Screen,
  useColors,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useTaskRelationWrites } from "../tasks/use-relations.js";
import { useTaskOverview } from "../tasks/use-tasks.js";

/** The sheet's own words. */
const WORDS = {
  CANCEL: "Cancel",
  TASK_NOT_FOUND: "Task not found",
} as const;

/** Each kind's glyph, the SF Symbol nearest the panel's icon for it, which leads its row among the kinds and in a task's Task relation menu. */
export const RELATION_KIND_SYMBOL = {
  [TASK_RELATION_KIND.SUB_TASK]: GLYPH.SUB_TASK,
  [TASK_RELATION_KIND.PARENT]: GLYPH.PARENT_TASK,
  [TASK_RELATION_KIND.BLOCKED_BY]: GLYPH.BLOCKED_BY,
  [TASK_RELATION_KIND.BLOCKS]: GLYPH.BLOCKS,
} as const satisfies Record<TaskRelationKind, Glyph>;

/** Opens the Task relation sheet over a task, on `kind`, or on the four kinds where none is named. */
export type OpenRelation = (taskId: string, kind?: TaskRelationKind) => void;

/** The door to the Task relation sheet, as a task's menus and page open it. */
export function useOpenRelation(): OpenRelation {
  const router = useRouter();

  return (taskId, kind) =>
    router.push({
      pathname: "/task-relation",
      params: kind === undefined ? { task: taskId } : { task: taskId, kind },
    });
}

/** What the sheet says while the task's document, which holds its blocks, is first read. */
const READING_TASK = readingWords("the task");

/** Whether a kind is a block, which the open task's document judges, since the list carries no blocks. */
function blockKind(kind: TaskRelationKind): boolean {
  return kind === TASK_RELATION_KIND.BLOCKED_BY || kind === TASK_RELATION_KIND.BLOCKS;
}

/** Whether a route's word names one of the four kinds. */
export function isRelationKind(word: string | undefined): word is TaskRelationKind {
  return TASK_RELATION_ORDER.some((kind) => kind === word);
}

/** A task offered for a kind: the task, its key, and why it cannot take the kind, where it cannot. */
interface Candidate {
  readonly task: TaskSummary;
  readonly key: string | undefined;
  readonly why: string | undefined;
}

/**
 * The tasks the sheet offers for `kind`: the workspace's others, or those
 * a search finds by name, repository, or key, each one that cannot take the
 * kind kept with why, as the panel's menu dims it.
 */
function candidatesFor(
  subject: TaskRelationSubject,
  tasks: readonly TaskSummary[],
  kind: TaskRelationKind,
  workspaceName: string | undefined,
  search: string,
): readonly Candidate[] {
  const tokens = searchTokens(search);
  const byId = new Map(tasks.map((each) => [each.id, each]));

  const offered =
    tokens.length === 0
      ? tasks.filter((each) => each.workspaceId === subject.workspaceId)
      : searchedTasks({ tasks, workspaceId: subject.workspaceId, workspaceName, tokens });

  return offered
    .filter((each) => each.id !== subject.id)
    .map((each) => ({
      task: each,
      key:
        workspaceName === undefined || each.number === undefined
          ? undefined
          : taskKey(workspaceName, each.number),
      why: relationWhyNot(subject, each, kind, byId),
    }));
}

/** The kinds the sheet opens on where none is named, each by its glyph and what choosing it does. */
function KindRows({ onKind }: { readonly onKind: (kind: TaskRelationKind) => void }) {
  return (
    <RowList look={LIST_LOOK.PLAIN}>
      <ListSection>
        {TASK_RELATION_ORDER.map((kind) => (
          <LinkRow
            key={kind}
            symbol={RELATION_KIND_SYMBOL[kind]}
            label={TASK_RELATION_VERBS[kind].choose}
            onPress={() => onKind(kind)}
          />
        ))}
      </ListSection>
    </RowList>
  );
}

/**
 * The Task relation sheet over a task, as the panel's menu asks: opened on
 * no kind, the four kinds, each what choosing it does; a kind chosen, or
 * named by the route, the workspace's other tasks under the system's search
 * field, which says which way round the relation stands, each by its status
 * ring, its name, and its key, or, where it cannot take the kind, dimmed with
 * why. A pick relates the two at once and closes the sheet; a dimmed task
 * picks nothing. On Add sub-task, New sub-task leads the list, opening New
 * task for one in the sheet's place.
 */
export function TaskRelationScreen({
  taskId,
  kind: opened,
}: {
  readonly taskId: string;
  readonly kind?: TaskRelationKind | undefined;
}) {
  const router = useRouter();
  const colors = useColors();
  const overview = useTaskOverview(taskId);
  const writes = useTaskRelationWrites();
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const [chosen, setChosen] = useState<TaskRelationKind | undefined>(opened);
  const [search, setSearch] = useState("");
  const kind = chosen;

  const bar = (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: kind === undefined ? TASK_RELATION_MENU : TASK_RELATION_VERBS[kind].head,
          headerTintColor: colors.TEXT,
          headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.SIDEBAR },
        }}
      >
        {kind === undefined ? null : (
          <Stack.SearchBar
            placeholder={TASK_RELATION_SEARCH[kind].find}
            hideWhenScrolling={false}
            onChangeText={(event) => setSearch(event.nativeEvent.text)}
            onCancelButtonPress={() => setSearch("")}
          />
        )}
      </Stack.Screen>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={() => router.back()}>{WORDS.CANCEL}</Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );

  if (overview === undefined) {
    return (
      <>
        {bar}
        <Screen>
          <EmptyState title={WORDS.TASK_NOT_FOUND} symbol={GLYPH.NOT_FOUND} />
        </Screen>
      </>
    );
  }

  if (kind === undefined) {
    return (
      <>
        {bar}
        <Screen>
          <KindRows onKind={setChosen} />
        </Screen>
      </>
    );
  }

  const { document } = overview;

  // Note that the open task's blocks are its document's, which the list does not carry, so a block's tasks wait for it rather than be judged against none.
  if (blockKind(kind) && document === undefined) {
    return (
      <>
        {bar}
        <Screen>
          <EmptyState title={READING_TASK} symbol={GLYPH.TASK} />
        </Screen>
      </>
    );
  }

  const subject: TaskRelationSubject = {
    ...overview.task,
    ...(document?.blockedBy === undefined ? undefined : { blockedBy: document.blockedBy }),
    ...(document?.blocks === undefined ? undefined : { blocks: document.blocks }),
  };

  const workspaceName = workspaces.find((each) => each.id === subject.workspaceId)?.name;
  const candidates = candidatesFor(subject, overview.tasks, kind, workspaceName, search);
  const byId = new Map(candidates.map((each) => [each.task.id, each]));

  const pick = (id: string) => {
    const picked = byId.get(id);

    if (picked === undefined || picked.why !== undefined) return;
    writes.relate(subject.id, kind, id);
    router.back();
  };

  const newSubTask =
    kind === TASK_RELATION_KIND.SUB_TASK ? (
      <LinkRow
        symbol={GLYPH.ADD}
        label={TASK_RELATION_SEARCH[kind].create}
        onPress={() => router.replace({ pathname: "/start-task", params: { parent: subject.id } })}
      />
    ) : null;

  return (
    <>
      {bar}
      <Screen>
        {candidates.length === 0 && newSubTask === null ? (
          <EmptyState title={NO_TASKS_MATCH} symbol={GLYPH.NOT_FOUND} />
        ) : (
          <RowList look={LIST_LOOK.PLAIN} onSelect={pick}>
            <ListSection>
              {newSubTask}
              {candidates.map(({ task, key, why }) => (
                <RelationRow
                  key={task.id}
                  id={task.id}
                  name={task.name}
                  status={task.status}
                  relation={why ?? key ?? ""}
                  faded={why !== undefined}
                />
              ))}
            </ListSection>
          </RowList>
        )}
      </Screen>
    </>
  );
}
