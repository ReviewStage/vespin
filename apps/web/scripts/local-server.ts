/**
 * local-server.ts -- the hosted routes served from this machine as Vercel serves them, over a local database, with the site's pages beside them.
 *
 *   DATABASE_URL=postgres://…@127.0.0.1:5432/luke DATABASE_URL_UNPOOLED=… \
 *   BETTER_AUTH_SECRET=… CRON_SECRET=… \
 *     pnpm --filter @repo/web local-server --port 5173
 *
 * It refuses to start beside any `VERCEL*` variable or over a database off
 * this machine's loopback (`@repo/service/local/local-server-guard`), and it
 * imports no route until it has, because the auth service reads the
 * environment as it loads (`@repo/service/auth/auth`). Where
 * `BETTER_AUTH_URL` names no address, the server names its own there first,
 * so Better Auth's base URL and the cookie origin guard both call it by the
 * address it listens at.
 *
 * Every path a rewrite of the committed table takes is the deployment's,
 * answered by the function the rewrite lands it on
 * (`server/local-deployment.ts`); every other path is the site's, which Vite
 * serves in middleware mode as `pnpm dev` would. With `--built-pages` (or
 * `LOCAL_SERVER_BUILT_PAGES=true`) it runs `vite build` first and serves the
 * pages it wrote instead, through the same page table, while the routes are
 * still imported from source, as close to the deployment as this machine
 * can come: a function's bundle does not run here. It listens on 127.0.0.1
 * alone, on `--port`, `PORT`, or Vite's own port, and calls the scheduled
 * sweep on the cron's cadence under `CRON_SECRET`, as Vercel's cron does.
 *
 * `@vercel/functions` does nothing here. `waitUntil` hands its promise to
 * the request context Vercel puts on `globalThis`, which this process has
 * none of, so the work runs on as any promise in a live process would;
 * every caller hands one that settles. `attachDatabasePool` arms its idle
 * wait only where `VERCEL_URL` and `VERCEL_REGION` are set, which the guard
 * refuses.
 */

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire, registerHooks } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NodeHttpServer,
  NodeHttpServerRequest,
  NodeRuntime,
  NodeServices,
} from "@effect/platform-node";
import { AUTH_DEPLOYMENT_ENVIRONMENT } from "@repo/service/auth/auth-deployment";
import { localServerRefusal } from "@repo/service/local/local-server-guard";
import {
  CRON_ENVIRONMENT,
  MAINTENANCE_SWEEP,
  MAINTENANCE_SWEEP_PATH,
} from "@repo/service/maintenance/maintenance-bounds";
import type { Route } from "@repo/service/route";
import {
  Config,
  ConfigProvider,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  type PlatformError,
  Redacted,
  Schedule,
  Schema,
} from "effect";
import {
  HttpEffect,
  type HttpPlatform,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { createServer as createViteServer, type InlineConfig, type ViteDevServer } from "vite";
import type { LocalDeployment } from "../server/local-deployment.js";

const WEB = join(import.meta.dirname, "..");

/** The one address the server listens at: this machine's loopback, never a network's. */
const LOOPBACK = "127.0.0.1";

/** Vite's own port, where neither the flag nor the variable names one. */
const DEFAULT_PORT = 5173;

const PORT_FLAG = "--port";

const BUILT_PAGES_FLAG = "--built-pages";

const ENV = {
  PORT: "PORT",
  BUILT_PAGES: "LOCAL_SERVER_BUILT_PAGES",
  AUTH_URL: AUTH_DEPLOYMENT_ENVIRONMENT.PRODUCTION_URL,
  CRON_SECRET: CRON_ENVIRONMENT.CRON_SECRET,
} as const;

const STATUS = { NOT_FOUND: 404, SERVER_ERROR: 500 } as const;

/** The query a module is imported under to be its file's text, as Vite spells it. */
const RAW_QUERY = "?raw";

/** How long a stop waits on the connections still open, a page's held reads among them, before it closes them. */
const SHUTDOWN_GRACE = Duration.seconds(1);

/**
 * The site as `pnpm dev` serves it, in middleware mode under this server.
 * Note that Vite's HMR socket is left off, because the Effect server answers
 * every upgrade on this server itself and a socket of Vite's own would be a
 * second port: an edit shows on the page's next load.
 */
const VITE: InlineConfig = { root: WEB, server: { middlewareMode: true, ws: false } };

/**
 * Where the built pages are written: the repository's scratch, so a
 * `pnpm build`'s own `dist`, prerendered pages and all, is never overwritten.
 */
const BUILT_PAGES = join(WEB, ".build", "local-pages");

/** Vite's command line, run by this Node rather than through a package manager. */
const VITE_BIN = join(
  dirname(createRequire(import.meta.url).resolve("vite/package.json")),
  "bin",
  "vite.js",
);

/** The heap the build runs in: Vite's build of the app runs out of Node's default on a small machine. */
const BUILD_HEAP = "--max-old-space-size=4096";

/** The page a directory is served as, and the one a path no file answers is, as Vercel serves the build. */
const PAGE = { INDEX: "index.html", NOT_FOUND: "404.html" } as const;

class LocalServerRefused extends Schema.TaggedError<LocalServerRefused>()("LocalServerRefused", {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}

/** The command line's flags as the variables they stand in for, read ahead of the environment's own. */
function flagsProvider(argv: readonly string[]): ConfigProvider.ConfigProvider {
  const flag = argv.indexOf(PORT_FLAG);
  const port = flag === -1 ? undefined : argv[flag + 1];

  const flags: Record<string, string> = {};

  if (port !== undefined) flags[ENV.PORT] = port;

  if (argv.includes(BUILT_PAGES_FLAG)) flags[ENV.BUILT_PAGES] = "true";

  return ConfigProvider.fromEnvRecord(flags);
}

/**
 * Answers a file a route imports `?raw` with its text, as the function's
 * bundle inlines it (`server/function-bundles.ts`) and Vite answers it to a
 * test, since Node knows no such import: the host's install script.
 */
function answerRawImports(): void {
  registerHooks({
    load(url, context, nextLoad) {
      if (!url.endsWith(RAW_QUERY)) return nextLoad(url, context);
      const text = readFileSync(fileURLToPath(url), "utf8");

      return {
        format: "module",
        shortCircuit: true,
        source: `export default ${JSON.stringify(text)};`,
      };
    },
  });
}

/**
 * The routes this server answers ahead of the deployment's and the pages,
 * by the path each answers: where a local-only route mounts. The demo's
 * sign-in answers `/sign-in` in the page's place, as the member the
 * demo seed writes, or the one a bare `?member=` names
 * (`server/local-sign-in.ts`). None ever stands under
 * `server/routes/`, so no function a deploy carries reaches one. Read once
 * the environment is settled, as the deployment's routes are, since what
 * they import may read it as it loads.
 */
async function localRoutes(): Promise<ReadonlyMap<string, Route>> {
  const [{ auth }, { DEMO_DEAN }, { LOCAL_SIGN_IN_PATH, localSignIn }] = await Promise.all([
    import("@repo/service/auth/auth"),
    import("@repo/service/demo/demo-seed"),
    import("../server/local-sign-in.js"),
  ]);

  return new Map([[LOCAL_SIGN_IN_PATH, localSignIn(auth, DEMO_DEAN.id)]]);
}

/**
 * A page's request, handed to Vite as the Node request and response it came
 * as, addressed to the page it is served from; Vite writes the answer, so the
 * empty response returned is never written. The browser keeps the address it
 * asked for, which the app reads its link from.
 */
function page(
  vite: ViteDevServer,
  request: HttpServerRequest.HttpServerRequest,
  served: URL,
): Effect.Effect<HttpServerResponse.HttpServerResponse> {
  return Effect.callback((resume) => {
    const incoming = NodeHttpServerRequest.toIncomingMessage(request);
    const outgoing = NodeHttpServerRequest.toServerResponse(request);
    incoming.url = `${served.pathname}${served.search}`;
    outgoing.once("close", () => resume(Effect.succeed(HttpServerResponse.empty())));
    vite.middlewares(incoming, outgoing, (cause?: unknown) => {
      outgoing.statusCode = cause === undefined ? STATUS.NOT_FOUND : STATUS.SERVER_ERROR;
      outgoing.end();
    });
  });
}

/**
 * The file of the build a page's path names, under the build's folder alone:
 * the file itself, or a folder's index page, or none.
 */
const builtFile = Effect.fnUntraced(function* (directory: string, pathname: string) {
  const fs = yield* FileSystem.FileSystem;
  const decoded = Option.liftThrowable(decodeURIComponent)(pathname);

  const named = Option.filter(
    Option.map(decoded, (path) => resolve(directory, `.${path}`)),
    (path) => path === directory || path.startsWith(`${directory}${sep}`),
  );

  if (Option.isNone(named)) return Option.none<string>();

  const info = yield* Effect.option(fs.stat(named.value));

  const file =
    Option.isSome(info) && info.value.type === "Directory"
      ? join(named.value, PAGE.INDEX)
      : named.value;

  const found = yield* Effect.option(fs.stat(file));

  return Option.isSome(found) && found.value.type === "File" ? Option.some(file) : Option.none();
});

/** A page's request answered from the build at `directory`, or its 404 page where no file answers the path. */
function builtPage(directory: string, served: URL) {
  return Effect.flatMap(builtFile(directory, served.pathname), (file) =>
    Option.isSome(file)
      ? HttpServerResponse.file(file.value)
      : HttpServerResponse.file(join(directory, PAGE.NOT_FOUND), { status: STATUS.NOT_FOUND }),
  );
}

/** The site's pages written afresh by `vite build`, in its own process for the heap it takes, which the server answers from. */
const buildPages = Effect.fnUntraced(function* (directory: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const exitCode = yield* spawner.exitCode(
    ChildProcess.make(
      process.execPath,
      [
        BUILD_HEAP,
        VITE_BIN,
        "build",
        "--outDir",
        directory,
        "--emptyOutDir",
        "--logLevel",
        "error",
      ],
      { cwd: WEB, stdin: "ignore", stdout: "inherit", stderr: "inherit" },
    ),
  );

  if (exitCode !== 0) {
    return yield* new LocalServerRefused({ reason: `The pages' build exited ${exitCode}` });
  }
});

/** How a page's request, addressed to the page it is served from, is answered: by Vite, or from the build. */
type Pages = (
  request: HttpServerRequest.HttpServerRequest,
  served: URL,
) => Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  PlatformError.PlatformError,
  FileSystem.FileSystem | HttpPlatform.HttpPlatform
>;

/** The site's pages as the server was asked to serve them: built by `vite build` before it listens, or by Vite in middleware mode as they are asked for. */
function sitePages(built: boolean) {
  if (built) {
    const fromBuild: Pages = (_request, served) => builtPage(BUILT_PAGES, served);

    return Effect.as(buildPages(BUILT_PAGES), fromBuild);
  }

  return Effect.map(
    Effect.acquireRelease(
      Effect.promise(() => createViteServer(VITE)),
      (server) => Effect.promise(() => server.close()),
    ),
    (vite): Pages =>
      (request, served) =>
        page(vite, request, served),
  );
}

/** What a request is answered by: a local-only route, the deployment's routes, or the page a path of the site is served from. */
interface LocalSite {
  readonly local: ReadonlyMap<string, Route>;
  readonly deployment: LocalDeployment;
  readonly pageOf: (pathname: string) => string;
  readonly pages: Pages;
}

/** Every request as this server answers it: a local-only route's, the deployment's, or a page's, in that order. */
function answer(origin: string, site: LocalSite) {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const asked = new URL(request.url, origin);
    const own = site.local.get(asked.pathname);

    if (own !== undefined) return yield* HttpEffect.fromWebHandler(own.fetch);

    if (site.deployment.answers(asked.pathname)) {
      return yield* HttpEffect.fromWebHandler(site.deployment.fetch);
    }

    const served = new URL(asked);
    served.pathname = site.pageOf(asked.pathname);

    return yield* site.pages(request, served);
  });
}

