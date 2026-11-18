// renderer-storage.ts -- carry the previous desktop origin's local storage into the new one.

import { pathToFileURL } from "node:url";
import type { WebContents } from "electron";
import { PANEL_RENDERER_URL } from "./renderer-protocol";

type StoragePage = Pick<WebContents, "loadURL" | "executeJavaScriptInIsolatedWorld">;

const MIGRATED = JSON.stringify("app.desktopRendererStorageMigrated");
const STORAGE_WORLD = 999;

/** Run before the first panel loads, using a sandboxed page with scripts and preloads disabled. */
export async function migrateRendererStorage(
  page: StoragePage,
  legacyPanelPath: string,
): Promise<void> {
  await page.loadURL(PANEL_RENDERER_URL);

  const migrated: unknown = await page.executeJavaScriptInIsolatedWorld(STORAGE_WORLD, [
    { code: `localStorage.getItem(${MIGRATED}) === "1"` },
  ]);

  if (migrated === true) return;

  await page.loadURL(pathToFileURL(legacyPanelPath).href);

  const entries: unknown = await page.executeJavaScriptInIsolatedWorld(STORAGE_WORLD, [
    {
      code: `Array.from({ length: localStorage.length }, (_, index) => {
        const key = localStorage.key(index);
        return [key, localStorage.getItem(key)];
      })`,
    },
  ]);

  await page.loadURL(PANEL_RENDERER_URL);
  await page.executeJavaScriptInIsolatedWorld(STORAGE_WORLD, [
    {
      code: `{
        for (const [key, value] of ${JSON.stringify(entries)}) {
          if (key !== ${MIGRATED} && localStorage.getItem(key) === null) {
            localStorage.setItem(key, value);
          }
        }
        localStorage.setItem(${MIGRATED}, "1");
      }`,
    },
  ]);
}
