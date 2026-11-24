import assert from "node:assert/strict";
import { test } from "vitest";
import {
  PRODUCT_EVENT,
  PRODUCT_EVENT_PROPERTY,
  PRODUCT_EXPERIMENT,
  PRODUCT_EXPERIMENT_SCOPE,
  PRODUCT_OPEN_ORDER,
  PRODUCT_PAGE_VERSION,
  PRODUCT_PICTURE_BYTES,
  PRODUCT_PICTURE_FROM,
  PRODUCT_PICTURE_KIND,
  PRODUCT_REPLY_KIND,
  PRODUCT_SETTING_VALUE,
  PRODUCT_SURFACE,
  productDrawnMilliseconds,
  productEventBuildFromWire,
  productEventFromWire,
  productLaunchSeconds,
  productOpenMilliseconds,
} from "./product-events.js";

const AT = Date.parse("2026-08-19T12:00:00.000Z");

test("prose cannot pass as a property value", () => {
  const prose = "codex — /Users/me/luke on feature/x";
  assert.equal(
    productEventFromWire({
      name: PRODUCT_EVENT.SEARCH_OPEN,
      at: AT,
      properties: { [PRODUCT_EVENT_PROPERTY.SEARCH_SURFACE]: prose },
    }),
    undefined,
  );
  // A version reader is not a string reader: a path is not `x.y.z`.
  assert.equal(
    productEventFromWire({
      name: PRODUCT_EVENT.APP_LAUNCH,
      at: AT,
      properties: { [PRODUCT_EVENT_PROPERTY.APP_VERSION]: "/Users/me/luke" },
    }),
    undefined,
  );
});

test("a deployment's commit names a build as a release version does, and a shorter hash does not", () => {
  const commit = "f580775ef9ece91b7ebc8ebac5430cc01d3699f5";

  assert.deepEqual(
    productEventFromWire({
      name: PRODUCT_EVENT.APP_LAUNCH,
      at: AT,
      properties: { [PRODUCT_EVENT_PROPERTY.APP_VERSION]: commit },
    }),
    {
      name: PRODUCT_EVENT.APP_LAUNCH,
      at: AT,
      properties: { [PRODUCT_EVENT_PROPERTY.APP_VERSION]: commit },
    },
  );
  assert.deepEqual(
    productEventBuildFromWire({ events: [], build: { app_version: commit, packaged: true } }),
    { app_version: commit, packaged: true },
  );
  assert.equal(
    productEventFromWire({
      name: PRODUCT_EVENT.APP_LAUNCH,
      at: AT,
      properties: { [PRODUCT_EVENT_PROPERTY.APP_VERSION]: commit.slice(0, 7) },
    }),
    undefined,
  );
});

test("nothing on the envelope survives except what the allowlist names", () => {
  const event = productEventFromWire({
    name: PRODUCT_EVENT.APP_LAUNCH,
    at: AT,
    distinct_id: "someone-else",
    $ip: "203.0.113.7",
    email: "someone@example.test",
    properties: {
      [PRODUCT_EVENT_PROPERTY.APP_VERSION]: "0.2.0",
      distinct_id: "someone-else",
      $set: { email: "someone@example.test" },
      $ip: "203.0.113.7",
    },
  });

  assert.deepEqual(event, {
    name: PRODUCT_EVENT.APP_LAUNCH,
    at: AT,
    properties: { [PRODUCT_EVENT_PROPERTY.APP_VERSION]: "0.2.0" },
  });
});

test("an experiment's switch is counted by its key, on or off, and whose choice it was, an older build's as the account's, and by nothing it does not list", () => {
  const toggled = {
    [PRODUCT_EVENT_PROPERTY.EXPERIMENT]: PRODUCT_EXPERIMENT.BROWSER,
    [PRODUCT_EVENT_PROPERTY.SETTING_VALUE]: PRODUCT_SETTING_VALUE.ON,
  };

  const workspace = {
    ...toggled,
    [PRODUCT_EVENT_PROPERTY.EXPERIMENT_SCOPE]: PRODUCT_EXPERIMENT_SCOPE.WORKSPACE,
  };

  assert.deepEqual(
    productEventFromWire({ name: PRODUCT_EVENT.EXPERIMENT_TOGGLE, at: AT, properties: workspace }),
    { name: PRODUCT_EVENT.EXPERIMENT_TOGGLE, at: AT, properties: workspace },
  );
  assert.deepEqual(
    productEventFromWire({ name: PRODUCT_EVENT.EXPERIMENT_TOGGLE, at: AT, properties: toggled }),
    {
      name: PRODUCT_EVENT.EXPERIMENT_TOGGLE,
      at: AT,
      properties: {
        ...toggled,
        [PRODUCT_EVENT_PROPERTY.EXPERIMENT_SCOPE]: PRODUCT_EXPERIMENT_SCOPE.ACCOUNT,
      },
    },
  );
  assert.equal(
    productEventFromWire({
      name: PRODUCT_EVENT.EXPERIMENT_TOGGLE,
      at: AT,
      properties: { ...toggled, [PRODUCT_EVENT_PROPERTY.EXPERIMENT]: "a feature nobody listed" },
    }),
    undefined,
  );
});

