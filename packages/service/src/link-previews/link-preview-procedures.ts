/**
 * link-preview-procedures.ts -- a web page's preview for the card a plain link hangs, as the hosted oRPC router answers it.
 *
 * `GET /api/link-previews?url=` answers, to any signed-in account, what the
 * page at the address says of itself (`link-preview-read.ts`), or why it
 * has no preview, inside the answer. The read is the service's own, from
 * its network, so the member's machine contacts no third party; what the
 * service may reach is held by `link-address.ts` before any byte is sent.
 * An address inside a network is refused as the socket is made
 * (`node-link-reach.ts`), so a name cannot point the fetch elsewhere.
 * An answer is kept for a while per address, a few minutes where the page
 * answered and a moment where it did not, so a link many members hover
 * is read once, and the reads under way at once are bounded per instance,
 * a read waiting its turn past the bound answered as unread rather than
 * held. A member is braked per instance to so many asks a minute
 * (`http/rate-brake.ts`), refused as quota exhausted past it, so one
 * account cannot fill the instance's reads with addresses of its own.
 * Nothing of the address or the page is logged: an address may carry a
 * token, and the page is a third party's.
 */

import { LINK_PREVIEW_REFUSAL, type LinkPreviewAnswer } from "@repo/features/link-preview-wire";
import { Cache, Duration, Effect, Exit, Option, Semaphore } from "effect";
import { HOSTED_REFUSAL, type UserIdResolver } from "../http/http-effect.js";
import { createRateBrake } from "../http/rate-brake.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { webPageAddressOf } from "./link-address.js";
import { type HopTransport, readLinkPreview } from "./link-preview-read.js";

export interface LinkPreviewsProcedureSeams {
  resolveUserId: UserIdResolver;
  /** How the reads reach the web: the transport that refuses an address inside a network as the socket is made. */
  linkReach: HopTransport;
}

/** How previews are kept on one instance. */
const PREVIEWS_KEPT = {
  /** The most addresses whose previews one instance keeps. */
  CAPACITY: 128,
  /** How long a preview the page answered is kept. */
  ANSWERED: Duration.minutes(10),
  /** How long a refusal or an unread page is kept, so a hover repeated at once asks nothing again. */
  UNANSWERED: Duration.minutes(1),
  /** The most pages one instance reads at once. */
  CONCURRENT_READS: 8,
  /** The longest an ask waits for its read, the wait for a turn included: inside the window's own deadline on the call, so a queue never answers after the window gave up. */
  ASK_DEADLINE: Duration.seconds(9),
} as const;

/** How many previews one member may ask of an instance in a minute: a page of links hovered through, not a crawl. */
const ASK_BRAKE = {
  windowMs: Duration.toMillis(Duration.minutes(1)),
  maxRequestsPerWindow: 60,
  maxTrackedUsers: 10_000,
} as const;

/** The previews one instance keeps, by the page's address without its fragment. */
type LinkPreviewCache = Cache.Cache<string, LinkPreviewAnswer>;

/** How long an answer is kept: longer where the page answered. */
function previewKept(exit: Exit.Exit<LinkPreviewAnswer>): Duration.Duration {
  return Exit.isSuccess(exit) && "preview" in exit.value
    ? PREVIEWS_KEPT.ANSWERED
    : PREVIEWS_KEPT.UNANSWERED;
}

/**
 * The instance's one cache of previews, made on the first ask and kept for
 * the instance's life, as the published cache is
 * (`agents/coder-host/published.ts`), since the procedures are built with
 * no Effect to build one in.
 */
function instanceLinkPreviewCache(connect: HopTransport): Effect.Effect<LinkPreviewCache> {
  const reads = Semaphore.makeUnsafe(PREVIEWS_KEPT.CONCURRENT_READS);

  const made = Cache.makeWith(
    (address: string): Effect.Effect<LinkPreviewAnswer> =>
      Effect.map(
        Effect.timeoutOption(
          reads.withPermits(1)(readLinkPreview(address, connect)),
          PREVIEWS_KEPT.ASK_DEADLINE,
        ),
        Option.getOrElse((): LinkPreviewAnswer => ({ refused: LINK_PREVIEW_REFUSAL.UNREAD })),
      ),
    {
      capacity: PREVIEWS_KEPT.CAPACITY,
      timeToLive: previewKept,
    },
  );

  let kept: LinkPreviewCache | undefined;

  return Effect.suspend(() =>
    kept === undefined ? Effect.map(made, (cache) => (kept ??= cache)) : Effect.succeed(kept),
  );
}

/** The link previews resource: one page's preview, read for a signed-in account. */
export function linkPreviewsProcedures(seams: LinkPreviewsProcedureSeams) {
  const previews = instanceLinkPreviewCache(seams.linkReach);
  const brake = createRateBrake(ASK_BRAKE);
  const signedIn = hosted.linkPreviews.use(accountMiddleware(seams.resolveUserId));

  return {
    read: signedIn.read.effect(function* ({ input, context }) {
      if (!(yield* brake.check(context.userId))) {
        return yield* Effect.fail(HOSTED_REFUSAL.QUOTA_EXHAUSTED);
      }

      const url = webPageAddressOf(input.url);

      if (url === undefined) return { refused: LINK_PREVIEW_REFUSAL.ADDRESS };
      // Note that the fragment never reaches the server, so two links to one page differing in it share one read.
      url.hash = "";
      const cache = yield* previews;
      const answer = yield* Cache.get(cache, url.href);

      return "preview" in answer ? { preview: { ...answer.preview, url: input.url } } : answer;
    }),
  };
}
