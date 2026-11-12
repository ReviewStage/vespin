/**
 * apple-app-site-association.ts -- the home host's Apple App Site Association: the iPhone app it names, so iOS lets that app catch its sign-in's universal link.
 *
 * Apple reads `/.well-known/apple-app-site-association` from every host an
 * app declares an associated domain with, through Apple's own CDN, as JSON
 * at exactly that path and under no redirect
 * (developer.apple.com/documentation/xcode/supporting-associated-domains).
 * The document names the app by its Team ID and bundle ID: under `applinks`
 * for the path the sign-in returns to (`@repo/features/ios-sign-in-wire`),
 * which is what lets `ASWebAuthenticationSession`'s HTTPS callback catch the
 * authorization's redirect before any page loads, and for the links the app
 * draws a screen for (`@repo/features/ios-app-links`), and under
 * `webcredentials`, which that callback requires of its host besides. The web service rewrites the
 * well-known path onto this group's route (`apps/web/server/function-rewrites.ts`).
 *
 * The Team ID is the deployment's to configure, and the bundle ID is the
 * app's own unless the deployment names another; a deployment without a
 * Team ID answers not found, since a document naming no app associates
 * nothing, and Apple reads a missing file as no association.
 */

import { type AppLinkComponent, IOS_APP_LINK_COMPONENTS } from "@repo/features/ios-app-links";
import { HTTP_METHOD } from "@repo/wire";
import { Config, Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { text } from "../core.js";
import { HOSTED_REFUSAL, hostedNotFoundRoute, hostedRefusing } from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";

/** The variables the app is named from; a blank value is absent. */
export const APPLE_APP_ENVIRONMENT = {
  /** The Apple Developer Team ID the app is signed under, which every app ID begins with. */
  TEAM_ID: "APPLE_TEAM_ID",
  /** The app's bundle ID, where a deployment names one other than the app's own. */
  IOS_BUNDLE_ID: "IOS_BUNDLE_ID",
} as const;

/** The app's own bundle ID, which every deployment names unless it sets another. */
export const IOS_BUNDLE_ID_DEFAULT = "dev.vespin.ios";

/** Where the document stands: the well-known path Apple reads, and the route the web service rewrites it onto. */
export const APPLE_APP_SITE_ASSOCIATION = {
  PATH: "/.well-known/apple-app-site-association",
  ROUTE: "/api/ios/app-site-association",
} as const;

/** The content type Apple reads the document under, with no charset after it. */
const ASSOCIATION_CONTENT_TYPE = "application/json";

/** Read as JSON and nothing else, and kept by no cache, so a Team ID set on the deployment is what Apple's next read finds. */
const ASSOCIATION_HEADERS = {
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
} as const;

/** The app the host is associated with, as Apple names one: `<Team ID>.<bundle ID>`. */
interface AssociatedApp {
  readonly teamId: string;
  readonly bundleId: string;
}

/** The document as Apple's format lays it out: the app's universal links by path, and the app the host's credentials may be shared with. */
interface AppleAppSiteAssociation {
  readonly applinks: {
    readonly details: readonly {
      readonly appIDs: readonly string[];
      readonly components: readonly AppLinkComponent[];
    }[];
  };
  readonly webcredentials: { readonly apps: readonly string[] };
}

/** The app's id in the document: its Team ID, a dot, and its bundle ID. */
function appId(app: AssociatedApp): string {
  return `${app.teamId}.${app.bundleId}`;
}

/** The document naming the app: the sign-in's callback and the links the app draws as its universal links, and the app as the one the host's credentials go to. */
function appleAppSiteAssociation(app: AssociatedApp): AppleAppSiteAssociation {
  const id = appId(app);

  return {
    applinks: {
      details: [
        {
          appIDs: [id],
          components: IOS_APP_LINK_COMPONENTS,
        },
      ],
    },
    webcredentials: { apps: [id] },
  };
}

/** The app the deployment names, or none where it names no Team ID. */
const associatedApp: Effect.Effect<Option.Option<AssociatedApp>> = Config.all({
  teamId: Config.option(Config.String(APPLE_APP_ENVIRONMENT.TEAM_ID)),
  bundleId: Config.option(Config.String(APPLE_APP_ENVIRONMENT.IOS_BUNDLE_ID)),
}).pipe(
  Effect.orElseSucceed(() => ({ teamId: Option.none<string>(), bundleId: Option.none<string>() })),
  Effect.map(({ teamId, bundleId }) => {
    const team = text(Option.getOrUndefined(teamId));

    if (team === undefined) return Option.none();

    return Option.some({
      teamId: team,
      bundleId: text(Option.getOrUndefined(bundleId)) ?? IOS_BUNDLE_ID_DEFAULT,
    });
  }),
);

/** GET: the document naming the deployment's app, or not found where it names none. */
const associationEndpoint = Effect.gen(function* () {
  const incoming = yield* HttpServerRequest.HttpServerRequest;

  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }

  const app = yield* associatedApp;

  if (Option.isNone(app)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

  return HttpServerResponse.text(JSON.stringify(appleAppSiteAssociation(app.value)), {
    contentType: ASSOCIATION_CONTENT_TYPE,
    headers: ASSOCIATION_HEADERS,
  });
});

/** The group: the association at its route, and the hosted vocabulary's own refusal for any other path. */
export function appleAppSiteAssociationApp(): WebRoutes<never> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      APPLE_APP_SITE_ASSOCIATION.ROUTE,
      hostedRefusing(associationEndpoint),
    ),
    hostedNotFoundRoute,
  );
}
