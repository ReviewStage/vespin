import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { beforeAll, test } from "vitest";
import {
  type EmittedFunction,
  emitBuildOutput,
  functionDirectory,
  functionEntryPath,
  HAND_WRITTEN_FUNCTIONS,
} from "../server/build-output";
import { functionBundlePlan, profilerBinaryFiles } from "../server/function-bundles";
import { functionPublicPath, webFunctions } from "../server/function-layout";
import { apiRewrites } from "../server/function-rewrites";

/**
 * The tree Vercel deploys is emitted here from the same plan the build step
 * uses, into a directory of its own, and read back as data. Two things are
 * asserted and they are different claims. Structure: every planned function
 * has a `.func`, every `/api/` rewrite names a `.func` that exists, so a
 * route cannot point at nothing while the build stays green, and a queue's
 * consumer names its topic in its trigger. Isolation: each
 * `.func` loads with nothing above it on disk, which is how a function is
 * mounted on the platform; a bundle that reached a module it did not carry
 * loads in this checkout and fails on production, which is the shape of the
 * one outage.
 */

const WEB = fileURLToPath(new URL("..", import.meta.url));

const LOAD_MODULE = "await import(process.argv[1]);";

/** Loads a function and answers one request through its default export, printing the status and the body. */
const ANSWER_REQUEST =
  "const fn = await import(process.argv[1]); const answer = await fn.default.fetch(new Request(process.argv[2])); console.log(answer.status, await answer.text()); process.exit(0);";

/** A database URL that connects to nothing, which the web runtime's layer names and no answer here dials. */
const PLACEHOLDER_DATABASE_URL = "postgresql://isolation:load@127.0.0.1:5432/app";

/**
 * What a load is given: a PATH to find node, and nothing else. Every bundle
 * reaches the auth module statically, and that module once built its pool as
 * it was constructed, so a load needed a `DATABASE_URL` to get through the
 * import at all; a load now reads no environment, and this environment is
 * what proves it. The guard is about what a bundle can resolve, not what a
 * deployment is configured with.
 */
const LOAD_ENVIRONMENT = { PATH: process.env.PATH ?? "" } as const;

/** How many `.func` loads run at once: each is a node process, and the file's time is its slowest part. */
const LOAD_CONCURRENCY = 4;

const execFileAsync = promisify(execFile);

interface EmittedTree {
  readonly outputDirectory: string;
  readonly paths: readonly string[];
}

/**
 * The tree is emitted once for the file, because the three tests only read
 * it and the esbuild run that makes it is the file's largest cost: built per
 * test, the file took 79 to 90 s on CI, which is the cap it is held to.
 */
let emittedTree: Promise<EmittedTree> | undefined;

function emitFromTask(): Promise<EmittedTree> {
  emittedTree ??= emitTree();

  return emittedTree;
}

async function emitTree(): Promise<EmittedTree> {
  const task = await functionBundlePlan(WEB);
  const result = await build({ ...task.options, write: false });
  const profilerBinary = await profilerBinaryFiles(result.metafile, WEB);
  const contentsOf = new Map(result.outputFiles.map((file) => [file.path, file.contents] as const));
  const outputDirectory = mkdtempSync(join(tmpdir(), "build-output-"));

  const functions: EmittedFunction[] = [
    ...task.functions.map((definition) => {
      const bundle = join(WEB, "dist-functions", `${definition.file}.js`);
      const contents = contentsOf.get(bundle);
      assert.ok(contents, definition.file);
      const binary = profilerBinary.get(bundle);

      return {
        path: functionPublicPath(definition),
        contents,
        maxDuration: definition.maxDuration,
        queueTopic: definition.queueTopic,
        files: binary === undefined ? [] : [binary],
      };
    }),
    ...(await Promise.all(
      HAND_WRITTEN_FUNCTIONS.map(async (fn) => ({
        path: fn.path,
        contents: await readFile(join(WEB, fn.source)),
        maxDuration: undefined,
      })),
    )),
  ];

  const paths = await emitBuildOutput({ outputDirectory, functions });

  return { outputDirectory, paths };
}

let emitted: Awaited<ReturnType<typeof emitFromTask>>;

beforeAll(async () => {
  emitted = await emitFromTask();
}, 180_000);

test("every planned function and every rewrite lands on a .func, and a queue's consumer carries its trigger", {
  timeout: 180_000,
}, async () => {
  const { outputDirectory, paths } = emitted;
  const functions = await webFunctions(WEB);
  assert.deepEqual(
    paths,
    [...functions.map(functionPublicPath), ...HAND_WRITTEN_FUNCTIONS.map((fn) => fn.path)].sort(),
  );

  for (const rewrite of apiRewrites(functions)) {
    const destination = new URL(rewrite.dest, "http://localhost");
    assert.equal(
      existsSync(functionDirectory(outputDirectory, destination.pathname.slice(1))),
      true,
      rewrite.dest,
    );
  }

  // A consumer deployed without its trigger is never invoked, and nothing else would say so.
  for (const consumer of functions.filter((definition) => definition.queueTopic !== undefined)) {
    const path = functionPublicPath(consumer);

    const config = JSON.parse(
      await readFile(join(functionDirectory(outputDirectory, path), ".vc-config.json"), "utf8"),
    );

    assert.deepEqual(
      config.experimentalTriggers?.map((trigger: { type: string; topic: string }) => [
        trigger.type,
        trigger.topic,
      ]),
      [["queue/v2beta", consumer.queueTopic]],
      path,
    );
  }
});

test("each .func loads with nothing above it available", { timeout: 180_000 }, async () => {
  const { outputDirectory, paths } = emitted;

  const pending = [...paths];

  // Note that a failed load is thrown from its worker, so the first one to fail names its path.
  const worker = async () => {
    for (let path = pending.shift(); path !== undefined; path = pending.shift()) {
      const loaded = await execFileAsync(
        process.execPath,
        ["--input-type=module", "-e", LOAD_MODULE, functionEntryPath(outputDirectory, path)],
        { cwd: functionDirectory(outputDirectory, path), encoding: "utf8", env: LOAD_ENVIRONMENT },
      ).then(
        () => undefined,
        (error: { readonly stderr?: string }) => `${path}: ${error.stderr}`,
      );

      assert.equal(loaded, undefined);
    }
  };

  await Promise.all(Array.from({ length: LOAD_CONCURRENCY }, worker));
});

test("the default .func, loaded alone, lands the fallback's requests on the hosted oRPC router", {
  timeout: 180_000,
}, async () => {
  const { outputDirectory } = emitted;
  const grouped = (await webFunctions(WEB)).find((definition) => definition.file === "default");
  assert.ok(grouped);
  const path = functionPublicPath(grouped);

  const answered = (query: string) => {
    const run = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        ANSWER_REQUEST,
        functionEntryPath(outputDirectory, path),
        `https://app.test/${path}?${query}`,
      ],
      {
        cwd: functionDirectory(outputDirectory, path),
        encoding: "utf8",
        env: { ...LOAD_ENVIRONMENT, DATABASE_URL: PLACEHOLDER_DATABASE_URL },
      },
    );

    assert.equal(run.status, 0, run.stderr);

    return run.stdout.trim().split("\n").at(-1);
  };

  assert.equal(answered("route=orpc&route-path=models"), '401 {"error":"invalid-token"}');
  assert.equal(answered("route=orpc&route-path=nope"), '404 {"error":"not-found"}');
});
