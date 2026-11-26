import assert from "node:assert/strict";
import { AGENT_BRIEF, AGENT_MACHINE } from "@repo/features/agent-wire";
import { Option } from "effect";
import { test } from "vitest";
import { TOOL_GATE, type ToolGate } from "../tool-catalog/gates.js";
import { NO_EXPERIMENT_ON } from "../workspace-experiment-on.js";
import { coderInstructions } from "./instructions.js";

/**
 * instructions.test.ts -- whom an agent is told it works for: a coder, the
 * developer who started it; a Manager, whichever member asked.
 */

const STARTER = "00000000-0000-4000-8000-000000000002";

const OWN = {
  id: "00000000-0000-4000-8000-000000000001",
  runsOn: { machine: AGENT_MACHINE.VERCEL },
  developer: { userId: STARTER, name: "Ada Lovelace" },
  startedByAgent: false,
} as const;

const instructionsOf = (gates: readonly ToolGate[]) =>
  coderInstructions("acme/app", AGENT_BRIEF.BLANK, undefined, OWN, {
    agent: Option.none(),
    open: new Set(gates),
    experiments: NO_EXPERIMENT_ON,
  });

test("a coder is told the developer it works for, and a Manager that it acts for whichever member asked, its starter named as the one who set it up", () => {
  const coder = instructionsOf([TOOL_GATE.REPOSITORY, TOOL_GATE.SANDBOX]);
  const manager = instructionsOf([TOOL_GATE.REPOSITORY, TOOL_GATE.SANDBOX, TOOL_GATE.MANAGER]);

  assert.ok(
    coder.includes(
      `The developer you work for: userId \`${STARTER}\`, mention \`[@Ada Lovelace](https://vespin.dev/acme/person/${STARTER})\`, as \`startedBy\`, \`to\`, and \`assignee\` take them.`,
    ),
  );

  assert.ok(!manager.includes("developer you work for"));
  assert.ok(manager.includes("You work for the members of this workspace"));
  assert.ok(manager.includes("act for whoever asked"));
  assert.ok(
    manager.includes(`Your starter set you up, and your tools act as them: userId \`${STARTER}\``),
  );
});
