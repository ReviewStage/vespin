import { TASK_STATUS, type TaskStatus } from "@repo/features/task-wire";
import {
  LIST_MOTION_REPLAY,
  NestedRowsMotion,
  RELATED_TASK_CELLS,
  RevealArea,
  revealArea,
  TASK_ROW_CELL,
  TaskRow,
  TaskRowGlyph,
  TaskRows,
  TaskStatusMark,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  useListMotionReplay,
} from "@repo/ui";
import { useRef, useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * nested-rows.tsx -- a flat list whose rows nest under the rows that fold
 * them, as a task's Overview nests an agent's started agents: a fold opened
 * unrolls its rows in together, what stands under them gliding down on the
 * same spring, and a fold shut rolls them up as what stands under them
 * closes over them (`NestedRowsMotion`).
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
  const list = useRef<HTMLDivElement>(null);
  const replay = useListMotionReplay();

  const toggle = (id: string, open: boolean) => {
    replay?.(open ? LIST_MOTION_REPLAY.MOVE : LIST_MOTION_REPLAY.CLOSE);
    setOpened((held) => {
      const next = new Set(held);

      if (open) next.add(id);
      else next.delete(id);

      return next;
    });
  };

  return (
    <div ref={list} className="min-w-0">
      <NestedRowsMotion
        root={list}
        folds={opened}
        rows={rowsOf(TREE, opened)}
        keyOf={(row) => row.node.id}
      >
        {(drawn) => (
          <TaskRows label="Agents" moves>
            {drawn.map(({ key, value: { node, depth } }) => (
              <TaskRow
                key={key}
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
        )}
      </NestedRowsMotion>
    </div>
  );
}

function NestedArea(): React.JSX.Element {
  const area = useRef<HTMLDivElement>(null);

  return (
    <RevealArea root={area}>
      <div ref={area} className="catalog-stack" {...revealArea()}>
        <NestedList />
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          What stands under the list moves with it.
        </Text>
      </div>
    </RevealArea>
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
