/**
 * client-identity.ts -- what a client says of itself on every hosted call: which app it is and its version, and the hosted API version it was built against.
 *
 * A released build talks to a newer service for weeks: an App Store build,
 * a desktop that has not restarted into its update, a CLI not yet updated.
 * Two headers name the caller, so the service's lines say which build asked
 * and, with a floor, which builds it still serves (`HOSTED_API_VERSION`).
 * The host daemon names itself apart, by `HOST_WIRE.VERSION_HEADER`.
 */

import { Option, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { PRODUCT_PLATFORM } from "./analytics/product-events.js";

/**
 * The hosted API as a build sees it, one integer: moved when the wire
 * changes in a way a build before the move cannot read, so the service can
 * refuse every build below its floor as needing an update. A build from 3
 * on reads `show_media` and plays sound clips, in the transcript, a thread,
 * an ask's options, and a description alike, so a service that keeps a clip
 * may refuse the builds before it, which would draw one as a picture that
 * never loads. A build from 4 on reads Cursor as a model provider and an
 * agent's runtime (`MODEL_PROVIDER.CURSOR`, `AGENT_RUNTIME.CURSOR`), so a
 * service may offer Cursor's models and agents to it alone until the floor
 * passes 3. A build from 5 on reads an automation without its `guards`, so
 * a service may stop sending them once the floor reaches 5. A build from 6
 * on reads an agent, and an inbox item, on no task (`taskId: null`), so a
 * service may answer one to it alone until the floor passes 5. A build from
 * 7 on reads an agent on a machine its workspace owns
 * (`AGENT_MACHINE.WORKSPACE`), so a service may answer one to it alone until
 * the floor passes 6. A build from 8 on draws the Inbox's and a Manager's
 * chat's tools under the names they took for their surface (`inbox_*`,
 * `chat_*`), so a service may store their calls under those names
 * (`storedToolName`) once the floor reaches 8. An iOS build from 9 on opens a
 * thread's push that names no task, a Manager's, on the thread in its Inbox,
 * so a service may push one to a phone that registered at 9 or later alone.
 * A build from 10 on reads and draws a reaction to a Manager's chat message
 * of any kind, by its Slack name and its emoji, and sends one, so a service
 * may give and take kinds beyond 👍 and 👎 once the floor reaches 10. A
 * build from 11 on never asks for the machines a workspace owns
 * (`workspaceMachines.*`, `LIVE_READ.WORKSPACE_MACHINES`) or approves a host
 * for a workspace, so a service may stop serving those once the floor
 * reaches 11. A build from 12 on reads a delta read's whole answer in pages
 * (`LIVE_POLL.PAGE`), so a service answers one so to it alone
 * (`live-pages.ts`'s `PAGED_API_VERSION`) until the floor passes 11.
 */
export const HOSTED_API_VERSION = 12;

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

type ClientPlatform = (typeof CLIENT_PLATFORM)[keyof typeof CLIENT_PLATFORM];

/** What a build says of itself: which app, and its version as its package names it. */
export interface ClientIdentity {
  readonly platform: ClientPlatform;
  readonly version: string;
}

/** What stands between the platform and the version in the client header. */
const CLIENT_SEPARATOR = "/";

/** A version as a build names it, bounded, since the service writes it into its lines: a release version, a build number, or a development build's word. */
const VERSION_PATTERN = /^[0-9A-Za-z.+-]{1,64}$/u;

/** The word a build that names no version of its own, a web tab served by a development server, names itself by, since a header naming none would not read. */
const UNVERSIONED_BUILD = "development";

/** The two headers a build sends on every hosted call, as a record a request or a socket's address carries. */
export function clientHeaders(identity: ClientIdentity) {
  return {
    [CLIENT_HEADER.CLIENT]: `${identity.platform}${CLIENT_SEPARATOR}${identity.version || UNVERSIONED_BUILD}`,
    [CLIENT_HEADER.API_VERSION]: String(HOSTED_API_VERSION),
  } satisfies Readonly<Record<string, string>>;
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

  if (Option.isNone(platform) || Option.isNone(apiVersion) || !VERSION_PATTERN.test(version)) {
    return undefined;
  }

  return { platform: platform.value, version, apiVersion: apiVersion.value };
}
