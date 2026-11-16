// chip-mark-model.test.ts -- a chip leads with its entity's own mark where the app holds it, as the panel's does, and with its kind's glyph where it does not.

import { ENTITY_KIND } from "@repo/features/entity-kind";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import { TASK_STATUS } from "@repo/features/task-wire";
import { describe, expect, it } from "vitest";
import { CHIP_MARK, type ChipMarksHeld, chipMarkOf } from "./chip-mark-model.js";
import { GLYPH } from "./glyph.js";
import { STATUS_TONE } from "./tokens/status-tone.js";

const RELAY = { id: "w-relay", name: "Relay" };

const HELD: ChipMarksHeld = {
  taskStatus: (taskId) => (taskId === "t-alerts" ? TASK_STATUS.IN_PROGRESS : undefined),
  agentModel: (agentId) => (agentId === "a-1" ? "anthropic/claude-opus-5.5" : undefined),
  member: (userId) =>
    userId === "u-grace" ? { name: "Grace Hopper", picture: undefined } : undefined,
  inboxItem: () => undefined,
  workspace: (slug) => (slug === "relay" ? RELAY : undefined),
};

describe("a chip's mark", () => {
  it("is its entity's own where the app holds it: a task's status, an agent's harness, a person's face, a workspace's tile", () => {
    expect(chipMarkOf({ kind: ENTITY_KIND.PLAN, taskId: "t-alerts" }, HELD)).toEqual({
      kind: CHIP_MARK.GLYPH,
      glyph: GLYPH.STATUS_IN_PROGRESS,
      tone: STATUS_TONE.WORKING,
    });
    expect(chipMarkOf({ kind: ENTITY_KIND.AGENT, agentId: "a-1" }, HELD)).toEqual({
      kind: CHIP_MARK.HARNESS,
      harness: MODEL_PROVIDER.ANTHROPIC,
    });
    expect(chipMarkOf({ kind: ENTITY_KIND.PERSON, userId: "u-grace" }, HELD)).toEqual({
      kind: CHIP_MARK.FACE,
      name: "Grace Hopper",
      picture: undefined,
    });
    expect(chipMarkOf({ kind: ENTITY_KIND.WORKSPACE, workspace: "relay" }, HELD)).toEqual({
      kind: CHIP_MARK.TILE,
      workspace: RELAY,
    });
  });

  it("is none, leaving its kind's glyph, where the app holds nothing of it or the kind wears no mark of its own", () => {
    expect(chipMarkOf({ kind: ENTITY_KIND.PLAN, taskId: "t-unread" }, HELD)).toBeUndefined();
    expect(
      chipMarkOf({ kind: ENTITY_KIND.REPOSITORY, repository: "ada/relay" }, HELD),
    ).toBeUndefined();
  });
});
