/**
 * client-identity.ts -- what a client says of itself on every hosted call: which app it is and its version, and the hosted API version it was built against.
 *
 * A released build talks to a newer service for weeks: an App Store build,
 * a desktop that has not restarted into its update, a CLI not yet updated.
 * Two headers name the caller, so the service's lines say which build asked
 * and, with a floor, which builds it still serves (`HOSTED_API_VERSION`).
 * The host daemon names itself apart, by `HOST_WIRE.VERSION_HEADER`.
 */

import { Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { PRODUCT_PLATFORM } from "./analytics/product-events.js";

/**
 * The hosted API as a build sees it, one integer: moved when the wire
 * changes in a way a build before the move cannot read, so the service can
 * refuse every build below its floor as needing an update.
 */
export const HOSTED_API_VERSION = 1;

/** The headers a client names itself in: which app and version, as `platform/version`, and the hosted API version it was built against. */
export const CLIENT_HEADER = {
  CLIENT: "vespin-client",
  API_VERSION: "vespin-api-version",
} as const;

/** Which app calls: the desktop, the web tab, the iOS app, or the CLI. */
export const CLIENT_PLATFORM = {
  DESKTOP: PRODUCT_PLATFORM.DESKTOP,
  WEB: PRODUCT_PLATFORM.WEB,
  IOS: PRODUCT_PLATFORM.IOS,
  CLI: "cli",
} as const;

export type ClientPlatform = (typeof CLIENT_PLATFORM)[keyof typeof CLIENT_PLATFORM];

/** What a build says of itself: which app, and its version as its package names it. */
export interface ClientIdentity {
  readonly platform: ClientPlatform;
  readonly version: string;
}

/** What stands between the platform and the version in the client header. */
const CLIENT_SEPARATOR = "/";

/** A version as a build names it, bounded, since the service writes it into its lines: a release version, a build number, or a development build's word. */
const VERSION_PATTERN = /^[0-9A-Za-z.+-]{1,64}$/u;

/** The two headers a build sends on every hosted call, as a record a request or a socket's address carries. */
export function clientHeaders(identity: ClientIdentity): Readonly<Record<string, string>> {
  return {
    [CLIENT_HEADER.CLIENT]: `${identity.platform}${CLIENT_SEPARATOR}${identity.version}`,
    [CLIENT_HEADER.API_VERSION]: String(HOSTED_API_VERSION),
  };
}

/** The client given, naming itself on every request to the service's origin and on no other. */
export function clientNamedOnService(
  http: HttpClient.HttpClient,
  identity: ClientIdentity,
  serviceBaseUrl: string,
): HttpClient.HttpClient {
  const origin = new URL(serviceBaseUrl).origin;
  const headers = clientHeaders(identity);

  return HttpClient.mapRequest(http, (request) =>
    request.url === origin || request.url.startsWith(`${origin}/`)
      ? HttpClientRequest.setHeaders(request, headers)
      : request,
  );
}

/** A client as the service reads it off a request: its identity, and the API version it was built against. */
export interface PresentedClient extends ClientIdentity {
  readonly apiVersion: number;
}

const readPlatform = Schema.decodeUnknownOption(Schema.Literals(Object.values(CLIENT_PLATFORM)));

/** The API version header as an integer at or past zero. */
const readApiVersion = Schema.decodeUnknownOption(
  Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
);

/** The client a request's headers name, or nothing where they name none or one that does not read, as a build from before the headers. */
export function presentedClient(headers: {
  readonly get: (name: string) => string | null;
}): PresentedClient | undefined {
  const named = headers.get(CLIENT_HEADER.CLIENT)?.trim() ?? "";
  const at = named.indexOf(CLIENT_SEPARATOR);

  if (at <= 0) return undefined;
  const platform = readPlatform(named.slice(0, at));
  const apiVersion = readApiVersion(headers.get(CLIENT_HEADER.API_VERSION)?.trim());
  const version = named.slice(at + 1);

  if (platform._tag === "None" || apiVersion._tag === "None" || !VERSION_PATTERN.test(version)) {
    return undefined;
  }

  return { platform: platform.value, version, apiVersion: apiVersion.value };
}