test("a mirror's failure travels its wait on a rung, never as the raw time", () => {
  const failed = {
    [PRODUCT_EVENT_PROPERTY.MIRROR_STEP]: "worktree",
    [PRODUCT_EVENT_PROPERTY.MIRROR_FAILURE]: "exited",
    [PRODUCT_EVENT_PROPERTY.ATTEMPT]: 2,
    [PRODUCT_EVENT_PROPERTY.ELAPSED_SECONDS]: 120,
  };

  assert.deepEqual(
    productEventFromWire({ name: PRODUCT_EVENT.MIRROR_FAIL, at: AT, properties: failed }),
    { name: PRODUCT_EVENT.MIRROR_FAIL, at: AT, properties: failed },
  );
  assert.equal(
    productEventFromWire({
      name: PRODUCT_EVENT.MIRROR_FAIL,
      at: AT,
      properties: { ...failed, [PRODUCT_EVENT_PROPERTY.ELAPSED_SECONDS]: 137 },
    }),
    undefined,
  );
});

test("a launch travels its time to the first rows on a rung, never as the raw time, and nothing else", () => {
  assert.equal(productLaunchSeconds(6_400), 5);
  assert.equal(productLaunchSeconds(700), 0.6);
  assert.equal(productLaunchSeconds(150), 0);
  assert.deepEqual(
    productEventFromWire({
      name: PRODUCT_EVENT.APP_READY,
      at: AT,
      properties: { [PRODUCT_EVENT_PROPERTY.LAUNCH_SECONDS]: 5, rows: 639 },
    }),
    {
      name: PRODUCT_EVENT.APP_READY,
      at: AT,
      properties: { [PRODUCT_EVENT_PROPERTY.LAUNCH_SECONDS]: 5 },
    },
  );
  assert.equal(
    productEventFromWire({
      name: PRODUCT_EVENT.APP_READY,
      at: AT,
      properties: { [PRODUCT_EVENT_PROPERTY.LAUNCH_SECONDS]: 6.4 },
    }),
    undefined,
  );
});

test("a launch may add when its bundle evaluated, its account was read, its local copy opened, its host was composed and stood, its screens first drew, its Inbox was first grouped and how many documents it took, which rows it first showed, its build number and what it waited from, each read strictly", () => {
  const phases = {
    [PRODUCT_EVENT_PROPERTY.LAUNCH_SECONDS]: 8,
    [PRODUCT_EVENT_PROPERTY.STANDING_SECONDS]: 5,
    [PRODUCT_EVENT_PROPERTY.EVALUATED_SECONDS]: 0,
    [PRODUCT_EVENT_PROPERTY.ACCOUNT_SECONDS]: 1,
    [PRODUCT_EVENT_PROPERTY.LOCAL_SECONDS]: 2,
    [PRODUCT_EVENT_PROPERTY.STARTED_SECONDS]: 3,
    [PRODUCT_EVENT_PROPERTY.INBOX_SECONDS]: 5,
    [PRODUCT_EVENT_PROPERTY.SCREENS_SECONDS]: 0.4,
    [PRODUCT_EVENT_PROPERTY.DELIVERIES]: 5,
    [PRODUCT_EVENT_PROPERTY.APP_BUILD]: "52",
    [PRODUCT_EVENT_PROPERTY.FIRST_ROWS]: "feed",
    [PRODUCT_EVENT_PROPERTY.READY_AFTER]: "sign_in",
  };

  assert.deepEqual(
    productEventFromWire({ name: PRODUCT_EVENT.APP_READY, at: AT, properties: phases }),
    { name: PRODUCT_EVENT.APP_READY, at: AT, properties: phases },
  );
  // A count of documents travels on a rung alone, so a raw count refuses the event rather than travel.
  assert.equal(
    productEventFromWire({
      name: PRODUCT_EVENT.APP_READY,
      at: AT,
      properties: { ...phases, [PRODUCT_EVENT_PROPERTY.DELIVERIES]: 7 },
    }),
    undefined,
  );
  // A build number is digits alone, so a word sent in its place refuses the event rather than travel.
  assert.equal(
    productEventFromWire({
      name: PRODUCT_EVENT.APP_READY,
      at: AT,
      properties: { ...phases, [PRODUCT_EVENT_PROPERTY.APP_BUILD]: "52 beta" },
    }),
    undefined,
  );
});

