/**
 * index.ts -- the Node-only seams a relay is carried over: a loopback listener over `node:net` and a relay socket over `ws`, kept off every other subpath so the web and the iOS app never load them.
 *
 * The desktop's main process hands them to the host as seams, and the CLI
 * uses them directly.
 */
export { listenOnLoopbackOverNet } from "./loopback-listener-over-net.js";

export { openTerminalSocketOverWs } from "./terminal-socket-over-ws.js";
