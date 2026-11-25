// desktop-sign-in.e2e.ts -- the packaged desktop app, launched on a fresh profile against the suite's local server, signs a fresh member in and shows their task.

import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron, type ElectronApplication, type Page } from "@playwright/test";
import { expect, test } from "../../support/signed-in.js";

/** The task seeded for the member, which the window's task list shows once the app is signed in. */
const TASK_NAME = "Check the desktop signs in";

test.use({ memberAsk: { setupFinished: true, taskName: TASK_NAME } });

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

/**
 * The app's authorize address as a browser already signed in follows it: the
 * same authorization with its `prompt=login` left out. Note that the app
 * always asks the login page again, and the local server's login page signs
 * in the demo's own member whatever session stands, so a journey that left
 * it in would hand the app that member's session rather than its own
 * member's; the member's session is already the context's (`signedIn`),
 * so authorize goes straight on to the app's loopback as it would for anyone
 * signed in on the web.
 */
function withoutLoginPrompt(authorize: string): string {
  const url = new URL(authorize);
  url.searchParams.delete("prompt");

  return url.toString();
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

/** Playwright also reports the hidden storage migration view as a window. */
async function firstBrowserWindow(app: ElectronApplication): Promise<Page | undefined> {
  for (const page of app.windows()) {
    try {
      const window = await app.browserWindow(page);

      try {
        if (await window.evaluate((value) => value !== null)) return page;
      } finally {
        await window.dispose();
      }
    } catch (error) {
      if (!page.isClosed()) throw error;
    }
  }

  return undefined;
}

/**
 * The desktop's sign-in end to end, over the suite's server, as the test's
 * own fresh member past setup with one task: the journey's browser is signed
 * in as them (`signedIn`), the app's authorize goes on to its loopback
 * (`withoutLoginPrompt`), then on through the hand-off that gives the app its
 * session, and the window lists the member's task. The browser half runs in
 * the journey's page, held to loopback like every other, and the app itself
 * stands behind `refusingProxy`, so neither reaches past this machine.
 */
test("the packaged app signs in on a fresh profile and shows the task list", async ({
  page,
  baseURL,
  signedIn,
}) => {
  // Note that the first page load waits on the app's own launch and the local server's first answers, which run well past the default on a CI Mac.
  test.setTimeout(180_000);
  const executablePath = process.env.APP_E2E_DESKTOP_EXECUTABLE;

  if (executablePath === undefined || baseURL === undefined) {
    throw new Error("The desktop project runs only with APP_E2E_DESKTOP_EXECUTABLE and a baseURL");
  }

  const stateRoot = await mkdtemp(path.join(tmpdir(), "vespin-e2e-desktop-"));
  let proxy: RefusingProxy | undefined;
  let app: ElectronApplication | undefined;

  // Note that everything the journey opens is given back in `finally`, a launch that throws included, so no proxy keeps the worker alive and no profile outlives the run.
  try {
    proxy = await refusingProxy();

    app = await _electron.launch({
      executablePath,
      args: [`--proxy-server=${proxy.address}`],
      env: {
        ...process.env,
        APP_ACCOUNT_BASE_URL: `${baseURL}/api/auth`,
        APP_STATE_ROOT: stateRoot,
      },
    });

    await holdOpens(app);
    let window: Page | undefined;
    await expect
      .poll(
        async () => {
          window = await firstBrowserWindow(app);

          return window !== undefined;
        },
        { timeout: 60_000 },
      )
      .toBe(true);

    if (window === undefined) throw new Error("The app did not open a browser window");

    const signIn = window.getByRole("region", { name: /^Sign in to / });
    await signIn.getByRole("button", { name: "Continue with GitHub" }).click();
    await page.goto(withoutLoginPrompt(await firstOpened(app)));

    await expect(signIn).toBeHidden({ timeout: 60_000 });
    expect(signedIn.taskId).toBeDefined();
    await expect(window.getByText(TASK_NAME).first()).toBeVisible();
  } finally {
    await app?.close();
    await proxy?.close();
    await rm(stateRoot, { recursive: true, force: true });
  }

  expect(proxy.refused, "The app reached off this machine's loopback").toEqual([]);
});