/** The scheduled sweep as Vercel's cron calls it, under the cron secret, on the cadence the root `vercel.json` gives it, answered in process. */
function sweepOnSchedule(deployment: LocalDeployment, origin: string, secret: Redacted.Redacted) {
  const sweep = Effect.tryPromise(async () => {
    const answered = await deployment.fetch(
      new Request(new URL(MAINTENANCE_SWEEP_PATH, origin), {
        headers: { authorization: `Bearer ${Redacted.value(secret)}` },
      }),
    );

    await answered.body?.cancel();

    return answered.status;
  }).pipe(
    Effect.flatMap((status) =>
      status < 300 ? Effect.void : Effect.logWarning(`The scheduled sweep answered ${status}`),
    ),
    Effect.catch((error) => Effect.logWarning("The scheduled sweep failed", error)),
  );

  return Effect.repeat(sweep, Schedule.cron(MAINTENANCE_SWEEP.CRONTAB)).pipe(Effect.orDie);
}

const program = Effect.gen(function* () {
  const refusal = localServerRefusal(process.env);

  if (refusal !== undefined) return yield* new LocalServerRefused({ reason: refusal });
  const port = yield* Config.Port(ENV.PORT).pipe(Config.withDefault(DEFAULT_PORT));
  const built = yield* Config.Boolean(ENV.BUILT_PAGES).pipe(Config.withDefault(false));
  const cronSecret = yield* Config.option(Config.Redacted(ENV.CRON_SECRET));
  const origin = `http://${LOOPBACK}:${port}`;
  // Note that the address is settled before any route is imported, because the services read the environment as they are built.
  yield* Effect.sync(() => {
    if (!process.env[ENV.AUTH_URL]?.trim()) process.env[ENV.AUTH_URL] = origin;
  });
  yield* Effect.sync(answerRawImports);

  const { localDeployment, localPages } = yield* Effect.promise(
    () => import("../server/local-deployment.js"),
  );

  const deployment = yield* Effect.promise(() => localDeployment(WEB));
  const pageOf = yield* Effect.promise(() => localPages(WEB));
  const local = yield* Effect.promise(localRoutes);

  const pages = yield* sitePages(built);

  if (Option.isSome(cronSecret)) {
    yield* Effect.forkScoped(sweepOnSchedule(deployment, origin, cronSecret.value));
  } else {
    yield* Effect.logWarning(`${ENV.CRON_SECRET} is not set, so the scheduled sweep does not run`);
  }

  const listening = NodeHttpServer.layer(createServer, {
    port,
    host: LOOPBACK,
    gracefulShutdownTimeout: SHUTDOWN_GRACE,
  });

  return yield* Layer.launch(
    HttpServer.serve(answer(origin, { local, deployment, pageOf, pages })).pipe(
      HttpServer.withLogAddress,
      Layer.provide(listening),
    ),
  );
}).pipe(
  Effect.scoped,
  Effect.provide(NodeServices.layer),
  Effect.provide(
    ConfigProvider.layer(
      ConfigProvider.orElse(flagsProvider(process.argv.slice(2)), ConfigProvider.fromEnv()),
    ),
  ),
);

NodeRuntime.runMain(program);
