/**
 * web-terminal-socket.ts -- an agent shell's relay socket opened from this page: the seam the host's terminal concern attaches a shell through, on the page's own origin, under the session cookie the browser carries.
 *
 * The relay admits a page of the deployment's own origin by its cookie and
 * the `Origin` the browser names (`@repo/service`'s `http/relay-upgrade.ts`),
 * so the page opens the socket itself, as a plain same-origin `WebSocket`,
 * and sets no header: a page can set none on a socket, and the tab's
 * account is the cookie, which asks for none (`relay-credential.ts`). What
 * follows the open is the host's own (`@repo/host/effect`'s
 * `openTerminalSocketOver`), which the Expo app's socket shares.
 */

import { openTerminalSocketOver } from "@repo/host/effect";

export const openTerminalSocketFromPage = openTerminalSocketOver((url) => new WebSocket(url));
