// desktop-sign-in.e2e.ts -- the packaged desktop app, launched on a fresh profile against the suite's local server, signs in and shows the task list.

import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron, type ElectronApplication } from "@playwright/test";
import { expect, test } from "../../support/test.js";

/** A proxy on loopback that refuses every request handed to it, and the addresses it refused. */
interface RefusingProxy {
  readonly address: string;
  readonly refused: ReadonlyArray<string>;
  readonly close: () => Promise<void>;
}

/**
 * The app's own hold to loopback: a proxy it is launched behind
 * (`--proxy-server`, a Chromium switch, which the main process's `net`, the
 * updater's included, and every renderer follow from the first request),
 * which answers every request 403 and keeps its address. Loopback bypasses a
 * proxy by Chromium's own rule, so the suite's server is reached directly
 * and only an address off this machine lands here. Note that it is a proxy
 * rather than a hook through `electronApp.evaluate`, because the update
 * check starts as the app composes, before a hook could stand.
 */
async function refusingProxy(): Promise<RefusingProxy> {
  const refused: Array<string> = [];

  const server = createServer((request, response) => {
    refused.push(request.url ?? "");
    response.writeHead(403).end();
  });

  server.on("connect", (request, socket) => {
    refused.push(`https://${request.url ?? ""}`);
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  });

  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  // SAFETY: a server listening on a TCP port answers its address as an `AddressInfo`.
  const { port } = server.address() as AddressInfo;

  return {
    address: `127.0.0.1:${port}`,
    refused,
    close: () => new Promise((closed) => server.close(() => closed())),
  };
}

/** Where the stub the journey puts in the app's main process keeps the addresses it was asked to open. */
interface OpenedAddresses {
  e2eOpened?: Array<string>;
}

/**
 * Puts a stub in the app's main process in place of `shell.openExternal`,
 * which every open the app makes goes through (`src/main/main.ts`), so the
 * sign-in's trip through the browser lands in the journey's own page rather
 * than in the Mac's default browser.
 */
async function holdOpens(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const opened: Array<string> = [];
    // SAFETY: the main process's global holds no `e2eOpened` but the one this stub writes.
    (globalThis as OpenedAddresses).e2eOpened = opened;
    shell.openExternal = async (url) => {
      opened.push(url);
    };
  });
}

/** The first address the app asked to open, once it has asked. */
async function firstOpened(app: ElectronApplication): Promise<string> {
  let first: string | undefined;

  await expect
    .poll(async () => {
      // SAFETY: `holdOpens` wrote `e2eOpened` as an array of the addresses asked for, or nothing yet stands there.
      first = await app.evaluate(() => (globalThis as OpenedAddresses).e2eOpened?.[0]);

      return first;
    })
    .toBeDefined();

  // SAFETY: the poll above passes only once `first` holds an address.
  return first as string;
}

/**
 * The desktop's sign-in end to end, over the suite's server: the app's
 * authorize goes to the local server's login page (`apps/web/server/local-sign-in.ts`),
 * which signs the journey's browser in as the demo seed's member and goes
 * back through authorize to the app's loopback, then on through the hand-off
 * that gives the app its session. The browser half runs in the journey's
 * page, held to loopback like every other, and the app itself stands behind
 * `refusingProxy`, so neither reaches past this machine. Note that it signs in as the
 * demo's Dean, the one member `/sign-in` answers for today; it takes the
 * per-test `member` once the sign-in can be handed one.
 */
test("the packaged app signs in on a fresh profile and shows the task list", async ({
  page,
  baseURL,
}) => {
  // Note that the first page load waits on the app's own launch and the local server's first answers, which run well past the default on a CI Mac.
  test.setTimeout(180_000);
  const executablePath = process.env.APP_E2E_DESKTOP_EXECUTABLE;

  if (executablePath === undefined || baseURL === undefined) {
    throw new Error("The desktop project runs only with APP_E2E_DESKTOP_EXECUTABLE and a baseURL");
  }

  const stateRoot = await mkdtemp(path.join(tmpdir(), "vespin-e2e-desktop-"));
  const proxy = await refusingProxy();

  const app = await _electron.launch({
    executablePath,
    args: [`--proxy-server=${proxy.address}`],
    env: {
      ...process.env,
      APP_ACCOUNT_BASE_URL: `${baseURL}/api/auth`,
      APP_STATE_ROOT: stateRoot,
    },
  });

  try {
    await holdOpens(app);
    const window = await app.firstWindow();
    const signIn = window.getByRole("region", { name: /^Sign in to / });
    await signIn.getByRole("button", { name: "Continue with GitHub" }).click();
    await page.goto(await firstOpened(app));

    await expect(signIn).toBeHidden({ timeout: 60_000 });
    await expect(window.getByRole("navigation", { name: /tasks/i })).toBeVisible();
  } finally {
    await app.close();
    await proxy.close();
  }

  expect(proxy.refused, "The app reached off this machine's loopback").toEqual([]);
});
