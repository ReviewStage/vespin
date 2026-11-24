// native-manager-faces.ts -- writes or checks the iOS app's Manager faces, each character at rest and at work, from the desktop's own `ManagerFace`.

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";
import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_COLOR,
  type ManagerFaceCharacter,
} from "@repo/features/manager-face";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MANAGER_FACE_SIZE, ManagerFace } from "../src/components/manager-face/manager-face.js";

/**
 * Where the faces are written: `@repo/ui-native`'s, which the app's config
 * fills with each color and writes into its asset catalog under
 * `ManagerFaces/` (`apps/mobile/app.config.ts`'s `MANAGER_FACES`).
 */
const OUT = fileURLToPath(new URL("../../ui-native/assets/manager-faces/", import.meta.url));

/** What a face's file says of whether its Manager works, the word its name ends with, as `@repo/ui-native`'s `MANAGER_FACE_STATE` reads it. */
const STATE = { REST: "rest", WORKING: "working" } as const;

/** What a face's file is called inside it, as a provider's mark names its brand; the app hears the name beside it, never this. */
const TITLE = "A Manager's face";

/** The side a face's vector stands at on its own, a sidebar row's 20 pt, which every place that draws it scales. */
const SIDE = 20;

/**
 * The face's own SVG, its body in `currentColor` for the app's config to
 * fill, from the markup `ManagerFace` draws: its seat's box and the working
 * mark's disc left out, since iOS draws its own. Note that the mood's
 * `<use>`s are written out as the paths they name and its mask left out,
 * because iOS's vector images draw neither: the mask Kawaii writes names no
 * mask (its `url(` is never closed), so a browser draws the tongue unmasked
 * too, and the face is drawn here as the desktop shows it.
 */
function faceSvg(character: ManagerFaceCharacter, working: boolean): string {
  const markup = renderToStaticMarkup(
    createElement(ManagerFace, {
      face: { character, color: MANAGER_FACE_COLOR.YELLOW },
      size: MANAGER_FACE_SIZE.ROW,
      working,
    }),
  );

  const svg = /<svg[\s\S]*?<\/svg>/u.exec(markup)?.[0];

  if (svg === undefined) throw new Error(`native-manager-faces: "${character}" drew no SVG`);

  const defined = new Map(
    [...svg.matchAll(/<path d="([^"]*)" id="([^"]*)"><\/path>/gu)].map(([, d, id]) => [id, d]),
  );

  const written = svg
    .replace(/<mask\b[^>]*>[\s\S]*?<\/mask>/gu, "")
    .replace(/ mask="[^"]*"/gu, "")
    .replace(/<use\b([^>]*?) xlink:href="#([^"]*)"([^>]*)><\/use>/gu, (_, before, id, after) => {
      const d = defined.get(id);

      if (d === undefined) throw new Error(`native-manager-faces: "${character}" uses no "${id}"`);

      return `<path${before}${after} d="${d}"></path>`;
    })
    .replace(/<defs>[\s\S]*?<\/defs>/gu, "")
    .replace(/ (class|focusable|id)="[^"]*"/gu, "")
    .replace(/ width="100%" height="100%"/u, ` width="${SIDE}" height="${SIDE}"`)
    .replace(/\s*\n\s*/gu, " ")
    .replace(/^(<svg[^>]*>)/u, `$1<title>${TITLE}</title>`);

  return `${written}\n`;
}

/** Every face's file by its name: each character at rest and at work. */
const wanted = new Map(
  Object.values(MANAGER_FACE_CHARACTER).flatMap((character) => [
    [`${character}-${STATE.REST}.svg`, faceSvg(character, false)],
    [`${character}-${STATE.WORKING}.svg`, faceSvg(character, true)],
  ]),
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
      `error: the iOS app's Manager faces no longer match @repo/ui's (${drifted.join(", ")}); run pnpm --dir packages/ui exec tsx scripts/native-manager-faces.ts`,
    );
    exit(1);
  }
} else {
  await rm(OUT, { recursive: true, force: true });

  await mkdir(OUT, { recursive: true });
  await Promise.all([...wanted].map(([name, svg]) => writeFile(join(OUT, name), svg)));
}
