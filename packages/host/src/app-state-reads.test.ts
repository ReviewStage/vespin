import { AGENT_STATUS } from "@repo/features/agent-wire";
import { IDLE_TASKS_VIEW } from "@repo/features/tasks-view";
import { describe, expect, it } from "vitest";
import type { AppStateSnapshot } from "./app-state.js";
import { answerKeeper, selectAgentNames, shareAppState } from "./app-state-reads.js";
import { initialAppState } from "./client/app-state-store.js";
import { runModeFor } from "./run-mode.js";

describe("shareAppState", () => {
  it("answers a reader's changed slice with the document's own nodes, not copies of them", () => {
    const kept = { id: "kept", title: "Kept" };
    const moved = { id: "moved", title: "Before" };
    const held = { tasks: [kept, moved] };
    const document = { tasks: [kept, { id: "moved", title: "After" }] };

    const shared = shareAppState(held, document);

    expect(shared).toBe(document);
    expect(shared.tasks).toBe(document.tasks);
  });

  it("keeps the held parts a fresh write left equal, and takes the parts it changed", () => {
    const kept = { id: "kept", title: "Kept" };
    const held = { tasks: [kept, { id: "moved", title: "Before" }] };
    const changed = { id: "moved", title: "After" };
    const write = { tasks: [{ id: "kept", title: "Kept" }, changed] };

    const shared = shareAppState(held, write);

    expect(shared).toEqual(write);
    expect(shared.tasks[0]).toBe(kept);
    expect(shared.tasks[1]).toBe(changed);
  });
});

describe("answerKeeper", () => {
  it("answers the last answer again while a new one equals it, and the new one once it moves", () => {
    const keep = answerKeeper<{ readonly rows: readonly { readonly id: string }[] }>();
    const first = keep({ rows: [{ id: "a" }, { id: "b" }] });
    const same = keep({ rows: [{ id: "a" }, { id: "b" }] });
    const moved = keep({ rows: [{ id: "a" }, { id: "c" }] });

    expect(same).toBe(first);
    expect(moved.rows.map(({ id }) => id)).toEqual(["a", "c"]);
    expect(moved.rows[0]).toBe(first.rows[0]);
  });
});

/** The fixture's document with `taskAgents` as the task list's agents. */
function withAgents(
  taskAgents: NonNullable<AppStateSnapshot["tasks"]["taskAgents"]>,
): AppStateSnapshot {
  return {
    ...initialAppState(
      {
        launch: { profile: "inbox", captureMode: false, fixtureMode: true },
        runMode: runModeFor({ capture: false, fixture: true }),
        appVersion: "1.2.3",
        packaged: true,
        platform: "ios",
      },
      false,
      [],
    ),
    version: 1,
    window: { fullScreen: false },
    tasks: { ...IDLE_TASKS_VIEW, taskAgents },
  };
}

const AGENT_ID = "a1b2c3d4-0000-4000-8000-0000000000aa";

const UNTITLED_AGENT = {
  id: AGENT_ID,
  planId: "a1b2c3d4-0000-4000-8000-0000000000bb",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: null,
  createdAt: 1,
  status: AGENT_STATUS.RUNNING,
  turnId: null,
  workspaceId: "workspace-personal",
  repository: null,
  automationName: "Morning triage",
} as const;

describe("selectAgentNames", () => {
  it("names an agent with no title yet by the automation whose run started it, as the panel does", () => {
    expect(selectAgentNames(withAgents([UNTITLED_AGENT])).get(AGENT_ID)).toBe("Morning triage");
  });

  it("answers the same names while an agent moves without its name moving, so its readers draw nothing anew", () => {
    const running = selectAgentNames(withAgents([UNTITLED_AGENT]));

    const done = selectAgentNames(
      withAgents([{ ...UNTITLED_AGENT, status: AGENT_STATUS.COMPLETED }]),
    );

    const named = selectAgentNames(withAgents([{ ...UNTITLED_AGENT, title: "Triage the queue" }]));

    expect(done).toBe(running);
    expect(named.get(AGENT_ID)).toBe("Triage the queue");
  });
});
