import { Cause, Data, Effect, Option, Schema } from "effect";

/**
 * workspace-seams.ts -- the workspace write that goes through Better Auth, handed to the store and the routes as a seam, and a Better Auth call's refusal read by its status.
 *
 * A workspace is created by the organization plugin itself, so its
 * organization and owner rows are the plugin's own, through the server-only
 * `auth.api.createOrganization`: called with a `userId` and neither a
 * request nor headers, which is the one way the plugin creates for an
 * account with no session. The call is the auth service's promise, wrapped
 * once here the way `bearer.ts` wraps `oauth2UserInfo`. The auth service is
 * handed in rather than imported, so a route hands it `auth.api` and a test
 * the API of a Better Auth over its own database. A workspace's members,
 * name, photo, invitations, and deletion are the store's to write
 * (`organization-store.ts`, `invitation-store.ts`), since the plugin takes
 * only a session for them; `pluginCall` reads the refusal of the session
 * calls that remain, GitHub's unlink and support access among them.
 */

/** The metadata the plugin stores on the workspace made for an account, as JSON text; only the server writes it, and only a racing ensure reads it, to adopt the account's own. */
export const PERSONAL_WORKSPACE_METADATA = { personal: true } as const;

/** What a workspace is created with: its name and slug, the account that will own it, and the metadata the plugin stores as JSON text. */
export interface WorkspaceCreation {
  readonly name: string;
  readonly slug: string;
  readonly userId: string;
  readonly metadata: Readonly<Record<string, boolean>>;
}

/** A call Better Auth refused, by the HTTP status and the code its refusal carries; its words stay with it. */
export class OrganizationRefused extends Data.TaggedError("OrganizationRefused")<{
  readonly status: number;
  readonly code?: string | undefined;
}> {}

/** The plugin's write the workspace store makes. */
export interface WorkspaceSeams {
  readonly createOrganization: (
    creation: WorkspaceCreation,
  ) => Effect.Effect<{ readonly id: string }, Cause.UnknownError>;
}

/** Every way a plugin call fails: its refusal, or anything else it threw or answered. */
export type MemberFailure = OrganizationRefused | Cause.UnknownError;

/** The part of a Better Auth `api` with the organization plugin that the workspace seam calls. */
export interface OrganizationAuthApi {
  readonly createOrganization: (input: {
    body: { name: string; slug: string; userId: string; metadata: Record<string, boolean> };
  }) => Promise<{ readonly id: string }>;
}

/**
 * The status a Better Auth `APIError` carries, read by shape: the plugin's
 * refusals are that error, and this package reaches no Better Auth of its
 * own to name the class by.
 */
const decodeRefusal = Schema.decodeUnknownOption(
  Schema.Struct({
    statusCode: Schema.Number,
    body: Schema.optionalKey(Schema.Struct({ code: Schema.optionalKey(Schema.String) })),
  }),
);

/** A plugin call's answer, its refusal kept by status and code and anything else an unknown failure. */
export function pluginCall(
  write: () => Promise<object | null>,
): Effect.Effect<object | null, MemberFailure> {
  return Effect.tryPromise({
    try: write,
    catch: (thrown): MemberFailure =>
      Option.match(decodeRefusal(thrown), {
        onNone: () => new Cause.UnknownError(thrown),
        onSome: ({ statusCode, body }) =>
          new OrganizationRefused({ status: statusCode, code: body?.code }),
      }),
  });
}

/** The workspace writes over one auth service: `auth.api` on a deployment. */
export function workspaceSeams(api: OrganizationAuthApi): WorkspaceSeams {
  return {
    createOrganization: (creation) =>
      Effect.tryPromise(() =>
        api.createOrganization({
          body: {
            name: creation.name,
            slug: creation.slug,
            userId: creation.userId,
            metadata: { ...creation.metadata },
          },
        }),
      ).pipe(Effect.map((created) => ({ id: created.id }))),
  };
}
