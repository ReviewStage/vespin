/**
 * sandbox-pty.ts -- a sandbox session's PTY as the service's relays speak it: the socket `@repo/sandbox` opens, read and written as one relay socket.
 *
 * The terminal relay pipes a developer's shell over it, and the agent's
 * browser carries its DevTools protocol over it (`browser/agent-browser.ts`),
 * as a tunnel carries its bridge's channels (`tunnel/relay.ts`), so the
 * sandbox exposes no port of its own for any of them.
 */

import { type InteractiveShell, openPtySocket, type SandboxUnavailable } from "@repo/sandbox";
import { Context, Effect, Layer, type Scope } from "effect";
import { HttpClient } from "effect/http";
import { voiceSocket } from "../http/socket.js";
import type { RelaySocket } from "../terminal/relay.js";

/** The PTY's socket opened under its minted token, once its server answers healthy, for the scope it is opened in. */
export function connectPty(
  shell: InteractiveShell,
  client: HttpClient.HttpClient,
): Effect.Effect<RelaySocket, SandboxUnavailable, Scope.Scope> {
  return Effect.flatMap(openPtySocket(shell, client), (socket) => voiceSocket(socket));
}

export interface SandboxPtyService {
  /** Opens the PTY's socket for the caller's scope. */
  readonly connect: (
    shell: InteractiveShell,
  ) => Effect.Effect<RelaySocket, SandboxUnavailable, Scope.Scope>;
}

export class SandboxPty extends Context.Service<SandboxPty, SandboxPtyService>()("SandboxPty") {}

/** The PTY as the deployment reaches it, over the runtime's HTTP client and `ws`. @public */
export const sandboxPtyLayer: Layer.Layer<SandboxPty, never, HttpClient.HttpClient> = Layer.effect(
  SandboxPty,
  Effect.map(HttpClient.HttpClient, (client) => ({
    connect: (shell: InteractiveShell) => connectPty(shell, client),
  })),
);
