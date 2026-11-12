/**
 * preview-links.ts -- a shared port's members-only link: the preview host each agent's port is served on, under the page sandbox's own domain, and the signed tokens that admit a signed-in member to it.
 *
 * A port an agent shares is never handed out at its sandbox's own public
 * route. Its link is a host of its own under the page sandbox's domain, named
 * by the agent's task as a link to it names it and the head of the agent's
 * own id (`<workspace slug>-<task number>-<6 hex>.vespin.page`), a site apart
 * from the app's, so nothing the agent's app runs reaches the app's cookies.
 * The host names the agent only to a member who reaches its task
 * (`task-number-store.ts`'s `agentIdOfTaskNumber`), so it is read again for
 * the member each token admits. Where that name would not fit in one DNS
 * label, as a long slug's would not, the host is the agent's id without its
 * dashes instead, which every link shared before the task's name was used
 * also is. That host answers
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
  /** The preview host's own path the waking page asks whether the preview is ready. */
  STATUS_PATH: "/__vespin/status",
  QUERY: { PREVIEW: "preview", RETURN: "return", TOKEN: "token" },
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

/** How many of an agent's id's hex digits its preview host ends with, enough to tell apart the agents on one task. */
const AGENT_HEAD_DIGITS = 6;

/** The most characters one DNS label holds. */
const MAX_LABEL_CHARS = 63;

/** A preview host's label by its task: a workspace's slug, its task's number, and the head of the agent's id. */
const TASK_LABEL = /^([a-z0-9]+(?:-[a-z0-9]+)*)-([1-9][0-9]*)-([0-9a-f]{6})$/u;

/** A preview host's label by its agent alone: the agent's id, its dashes dropped. */
const AGENT_LABEL = /^[0-9a-f]{32}$/u;

/** How a preview host names its agent. */
export const PREVIEW_NAME_KIND = { TASK: "task", AGENT: "agent" } as const;

/** What a preview host names: the agent's task, by its workspace's slug and its number, and the head of the agent's id; or, where that is too long for a label, the agent's id. */
export type PreviewName =
  | {
      readonly kind: typeof PREVIEW_NAME_KIND.TASK;
      readonly slug: string;
      readonly number: number;
      readonly agentHead: string;
    }
  | { readonly kind: typeof PREVIEW_NAME_KIND.AGENT; readonly agentId: string };

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

/** A preview host's label for its name. */
export function previewLabel(name: PreviewName): string {
  return name.kind === PREVIEW_NAME_KIND.TASK
    ? `${name.slug}-${name.number}-${name.agentHead}`.toLowerCase()
    : name.agentId.replaceAll("-", "").toLowerCase();
}

/** The name of an agent's preview: by its task's workspace slug and number where that fits in a label, by the agent's id otherwise. */
export function previewNameOf(slug: string, number: number, agentId: string): PreviewName {
  const byTask: PreviewName = {
    kind: PREVIEW_NAME_KIND.TASK,
    slug,
    number,
    agentHead: agentId.slice(0, AGENT_HEAD_DIGITS),
  };

  const fits = previewLabel(byTask).length <= MAX_LABEL_CHARS;

  return fits ? byTask : { kind: PREVIEW_NAME_KIND.AGENT, agentId };
}

/** The name a preview host's label spells, or none for a label that spells none. */
export function previewNameOfLabel(label: string): PreviewName | undefined {
  const bare = label.toLowerCase();

  if (AGENT_LABEL.test(bare)) {
    const agentId = [8, 12, 16, 20].reduceRight(
      (id, at) => `${id.slice(0, at)}-${id.slice(at)}`,
      bare,
    );

    return { kind: PREVIEW_NAME_KIND.AGENT, agentId };
  }

  const match = bare.length <= MAX_LABEL_CHARS ? TASK_LABEL.exec(bare) : null;

  if (match === null) return undefined;
  const [, slug, number, agentHead] = match;

  if (slug === undefined || number === undefined || agentHead === undefined) return undefined;

  return { kind: PREVIEW_NAME_KIND.TASK, slug, number: Number(number), agentHead };
}

/** The preview host an agent's shared port is served on. */
export function previewOrigin(sandbox: PageSandbox, name: PreviewName): string {
  const { protocol, host } = new URL(sandbox.origin);

  return `${protocol}//${previewLabel(name)}.${host}`;
}

/** The preview a host names, or none for any host that is not a preview host. */
export function previewNameOfHost(sandbox: PageSandbox, host: string): PreviewName | undefined {
  const suffix = `.${new URL(sandbox.origin).host}`;
  const bare = host.replace(/\.$/u, "").toLowerCase();

  if (!bare.endsWith(suffix)) return undefined;

  return previewNameOfLabel(bare.slice(0, -suffix.length));
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
