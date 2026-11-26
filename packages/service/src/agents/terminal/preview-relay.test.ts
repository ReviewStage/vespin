/** preview-relay.test.ts -- broken HTTP streams close both sides of the sandbox's relay. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { createServer, get, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { temporaryDirectory } from "@repo/runtime/testing";
import { expect, it, type TestContext, vi } from "vitest";
import { relayPortOf, restoringRelay } from "./preview-relay.js";

async function streamingRelay(t: TestContext) {
  const directory = await temporaryDirectory(t, "preview-relay-");
  const started = Promise.withResolvers<ServerResponse>();

  const server = createServer((req, res) => {
    if (req.url !== "/stream") return void res.end("ready");
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("first chunk");
    started.resolve(res);
  });

  t.onTestFinished(() => {
    server.closeAllConnections();
    server.close();
  });
  let port: number;

  // Note that the relay listens 32,768 above the port, so this range keeps it over
  // Linux's ephemeral ports (32768-60999), where another test's connection may hold it.
  for (;;) {
    port = randomInt(28_232, 32_768);
    server.listen(port, "127.0.0.1");

    try {
      await once(server, "listening");
      break;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EADDRINUSE")
        throw error;
    }
  }

  const record = join(directory, "preview.json");
  await writeFile(record, JSON.stringify({ port }));
  const command = restoringRelay();

  const child = spawn(process.execPath, [...command.args.slice(0, -1), record], {
    stdio: ["ignore", "ignore", "inherit"],
  });

  t.onTestFinished(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill();
    await exited;
  });
  const url = `http://127.0.0.1:${relayPortOf(port)}`;
  await vi.waitFor(
    () =>
      new Promise<void>((resolve, reject) => {
        get(url, (res) => {
          res.resume();
          res.on("end", resolve);
        }).on("error", reject);
      }),
    { interval: 10 },
  );

  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    get(`${url}/stream`, resolve).on("error", reject);
  });

  response.on("error", () => {});
  t.onTestFinished(() => void response.destroy());
  response.resume();

  return { response, upstream: await started.promise, child };
}

it("an upstream reset closes the client's unfinished response without crashing the relay", async (t) => {
  const { response, upstream, child } = await streamingRelay(t);
  upstream.destroy();

  await expect.poll(() => response.destroyed, { timeout: 500, interval: 10 }).toBe(true);
  assert.equal(response.complete, false);
  assert.equal(child.exitCode, null);
});

it("a client disconnect closes the unfinished upstream response without crashing the relay", async (t) => {
  const { response, upstream, child } = await streamingRelay(t);
  response.destroy();

  await expect.poll(() => upstream.destroyed, { timeout: 500, interval: 10 }).toBe(true);
  assert.equal(child.exitCode, null);
});
