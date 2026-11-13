/**
 * source-sandbox.ts -- a coding agent's sandbox at Vercel's REST boundary, as `@vercel/sandbox` reads it, its shell a real one over a git checkout on disk, for the suites that copy a source agent's work.
 *
 * The double answers Vercel Sandbox's API as the scenario has it: the
 * session's sandbox under its session's name, in the status given, owning a
 * drive of its own where the scenario says so, a resume
 * that brings it up under a fresh session, a stop that stops it where it is
 * sent as JSON and is refused with 415 where not, as Vercel refuses it, a
 * firewall policy written down, and each command run in a checkout the test
 * made by a real POSIX shell with git, what it printed on stdout and stderr
 * streamed back, refused where it names any directory but the agent's
 * checkout. The checkout is the way an agent leaves one: cloned from a bare
 * remote on disk, one commit pushed, its identity set. Synthetic throughout.
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  commandRunStreamed,
  driveAnswered,
  sandboxesListed,
  sandboxFound,
  sandboxListRefusal,
  sandboxStopRefusal,
  sessionAnswered,
} from "@repo/sandbox/vercel/testing";
import { agentSandboxName } from "../agents/agent-sandbox-open.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "../agents/repository-sandbox-contract.js";

export const SOURCE_SANDBOX = {
  /** The source's session, after which its sandbox is named. */
  SESSION: "wrun_source",
  RUNNING: "sbs_running",
  WOKEN: "sbs_woken",
  /** The session a stopped sandbox last ran, which Vercel's list names as its current one. */
  STOPPED: "sbs_stopped",
} as const;

/** git as the sandbox runs it, kept from the host's own configuration. */
function gitEnvironment(home: string): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: "1" };
}

