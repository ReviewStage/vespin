import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { IOS_APP_LINK_COMPONENTS } from "@repo/features/ios-app-links";
import { ConfigProvider, Effect, Schema } from "effect";
import { HttpRouter } from "effect/http";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  APPLE_APP_ENVIRONMENT,
  APPLE_APP_SITE_ASSOCIATION,
  appleAppSiteAssociationApp,
  IOS_BUNDLE_ID_DEFAULT,
} from "./apple-app-site-association.js";

/**
 * The association document, answered by its group the way a function answers
 * it, as Apple reads it: JSON naming the app the deployment configures, by
 * its Team ID and bundle ID, for the sign-in's one path, and not found where
 * the deployment names no Team ID. Synthetic ids throughout.
 */

const ORIGIN = "https://app.test";
const TEAM_ID = "ABCDE12345";

const decodeDocument = Schema.decodeUnknownSync(
  Schema.Struct({
    applinks: Schema.Struct({
      details: Schema.Array(
        Schema.Struct({
          appIDs: Schema.Array(Schema.String),
          components: Schema.Array(Schema.Struct({ "/": Schema.String })),
        }),
      ),
    }),
    webcredentials: Schema.Struct({ apps: Schema.Array(Schema.String) }),
  }),
);

/** The document as the deployment's variables name it. */
const answered = Effect.fn(function* (variables: Record<string, string>) {
  const web = HttpRouter.toWebHandler(
    appleAppSiteAssociationApp().pipe(
      HttpRouter.provideRequest(ConfigProvider.layer(ConfigProvider.fromUnknown(variables))),
    ),
    { disableLogger: true },
  );
  yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
  return yield* Effect.promise(() =>
    web.handler(new Request(`${ORIGIN}${APPLE_APP_SITE_ASSOCIATION.ROUTE}`)),
  );
});

it.effect(
  "the document names the configured app, under the app's own bundle id unless the deployment names another, as JSON for the paths the app opens",
  () =>
    Effect.gen(function* () {
      const own = yield* answered({ [APPLE_APP_ENVIRONMENT.TEAM_ID]: TEAM_ID });
      assert.equal(own.status, HOSTED_HTTP_STATUS.OK);
      assert.equal(own.headers.get("content-type"), "application/json");
      const document = decodeDocument(yield* Effect.promise(() => own.json()));
      const appId = `${TEAM_ID}.${IOS_BUNDLE_ID_DEFAULT}`;
      assert.deepEqual(document, {
        applinks: {
          details: [
            {
              appIDs: [appId],
              components: IOS_APP_LINK_COMPONENTS.map((component) => ({ "/": component["/"] })),
            },
          ],
        },
        webcredentials: { apps: [appId] },
      });

      const named = yield* answered({
        [APPLE_APP_ENVIRONMENT.TEAM_ID]: TEAM_ID,
        [APPLE_APP_ENVIRONMENT.IOS_BUNDLE_ID]: "dev.vespin.ios.beta",
      });
      const renamed = decodeDocument(yield* Effect.promise(() => named.json()));
      assert.deepEqual(renamed.webcredentials.apps, [`${TEAM_ID}.dev.vespin.ios.beta`]);
    }),
);

it.effect("a deployment naming no Team ID answers not found, so Apple reads no association", () =>
  Effect.gen(function* () {
    const unset = yield* answered({});
    assert.equal(unset.status, HOSTED_HTTP_STATUS.NOT_FOUND);
    const blank = yield* answered({ [APPLE_APP_ENVIRONMENT.TEAM_ID]: "  " });
    assert.equal(blank.status, HOSTED_HTTP_STATUS.NOT_FOUND);
  }),
);
