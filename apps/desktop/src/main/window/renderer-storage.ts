// renderer-storage.ts -- carry the previous desktop origin's local storage into the new one.

import { pathToFileURL } from "node:url";
import { COMPOSER_DRAFTS_KEY, mergeStoredComposerDrafts } from "@repo/panel/composer-draft-storage";
import { Schema } from "effect";
import type { WebContents } from "electron";
import { PANEL_RENDERER_URL } from "./renderer-protocol";

type StoragePage = Pick<WebContents, "loadURL" | "executeJavaScriptInIsolatedWorld">;

const MIGRATED = JSON.stringify("app.desktopRendererStorageMigrated");
const STORAGE_WORLD = 999;

const decodeCurrentDrafts = Schema.decodeUnknownSync(
  Schema.Union([Schema.Literal(true), Schema.NullOr(Schema.String)]),
);

const decodeEntries = Schema.decodeUnknownSync(
  Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
);

/** Run before the first panel loads, using a sandboxed page with scripts and preloads disabled. */
export async function migrateRendererStorage(
  page: StoragePage,
  legacyPanelPath: string,
): Promise<void> {
  await page.loadURL(PANEL_RENDERER_URL);

  const current: unknown = await page.executeJavaScriptInIsolatedWorld(STORAGE_WORLD, [
    {
      code: `localStorage.getItem(${MIGRATED}) === "1" ||
        localStorage.getItem(${JSON.stringify(COMPOSER_DRAFTS_KEY)})`,
    },
  ]);

  const currentDrafts = decodeCurrentDrafts(current);

  if (currentDrafts === true) return;

  await page.loadURL(pathToFileURL(legacyPanelPath).href);

  const snapshot: unknown = await page.executeJavaScriptInIsolatedWorld(STORAGE_WORLD, [
    {
      code: `Array.from({ length: localStorage.length }, (_, index) => {
        const key = localStorage.key(index);
        return [key, localStorage.getItem(key)];
      })`,
    },
  ]);

  const entries = decodeEntries(snapshot);
  const legacyDrafts = entries.find(([key]) => key === COMPOSER_DRAFTS_KEY)?.[1];

  const merged =
    currentDrafts !== null && legacyDrafts !== undefined
      ? mergeStoredComposerDrafts(legacyDrafts, currentDrafts)
      : undefined;

  await page.loadURL(PANEL_RENDERER_URL);

  await page.executeJavaScriptInIsolatedWorld(STORAGE_WORLD, [
    {
      code: `{
        for (const [key, value] of ${JSON.stringify(entries)}) {
          if (key !== ${MIGRATED} && localStorage.getItem(key) === null) {
            localStorage.setItem(key, value);
          }
        }
        ${
          merged === undefined || merged === currentDrafts
            ? ""
            : `localStorage.setItem(${JSON.stringify(COMPOSER_DRAFTS_KEY)}, ${JSON.stringify(merged)});`
        }
        localStorage.setItem(${MIGRATED}, "1");
      }`,
    },
  ]);
}