test("a reply's wait to stand in its thread travels on a rung, with what it carried, never its words or the raw time", () => {
  assert.equal(productDrawnMilliseconds(640), 500);
  assert.equal(productDrawnMilliseconds(40), 0);
  assert.deepEqual(
    productEventFromWire({
      name: PRODUCT_EVENT.REPLY_DRAWN,
      at: AT,
      properties: {
        [PRODUCT_EVENT_PROPERTY.DRAWN_MS]: 500,
        [PRODUCT_EVENT_PROPERTY.REPLY_KIND]: PRODUCT_REPLY_KIND.PICTURES,
        words: "Here's the screenshot",
      },
    }),
    {
      name: PRODUCT_EVENT.REPLY_DRAWN,
      at: AT,
      properties: {
        [PRODUCT_EVENT_PROPERTY.DRAWN_MS]: 500,
        [PRODUCT_EVENT_PROPERTY.REPLY_KIND]: PRODUCT_REPLY_KIND.PICTURES,
      },
    },
  );
  assert.equal(
    productEventFromWire({
      name: PRODUCT_EVENT.REPLY_DRAWN,
      at: AT,
      properties: {
        [PRODUCT_EVENT_PROPERTY.DRAWN_MS]: 640,
        [PRODUCT_EVENT_PROPERTY.REPLY_KIND]: PRODUCT_REPLY_KIND.WORDS,
      },
    }),
    undefined,
  );
});

