/**
 * sandbox-pty.ts -- a sandbox's PTY as the service's relays speak it: the socket `Sandbox` opens, read and written as one relay socket.
 *
 * The terminal relay pipes a developer's shell over it, and the agent's
 * browser carries its DevTools protocol over it (`browser/agent-browser.ts`),
 * as a tunnel carries its bridge's channels (`tunnel/relay.ts`), so the
 * sandbox exposes no port of its own for any of them.
 */

import type { InteractiveShell, SandboxError, SandboxService } from "@repo/sandbox";
import { Effect, type Scope } from "effect";
import { voiceSocket } from "../http/socket.js";
import type { RelaySocket } from "../terminal/relay.js";

/** The PTY's socket opened under its minted token, once it answers healthy, for the scope it is opened in. */
export function connectPty(
  sandbox: SandboxService,
  shell: InteractiveShell,
): Effect.Effect<RelaySocket, SandboxError, Scope.Scope> {
  return Effect.flatMap(sandbox.connectPty(shell), (socket) => voiceSocket(socket));
}

export interface SandboxPtyService {
  /** Opens the PTY's socket for the caller's scope. */
  readonly connect: (
    shell: InteractiveShell,
  ) => Effect.Effect<RelaySocket, SandboxError, Scope.Scope>;
}

/** The PTY as `sandbox` reaches it. */
export function sandboxPtyOf(sandbox: SandboxService): SandboxPtyService {
  return { connect: (shell) => connectPty(sandbox, shell) };
}
