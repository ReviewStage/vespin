import { describe, expect, it } from "vitest";
import { relationSubject } from "./task-relation-model.js";
import { TASK_RELATION_KIND, type TaskSummary } from "./task-wire.js";

const AT = Date.UTC(2026, 10, 13);
const BLOCKER = "0b7a8f43-5d2e-4c1a-9f6b-000000000002";

const ROW: TaskSummary = {
  id: "0b7a8f43-5d2e-4c1a-9f6b-000000000001",
  workspaceId: "0b7a8f43-5d2e-4c1a-9f6b-0000000000aa",
  name: "Weekly digest email",
  createdAt: AT,
  updatedAt: AT,
  repository: "acme/relay",
};

describe("relationSubject", () => {
  it("judges a block by the row's blocks before the task's description is read", () => {
    const row = { ...ROW, blockedBy: [BLOCKER], blocks: [] };

    expect(relationSubject(row, undefined, TASK_RELATION_KIND.BLOCKED_BY)).toEqual(row);
  });

  it("waits on the description for a block where the row names no blocks, then takes its blocks", () => {
    const opened = { blockedBy: [BLOCKER], blocks: [] };

    expect(relationSubject(ROW, undefined, TASK_RELATION_KIND.BLOCKS)).toBeUndefined();
    expect(relationSubject(ROW, opened, TASK_RELATION_KIND.BLOCKS)).toEqual({ ...ROW, ...opened });
  });
});
