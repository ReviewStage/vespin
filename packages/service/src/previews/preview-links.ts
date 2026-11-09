/**
 * preview-links.ts -- a shared port's members-only link: the preview host each agent's port is served on, under the page sandbox's own domain, and the signed tokens that admit a signed-in member to it.
 *
 * A port an agent shares is never handed out at its sandbox's own public
 * route. Its link is a host of its own under the page sandbox's domain
 * (`<agent id without dashes>.vespin.page`), a site apart from the app's, so
 * nothing the agent's app runs reaches the app's cookies. That host answers
 * only a member who holds its cookie, and a member gets one by signing in on
 * the app: the app checks the member reaches the agent, mints a handoff
 * token a minute long, and sends the browser to the preview host, which
 * trades it for a session cookie held to that one host (`__Host-`).
 *
 * Both tokens are signed with HMAC-SHA256 under the page sandbox's key
 * (`page-links.ts`), each over a purpose of its own, so neither stands for
 * the other or for a page's link. A deployment without the page sandbox has
 * no preview host either.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { PREVIEW_SIGN_IN } from "@repo/features/preview-sign-in";
import { Duration, Option, Redacted, Schema } from "effect";
import type { PageSandbox } from "../pages/page-links.js";

/** The paths and names the preview's sign-in travels by. */
export const PREVIEW_LINK = {
  /** The app's route that checks a member's reach and hands them to the preview host. */
  SIGN_IN_PATH: PREVIEW_SIGN_IN.PATH,
  /** The route the deployment's routing hands every request to a preview host. */
  PROXY_PATH: "/api/previews/proxy",
  /** The preview host's own path that trades a handoff token for its cookie. */
  SESSION_PATH: "/__vespin/session",
  QUERY: { AGENT: "agent", RETURN: "return", TOKEN: "token" },
  /** The preview host's session cookie, held to that host alone by its prefix. */
  COOKIE: "__Host-vespin-preview",
} as const;

/** What each token's signature is made over ahead of its claims. */
const PREVIEW_TOKEN_PURPOSE = {
  HANDOFF: "app-preview-handoff-v1",
  SESSION: "app-preview-session-v1",
} as const;

type PreviewTokenPurpose = (typeof PREVIEW_TOKEN_PURPOSE)[keyof typeof PREVIEW_TOKEN_PURPOSE];

/** How long each token admits its member. */
export const PREVIEW_TOKEN_LIFETIME = {
  HANDOFF: Duration.minutes(1),
  SESSION: Duration.hours(8),
} as const;

/** A preview host's label: an agent's id, its dashes dropped. */
const PREVIEW_LABEL = /^[0-9a-f]{32}$/u;

/** Who a token admits, to which agent's preview. */
export interface PreviewMember {
  readonly userId: string;
  readonly agentId: string;
}

const PreviewClaimsJson = Schema.fromJsonString(
  Schema.Struct({ userId: Schema.String, agentId: Schema.String, until: Schema.Number }),
);

function signatureOf(key: Redacted.Redacted, purpose: PreviewTokenPurpose, claims: string) {
  return createHmac("sha256", Redacted.value(key))
    .update(`${purpose}.${claims}`)
    .digest("base64url");
}

function sameText(offered: string, held: string): boolean {
  const left = Buffer.from(offered);
  const right = Buffer.from(held);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The preview host an agent's shared port is served on. */
export function previewOrigin(sandbox: PageSandbox, agentId: string): string {
  const { protocol, host } = new URL(sandbox.origin);
  return `${protocol}//${agentId.replaceAll("-", "").toLowerCase()}.${host}`;
}

/** The agent a preview host is for, or none for any host that is not one. */
export function agentOfPreviewHost(sandbox: PageSandbox, host: string): string | undefined {
  const suffix = `.${new URL(sandbox.origin).host}`;
  const bare = host.replace(/\.$/u, "").toLowerCase();
  if (!bare.endsWith(suffix)) return undefined;
  const label = bare.slice(0, -suffix.length);
  if (!PREVIEW_LABEL.test(label)) return undefined;
  return [8, 12, 16, 20].reduceRight((id, at) => `${id.slice(0, at)}-${id.slice(at)}`, label);
}

/** A token admitting the member to the agent's preview, for its purpose's lifetime from `now`. */
function mintToken(
  sandbox: PageSandbox,
  purpose: PreviewTokenPurpose,
  lifetime: Duration.Duration,
  member: PreviewMember,
  now: number,
): string {
  const until = now + Duration.toMillis(lifetime);
  const claims = Buffer.from(Schema.encodeSync(PreviewClaimsJson)({ ...member, until })).toString(
    "base64url",
  );
  return `${claims}.${signatureOf(sandbox.key, purpose, claims)}`;
}

/** The member a token admits at `now`; none for one the key did not sign for the purpose, or one that lapsed. */
function readToken(
  sandbox: PageSandbox,
  purpose: PreviewTokenPurpose,
  token: string,
  now: number,
): PreviewMember | undefined {
  const [claims, signature, ...rest] = token.split(".");
  if (claims === undefined || signature === undefined || rest.length > 0) return undefined;
  if (!sameText(signature, signatureOf(sandbox.key, purpose, claims))) return undefined;
  const read = Schema.decodeUnknownOption(PreviewClaimsJson)(
    Buffer.from(claims, "base64url").toString("utf8"),
  );
  if (Option.isNone(read) || now >= read.value.until) return undefined;
  return { userId: read.value.userId, agentId: read.value.agentId };
}

/** The handoff token the app mints for a member it checked. */
export const mintPreviewHandoff = (sandbox: PageSandbox, member: PreviewMember, now: number) =>
  mintToken(sandbox, PREVIEW_TOKEN_PURPOSE.HANDOFF, PREVIEW_TOKEN_LIFETIME.HANDOFF, member, now);

export const readPreviewHandoff = (sandbox: PageSandbox, token: string, now: number) =>
  readToken(sandbox, PREVIEW_TOKEN_PURPOSE.HANDOFF, token, now);

/** The session cookie's value the preview host sets once a handoff is read. */
export const mintPreviewSession = (sandbox: PageSandbox, member: PreviewMember, now: number) =>
  mintToken(sandbox, PREVIEW_TOKEN_PURPOSE.SESSION, PREVIEW_TOKEN_LIFETIME.SESSION, member, now);

export const readPreviewSession = (sandbox: PageSandbox, token: string, now: number) =>
  readToken(sandbox, PREVIEW_TOKEN_PURPOSE.SESSION, token, now);

/** A path a preview may be returned to after sign-in: one of its own, never another site's; a tab or line break, which a URL parser drops, is refused too. */
export function previewReturnPath(asked: string | null): string {
  return asked !== null && /^\/(?![/\\])/u.test(asked) && !/[\t\n\r]/u.test(asked) ? asked : "/";
}
