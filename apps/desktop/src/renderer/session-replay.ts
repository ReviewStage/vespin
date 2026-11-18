/**
 * session-replay.ts -- the desktop panel window's answer to session replay: the masked recording `@repo/panel/session-replay` runs, filed under the release build's project and an address that names no one's disk.
 *
 * What is recorded, and what is masked, is the shared controller's
 * (`packages/panel/src/session-replay.ts`), which every shell records
 * through, so the rule is stated once. What this file decides on its own is
 * what only the desktop has: the project key a release build carries, the
 * address this window reports, and the recorder's bundle, which
 * the desktop's build emits as an entry of its own. Whether to record at all
 * is the main process's word: an ordinary packaged run records, a
 * development, fixture, or capture run does not, and a run whose account was
 * deleted stops. There is no switch — `PRIVACY.md` is where a user learns
 * this happens, so that file carries the whole of the disclosure and has to
 * keep doing it.
 */

import { PRODUCT_PLATFORM } from "@repo/features/analytics";
import { POSTHOG_PROXY } from "@repo/features/posthog-proxy";
import type { BundleImporter } from "@repo/panel/bundle-loader";
import {
  type ApplySessionReplay,
  sessionReplay,
  withoutOwnAddress,
} from "@repo/panel/session-replay";
import type { UnparsedWireValue } from "@repo/wire";

/** The logical address already used to group desktop recordings. */
const RENDERER_ADDRESS = "app://desktop/panel";

/**
 * Where macOS keeps home folders, and so where the account name sits in any
 * absolute path on this machine. A path under it is the thing this whole
 * parser exists to stop, whatever produced it.
 */
const ACCOUNTS_DIRECTORY = "/Users/";

/** Local file addresses in event data can still name the developer. */
function namesThisMachine(value: string): boolean {
  return value.startsWith("file://") || value.startsWith(ACCOUNTS_DIRECTORY);
}

/** The address scrub this window records under, by itself, for what reads it without a recording. */
const ADDRESS = { address: RENDERER_ADDRESS, namesOwnAddress: namesThisMachine } as const;

/** Takes this machine's path out of anything on its way to the processor, wherever it sits. */
export function withoutLocalAddress(value: UnparsedWireValue): UnparsedWireValue {
  return withoutOwnAddress(value, ADDRESS);
}

/**
 * The project the recording is filed under, fixed at build time, and baked
 * only into a Developer ID release build (`scripts/package-config.mjs`'s
 * `replayProjectKeyDefine`). A build without one records nothing — the same
 * kill switch the site's own counting has, so a local run or an unconfigured
 * build measures nothing rather than measuring into production's project.
 */
declare const PACKAGED_POSTHOG_PROJECT_API_KEY: string | undefined;

function projectApiKey(): string {
  try {
    // SAFETY: esbuild replaces this free identifier when it bundles the
    // renderer; a run that never went through the bundler has no such global,
    // and reading one throws rather than answering undefined.
    return PACKAGED_POSTHOG_PROJECT_API_KEY ?? "";
  } catch {
    return "";
  }
}

/** The recorder's bundle, imported where the bundler put it; it registers itself as it runs. */
const importSessionRecorder: BundleImporter<unknown> = () => import("./session-recorder/index");

/**
 * Where the recording posts: PostHog's own hosts, which the window's connect
 * policy names (`index.html`), rather than the web's path on its own origin,
 * because the desktop's protocol serves only bundled assets.
 */
const POSTHOG_HOST = { api: POSTHOG_PROXY.INGEST_ORIGIN, ui: POSTHOG_PROXY.UI_ORIGIN } as const;

/** The panel window's recording, which `desktop-platform.ts` answers the panel's platform with. */
export const applySessionReplay: ApplySessionReplay = sessionReplay({
  platform: PRODUCT_PLATFORM.DESKTOP,
  projectApiKey,
  host: POSTHOG_HOST,
  ...ADDRESS,
  importRecorder: importSessionRecorder,
});
