import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { CLOUD_SETUP_SCRIPT } from "@repo/features/workspace-sandbox-setup-wire";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, openAgentOnOwnTask, openWorkspace } from "../../testing/index.js";
import { listScriptRuns, recordScriptRun } from "../workspace-sandbox-script-run-store.js";

/**
 * A workspace's cloud setup script runs, over a real dialect: a run replaces
 * its script's last however the repository is cased, each script keeps its
 * own, and one workspace never reads another's runs.
 * Synthetic accounts, workspaces, and agents throughout.
 */

const AT = new Date("2026-11-08T12:00:00Z");
const LATER = new Date("2026-11-08T12:05:00Z");

const { INSTALL, SETUP, ARCHIVE } = CLOUD_SETUP_SCRIPT;

const openOwnedWorkspace = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
  const workspace = yield* openWorkspace(userId);
  const agentId = yield* openAgentOnOwnTask(userId, workspace);
  return { workspace, agentId };
});

it.layer(getTestDB())("the workspace sandbox script run store", (it) => {
  it.effect(
    "a run replaces its script's last however its repository is cased unless it started earlier, and each script keeps its own",
    () =>
      Effect.gen(function* () {
        const { workspace, agentId } = yield* openOwnedWorkspace;
        const ran = { organizationId: workspace, agentId };
        yield* recordScriptRun({
          ...ran,
          script: INSTALL,
          repository: null,
          exitCode: 0,
          ranAt: AT,
        });
        yield* recordScriptRun({
          ...ran,
          script: SETUP,
          repository: "acme/relay",
          exitCode: 0,
          ranAt: AT,
        });
        yield* recordScriptRun({
          ...ran,
          script: SETUP,
          repository: "Acme/Relay",
          exitCode: 1,
          ranAt: LATER,
        });
        // A run that started before the one standing, finishing after it, leaves it standing.
        yield* recordScriptRun({
          ...ran,
          script: SETUP,
          repository: "acme/relay",
          exitCode: 0,
          ranAt: AT,
        });
        yield* recordScriptRun({
          ...ran,
          script: ARCHIVE,
          repository: "acme/relay",
          exitCode: 0,
          ranAt: AT,
        });
        // The install script's runs, under no repository, are one row too.
        yield* recordScriptRun({
          ...ran,
          script: INSTALL,
          repository: null,
          exitCode: 2,
          ranAt: LATER,
        });

        const runs = yield* listScriptRuns(workspace);
        assert.deepEqual(
          runs
            .map((row) => [
              row.script,
              row.repository,
              row.exitCode,
              row.ranAt.getTime(),
              row.agent.id,
            ])
            .sort(),
          [
            [ARCHIVE, "acme/relay", 0, AT.getTime(), agentId],
            [INSTALL, null, 2, LATER.getTime(), agentId],
            [SETUP, "acme/relay", 1, LATER.getTime(), agentId],
          ].sort(),
        );
      }),
  );

  it.effect("one workspace never reads another's runs", () =>
    Effect.gen(function* () {
      const mine = yield* openOwnedWorkspace;
      const theirs = yield* openOwnedWorkspace;
      yield* recordScriptRun({
        organizationId: theirs.workspace,
        agentId: theirs.agentId,
        script: INSTALL,
        repository: null,
        exitCode: 0,
        ranAt: AT,
      });

      assert.deepEqual(yield* listScriptRuns(mine.workspace), []);
    }),
  );
});
