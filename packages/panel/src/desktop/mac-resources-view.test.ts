import assert from "node:assert/strict";
import { MAC_PROCESS_KIND, type MacProcess } from "@repo/host/contract";
import { RESOURCE_SORT } from "@repo/ui";
import { test } from "vitest";
import { macResourcesView } from "./mac-resources-view.js";

const MB = 1_000_000;

/** Main with a shell and its busy command under it, a renderer beside main, and the host with its agent. */
const PROCESSES: readonly MacProcess[] = [
  {
    pid: 10,
    ppid: 1,
    command: "/Applications/Vespin.app/Contents/MacOS/Vespin",
    kind: MAC_PROCESS_KIND.MAIN,
    name: "Vespin",
    cpu: 3,
    memory: 200 * MB,
  },
  {
    pid: 11,
    ppid: 10,
    command:
      "/Applications/Vespin.app/Contents/Frameworks/Vespin Helper (Renderer).app/Contents/MacOS/Vespin Helper (Renderer)",
    kind: MAC_PROCESS_KIND.RENDERER,
    name: "Tab",
    cpu: 2,
    memory: 900 * MB,
  },
  {
    pid: 12,
    ppid: 10,
    command: "/bin/zsh",
    parent: 10,
    kind: MAC_PROCESS_KIND.CHILD,
    name: "zsh",
    cpu: 0,
    memory: 2 * MB,
  },
  {
    pid: 13,
    ppid: 12,
    command: "/usr/local/bin/node",
    parent: 12,
    kind: MAC_PROCESS_KIND.CHILD,
    name: "node",
    cpu: 90,
    memory: 40 * MB,
  },
  {
    pid: 20,
    ppid: 1,
    command: "/Users/me/.vespin/host/vespin-host",
    kind: MAC_PROCESS_KIND.HOST,
    name: "vespin-host",
    cpu: 0.5,
    memory: 150 * MB,
  },
  {
    pid: 21,
    ppid: 20,
    command: "claude",
    parent: 20,
    kind: MAC_PROCESS_KIND.CHILD,
    name: "claude",
    cpu: 140,
    memory: 500 * MB,
  },
];

test("sorts each level by the column chosen, every child kept under the process that started it", () => {
  const view = macResourcesView(PROCESSES, RESOURCE_SORT.CPU);
  assert.deepEqual(
    view.rows.map(({ name, depth }) => `${depth}:${name}`),
    ["0:Main", "1:zsh", "2:node", "0:Renderer", "0:Host", "1:claude"],
  );
  assert.equal(view.cpu, "235.5%");
  assert.equal(view.memory, "1.8 GB");
  assert.deepEqual(view.text.split("\n").slice(0, 2), [
    "CPU 235.5% Memory 1.8 GB",
    "Main 3.0% 200 MB (pid=10 ppid=1 cmd=/Applications/Vespin.app/Contents/MacOS/Vespin)",
  ]);
});
