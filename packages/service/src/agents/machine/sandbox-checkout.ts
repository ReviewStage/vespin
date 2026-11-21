/**
 * sandbox-checkout.ts -- a sandbox run as a repository's checkout reaches it: the edge's runner it runs through, its firewall bound to the run and its account, and its commands fenced to the run.
 *
 * Both the agent machine (`sandbox-machine.ts`) and a workspace drive's
 * fill (`../workspace-drive.ts`) hand a checkout (`../repository-shell.ts`)
 * the sandbox they opened through these, so neither reads the other for
 * them.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import type { SandboxRunning, SandboxService } from "@repo/sandbox";
import { Context, Effect, Option, Tracer } from "effect";
import type { RepositoryFirewall, RepositorySandbox } from "../repository-shell.js";
import {
  type FirewallSession,
  type FirewallSources,
  sandboxFirewall,
} from "../sandbox-firewall.js";

/** Runs one effect on the edge's runtime; the checkout reaches the sandbox through promises (`../repository-shell.ts`). */
export type SandboxRunner = <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;

/** The run a place stands for as its firewall names it, with the account whose agent it is. */
export function firewallSessionOf(place: SandboxRunning, userId: string): FirewallSession {
  return { userId, name: place.name, sandboxSessionId: place.running };
}

/**
 * The effect handed to the edge's runner under the span given, so what it
 * runs stays in the caller's trace. Note that the runner runs it as a root
 * of its own, with none of the caller's context, so without the span every
 * span it opens would start a trace of its own.
 */
export function runUnder<A, E>(
  run: SandboxRunner,
  parent: Option.Option<Tracer.AnySpan>,
  effect: Effect.Effect<A, E>,
): Promise<A> {
  return run(
    Option.match(parent, {
      onNone: () => effect,
      onSome: (span) => Effect.withParentSpan(effect, span),
    }),
  );
}

/** The services a context holds without the span it was read under, so an effect handed them goes on under its own caller's span. */
function servicesOf(context: Context.Context<DatabaseServices>): Context.Context<DatabaseServices> {
  return Context.omit(Tracer.ParentSpan)(context);
}

/** The sandbox run's firewall as the checkout reaches it, bound to the run and its account and to what stands beside the checkout's own, over the store the machine was made on; `carries` names the repository whose credential stands there already. */
export function repositoryFirewallOver(
  api: SandboxService,
  context: Context.Context<DatabaseServices>,
  session: FirewallSession,
  beside: FirewallSources,
  carries?: string,
): RepositoryFirewall {
  const firewall = sandboxFirewall(api);

  return {
    write: (sources) =>
      Effect.provideContext(
        firewall.write(session, { ...beside, ...sources }),
        servicesOf(context),
      ),
    ...(carries === undefined ? undefined : { carries }),
  };
}

/** The sandbox run as the checkout reaches it, each command fenced to it, through the edge's runner, its firewall the account's given. */
export function repositorySandboxOver(
  api: SandboxService,
  place: SandboxRunning,
  run: SandboxRunner,
  firewall: RepositoryFirewall,
): RepositorySandbox {
  return {
    run: (ask, parent) =>
      runUnder(
        run,
        Option.fromNullishOr(parent),
        Effect.map(
          api.run(place, {
            command: "bash",
            args: ["-c", ask.command],
            ...(ask.workingDirectory === undefined ? undefined : { cwd: ask.workingDirectory }),
            ...(ask.env === undefined ? undefined : { env: ask.env }),
          }),
          (ran) => ({ exitCode: ran.exitCode, stdout: ran.stdout, stderr: ran.stderr }),
        ),
      ),
    firewall,
  };
}
