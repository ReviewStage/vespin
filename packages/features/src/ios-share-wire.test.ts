import { expect, test } from "vitest";
import { CLIENT_PLATFORM } from "./client-identity.js";
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

/** Where the sheet's Start goes, as a build of 0.1.0 names itself. */
const SERVICE = {
  origin: "https://vespin.test",
  client: { platform: CLIENT_PLATFORM.IOS, version: "0.1.0" },
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
  const snapshot = shareSnapshotOf("user-ada", ACME.id, [ACME], tasks, () => undefined, SERVICE);
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

test("a draft names its pictures only by the files the share sheet keeps them in", () => {
  const kept = (pictures: readonly string[]) =>
    JSON.stringify({ accountId: "user-ada", prompt: "", pictures, keptAt: 1 });

  expect(shareDraftOf(kept(["share-draft-picture-1.jpg"]), "user-ada")?.pictures).toEqual([
    "share-draft-picture-1.jpg",
  ]);
  expect(shareDraftOf(kept(["../Library/token.json"]), "user-ada")).toBeUndefined();
});
