/**
 * machine-name.ts -- what every list of the member's machines calls each one: This Mac, or its name, with its model where another listed machine has that name too.
 *
 * Settings › Machines, New task's Runs on, and an agent's row in its plan's
 * head all name a machine here (`machineName`), on the desktop, the web, and
 * the iOS app alike, so they never disagree. The machine the desktop app
 * runs on reads "This Mac": the one whose host reported the same keyed
 * machine id the desktop reads of this Mac, or, for one whose host reported
 * none, the device this Mac's account host's record names. Two machines
 * listed under one name, as two Macs set up alike are, each say their model
 * after it. A browser tab and a phone have no This Mac, so each names every
 * machine by its own name.
 */

/** A control character, a line break or a tab among them, which stands between words. */
const CONTROL_CHARACTER = /\p{Cc}/gu;

/**
 * A format character, which draws as nothing, a bidi override among them,
 * but for the zero-width joiner and non-joiner (U+200D, U+200C), which an
 * emoji sequence and some scripts need to draw at all.
 */
const FORMAT_CHARACTER = /(?![\u200C\u200D])\p{Cf}/gu;

/** The two joiners a name keeps, which draw nothing alone. */
const JOINER = /[\u200C\u200D]/gu;

/** A run of white space. */
const WHITE_RUN = /\s+/gu;

/**
 * A name a machine gave itself, as it is kept and shown: on one line, each
 * control character a space, each format character but the joiners gone,
 * each run of white space one space, and trimmed; empty where nothing that
 * draws was left. Note that a machine chooses its own name, and its pairing
 * is approved over it, so a line break would draw a facts line of its own
 * under it, a bidi override would turn its words around, and a name of
 * joiners alone would draw as nothing.
 */
export function cleanMachineName(name: string): string {
  const kept = name
    .replace(FORMAT_CHARACTER, "")
    .replace(CONTROL_CHARACTER, " ")
    .replace(WHITE_RUN, " ")
    .trim();

  return kept.replace(JOINER, "").trim() === "" ? "" : kept;
}

/** What the machine the desktop app runs on is called. */
export const THIS_MAC = "This Mac";

/** A machine as a list holds it: its device, the name it registered, and which machine it is and its model, where its host reported them. */
export interface ListedMachine {
  readonly deviceId: string | undefined;
  readonly name: string;
  readonly machineId?: string | undefined;
  readonly model?: string | undefined;
}

/** This Mac as the desktop's host holds it: its device and its machine, where the host read them; none in a browser tab or on a phone. */
export type ThisMac =
  | { readonly deviceId?: string | undefined; readonly machineId?: string | undefined }
  | undefined;

/** Whether the machine given is the one the desktop app runs on: by machine id where both name one, else by the device this Mac's host's record names. */
export function isThisMac(machine: ListedMachine, thisMac: ThisMac): boolean {
  if (thisMac === undefined) return false;

  if (machine.machineId !== undefined && thisMac.machineId !== undefined) {
    return machine.machineId === thisMac.machineId;
  }

  return machine.deviceId !== undefined && machine.deviceId === thisMac.deviceId;
}

/** What the machine given is called among those listed: This Mac, or its name, and its model where another listed machine but This Mac has the same name. */
export function machineName(
  machine: ListedMachine,
  listed: readonly ListedMachine[],
  thisMac: ThisMac,
): string {
  if (isThisMac(machine, thisMac)) return THIS_MAC;

  const twinned = listed.some(
    (other) =>
      other.deviceId !== machine.deviceId &&
      other.name === machine.name &&
      !isThisMac(other, thisMac),
  );

  return twinned && machine.model !== undefined
    ? `${machine.name} · ${machine.model}`
    : machine.name;
}
