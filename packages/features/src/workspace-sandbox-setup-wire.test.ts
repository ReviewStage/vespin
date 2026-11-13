import assert from "node:assert/strict";
import { it } from "vitest";
import {
  RUN_ACTION_AVAILABILITY,
  RUN_ACTION_PLACE,
  type RunAction,
  runActionsIn,
} from "./workspace-sandbox-setup-wire.js";

const DEV: RunAction = { id: "dev", label: "Dev", command: "pnpm dev" };

const PREVIEW: RunAction = {
  id: "preview",
  label: "Preview",
  command: "pnpm preview",
  availableIn: RUN_ACTION_AVAILABILITY.CLOUD,
};

const SIMULATOR: RunAction = {
  id: "simulator",
  label: "Simulator",
  command: "pnpm ios",
  availableIn: RUN_ACTION_AVAILABILITY.LOCAL,
};

// Regression: a Mac agent offered an action kept to the cloud, a cloud agent one kept to Macs, or an action that says nothing offered in only one.
it("offers a cloud-only action to cloud agents alone, a local-only one to local agents alone, and one that says nothing to both", () => {
  const actions = [DEV, PREVIEW, SIMULATOR];

  assert.deepEqual(
    runActionsIn(actions, RUN_ACTION_PLACE.CLOUD).map((action) => action.id),
    ["dev", "preview"],
  );
  assert.deepEqual(
    runActionsIn(actions, RUN_ACTION_PLACE.LOCAL).map((action) => action.id),
    ["dev", "simulator"],
  );
});
