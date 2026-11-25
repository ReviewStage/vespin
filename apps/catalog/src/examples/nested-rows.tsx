import { TASK_STATUS, type TaskStatus } from "@repo/features/task-wire";
import {
  RELATED_TASK_CELLS,
  TASK_ROW_CELL,
  TaskRow,
  TaskRowGlyph,
  TaskRows,
  TaskStatusMark,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * nested-rows.tsx -- a flat list whose rows nest under the rows that fold
 * them, as a task's Overview nests an agent's started agents: a fold opened
 * stands its rows under it, and a fold shut takes them away.
 */

interface Nested {
  readonly id: string;
  readonly name: string;
  readonly status: TaskStatus;
  readonly children?: readonly Nested[];
}

const TREE: readonly Nested[] = [
  {
    id: "agent-1",
    name: "Fix the Safari login",
    status: TASK_STATUS.IN_PROGRESS,
    children: [
      { id: "agent-2", name: "Reproduce on Safari 19", status: TASK_STATUS.DONE },
      { id: "agent-3", name: "Write the cookie fix", status: TASK_STATUS.IN_PROGRESS },
      { id: "agent-4", name: "Review the fix", status: TASK_STATUS.TODO },
    ],
  },
  { id: "agent-5", name: "Rate limit search", status: TASK_STATUS.TODO },
];

/** One row as drawn: its node, and how deep it nests. */
interface Row {
  readonly node: Nested;
  readonly depth: number;
}

/** The rows the tree draws, each fold's rows standing only while it is open. */
function rowsOf(tree: readonly Nested[], opened: ReadonlySet<string>, depth = 0): Row[] {
  return tree.flatMap((node) => [
    { node, depth },
    ...(opened.has(node.id) ? rowsOf(node.children ?? [], opened, depth + 1) : []),
  ]);
}

function NestedList(): React.JSX.Element {
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = (id: string, open: boolean) => {
    setOpened((held) => {
      const next = new Set(held);

      if (open) next.add(id);
      else next.delete(id);

      return next;
    });
  };

  return (
    <div className="min-w-0">
      <TaskRows label="Agents">
        {rowsOf(TREE, opened).map(({ node, depth }) => (
          <TaskRow
            key={node.id}
            taskId={node.id}
            name={node.name}
            cells={RELATED_TASK_CELLS}
            content={{
              [TASK_ROW_CELL.STATUS]: (
                <TaskRowGlyph>
                  <TaskStatusMark status={node.status} />
                </TaskRowGlyph>
              ),
            }}
            onOpen={() => undefined}
            depth={depth}
            fold={
              node.children === undefined
                ? undefined
                : {
                    open: opened.has(node.id),
                    onOpenChange: (open) => toggle(node.id, open),
                    label: `Agents started by ${node.name}`,
                  }
            }
          />
        ))}
      </TaskRows>
    </div>
  );
}

function NestedArea(): React.JSX.Element {
  return (
    <div className="catalog-stack">
      <NestedList />
      <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        What stands under the list moves with it.
      </Text>
    </div>
  );
}

function NestedRowsExamples(): React.JSX.Element {
  return (
    <CatalogSection id="nested-rows-fold" title="Rows nested under a row that folds them">
      <NestedArea />
    </CatalogSection>
  );
}

export const NESTED_ROWS_EXAMPLE: Example = {
  id: "nested-rows",
  title: "Nested rows",
  Render: NestedRowsExamples,
};
