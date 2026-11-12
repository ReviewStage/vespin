/**
 * sealed-page.ts -- a page an agent showed, as a client that draws it in a web view of its own wears it: sealed off from every network and every frame, in the client's theme.
 *
 * The desktop and the web frame a page under their own policy
 * (`page-policy.ts`), served from a sandbox's own origin. The iPhone has no
 * origin to serve it from, so it hands its web view the page's HTML whole,
 * and the policy rides in the page itself, ahead of the agent's markup:
 * nothing may be fetched, posted, framed, or loaded but what the page holds
 * inline, cdnjs's libraries included, so a page that reaches for one draws
 * without it. The theme is handed the way a frame is told it
 * (`page-theme.ts`), the theme's own script listening and the client's
 * theme posted to it at once, so a page reads the same `--app-*` variables
 * on every client.
 */

import { doctypeEnd } from "./page-find.js";
import { PAGE_THEME_SCRIPT, type PageTheme, pageThemeMessage } from "./page-theme.js";

/** The content security policy a sealed page wears: its own inline scripts, styles, and data, and nothing from anywhere. */
const SEALED_PAGE_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "worker-src blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/**
 * The viewport a page is laid out in where it names none: the device's
 * width, as a frame on the Mac lays every page out at its own. Note that it
 * stands ahead of the page's markup, so a viewport the page names itself is
 * read after it and wins.
 */
const DEVICE_VIEWPORT = `<meta name="viewport" content="width=device-width, initial-scale=1">`;

/** A value as JSON a script element may hold, its `<` written as an escape so no `</script>` in it ends the element. */
function scriptJson(value: ReturnType<typeof pageThemeMessage>): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

/**
 * A page's HTML as a sealed web view is handed it: the policy and the
 * device's viewport, then the theme's script and the theme posted to it, ahead of the agent's markup,
 * after its doctype, so a page keeps the standards mode its doctype asks
 * for and markup it leaves open cannot swallow them.
 */
export function sealedPageDocument(html: string, theme: PageTheme): string {
  const end = doctypeEnd(html);
  const policy = `<meta http-equiv="Content-Security-Policy" content="${SEALED_PAGE_CONTENT_SECURITY_POLICY}">${DEVICE_VIEWPORT}`;
  const scripts = `<script>${PAGE_THEME_SCRIPT}</script><script>postMessage(${scriptJson(pageThemeMessage(theme))}, "*");</script>`;

  return `${html.slice(0, end)}${policy}${scripts}${html.slice(end)}`;
}
