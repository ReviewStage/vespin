// native-provider-marks.ts -- writes or checks the iOS app's integration marks, each the desktop's own vector, from `ProviderMark`.

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";
import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER_LIST,
  type IntegrationProvider,
} from "@repo/features/integration-wire";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProviderMark } from "../src/marks/provider-mark.js";

/**
 * Where the marks are written: `@repo/ui-native`'s, which the app's config
 * puts in its asset catalog (`apps/mobile/app.config.ts`'s `IMAGE_SETS`).
 */
const OUT = fileURLToPath(new URL("../../ui-native/assets/provider-marks/", import.meta.url));

/** What the desktop's stylesheet inks a mark in, light then dark, for each brand that names one ink per ground (`styles/desktop.css`). */
const NAMED_INK: Partial<Record<IntegrationProvider, readonly [string, string]>> = {
  executor: ["#000", "#fff"],
  mercury: ["#272735", "#f4f5f9"],
  neon: ["#37c38f", "#34d59a"],
  notion: ["#000", "#fff"],
  resend: ["#000", "#fff"],
  sentry: ["#181225", "#fff"],
};

/** Each mark's files by name: a mark in `currentColor` with no named ink is a template, which iOS draws in the ink of its row. */
function filesOf(provider: IntegrationProvider): ReadonlyMap<string, string> {
  const markup = renderToStaticMarkup(createElement(ProviderMark, { provider }))
    .replace(/ class="[^"]*"/g, "")
    .replace(/ (aria-hidden|focusable)="[^"]*"/g, "")
    .replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ')
    .replace(/^(<svg[^>]*>)/, `$1<title>${INTEGRATION_NAME[provider]}</title>`);

  const ink = NAMED_INK[provider];

  if (ink === undefined) return new Map([[`${provider}.svg`, `${markup}\n`]]);

  const [light, dark] = ink;

  return new Map([
    [`${provider}.svg`, `${markup.replaceAll("currentColor", light)}\n`],
    [`${provider}-dark.svg`, `${markup.replaceAll("currentColor", dark)}\n`],
  ]);
}

const wanted = new Map(INTEGRATION_PROVIDER_LIST.flatMap((provider) => [...filesOf(provider)]));

if (argv.includes("--check")) {
  const held = await readdir(OUT).catch(() => []);

  const stale = [
    ...[...wanted].map(([name, svg]) =>
      readFile(join(OUT, name), "utf8").then(
        (kept) => (kept === svg ? undefined : name),
        () => name,
      ),
    ),
    ...held.filter((name) => !wanted.has(name)).map((name) => Promise.resolve(name)),
  ];

  const drifted = (await Promise.all(stale)).filter((name) => name !== undefined);

  if (drifted.length > 0) {
    console.error(
      `error: the iOS app's integration marks no longer match @repo/ui's (${drifted.join(", ")}); run pnpm --dir packages/ui exec tsx scripts/native-provider-marks.ts`,
    );
    exit(1);
  }
} else {
  await rm(OUT, { recursive: true, force: true });

  await mkdir(OUT, { recursive: true });
  await Promise.all([...wanted].map(([name, svg]) => writeFile(join(OUT, name), svg)));
}
