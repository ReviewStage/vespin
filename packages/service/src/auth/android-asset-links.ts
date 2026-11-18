/**
 * android-asset-links.ts -- the home host's Digital Asset Links: the Android app it names, so Android verifies that app's App Links and lets it catch its sign-in's return.
 *
 * Android reads `/.well-known/assetlinks.json` from every host an app's
 * `autoVerify` intent filter names, as JSON at exactly that path, over
 * HTTPS and under no redirect
 * (developer.android.com/training/app-links/verify-android-applinks). The
 * document names the app by its package and the SHA-256 fingerprints of the
 * certificates it is signed with, under
 * `delegate_permission/common.handle_all_urls`, which is what lets the
 * app open the host's links, the sign-in's return among them
 * (`@repo/features/android-sign-in-wire`), and under
 * `delegate_permission/common.get_login_creds`, which lets the host's saved
 * credentials be offered in the app, as the iPhone's `webcredentials` does.
 * The web service rewrites the well-known path onto this group's route
 * (`apps/web/server/function-rewrites.ts`), as it does Apple's
 * (`apple-app-site-association.ts`).
 *
 * The fingerprints are the deployment's to configure, since Play App
 * Signing's certificate exists only once the app is first uploaded: the
 * upload key's for a build signed here, and Play's for one installed from
 * Play, both named where both stand. The package is the app's own unless
 * the deployment names another. A deployment naming no fingerprint that
 * reads as one answers not found, since a document naming no certificate
 * verifies nothing, and Android reads a missing file as no association.
 */

import { HTTP_METHOD } from "@repo/wire";
import { Config, Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { text } from "../core.js";
import { HOSTED_REFUSAL, hostedNotFoundRoute, hostedRefusing } from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";

/** The variables the app is named from; a blank value is absent. */
export const ANDROID_APP_ENVIRONMENT = {
  /** The SHA-256 fingerprints of the app's signing certificates, separated by commas or spaces, each as `keytool` or the Play Console prints it. */
  CERT_FINGERPRINTS: "ANDROID_CERT_FINGERPRINTS",
  /** The app's package name, where a deployment names one other than the app's own. */
  PACKAGE_NAME: "ANDROID_PACKAGE_NAME",
} as const;

/** The app's own package name, which every deployment names unless it sets another. */
export const ANDROID_PACKAGE_NAME_DEFAULT = "dev.vespin.android";

/** Where the document stands: the well-known path Android reads, and the route the web service rewrites it onto. */
export const ANDROID_ASSET_LINKS = {
  PATH: "/.well-known/assetlinks.json",
  ROUTE: "/api/android/asset-links",
} as const;

/** What the document lets the app do: open the host's links, and be offered the host's saved credentials. */
const ASSET_LINK_RELATION = {
  HANDLE_ALL_URLS: "delegate_permission/common.handle_all_urls",
  GET_LOGIN_CREDS: "delegate_permission/common.get_login_creds",
} as const;

/** The content type Android reads the document under. */
const ASSET_LINKS_CONTENT_TYPE = "application/json";

/** Read as JSON and nothing else, and kept by no cache, so a fingerprint set on the deployment is what Android's next read finds. */
const ASSET_LINKS_HEADERS = {
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
} as const;

/** A SHA-256 fingerprint as the document spells one: 32 bytes of upper-case hex, a colon between each. */
const FINGERPRINT_PATTERN = /^[0-9A-F]{2}(?::[0-9A-F]{2}){31}$/u;

/** A fingerprint written as 64 hex digits with no colons, which the document's spelling is made from. */
const BARE_FINGERPRINT_PATTERN = /^[0-9A-F]{64}$/u;

/** What separates the fingerprints in the variable. */
const FINGERPRINT_SEPARATOR = /[\s,]+/u;

/** The app the host is associated with, as Android names one: its package and its certificates. */
interface AssociatedApp {
  readonly packageName: string;
  readonly fingerprints: readonly string[];
}

/** One statement of the document, as Google's format lays it out. */
interface AssetLinkStatement {
  readonly relation: readonly string[];
  readonly target: {
    readonly namespace: "android_app";
    readonly package_name: string;
    readonly sha256_cert_fingerprints: readonly string[];
  };
}

/** A fingerprint as the document spells it, upper case with its colons; none where it is no SHA-256 fingerprint. */
function fingerprintOf(written: string): string | undefined {
  const upper = written.toUpperCase();

  if (FINGERPRINT_PATTERN.test(upper)) return upper;

  if (!BARE_FINGERPRINT_PATTERN.test(upper)) return undefined;

  return (upper.match(/.{2}/gu) ?? []).join(":");
}

/** The document naming the app: its links and its credentials, for every certificate it is signed with. */
function assetLinks(app: AssociatedApp): readonly AssetLinkStatement[] {
  return [
    {
      relation: [ASSET_LINK_RELATION.HANDLE_ALL_URLS, ASSET_LINK_RELATION.GET_LOGIN_CREDS],
      target: {
        namespace: "android_app",
        package_name: app.packageName,
        sha256_cert_fingerprints: app.fingerprints,
      },
    },
  ];
}

/** The app the deployment names, or none where it names no fingerprint; a word that is no fingerprint is left out and logged by the variable's name alone. */
const associatedApp: Effect.Effect<Option.Option<AssociatedApp>> = Effect.gen(function* () {
  const read = yield* Config.all({
    fingerprints: Config.option(Config.String(ANDROID_APP_ENVIRONMENT.CERT_FINGERPRINTS)),
    packageName: Config.option(Config.String(ANDROID_APP_ENVIRONMENT.PACKAGE_NAME)),
  }).pipe(
    Effect.orElseSucceed(() => ({
      fingerprints: Option.none<string>(),
      packageName: Option.none<string>(),
    })),
  );

  const written = (text(Option.getOrUndefined(read.fingerprints)) ?? "")
    .split(FINGERPRINT_SEPARATOR)
    .filter((word) => word !== "");

  const fingerprints = written.flatMap((word) => {
    const fingerprint = fingerprintOf(word);

    return fingerprint === undefined ? [] : [fingerprint];
  });

  if (fingerprints.length < written.length) {
    yield* Effect.logWarning(
      `${ANDROID_APP_ENVIRONMENT.CERT_FINGERPRINTS} holds a word that is no SHA-256 fingerprint, which the asset links leave out.`,
    );
  }

  if (fingerprints.length === 0) return Option.none();

  return Option.some({
    packageName: text(Option.getOrUndefined(read.packageName)) ?? ANDROID_PACKAGE_NAME_DEFAULT,
    fingerprints: [...new Set(fingerprints)],
  });
});

/** GET: the document naming the deployment's app, or not found where it names none. */
const assetLinksEndpoint = Effect.gen(function* () {
  const incoming = yield* HttpServerRequest.HttpServerRequest;

  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }

  const app = yield* associatedApp;

  if (Option.isNone(app)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

  return HttpServerResponse.text(JSON.stringify(assetLinks(app.value)), {
    contentType: ASSET_LINKS_CONTENT_TYPE,
    headers: ASSET_LINKS_HEADERS,
  });
});

/** The group: the asset links at their route, and the hosted vocabulary's own refusal for any other path. */
export function androidAssetLinksApp(): WebRoutes<never> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, ANDROID_ASSET_LINKS.ROUTE, hostedRefusing(assetLinksEndpoint)),
    hostedNotFoundRoute,
  );
}
