import { describe, expect, it } from "vitest";
import { RELAY_SOCKET_END, socketEnding, TERMINAL_RELAY_CLOSE } from "./terminal-wire.js";

describe("socketEnding", () => {
  it.each([
    [
      "an exit, with its code",
      TERMINAL_RELAY_CLOSE.EXITED,
      3,
      true,
      { kind: RELAY_SOCKET_END.EXITED, code: 3 },
    ],
    [
      "an exit before the shell attached",
      TERMINAL_RELAY_CLOSE.EXITED,
      undefined,
      false,
      { kind: RELAY_SOCKET_END.EXITED, code: undefined },
    ],
    [
      "a stopped sandbox, the exit code dropped",
      TERMINAL_RELAY_CLOSE.STOPPED,
      3,
      true,
      { kind: RELAY_SOCKET_END.STOPPED },
    ],
    [
      "a gone shell before it attached",
      TERMINAL_RELAY_CLOSE.GONE,
      undefined,
      false,
      { kind: RELAY_SOCKET_END.GONE },
    ],
    [
      "a sandbox still starting",
      TERMINAL_RELAY_CLOSE.STARTING,
      undefined,
      false,
      { kind: RELAY_SOCKET_END.STARTING },
    ],
    [
      "a relay unavailable after the shell attached",
      TERMINAL_RELAY_CLOSE.UNAVAILABLE,
      undefined,
      true,
      { kind: RELAY_SOCKET_END.DROPPED },
    ],
    [
      "a socket lost with no close before it attached",
      undefined,
      undefined,
      false,
      { kind: RELAY_SOCKET_END.UNATTACHED },
    ],
    ["a normal close after it attached", 1000, undefined, true, { kind: RELAY_SOCKET_END.DROPPED }],
  ] as const)("reads %s", (_case, closeCode, exitCode, attached, expected) => {
    expect(socketEnding(closeCode, exitCode, attached)).toEqual(expected);
  });
});
