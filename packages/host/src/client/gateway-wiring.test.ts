import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { IDLE_TASKS_VIEW, type ListedTasksView } from "@repo/features/tasks-view";
import {
  carried,
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  gatewayHost,
  NodeRegistry,
} from "@repo/gateway";
import { Context, Effect } from "effect";
import { runModeFor } from "../run-mode.js";
import { AppStateStore, initialAppState } from "./app-state-store.js";
import { wireGateway } from "./gateway-wiring.js";

/**
 * gateway-wiring.test.ts -- what the host says reaching the document every
 * window is told from, through the one in-process Gateway a client holds.
 */

const RUN = {
  launch: { profile: "idle", captureMode: false, fixtureMode: false },
  runMode: runModeFor({ capture: false, fixture: false }),
  appVersion: "1.2.3",
  packaged: true,
  platform: "darwin",
} as const;

it.effect(
  "the host's tasks view reaches the document as the host built it, never rebuilt by a decode on the way",
  () =>
    Effect.gen(function* () {
      const gateway = gatewayHost({
        methods: {},
        client: { clientId: "panel", role: GATEWAY_CLIENT_ROLE.OPERATOR },
      });

      const state = new AppStateStore(initialAppState(RUN, true, []), Context.empty());
      yield* wireGateway({
        gateway,
        nodes: new NodeRegistry(),
        report: () => undefined,
        state,
        node: { openExternal: () => Promise.resolve() },
      });
      const view: ListedTasksView = { ...IDLE_TASKS_VIEW, tasks: [], activeTaskId: "plan-1" };

      gateway.emit(GATEWAY_EVENT.TASKS_CHANGED, carried(view));

      // The document holds the view's slice and the store its very lists beside it, neither rebuilt.
      assert.deepEqual(state.snapshot().tasks, { ...IDLE_TASKS_VIEW, activeTaskId: "plan-1" });
      assert.equal(state.taskList().tasks, view.tasks);
      assert.equal(state.snapshot().version, 1);
    }).pipe(Effect.scoped),
);
