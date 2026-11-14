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
 * writes into its asset catalog under `IntegrationMarks/`
 * (`apps/mobile/app.config.ts`'s `INTEGRATION_MARKS`).
 */
const OUT = fileURLToPath(new URL("../../ui-native/assets/provider-marks/", import.meta.url));

/** The desktop's stylesheet, which inks each mark a brand names one ink per ground for. */
const DESKTOP_CSS = fileURLToPath(new URL("../../panel/src/styles/desktop.css", import.meta.url));

/** A named ink as the desktop's stylesheet declares it: `--integration-ink-<provider>: light-dark(<light>, <dark>);`. */
const NAMED_INK_RULE =
  /--integration-ink-([a-z-]+):\s*light-dark\(\s*([^,\s]+)\s*,\s*([^)\s]+)\s*\)/gu;

/** The light and dark ink of each provider the desktop inks by its ground, read from its stylesheet, so the phone's marks follow it. */
async function namedInks(): Promise<ReadonlyMap<IntegrationProvider, readonly [string, string]>> {
  const css = await readFile(DESKTOP_CSS, "utf8");
  const inks = new Map<IntegrationProvider, readonly [string, string]>();

  for (const [, provider, light, dark] of css.matchAll(NAMED_INK_RULE)) {
    const named = INTEGRATION_PROVIDER_LIST.find((each) => each === provider);

    if (named !== undefined && light !== undefined && dark !== undefined)
      inks.set(named, [light, dark]);
  }

  return inks;
}

/** Words set into the markup as text, their markup characters escaped. */
function escapedText(words: string): string {
  return words.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Each mark's files by name: a mark in `currentColor` with no named ink is a template, which iOS draws in the ink of its row. */
function filesOf(
  provider: IntegrationProvider,
  inks: ReadonlyMap<IntegrationProvider, readonly [string, string]>,
): ReadonlyMap<string, string> {
  const markup = renderToStaticMarkup(createElement(ProviderMark, { provider }))
    .replace(/ class="[^"]*"/g, "")
    .replace(/ (aria-hidden|focusable)="[^"]*"/g, "")
    .replace(/^<svg (?![^>]*xmlns=)/u, '<svg xmlns="http://www.w3.org/2000/svg" ')
    .replace(/^(<svg[^>]*>)/u, `$1<title>${escapedText(INTEGRATION_NAME[provider])}</title>`);

  const ink = inks.get(provider);

  if (ink === undefined) return new Map([[`${provider}.svg`, `${markup}\n`]]);

  const [light, dark] = ink;

  return new Map([
    [`${provider}.svg`, `${markup.replaceAll("currentColor", light)}\n`],
    [`${provider}-dark.svg`, `${markup.replaceAll("currentColor", dark)}\n`],
  ]);
}

const inks = await namedInks();

const wanted = new Map(
  INTEGRATION_PROVIDER_LIST.flatMap((provider) => [...filesOf(provider, inks)]),
);

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
