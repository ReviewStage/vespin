import { describe, expect, it } from "vitest";
import { DEVICE_ARCH, DEVICE_PLATFORM } from "./device-agent-wire.js";
import { hostConnectQuestion } from "./host-connect-words.js";

/**
 * host-connect-words.test.ts -- a pairing's question names the box on one
 * line whatever name it gave itself.
 */

// Note that the regression this catches is a name drawn as the box sent it, whose line break shows a facts line of the attacker's own under it, or whose bidi override turns its words around.
describe("a pairing's question", () => {
  it("names the box on one line, with no control or format character", () => {
    const box = {
      name: "Dean's MacBook Pro\nmacOS · arm64 · 192.168.1.23‮",
      platform: DEVICE_PLATFORM.LINUX,
      arch: DEVICE_ARCH.X64,
      ip: "203.0.113.9",
      expiresAt: 0,
    };

    expect(hostConnectQuestion(box)).toBe(
      "Connect Dean's MacBook Pro macOS · arm64 · 192.168.1.23?",
    );
  });
});
