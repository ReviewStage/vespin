// test.ts -- the suite's `test`: Playwright's, with a browser that may reach only this machine's loopback.

import { test as base, expect } from "@playwright/test";
import { isLocalAddress } from "./local-origin.js";

/**
 * Every journey's browser context refuses a request or WebSocket to any
 * address off this machine's loopback, so a page that would reach the
 * network fails its journey rather than passing on a live answer. The
 * refused call is aborted, as a blocked request, and once the journey ends
 * the test fails naming each address it tried, even where the page carried
 * on. It is an automatic fixture on the context, so every page and popup
 * of the journey stands under it.
 */
export const test = base.extend<{ noNetwork: undefined }>({
  noNetwork: [
    async ({ context }, use) => {
      const refused: Array<string> = [];
      const offLoopback = (url: URL): boolean => !isLocalAddress(url);
      await context.route(offLoopback, async (route) => {
        refused.push(route.request().url());
        await route.abort("blockedbyclient");
      });
      await context.routeWebSocket(offLoopback, async (socket) => {
        refused.push(socket.url());
        await socket.close();
      });
      await use(undefined);
      expect(refused, "The journey's browser reached off this machine's loopback").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
