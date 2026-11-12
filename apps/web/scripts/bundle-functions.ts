import { readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { sentryEsbuildPlugin } from "@sentry/esbuild-plugin";
import { type BuildOptions, build } from "esbuild";
import {
  BUILD_OUTPUT_DIRECTORY,
  emitBuildOutput,
  HAND_WRITTEN_FUNCTIONS,
} from "../server/build-output.js";
import {
  bundlesReaching,
  FUNCTION_METAFILE,
  functionBundlePlan,
  localOnlyReach,
  profilerBinaryFiles,
  undeclaredImports,
} from "../server/function-bundles.js";
import {
  bundlePath,
  FUNCTION_BUNDLE_DIRECTORY,
  functionPublicPath,
} from "../server/function-layout.js";
import { agentImageContext, shippedBesideFunctions } from "./agent-image.js";

/**
 * Bundles the functions the routes under `server/routes/` and the hosted
 * oRPC route are grouped into,
 * each a plain ESM file under `dist-functions/`, so Vercel's builder finds JavaScript
 * and only traces dependencies. Handed TypeScript, the builder runs its own
 * compiler over each function's whole import graph separately — thirty-odd
 * passes over the same sixteen workspace packages, most of a deploy's build
 * time, under compiler options that are not this repository's.
 *
 * Each bundle is emitted whole into a `.func` of the Build Output tree
 * (`server/build-output.ts`), which is what Vercel deploys; nothing under
 * `api/` is committed, so Vercel's zero-config pass has nothing to build
 * beside it.
 *
 * Workspace packages and declared dependencies alike are inlined, since a
 * `.func` carries only what is under it. Anything that still resolved
 * external and is neither a Node builtin nor a named exception is a module
 * the function would fail to load, so the build refuses it here instead.
 */
const WEB = join(import.meta.dirname, "..");

/**
 * The module that reads the agents' image reference beside a function's
 * entry. Every function whose bundle reaches it ships the reference, the
 * image's digest without the runner's unit, and the runner's unit in its
 * `.func`, the reference computed here as CI computes the tag it pushes the image under
 * (`agent-image.ts`), and a build without every file of the runner's unit the image
 * carries fails here rather than deploy a launch that names no image.
 */
const AGENT_IMAGE_READER = join(
  WEB,
  "..",
  "..",
  "packages",
  "service",
  "src",
  "agents",
  "coder-host",
  "agent-image.ts",
);

/** Where `vite build` and `prerender.ts` leave the site, copied whole under the output's `static/`. */
const SITE_DIRECTORY = "dist";

/**
 * The bundles' source maps, uploaded to Sentry's `vespin-web` project so a
 * function's stack traces and profiles name the source under `packages/`.
 * Only a production build that holds `SENTRY_AUTH_TOKEN` (set by Sentry's
 * Vercel integration) uploads, since writing and uploading the maps costs
 * the build time a Preview need not pay. The maps are written beside the
 * bundles under `dist-functions/`, matched to them by the debug ID the plugin
 * writes into each, filed under the release the plugin reads from
 * `VERCEL_GIT_COMMIT_SHA` as the SDK does (`@repo/service/observability/sentry`),
 * and deleted after the upload; none reaches a `.func`, which is handed each
 * bundle's contents alone.
 * A refused upload only warns, so Sentry being down never fails a deploy.
 */
function withSentrySourceMaps(options: BuildOptions): BuildOptions {
  const authToken = process.env.SENTRY_AUTH_TOKEN;

  if (!authToken || process.env.VERCEL_ENV !== "production") return options;

  return {
    ...options,
    // Sentry's guide asks for "hidden" maps; esbuild spells that `external`, a map named by no comment in the bundle.
    sourcemap: "external",
    plugins: [
      // Note that Sentry's plugin goes first, because it gives a bundle its debug ID by wrapping
      // its entry point, which the dispatcher's plugin would otherwise resolve before it sees it.
      sentryEsbuildPlugin({
        org: "stage-review",
        project: "vespin-web",
        authToken,
        sourcemaps: {
          filesToDeleteAfterUpload: [join(WEB, FUNCTION_BUNDLE_DIRECTORY, "**/*.map")],
        },
        errorHandler: (error) => {
          console.warn(
            `warning: Sentry source-map upload failed, so the build goes on without it: ${error.message}`,
          );
        },
      }),
      ...(options.plugins ?? []),
    ],
  };
}

const agentImage = shippedBesideFunctions(await agentImageContext());

const task = await functionBundlePlan(WEB);

// Emptied first, so a bundle an earlier plan emitted can never sit beside the shipping ones and be read as one of them.
await rm(join(WEB, FUNCTION_BUNDLE_DIRECTORY), { recursive: true, force: true });

const result = await build({ ...withSentrySourceMaps(task.options), metafile: true, write: true });

const undeclared = undeclaredImports(result.metafile, WEB, task.externalPackages);

if (undeclared.length > 0) {
  throw new Error(
    `bundled routes reach dependencies apps/web does not declare: ${undeclared.join(", ")}`,
  );
}

// A route that reaches the local server's own routes would carry a session for anyone into the deploy.
const localOnly = localOnlyReach(result.metafile, WEB);

if (localOnly.length > 0) {
  throw new Error(
    `bundled routes reach modules only the local server may carry: ${localOnly.join(", ")}`,
  );
}

await writeFile(join(WEB, FUNCTION_METAFILE), JSON.stringify(result.metafile));

const shipsImage = new Set(
  [...bundlesReaching(result.metafile, WEB, AGENT_IMAGE_READER)].map((path) => join(WEB, path)),
);

// The profiler's native binary ships beside every bundle that requires it, since no bundle can carry it.
const profilerBinary = await profilerBinaryFiles(result.metafile, WEB);

const durationOf = new Map(
  task.functions.map((definition) => [join(WEB, bundlePath(definition)), definition.maxDuration]),
);

for (const [file, output] of Object.entries(result.metafile.outputs)) {
  const maxDuration = durationOf.get(join(WEB, file));
  // biome-ignore lint/suspicious/noConsole: a build script's output is its log — what it wrote, and how much of it.
  console.log(
    `bundled ${relative(WEB, file)} (${output.bytes} bytes${maxDuration === undefined ? "" : `, ${maxDuration}s`})`,
  );
}

const emitted = await emitBuildOutput({
  outputDirectory: join(WEB, BUILD_OUTPUT_DIRECTORY),
  staticDirectory: join(WEB, SITE_DIRECTORY),
  functions: [
    ...(await Promise.all(
      task.functions.map(async (definition) => ({
        path: functionPublicPath(definition),
        contents: await readFile(join(WEB, bundlePath(definition))),
        maxDuration: definition.maxDuration,
        queueTopic: definition.queueTopic,
        files: [
          ...(shipsImage.has(join(WEB, bundlePath(definition))) ? agentImage : []),
          ...[profilerBinary.get(join(WEB, bundlePath(definition)))].filter(
            (file) => file !== undefined,
          ),
        ],
      })),
    )),
    ...(await Promise.all(
      HAND_WRITTEN_FUNCTIONS.map(async (fn) => ({
        path: fn.path,
        contents: await readFile(join(WEB, fn.source)),
        maxDuration: undefined,
      })),
    )),
  ],
});

// biome-ignore lint/suspicious/noConsole: a build script's output is its log — the tree it left for Vercel.
console.log(
  `emitted ${BUILD_OUTPUT_DIRECTORY} with ${emitted.length} functions: ${emitted.join(", ")}`,
);
