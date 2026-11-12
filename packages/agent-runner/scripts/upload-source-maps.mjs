/**
 * upload-source-maps.mjs -- the runner bundle's source map uploaded to Sentry under the deployment's release, from a production web build.
 *
 * The runner reports its startup to the service's Sentry project under the
 * service's release, the SDK's own `VERCEL_GIT_COMMIT_SHA`
 * (`packages/service/src/observability/sentry.ts`), so the map goes to that
 * project and release, named by the path the agent image runs the bundle
 * from. Note that the map is matched by release and path rather than by a
 * debug ID, because Sentry's esbuild plugin stamps a random one into the
 * bundle, whose bytes the agent image's tag is a digest of. A build without
 * the token, or a Preview, uploads nothing, and a refused upload warns and
 * the build goes on, so Sentry being down never holds a deploy back.
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ORG = "stage-review";
const PROJECT = "vespin-web";

/** Where the agent image runs the bundle from, as Sentry matches a frame's path. */
const URL_PREFIX = "~/opt/agent/agent-runner";

const release = process.env.VERCEL_GIT_COMMIT_SHA;

const uploads =
  Boolean(process.env.SENTRY_AUTH_TOKEN) &&
  process.env.VERCEL_ENV === "production" &&
  release !== undefined;

if (uploads) {
  const dist = join(import.meta.dirname, "..", "dist");

  const result = spawnSync(
    "sentry-cli",
    [
      "sourcemaps",
      "upload",
      "--org",
      ORG,
      "--project",
      PROJECT,
      "--release",
      release,
      "--url-prefix",
      URL_PREFIX,
      dist,
    ],
    { stdio: "inherit" },
  );

  if (result.status !== 0) {
    console.warn(
      "warning: the runner's source-map upload to Sentry failed, so the build goes on without it",
    );
  }
}
