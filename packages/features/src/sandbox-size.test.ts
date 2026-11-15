import assert from "node:assert/strict";
import { test } from "vitest";
import { sandboxVcpus } from "./sandbox-size.js";

test("a workspace's sandbox opens at the size it chose, held under the most it may have", () => {
  assert.equal(sandboxVcpus({ vcpus: 4, maxVcpus: 8 }), 4);
  assert.equal(sandboxVcpus({ vcpus: 8, maxVcpus: 4 }), 4);
});
