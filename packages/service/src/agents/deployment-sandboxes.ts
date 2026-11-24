/**
 * deployment-sandboxes.ts -- the sandboxes a deployment reaches: production under the names it opens them by, and a Preview only under a namespace of its own database's, so a Preview never acts on a sandbox production opened.
 *
 * A Preview runs on a branch of production's database (the Neon
 * integration's copy), which names every agent's sandbox, runner, and
 * drive as production does, while both deployments open their sandboxes in
 * the one Vercel project. Without a namespace, a Preview opened on an
 * agent warms, opens, touches, or writes the firewall of the very sandbox
 * production's runner is at work in, and cuts that runner off mid-turn.
 * Under a namespace of its own (`namespacedSandbox`), the
 * Preview finds none of production's sandboxes, so an agent it never
 * launched has no sandbox there until its first launch on the Preview
 * opens one, and production's lists never find the Preview's.
 *
 * The namespace is the Preview's database's: a digest of the host its
 * `DATABASE_URL` names, which each branch's endpoint holds alone, so every
 * deployment of one branch shares its sandboxes, as it shares the store
 * that records them, and no two branches do. Only the host is read, never
 * the credential beside it in the URL. Production and a local run keep the
 * names they always had.
 */

import { createHash } from "node:crypto";
import { namespacedSandbox, Sandbox } from "@repo/sandbox";
import { Effect, Layer } from "effect";
import { DEPLOYMENT_ENVIRONMENT } from "../auth/auth-deployment.js";
import { DATABASE_ENVIRONMENT } from "../db/index.js";

/** The variables the deployment's namespace is read from. */
const NAMESPACE_ENVIRONMENT = {
  ENVIRONMENT: "VERCEL_ENV",
  DEPLOYMENT_HOST: "VERCEL_URL",
} as const;

/**
 * A Preview's namespace: its mark and a short digest of its database's
 * host. Note that it is kept short, because a Vercel drive's name is held
 * to 64 characters and a workspace's drive name takes 54 of them.
 */
const PREVIEW_NAMESPACE = {
  MARK: "pv",
  DIGEST_LENGTH: 6,
  SEPARATOR: "-",
} as const;

/** The host the URL names, or none where it is no URL. */
function hostOf(url: string | undefined): string | undefined {
  if (url === undefined || url.trim() === "") return undefined;

  try {
    return new URL(url.trim()).host || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The namespace the deployment's sandboxes are opened under: a Preview's,
 * from its database's host, or its own host where it names no database;
 * none on production or a local run.
 */
export function deploymentSandboxNamespace(
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  if (environment[NAMESPACE_ENVIRONMENT.ENVIRONMENT]?.trim() !== DEPLOYMENT_ENVIRONMENT.PREVIEW) {
    return undefined;
  }

  const owner =
    hostOf(environment[DATABASE_ENVIRONMENT.URL]) ??
    environment[NAMESPACE_ENVIRONMENT.DEPLOYMENT_HOST]?.trim() ??
    "";

  const digest = createHash("sha256").update(owner).digest("hex");

  return `${PREVIEW_NAMESPACE.MARK}${digest.slice(0, PREVIEW_NAMESPACE.DIGEST_LENGTH)}${PREVIEW_NAMESPACE.SEPARATOR}`;
}

/** The deployment's sandboxes over the provider's: as they are on production, and under the Preview's namespace on a Preview. */
export function deploymentSandboxLayer<E, R>(
  sandboxes: Layer.Layer<Sandbox, E, R>,
  environment: Readonly<Record<string, string | undefined>>,
): Layer.Layer<Sandbox, E, R> {
  const namespace = deploymentSandboxNamespace(environment);

  if (namespace === undefined) return sandboxes;

  return Layer.effect(
    Sandbox,
    Effect.map(Sandbox, (sandbox) => namespacedSandbox(sandbox, namespace)),
  ).pipe(Layer.provide(sandboxes));
}
