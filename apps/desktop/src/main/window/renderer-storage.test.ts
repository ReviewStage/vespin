// renderer-storage.test.ts -- a desktop upgrade keeps unsent drafts without restoring deleted values later.

import path from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { expect, test, vi } from "vitest";
import { migrateRendererStorage } from "./renderer-storage";

const LEGACY_PATH = path.resolve("fixture", "renderer", "index.html");
const LEGACY_URL = pathToFileURL(LEGACY_PATH).href;
const PANEL_URL = "app-renderer://desktop/index.html";
const DRAFTS = "app.composerDrafts";
const WIDTH = "app.sidebar-width";

function storagePage(legacy: Map<string, string>, current: Map<string, string>) {
  const origins = new Map([
    [LEGACY_URL, legacy],
    [PANEL_URL, current],
  ]);

  let documentStorage: Map<string, string> | undefined;

  return {
    async loadURL(url: string): Promise<void> {
      documentStorage = origins.get(url);
    },
    async executeJavaScriptInIsolatedWorld(_world: number, scripts: { code: string }[]) {
      const entries = documentStorage;

      if (entries === undefined) throw new Error("No loaded storage origin");

      return runInNewContext(scripts.map(({ code }) => code).join("\n"), {
        localStorage: {
          length: entries.size,
          key: (index: number) => [...entries.keys()][index] ?? null,
          getItem: (key: string) => entries.get(key) ?? null,
          setItem: (key: string, value: string) => entries.set(key, value),
        },
      });
    },
  };
}

test("copies the old draft, but keeps a value already saved at the new origin", async () => {
  const draft = '[{"text":"Draft with quotes, \\"<test>\\" and a newline\\n"}]';

  const legacy = new Map([
    [DRAFTS, draft],
    [WIDTH, "200"],
  ]);

  const current = new Map([[WIDTH, "400"]]);

  await migrateRendererStorage(storagePage(legacy, current), LEGACY_PATH);
  expect(current.get(DRAFTS)).toBe(draft);
  expect(current.get(WIDTH)).toBe("400");
  expect(legacy.get(DRAFTS)).toBe(draft);
});

test("does not resurrect a migrated draft deleted before the next launch", async () => {
  const legacy = new Map([[DRAFTS, "Unsent draft"]]);
  const current = new Map<string, string>();

  await migrateRendererStorage(storagePage(legacy, current), LEGACY_PATH);
  current.delete(DRAFTS);
  await migrateRendererStorage(storagePage(legacy, current), LEGACY_PATH);

  expect(current.has(DRAFTS)).toBe(false);
});

test("keeps both sets of drafts when the user writes a draft before migration retries", async () => {
  const inbox = { kind: "inbox", taskId: null, agentId: "agent", itemId: "item" };
  const oldDraft = { accountId: "one", place: { ...inbox, revision: 1 }, text: "Old inbox reply" };
  const otherAccount = { accountId: "two", place: inbox, text: "Other account's reply" };
  const currentDraft = { accountId: "one", place: inbox, text: "Current inbox reply", revision: 2 };

  const newDraft = {
    accountId: "one",
    place: { kind: "newTask", workspaceId: null },
    text: "New task",
  };

  const legacy = new Map([[DRAFTS, JSON.stringify([oldDraft, otherAccount])]]);
  const current = new Map<string, string>();
  const page = storagePage(legacy, current);

  vi.spyOn(page, "loadURL").mockRejectedValueOnce(new Error("Could not load the renderer"));

  await expect(migrateRendererStorage(page, LEGACY_PATH)).rejects.toThrow(
    "Could not load the renderer",
  );
  current.set(DRAFTS, JSON.stringify([currentDraft, newDraft]));

  await migrateRendererStorage(page, LEGACY_PATH);

  expect(JSON.parse(current.get(DRAFTS) ?? "null")).toEqual([otherAccount, currentDraft, newDraft]);
});