/** An unsigned token naming a fixture project and team, a year from expiring, as the deployment's OIDC token. */
export function fixtureOidcToken(): string {
  const exp = Math.floor(Date.UTC(2027, 9, 14) / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");

  const payload = Buffer.from(
    JSON.stringify({ project_id: "prj_fixture", owner_id: "team_fixture", exp }),
  ).toString("base64url");

  return `${header}.${payload}.`;
}

/** A source agent's checkout and the remote it pushes to, with a command run in either. */
export interface SourceCheckout {
  readonly root: string;
  readonly remote: string;
  readonly checkout: string;
  /** A command run in the directory given, its stdout trimmed. */
  readonly sh: (cwd: string, command: string, ...args: string[]) => string;
}

/** A checkout in the directory given, on `main`, with two files committed and pushed to a bare remote beside it. */
export function sourceCheckout(root: string): SourceCheckout {
  const sh = (cwd: string, command: string, ...args: string[]) =>
    execFileSync(command, args, {
      cwd,
      env: gitEnvironment(root),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

  const remote = join(root, "remote.git");
  const checkout = join(root, "checkout");
  mkdirSync(checkout);
  sh(root, "git", "init", "--quiet", "--bare", "--initial-branch=main", remote);
  sh(checkout, "git", "init", "--quiet", "--initial-branch=main");
  sh(checkout, "git", "remote", "add", "origin", remote);
  sh(checkout, "git", "config", "user.name", "Fixture Developer");
  sh(checkout, "git", "config", "user.email", "developer@example.invalid");
  writeFileSync(join(checkout, ".gitignore"), "dist/\n");
  writeFileSync(join(checkout, "invites.ts"), "export const ttl = 1;\n");
  writeFileSync(join(checkout, "mailer.ts"), "export const from = 'a';\n");
  sh(checkout, "git", "add", "-A");
  sh(checkout, "git", "commit", "--quiet", "-m", "Start invites");
  sh(checkout, "git", "push", "--quiet", "origin", "main");

  return { root, remote, checkout, sh };
}

/** A request of the double as it was sent: its address, method, headers, and body as text. */
export interface SentToSandbox {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: string;
}

/** The sandbox as the double holds it, and what was asked of it. */
export interface SourceSandbox {
  readonly state: { status: string | undefined; session: string | undefined };
  /** The sessions it stopped, in order; a stop it refused is none of them. */
  readonly stops: string[];
  readonly policies: { readonly session: string; readonly hosts: readonly string[] }[];
  /** The session each command ran in, in order. */
  readonly ran: string[];
  /** Vercel's answer to a request of the sandbox API, or nothing for a request of any other host. */
  readonly answer: (sent: SentToSandbox) => Response | undefined;
}

/** The double over the checkout given, its sandbox first standing in the status given, or none for a session that never opened one, owning a drive of its own where `ownsDrive`. */
export function sourceSandbox(
  source: SourceCheckout,
  status: string | undefined,
  ownsDrive = false,
): SourceSandbox {
  const name = agentSandboxName(SOURCE_SANDBOX.SESSION);

  const state: SourceSandbox["state"] = {
    status,
    session: status === "running" ? SOURCE_SANDBOX.RUNNING : undefined,
  };

  const stops: string[] = [];
  const policies: SourceSandbox["policies"] = [];
  const ran: string[] = [];

  const answer = ({ url, method, headers, body }: SentToSandbox): Response | undefined => {
    const parsed = new URL(url);

    if (parsed.host !== "vercel.com") return undefined;
    const session = /\/sessions\/([^/]+)\//u.exec(parsed.pathname)?.[1] ?? "";
    const drive = /^\/api\/v2\/sandboxes\/drives\/([^/]+)$/u.exec(parsed.pathname)?.[1];

    // Note that `@vercel/sandbox` names a sandbox's own drive after it, so a lookup by that name alone finds one.
    if (drive !== undefined) {
      return ownsDrive && drive === `${name}-drive`
        ? Response.json(driveAnswered({ id: "drv_source", name: drive }))
        : Response.json({ error: { code: "not_found" } }, { status: 404 });
    }

    if (parsed.pathname.endsWith("/cmd")) {
      const asked = JSON.parse(body);
      assert.equal(asked.cwd, REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT);
      assert.equal(session, state.session);
      ran.push(session);

      const done = spawnSync(asked.command, asked.args, {
        cwd: source.checkout,
        env: gitEnvironment(source.root),
        encoding: "utf8",
      });

      return commandRunStreamed(
        { id: "cmd_1", sessionId: session },
        { exitCode: done.status ?? 1, stdout: done.stdout, stderr: done.stderr },
      );
    }

    if (parsed.pathname.endsWith("/stop") && method === "POST") {
      const refused = sandboxStopRefusal({ headers });

      if (refused === undefined) {
        stops.push(session);
        state.status = "stopped";
      }

      return refused ?? Response.json(sessionAnswered({ id: session, status: "stopped" }));
    }

    if (parsed.pathname.endsWith("/network-policy")) {
      // An open policy carries a credential on no host.
      policies.push({ session, hosts: Object.keys(JSON.parse(body).allow ?? {}) });

      return Response.json(sessionAnswered({ id: session, status: "running" }));
    }

    if (parsed.searchParams.get("resume") === "true") {
      state.status = "running";
      state.session = SOURCE_SANDBOX.WOKEN;
    }

    const listed = {
      name,
      status: state.status ?? "stopped",
      currentSessionId: state.session ?? SOURCE_SANDBOX.STOPPED,
      createdAt: 0,
    };

    // A lookup by any other name finds none, as for a session that never opened a sandbox.
    if (/^\/api\/v2\/sandboxes\/[^/]+$/u.test(parsed.pathname)) {
      return parsed.pathname === `/api/v2/sandboxes/${name}` && state.status !== undefined
        ? Response.json(sandboxFound(listed))
        : new Response(null, { status: 404 });
    }

    return (
      sandboxListRefusal(parsed) ??
      Response.json(sandboxesListed(state.status === undefined ? [] : [listed]))
    );
  };

  return { state, stops, policies, ran, answer };
}
