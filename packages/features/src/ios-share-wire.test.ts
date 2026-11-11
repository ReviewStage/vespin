import { expect, test } from "vitest";
import { shareDraftOf, shareSnapshotOf } from "./ios-share-wire.js";
import { TASK_STATUS, type TaskSummary } from "./task-wire.js";
import { WORKSPACE_ROLE, type Workspace } from "./workspace-wire.js";

/**
 * ios-share-wire.test.ts -- the share sheet offers a workspace only the
 * repositories its GitHub reaches, the newest the account worked in first,
 * and the app opens New task only on a draft kept under the account signed
 * in. Synthetic ids throughout.
 */

const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  role: WORKSPACE_ROLE.OWNER,
  github: { login: "acme", active: true },
};

/** A task of the account's, numbered `number`, in `repository`. */
function task(number: number, repository: string): TaskSummary {
  return {
    id: `task-${number}`,
    workspaceId: ACME.id,
    number,
    name: `Task ${number}`,
    createdAt: 0,
    updatedAt: 0,
    repository,
    status: TASK_STATUS.TODO,
    ownerId: "user-ada",
  };
}

test("a workspace is offered the repositories its GitHub reaches, the newest worked in first", () => {
  // Listed newest first, as the Tasks list orders them.
  const tasks = [task(3, "globex/site"), task(2, "acme/ledger"), task(1, "acme/web")];
  // Note that the workspace's own list is unread, as it is until New task has opened on it.
  const snapshot = shareSnapshotOf("user-ada", ACME.id, [ACME], tasks, () => undefined);
  expect(snapshot.workspaces).toEqual([
    { id: ACME.id, name: "Acme", repositories: ["acme/ledger", "acme/web"] },
  ]);
});

test("a draft opens New task only for the account it was kept under", () => {
  const kept = JSON.stringify({ accountId: "user-ada", prompt: "Fix the footer", keptAt: 1 });
  expect(shareDraftOf(kept, "user-ada")?.prompt).toBe("Fix the footer");
  expect(shareDraftOf(kept, "user-grace")).toBeUndefined();
  expect(shareDraftOf("not json", "user-ada")).toBeUndefined();
});
