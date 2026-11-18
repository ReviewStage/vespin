// renderer-protocol.ts -- serve the desktop's bundled renderer assets on dedicated origins.

import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { CustomScheme } from "electron";

export const RENDERER_SCHEME = "app-renderer";
const PANEL_PREFIX = `${RENDERER_SCHEME}://desktop/`;
const CALL_PREFIX = `${RENDERER_SCHEME}://call/`;

export const PANEL_RENDERER_URL = `${PANEL_PREFIX}index.html`;
export const CALL_RENDERER_URL = `${CALL_PREFIX}call.html`;

export const RENDERER_SCHEME_PRIVILEGES: CustomScheme = {
  scheme: RENDERER_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
};

function assetPath(url: string): string | undefined {
  const prefix = [PANEL_PREFIX, CALL_PREFIX].find((prefix) => url.startsWith(prefix));

  if (prefix === undefined) return undefined;

  try {
    // Read the raw path before a URL parser can normalize dot segments.
    const name = decodeURIComponent(url.slice(prefix.length).split(/[?#]/, 1)[0] ?? "");

    if (
      !name ||
      name.includes("\0") ||
      name.includes("\\") ||
      path.win32.isAbsolute(name) ||
      name.split("/").includes("..")
    )
      return undefined;

    return name;
  } catch {
    return undefined;
  }
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);

  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export async function rendererResponse(
  request: Pick<Request, "method" | "url">,
  rendererDirectory: string,
  fetchFile: (url: string) => Promise<Response>,
): Promise<Response> {
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: { Allow: "GET" } });
  }

  const asset = assetPath(request.url);

  if (asset === undefined) return new Response(null, { status: 403 });

  try {
    const root = await realpath(rendererDirectory);
    const candidate = path.resolve(root, asset);

    if (!inside(root, candidate)) return new Response(null, { status: 403 });

    const file = await realpath(candidate);

    if (!inside(root, file)) return new Response(null, { status: 403 });

    return await fetchFile(pathToFileURL(file).href);
  } catch {
    return new Response(null, { status: 404 });
  }
}
