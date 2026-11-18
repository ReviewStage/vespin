// renderer-protocol.test.ts -- the renderer can read bundled assets but not their neighbors.

import { mkdir, mkdtempDisposable, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  CALL_RENDERER_URL,
  PANEL_RENDERER_URL,
  RENDERER_SCHEME_PRIVILEGES,
  rendererResponse,
} from "./renderer-protocol";

const ORIGIN = "app-renderer://desktop";

function get(url: string, directory: string): Promise<Response> {
  return rendererResponse({ method: "GET", url }, directory, async (fileUrl) => {
    const text = await readFile(fileURLToPath(fileUrl), "utf8");

    return new Response(text);
  });
}

test("serves an encoded bundled asset with a query string", async () => {
  await using directory = await mkdtempDisposable(path.join(tmpdir(), "vespin-renderer-"));
  await mkdir(path.join(directory.path, "chunks"));
  await writeFile(path.join(directory.path, "chunks", "panel #1.js"), "export const ready = true;");

  const response = await get(`${ORIGIN}/chunks/panel%20%231.js?v=1`, directory.path);

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("export const ready = true;");
});

test("serves the call window on a separate zoom host from the panel", async () => {
  await using directory = await mkdtempDisposable(path.join(tmpdir(), "vespin-renderer-"));
  await writeFile(path.join(directory.path, "call.html"), "<title>Call</title>");

  const response = await get(CALL_RENDERER_URL, directory.path);

  expect(new URL(CALL_RENDERER_URL).hostname).not.toBe(new URL(PANEL_RENDERER_URL).hostname);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("<title>Call</title>");
});

test("serves streaming media without requiring a content length", async () => {
  await using directory = await mkdtempDisposable(path.join(tmpdir(), "vespin-renderer-"));
  const clip = Uint8Array.of(1, 2, 3);
  await writeFile(path.join(directory.path, "sample.m4a"), clip);

  const fileResponse = new Response(new Blob([clip], { type: "audio/x-m4a" }).stream(), {
    headers: { "Content-Type": "audio/x-m4a" },
  });

  const response = await rendererResponse(
    { method: "GET", url: `${ORIGIN}/sample.m4a` },
    directory.path,
    async () => fileResponse,
  );

  expect(RENDERER_SCHEME_PRIVILEGES.privileges?.stream).toBe(true);
  expect(response.headers.get("content-length")).toBeNull();
  expect(response.headers.get("content-type")).toBe("audio/x-m4a");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(clip);
});

test.each(["/../outside.txt", "/%2e%2e%2foutside.txt", "//outside.txt"])(
  "refuses a non-relative asset path: %s",
  async (pathname) => {
    await using directory = await mkdtempDisposable(path.join(tmpdir(), "vespin-renderer-"));

    const response = await get(`${ORIGIN}${pathname}`, directory.path);

    expect(response.status).toBe(403);
  },
);

test("refuses a bundled symlink pointing outside the renderer directory", async () => {
  await using directory = await mkdtempDisposable(path.join(tmpdir(), "vespin-renderer-"));
  const renderer = path.join(directory.path, "renderer");
  const sibling = path.join(directory.path, "renderer-other");
  await mkdir(renderer);
  await mkdir(sibling);
  await writeFile(path.join(sibling, "outside.txt"), "not bundled");
  await symlink(path.join(sibling, "outside.txt"), path.join(renderer, "linked.txt"));

  const response = await get(`${ORIGIN}/linked.txt`, renderer);

  expect(response.status).toBe(403);
});
