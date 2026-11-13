/**
 * host-connect-words.ts -- what a machine's pairing says where the member approves or denies it, as Settings › Machines asks it on the desktop, the web, and the phone alike: the question, the box's facts, the code's expiry, and why a code can't be used.
 *
 * A machine that pairs prints a link, `<origin>/connect/<code>`, and the code
 * itself. Whichever client opens the link reads the pairing and asks over the
 * same facts, the box's name, platform, architecture, and the address its
 * start came from, since those are what tell a member their own box from
 * one a stranger started and sent them the link to, as a device code's
 * approval shows the device (RFC 8628). Each client draws them its own way
 * but says them in these words, so no client asks with less.
 */

import { DEVICE_PLATFORM_NAME } from "./device-platform.js";
import { HOST_PAIRING_CALL_FAILURE, type HostPairingFailed } from "./host-pairing-view.js";
import type { HostPairingAnswer } from "./host-wire.js";
import { cleanMachineName } from "./machine-name.js";
import { clockText, momentText } from "./time-format.js";
import { readFailedWords, readingWords } from "./words.js";

/** The pairing's words, as Settings › Machines says them. */
export const HOST_CONNECT_WORDS = {
  TITLE: "Connect a machine",
  READING: readingWords("the code"),
  MATCH: "Connect it only if you ran the command on it, and this code matches the one it shows.",
  CONNECT: "Connect",
  CONNECTING: "Connecting",
  DENY: "Deny",
  DENYING: "Denying",
  DENIED:
    "It isn't connected to your account, and its command stops waiting. To connect it, run the command on it again.",
  AGAIN: "Run the command on the machine again for a new code.",
  NOT_FOUND_TITLE: "This code can't be used",
  NOT_FOUND: "It may have expired, been used already, or been typed wrong.",
  HELD_TITLE: "Too many codes tried",
  HELD: "Your account tried too many codes that match no machine.",
  HELD_SOON: "Try again in a few minutes.",
  UNREAD: readFailedWords("the code"),
  UNANSWERED: "Could not connect. Check your internet connection and try again.",
} as const;

/**
 * The name the box gave itself, as it is shown: on one line, with no control
 * or format character but an emoji's joiners, by the rule its name is kept by
 * (`cleanMachineName`). Note that a name kept before that rule may still hold
 * a line break or a bidi override, which would draw a facts line of its own
 * under it or turn its words around.
 */
export function hostShownName(box: HostPairingAnswer): string {
  return cleanMachineName(box.name);
}

/** The question a pairing asks, by the name the box gave itself. */
export function hostConnectQuestion(box: HostPairingAnswer): string {
  return `Connect ${hostShownName(box)}?`;
}

/** What a denied pairing is titled, by the name the box gave itself. */
export function hostDeniedTitle(box: HostPairingAnswer): string {
  return `Denied ${hostShownName(box)}`;
}

/** What the box is, as its row says under its name: its platform, its architecture, and the address its start came from. */
export function hostBoxFacts(box: HostPairingAnswer): string {
  return [DEVICE_PLATFORM_NAME[box.platform], box.arch, ...(box.ip === null ? [] : [box.ip])].join(
    " · ",
  );
}

/** When the code lapses, as a time of day, since a pairing lasts minutes. */
export function hostCodeExpiryText(at: number): string {
  const moment = new Date(at);

  return `This code expires at ${clockText(moment.getHours(), moment.getMinutes())}.`;
}

/** What a code that cannot be approved says: why, and what to do next. */
export function hostConnectRefusalWords(refusal: HostPairingFailed) {
  if (refusal.failure !== HOST_PAIRING_CALL_FAILURE.HELD) {
    return {
      title: HOST_CONNECT_WORDS.NOT_FOUND_TITLE,
      body: `${HOST_CONNECT_WORDS.NOT_FOUND} ${HOST_CONNECT_WORDS.AGAIN}`,
    };
  }

  const when =
    refusal.heldUntil === undefined
      ? HOST_CONNECT_WORDS.HELD_SOON
      : `Try again after ${momentText(refusal.heldUntil)}.`;

  return {
    title: HOST_CONNECT_WORDS.HELD_TITLE,
    body: `${HOST_CONNECT_WORDS.HELD} ${when} ${HOST_CONNECT_WORDS.AGAIN}`,
  };
}
