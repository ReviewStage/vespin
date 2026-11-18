import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { ConfigProvider, Effect } from "effect";
import { HttpRouter } from "effect/http";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  ANDROID_APP_ENVIRONMENT,
  ANDROID_ASSET_LINKS,
  androidAssetLinksApp,
} from "./android-asset-links.js";

/**
 * The asset links, answered by their group the way a function answers them,
 * as Android reads them: JSON naming the app's package and every
 * certificate fingerprint the deployment configures, spelled as Google's
 * format spells one, and not found where the deployment names none.
 * Synthetic fingerprints throughout.
 */

const ORIGIN = "https://app.test";

/** The upload key's fingerprint as `keytool` prints it, and Play's as 64 bare hex digits in lower case. */
const UPLOAD =
  "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5";

const PLAY_BARE = "fa".repeat(32);
const PLAY = Array.from({ length: 32 }, () => "FA").join(":");

/** The document as the deployment's variables name it. */
const answered = Effect.fn(function* (variables: Record<string, string>) {
  const web = HttpRouter.toWebHandler(
    androidAssetLinksApp().pipe(
      HttpRouter.provideRequest(ConfigProvider.layer(ConfigProvider.fromUnknown(variables))),
    ),
    { disableLogger: true },
  );

  yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));

  return yield* Effect.promise(() =>
    web.handler(new Request(`${ORIGIN}${ANDROID_ASSET_LINKS.ROUTE}`)),
  );
});

it.effect(
  "the document names the app's own package and each configured certificate, as JSON for its links and its credentials",
  () =>
    Effect.gen(function* () {
      const own = yield* answered({
        [ANDROID_APP_ENVIRONMENT.CERT_FINGERPRINTS]: `${UPLOAD}, ${PLAY_BARE}\n${UPLOAD}`,
      });

      assert.equal(own.status, HOSTED_HTTP_STATUS.OK);
      assert.equal(own.headers.get("content-type"), "application/json");
      assert.deepEqual(yield* Effect.promise(() => own.json()), [
        {
          relation: [
            "delegate_permission/common.handle_all_urls",
            "delegate_permission/common.get_login_creds",
          ],
          target: {
            namespace: "android_app",
            package_name: "dev.vespin.android",
            sha256_cert_fingerprints: [UPLOAD, PLAY],
          },
        },
      ]);

      const named = yield* answered({
        [ANDROID_APP_ENVIRONMENT.CERT_FINGERPRINTS]: UPLOAD,
        [ANDROID_APP_ENVIRONMENT.PACKAGE_NAME]: "dev.vespin.android.beta",
      });

      const [statement] = yield* Effect.promise(() => named.json());
      assert.equal(statement.target.package_name, "dev.vespin.android.beta");
    }),
);

it.effect(
  "a deployment naming no fingerprint, or only words that are none, answers not found, so Android reads no association",
  () =>
    Effect.gen(function* () {
      for (const variables of [
        {},
        { [ANDROID_APP_ENVIRONMENT.CERT_FINGERPRINTS]: "  " },
        { [ANDROID_APP_ENVIRONMENT.CERT_FINGERPRINTS]: "not-a-fingerprint AB:CD" },
      ]) {
        assert.equal((yield* answered(variables)).status, HOSTED_HTTP_STATUS.NOT_FOUND);
      }
    }),
);
