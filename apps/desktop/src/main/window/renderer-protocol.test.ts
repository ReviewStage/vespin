// renderer-protocol.test.ts -- the renderer can read bundled assets but not their neighbors.

import { mkdir, mkdtempDisposable, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { rendererResponse } from "./renderer-protocol";

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
