import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { MAC_PROCESS_KIND } from "./contract/index.js";
import { appProcesses, readProcessTable } from "./mac-resources.js";

const MAIN = 500;
const HOST = 700;

/** A process table as `ps` prints it: launchd, the app's main and its helpers, a shell main opened, the host and its agent, and a process of nobody's. */
const TABLE = [
  "    1     0   0.0   9216 /sbin/launchd",
  "  500     1   3.2 189952 /Applications/Vespin.app/Contents/MacOS/Vespin",
  "  501   500   2.3 1025945 /Applications/Vespin.app/Contents/Frameworks/Vespin Helper (Renderer).app/Contents/MacOS/Vespin Helper (Renderer)",
  "  502   500   0.0   2048 /bin/zsh",
  "  503   502  12.5  40960 /usr/local/bin/node",
  "  600     1  99.0  51200 /Applications/Safari.app/Contents/MacOS/Safari",
  "  700     1   0.4 160000 /Users/me/.vespin/host/vespin-host",
  "  701   700 142.3 524288 claude",
  "this line is no process",
].join("\n");

it("picks the app's processes out of the table, each under the process that started it", () => {
  const processes = appProcesses({
    table: readProcessTable(TABLE),
    main: MAIN,
    host: HOST,
    electron: new Map([[501, { kind: MAC_PROCESS_KIND.RENDERER, name: "Renderer" }]]),
  });
  assert.deepEqual(processes, [
    { pid: 500, kind: "main", name: "Vespin", cpu: 3.2, memory: 189952 * 1024 },
    { pid: 501, kind: "renderer", name: "Renderer", cpu: 2.3, memory: 1025945 * 1024 },
    { pid: 502, parent: 500, kind: "child", name: "zsh", cpu: 0, memory: 2048 * 1024 },
    { pid: 503, parent: 502, kind: "child", name: "node", cpu: 12.5, memory: 40960 * 1024 },
    { pid: 700, kind: "host", name: "vespin-host", cpu: 0.4, memory: 160000 * 1024 },
    { pid: 701, parent: 700, kind: "child", name: "claude", cpu: 142.3, memory: 524288 * 1024 },
  ]);
});
