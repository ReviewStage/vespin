/**
 * agent-image.test.ts -- what the build ships beside a function that opens a sandbox: the runner's unit whole, and the digest a base snapshot is keyed on, which stands through a change to the unit alone and moves with one to the Dockerfile.
 */

import assert from "node:assert/strict";
import { RUNNER_UNIT } from "@repo/agent-runner/pins";
import {
  AGENT_IMAGE_BASE_FILE,
  AGENT_IMAGE_FILE,
  AGENT_RUNNER_FOLDER,
} from "@repo/service/agents/coder-host/agent-image";
import { test } from "vitest";
import { shippedBesideFunctions } from "../scripts/agent-image";

/** The runner's unit as one build left it, each file's text by its name. */
const UNIT = { [RUNNER_UNIT.BUNDLE]: "// runner one", [RUNNER_UNIT.PROFILER]: "profiler one" };

/** A file of the unit by its name in the context and beside a function: in the unit's folder. */
const inFolder = (name: string) => `${AGENT_RUNNER_FOLDER}/${name}`;

/** The files shipped for a context of the Dockerfile and the runner's unit given, each read as text by its name. */
function shipped(dockerfile: string, unit: Readonly<Record<string, string>>) {
  const context = [
    { name: "Dockerfile", contents: Buffer.from(dockerfile) },
    ...Object.entries(unit).map(([name, text]) => ({
      name: inFolder(name),
      contents: Buffer.from(text),
    })),
  ];
  return new Map(
    shippedBesideFunctions(context).map((file) => [
      file.name,
      Buffer.from(file.contents).toString("utf8"),
    ]),
  );
}

test("a change to any file of the runner's unit ships the unit whole and moves the image but not the base's digest, and a Dockerfile's change moves both", () => {
  const before = shipped("FROM node:24", UNIT);
  const unitMoved = shipped("FROM node:24", { ...UNIT, [RUNNER_UNIT.PROFILER]: "profiler two" });
  const dockerfileMoved = shipped("FROM node:26", UNIT);

  assert.notEqual(unitMoved.get(AGENT_IMAGE_FILE), before.get(AGENT_IMAGE_FILE));
  assert.equal(unitMoved.get(AGENT_IMAGE_BASE_FILE), before.get(AGENT_IMAGE_BASE_FILE));
  assert.equal(unitMoved.get(inFolder(RUNNER_UNIT.BUNDLE)), "// runner one");
  assert.equal(unitMoved.get(inFolder(RUNNER_UNIT.PROFILER)), "profiler two");
  assert.notEqual(dockerfileMoved.get(AGENT_IMAGE_BASE_FILE), before.get(AGENT_IMAGE_BASE_FILE));
});