test("a page's open travels its waits on rungs with its kind and order, never which page or the raw time", () => {
  // Note that an instant open, one that drags, and a first open that stalls each land on rungs of their own.
  assert.equal(productOpenMilliseconds(340), 300);
  assert.equal(productOpenMilliseconds(830), 800);
  assert.equal(productOpenMilliseconds(1832), 1750);
  assert.equal(productOpenMilliseconds(40), 0);
  assert.equal(productOpenMilliseconds(9000), 5000);
  assert.deepEqual(
    productEventFromWire({
      name: PRODUCT_EVENT.OPEN_DRAWN,
      at: AT,
      properties: {
        [PRODUCT_EVENT_PROPERTY.SURFACE]: PRODUCT_SURFACE.THREAD,
        [PRODUCT_EVENT_PROPERTY.START_MS]: 800,
        [PRODUCT_EVENT_PROPERTY.STAND_MS]: 1250,
        [PRODUCT_EVENT_PROPERTY.OPEN_ORDER]: PRODUCT_OPEN_ORDER.FIRST,
        [PRODUCT_EVENT_PROPERTY.APP_BUILD]: "76",
        threadId: "4b1c6f0e-2f0a-4c1e-9d1a-0c2b9e1f7a3d",
      },
    }),
    {
      name: PRODUCT_EVENT.OPEN_DRAWN,
      at: AT,
      properties: {
        [PRODUCT_EVENT_PROPERTY.SURFACE]: PRODUCT_SURFACE.THREAD,
        [PRODUCT_EVENT_PROPERTY.START_MS]: 800,
        [PRODUCT_EVENT_PROPERTY.STAND_MS]: 1250,
        [PRODUCT_EVENT_PROPERTY.OPEN_ORDER]: PRODUCT_OPEN_ORDER.FIRST,
        [PRODUCT_EVENT_PROPERTY.APP_BUILD]: "76",
      },
    },
  );
  assert.equal(
    productEventFromWire({
      name: PRODUCT_EVENT.OPEN_DRAWN,
      at: AT,
      properties: {
        [PRODUCT_EVENT_PROPERTY.SURFACE]: PRODUCT_SURFACE.TASK,
        [PRODUCT_EVENT_PROPERTY.START_MS]: 212,
        [PRODUCT_EVENT_PROPERTY.STAND_MS]: 800,
        [PRODUCT_EVENT_PROPERTY.OPEN_ORDER]: PRODUCT_OPEN_ORDER.LATER,
      },
    }),
    undefined,
  );
  // A page an agent showed travels its read and its draw on the same rungs, with where its version came from, never which page.
  assert.deepEqual(
    productEventFromWire({
      name: PRODUCT_EVENT.PAGE_SHOWN,
      at: AT,
      properties: {
        [PRODUCT_EVENT_PROPERTY.READ_MS]: 300,
        [PRODUCT_EVENT_PROPERTY.SHOWN_MS]: 1750,
        [PRODUCT_EVENT_PROPERTY.PAGE_VERSION]: PRODUCT_PAGE_VERSION.NEWEST,
        [PRODUCT_EVENT_PROPERTY.OPEN_ORDER]: PRODUCT_OPEN_ORDER.FIRST,
        pageId: "4b1c6f0e-2f0a-4c1e-9d1a-0c2b9e1f7a3d",
      },
    }),
    {
      name: PRODUCT_EVENT.PAGE_SHOWN,
      at: AT,
      properties: {
        [PRODUCT_EVENT_PROPERTY.READ_MS]: 300,
        [PRODUCT_EVENT_PROPERTY.SHOWN_MS]: 1750,
        [PRODUCT_EVENT_PROPERTY.PAGE_VERSION]: PRODUCT_PAGE_VERSION.NEWEST,
        [PRODUCT_EVENT_PROPERTY.OPEN_ORDER]: PRODUCT_OPEN_ORDER.FIRST,
      },
    },
  );
  // A picture drawn travels its wait on the same rungs, where it came from, its kind, and its size on a rung, never which picture.
  assert.deepEqual(
    productEventFromWire({
      name: PRODUCT_EVENT.PICTURE_SHOWN,
      at: AT,
      properties: {
        [PRODUCT_EVENT_PROPERTY.READ_MS]: 900,
        [PRODUCT_EVENT_PROPERTY.PICTURE_FROM]: PRODUCT_PICTURE_FROM.READ,
        [PRODUCT_EVENT_PROPERTY.PICTURE_KIND]: PRODUCT_PICTURE_KIND.AGENT,
        [PRODUCT_EVENT_PROPERTY.PICTURE_BYTES]: PRODUCT_PICTURE_BYTES.UNDER_3M,
        pictureId: "9a0d2c1e-6f3b-4e8a-b2d4-1c7e5f9a3b6d",
      },
    }),
    {
      name: PRODUCT_EVENT.PICTURE_SHOWN,
      at: AT,
      properties: {
        [PRODUCT_EVENT_PROPERTY.READ_MS]: 900,
        [PRODUCT_EVENT_PROPERTY.PICTURE_FROM]: PRODUCT_PICTURE_FROM.READ,
        [PRODUCT_EVENT_PROPERTY.PICTURE_KIND]: PRODUCT_PICTURE_KIND.AGENT,
        [PRODUCT_EVENT_PROPERTY.PICTURE_BYTES]: PRODUCT_PICTURE_BYTES.UNDER_3M,
      },
    },
  );
});

test("a batch's build is read as strictly as an event's, and is never a reason to refuse the batch", () => {
  // A field the build does not name is not copied forward.
  assert.deepEqual(
    productEventBuildFromWire({
      events: [],
      build: { app_version: "0.18.0", packaged: true, email: "me@app.test" },
    }),
    { app_version: "0.18.0", packaged: true },
  );
  // A version that is not `x.y.z` or a flag that is not a boolean leaves the
  // whole build off rather than forwarding it.
  assert.deepEqual(
    productEventBuildFromWire({
      events: [],
      build: { app_version: "/Users/me/luke", packaged: true },
    }),
    {},
  );
  assert.deepEqual(
    productEventBuildFromWire({ events: [], build: { app_version: "0.18.0", packaged: "yes" } }),
    {},
  );
  // Builds 0.7 to 0.17 send no build at all.
  assert.deepEqual(productEventBuildFromWire({ events: [] }), {});
});
