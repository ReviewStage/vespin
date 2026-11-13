import assert from "node:assert/strict";
import { it } from "vitest";
import { cleanMachineName, type ListedMachine, machineName, type ThisMac } from "./machine-name.js";

/**
 * machine-name.test.ts -- every list of machines calls the one the desktop runs on This Mac, by its machine id or its host's record, tells two machines of one name apart by their models, and in a browser tab, which has none, calls each by its name.
 * Synthetic ids.
 */

const HERE = "a".repeat(64);

const STUDIO: ListedMachine = {
  deviceId: "7a1c9e3b-2f4d-4c6a-8b0e-5d7f9a1c3e52",
  name: "Studio",
  machineId: HERE,
  model: "Mac Studio (M2 Max, 2023)",
};

/** A Mac of the same name on another machine. */
const OTHER_STUDIO: ListedMachine = {
  deviceId: "3f6b0c2e-8d1a-4b5e-9c7d-2a4e6f8b0d14",
  name: "Studio",
  machineId: "b".repeat(64),
  model: "Mac mini (M2, 2023)",
};

/** The device of a Mac whose host reported no machine yet, which This Mac's host's record names. */
const RECORDED = "2d4f6a8c-0e1b-4c3d-9e5f-7a9b1c3d5e60";

const UNREPORTED: ListedMachine = { deviceId: RECORDED, name: "Air" };

it.each<{ case: string; machine: ListedMachine; thisMac: ThisMac; named: string }>([
  {
    case: "this Mac, by its machine id",
    machine: STUDIO,
    thisMac: { machineId: HERE },
    named: "This Mac",
  },
  {
    case: "this Mac, by its host's record, where the host reported no machine",
    machine: UNREPORTED,
    thisMac: { machineId: HERE, deviceId: RECORDED },
    named: "This Mac",
  },
  {
    case: "a Mac of This Mac's name, which needs no model",
    machine: OTHER_STUDIO,
    thisMac: { machineId: HERE },
    named: "Studio",
  },
  {
    case: "two Macs of one name in a browser tab, told apart by their models",
    machine: OTHER_STUDIO,
    thisMac: undefined,
    named: "Studio · Mac mini (M2, 2023)",
  },
])("names $case", ({ machine, thisMac, named }) => {
  assert.equal(machineName(machine, [STUDIO, OTHER_STUDIO, UNREPORTED], thisMac), named);
});

// Note that the regression these catch is a rule that lets a name a machine chose draw a line of its own, turn its words around, or stand invisible, or one that breaks an emoji or a script by taking its joiner.
it.each([
  {
    case: "a line break and a bidi override",
    given: "Dean's Mac\nmacOS\u202E",
    kept: "Dean's Mac macOS",
  },
  { case: "a soft hyphen inside a word", given: "build\u00ADbox", kept: "buildbox" },
  { case: "an emoji's joiner", given: "Dean's 👨\u200D💻 Mac", kept: "Dean's 👨\u200D💻 Mac" },
  { case: "a name of joiners alone", given: "\u200C\u200D", kept: "" },
])("keeps $case as a name draws", ({ given, kept }) => {
  assert.equal(cleanMachineName(given), kept);
});
