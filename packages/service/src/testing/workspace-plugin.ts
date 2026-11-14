import { workspaceSeams } from "@repo/database/models/workspace-seams";
import {
  openMigratedPglite,
  sqlClientOverPglite,
  syncListenerOverPglite,
} from "@repo/database/testing";
import { betterAuth } from "better-auth";
import { makeSignature } from "better-auth/crypto";
import {
  admin,
  bearer,
  type DefaultOrganizationPlugin,
  organization as organizationPlugin,
} from "better-auth/plugins";
import { drizzle } from "drizzle-orm/pglite";
import { type Cause, Effect, Layer, Option, type Scope } from "effect";
import { workspaceDeletionSteps } from "../accounts/deletion-hooks.js";
import { authDatabaseAdapter } from "../auth/auth-database.js";
import {
  ADMIN_OPTIONS,
  DISABLED_AUTH_PATHS,
  ORGANIZATION_OPTIONS,
  SESSION_BEARER,
  SESSION_COOKIE_CACHE,
  workspaceDeletion,
} from "../auth/auth-policy.js";
import { supportAccess } from "../auth/support-access.js";

/**
 * workspace-plugin.ts -- Better Auth with the organization, bearer, admin, and support-access plugins, and the session cookie cache `auth.ts` declares, over a migrated PGlite of its own.
 *
 * The plugin writes through its own adapter and the store reads through
 * `database`, the same PGlite, so a test sees the plugin's real rows: the
 * organization and owner a create makes, and the member an add makes, and a
 * session answers its user's `role` as the deployment's does. A plugin call
 * that takes a session, an invitation's accept among them, is made under one
 * `sessionBearerOf` mints for an account and signs as the bearer plugin
 * hands one out, so the plugin reads it back exactly as it reads the Mac's.
 * `sessionCookieOf` mints one as the cookie a signed-in browser carries,
 * spelled as the bearer plugin spells the cookie it reads a bearer as.
 * `database` carries a `SyncListener` on the same PGlite, as `getTestDB`'s
 * does, so a test hears what the plugin's writes notify. The database is
 * closed with the scope that opened it.
 */

const SECRET = "workspace-plugin-test-secret-with-enough-length";

/** The organization plugin's options: the shared ones and a workspace's deletion hooks. */
const WORKSPACE_ORGANIZATION_OPTIONS = {
  ...ORGANIZATION_OPTIONS,
  organizationHooks: workspaceDeletion(workspaceDeletionSteps),
};

/** The plugins a workspace's routes reach, named each by its own factory's type, as `auth.ts`'s `AuthPlugins` are and for its reason. */
type WorkspacePlugins = [
  DefaultOrganizationPlugin<typeof WORKSPACE_ORGANIZATION_OPTIONS>,
  ReturnType<typeof bearer>,
  ReturnType<typeof admin<typeof ADMIN_OPTIONS>>,
  ReturnType<typeof supportAccess>,
];

const WORKSPACE_PLUGINS: WorkspacePlugins = [
  organizationPlugin(WORKSPACE_ORGANIZATION_OPTIONS),
  bearer(SESSION_BEARER),
  admin(ADMIN_OPTIONS),
  supportAccess(),
];

/** Better Auth over the database given, with the plugins a workspace's routes reach. */
function workspaceAuth(client: Awaited<ReturnType<typeof openMigratedPglite>>) {
  return betterAuth({
    database: authDatabaseAdapter(drizzle({ client })),
    baseURL: "http://127.0.0.1",
    secret: SECRET,
    session: SESSION_COOKIE_CACHE,
    disabledPaths: [...DISABLED_AUTH_PATHS],
    plugins: WORKSPACE_PLUGINS,
  });
}

/** The store a test's workspace rows are read and written through, over the database given. */
function workspaceDatabase(client: Awaited<ReturnType<typeof openMigratedPglite>>) {
  return Layer.provideMerge(syncListenerOverPglite, sqlClientOverPglite(client));
}

/**
 * What a test reaches of the plugin. Note that the type is written out, its
 * API named by `workspaceAuth`'s, because the inferred one spells out every
 * endpoint Better Auth declares, down to zod's internal types, which the
 * declarations this package emits cannot name.
 */
export interface WorkspacePlugin {
  readonly api: ReturnType<typeof workspaceAuth>["api"];
  readonly seams: ReturnType<typeof workspaceSeams>;
  readonly resolveSessionUserId: (request: {
    headers: Headers;
  }) => Effect.Effect<Option.Option<string>, Cause.UnknownError>;
  readonly sessionBearerOf: (userId: string) => Effect.Effect<string>;
  readonly sessionCookieOf: (userId: string) => Effect.Effect<string>;
  readonly database: ReturnType<typeof workspaceDatabase>;
}

export const openWorkspacePlugin: Effect.Effect<WorkspacePlugin, never, Scope.Scope> = Effect.gen(
  function* () {
    const client = yield* Effect.acquireRelease(Effect.promise(openMigratedPglite), (opened) =>
      Effect.promise(() => opened.close()),
    );

    const plugin = workspaceAuth(client);

    /** A fresh session for the account, its token signed under the plugin's secret. */
    const signedSessionOf = async (userId: string) => {
      const context = await plugin.$context;
      const session = await context.internalAdapter.createSession(userId);

      return { context, signed: `${session.token}.${await makeSignature(session.token, SECRET)}` };
    };

    /** A fresh session for the account, as the signed bearer token the plugin would hand the Mac. */
    const sessionBearerOf = (userId: string) =>
      Effect.promise(async () => (await signedSessionOf(userId)).signed);

    /** A fresh session for the account, as the `Cookie` header a browser signed in to it sends. */
    const sessionCookieOf = (userId: string) =>
      Effect.promise(async () => {
        const { context, signed } = await signedSessionOf(userId);

        return `${context.authCookies.sessionToken.name}=${encodeURIComponent(signed)}`;
      });

    /** The account a request's session names, read as the routes read it, from a request or its headers alone. */
    const resolveSessionUserId = (request: { headers: Headers }) =>
      Effect.tryPromise(async () => {
        const session = await plugin.api.getSession({ headers: request.headers });

        return Option.fromNullishOr(session?.user.id);
      });

    return {
      api: plugin.api,
      seams: workspaceSeams(plugin.api),
      resolveSessionUserId,
      sessionBearerOf,
      sessionCookieOf,
      database: workspaceDatabase(client),
    };
  },
);
