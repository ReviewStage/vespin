// task-page-skeleton.tsx -- a task's page while what it stands for is read: its head, and its sections and description, drawn through the rows the loaded page draws with, in SwiftUI's placeholder look.

import type { ReactElement } from "react";
import { ListSection } from "./row-list.js";
import { SkeletonRegion } from "./skeleton.js";
import { AGENT_ROW_STATE, AgentRow, RelationRow, TaskHead, WordsRow } from "./task-rows.js";

/** The rows a task page's section lists, by the row the loaded page draws them with. */
export const TASK_SKELETON_ROW = {
  /** A related task (`RelationRow`), as Sub-tasks and the relations list them. */
  TASK: "task",
  /** An agent on the task (`AgentRow`). */
  AGENT: "agent",
  /** The description's words (`WordsRow`). */
  WORDS: "words",
} as const;

export type TaskSkeletonRow = (typeof TASK_SKELETON_ROW)[keyof typeof TASK_SKELETON_ROW];

/** One section of a task's page as its skeleton stands it: its title and how many of its rows, as the loaded page declares them. */
export type TaskSkeletonSection = {
  readonly title: string;
  readonly row: TaskSkeletonRow;
  readonly rows: number;
};

/**
 * The words a placeholder row is handed, which SwiftUI's placeholder look
 * draws as bars of their length: a name's, a short fact's, and a paragraph's.
 */
const PLACEHOLDER = {
  NAME: "Placeholder name of a task",
  FACT: "Placeholder",
  WORDS:
    "Placeholder words of a description, standing where its first paragraph is drawn once it is read, long enough to run over a few lines.",
} as const;

/** Nothing to open, since a placeholder's link is never pressed. */
const NO_LINK = () => undefined;

/** One placeholder row of a section, through the row the loaded page draws it with. */
function placeholderRow(row: TaskSkeletonRow, at: number): ReactElement {
  const id = String(at);

  switch (row) {
    case TASK_SKELETON_ROW.TASK:
      return <RelationRow key={id} id={id} name={PLACEHOLDER.NAME} status={undefined} />;
    case TASK_SKELETON_ROW.AGENT:
      return (
        <AgentRow
          key={id}
          id={id}
          name={PLACEHOLDER.NAME}
          state={AGENT_ROW_STATE.REST}
          runsOn={PLACEHOLDER.FACT}
          waiting={0}
        />
      );
    case TASK_SKELETON_ROW.WORDS:
      return <WordsRow key={id} words={PLACEHOLDER.WORDS} onOpenLink={NO_LINK} last />;
  }
}

/** A task's head while the task a link names is read: its heading, chips and byline as placeholders. */
export function TaskHeadSkeleton() {
  return (
    <SkeletonRegion>
      <TaskHead
        name={PLACEHOLDER.NAME}
        status={undefined}
        priority={undefined}
        assignee={{ name: PLACEHOLDER.FACT, nobody: true }}
        createdBy={PLACEHOLDER.NAME}
      />
    </SkeletonRegion>
  );
}

/**
 * A task page's sections while they are read, each under its own header
 * with as many placeholder rows as the loaded page declares, through the
 * rows it draws them with, so the page stands in its loaded shape rather
 * than blank under its head.
 */
export function TaskSectionsSkeleton({
  sections,
}: {
  readonly sections: readonly TaskSkeletonSection[];
}) {
  return (
    <SkeletonRegion>
      {sections.map((section) => (
        <ListSection key={section.title} title={section.title}>
          {Array.from({ length: section.rows }, (_, at) => placeholderRow(section.row, at))}
        </ListSection>
      ))}
    </SkeletonRegion>
  );
}
