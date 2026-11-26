import type { LandingTone } from "@repo/features/landing-outcome";
import { LOOPBACK_PAGE_ART } from "./generated/loopback-page-art.js";

/**
 * The page the browser is left on after the OAuth redirect lands on the
 * loopback. It is the last thing the sign-in shows, so it is the very page
 * the site's sign-in and connect landings are: `@repo/ui`'s `AuthPage`, the
 * provider's mark (or the app's) in a ring badged with how it ended, a title,
 * and a line saying where things stand, under vespin.dev's favicon.
 *
 * Self-contained on purpose: the ephemeral 127.0.0.1 server serves exactly
 * one document, so nothing here may fetch a font, a script, or an image from
 * anywhere. The page's markup, its sheet, its face, and its favicon are
 * rendered from `@repo/ui` ahead of time into `generated/loopback-page-art.ts`
 * (`packages/ui/scripts/loopback-page.ts`), and this module only sets the
 * words into it.
 *
 * Every string on the page is fixed by the build. Nothing the redirect
 * carried — code, state, error — is ever interpolated into the document.
 */

export const LOOPBACK_CONNECTION_SOURCE = {
  GOOGLE: "google",
  GITHUB: "github",
} as const;

export type LoopbackConnectionSource =
  (typeof LOOPBACK_CONNECTION_SOURCE)[keyof typeof LOOPBACK_CONNECTION_SOURCE];

interface LoopbackPage {
  tone: LandingTone;
  title: string;
  body: string;
  source?: LoopbackConnectionSource | undefined;
}

/** Words set into the document as text, their markup characters escaped. */
function escapedText(words: string): string {
  return words
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** The rendered page for `source`'s mark and `tone`, the app's own mark where no source is named. */
function markup(source: LoopbackConnectionSource | undefined, tone: LandingTone): string {
  return (
    source === undefined ? LOOPBACK_PAGE_ART.MARKUP.vespin : LOOPBACK_PAGE_ART.MARKUP[source]
  )[tone];
}

export function accountLoopbackPage(page: LoopbackPage): string {
  const title = escapedText(page.title);

  const body = markup(page.source, page.tone)
    .replace(LOOPBACK_PAGE_ART.SLOT.TITLE, () => title)
    .replace(LOOPBACK_PAGE_ART.SLOT.DESCRIPTION, () => escapedText(page.body));

  // Note that the root wears the site's web profile and dark theme, as its
  // sign-in and connect pages do, so the tokens resolve to the same values.
  return (
    `<!doctype html><html lang="en" data-ui-profile="web" data-ui-theme="dark"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="color-scheme" content="dark">` +
    `<link rel="icon" href="${LOOPBACK_PAGE_ART.FAVICON}" type="image/svg+xml">` +
    `<title>${title}</title><style>${LOOPBACK_PAGE_ART.STYLE}</style></head>` +
    `<body>${body}</body></html>`
  );
}
