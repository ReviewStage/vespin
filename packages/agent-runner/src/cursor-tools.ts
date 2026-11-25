/**
 * cursor-tools.ts -- our MCP servers' tools as a Cursor agent's custom tools: each listed from the service under the runner's bearer, and each call run there by the runner, so Cursor is handed no URL and no secret.
 *
 * Cursor's SDK runs a custom tool in the runner's own process, in every mode,
 * Auto-review never refusing one, where it would refuse an MCP server's call
 * it judged risky (the spike's finding). So each server the launch hands its
 * harness (`mcp-servers.ts`), ours and each integration's, is listed here as
 * the launch opens, its tools handed the SDK under the name Claude Code
 * knows them by, `mcp__<server>__<tool>`, which is also the name the
 * service keeps a call under, and each call is posted to the server as
 * `tools/call` and its answer handed back. A server the launch waits on
 * (`MCP_STARTUP.REQUIRED`, ours) is listed before the first message is sent;
 * one connected in the background (an integration's) is listed beside it,
 * its tools joining from the next message on, so a slow provider holds up no
 * turn. Each is listed within its own startup bound, as the other harnesses
 * wait on a server to start.
 * Note that a server's own instructions, which name the account an
 * integration is, lead each of its tools' descriptions, since a custom tool
 * has no server to carry them.
 *
 * Every request is JSON-RPC over streamable HTTP, one POST answered with one
 * JSON body, as our servers answer (`workspace-mcp/app.ts`). A call the
 * server did not answer is answered as the tool's error, so the agent reads
 * why rather than waiting.
 */

import type {
  SDKCustomTool,
  SDKCustomToolContent,
  SDKCustomToolResult,
  SDKJsonValue,
} from "@cursor/sdk";
import {
  Duration,
  Effect,
  Fiber,
  Option,
  Predicate,
  Queue,
  type Redacted,
  Schema,
  Stream,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { MCP_STARTUP, type McpServer } from "./mcp-servers.js";

/** The protocol version the runner speaks to our servers, one they speak (`workspace-mcp/app.ts`'s `WORKSPACE_MCP_PROTOCOL_VERSIONS`). */
const PROTOCOL_VERSION = "2025-06-18";

/** How long listing the tools of a server that names no startup bound may take before the launch goes on without them, in seconds. */
const LIST_TIMEOUT_SECONDS = 20;

/** The most pages of tools one server is read for. */
const LIST_PAGES = 20;

/** The JSON-RPC methods the runner sends. */
const METHOD = {
  INITIALIZE: "initialize",
  TOOLS_LIST: "tools/list",
  TOOLS_CALL: "tools/call",
} as const;

const JsonRecordSchema = Schema.Record(Schema.String, Schema.Json);

/** A JSON object as the SDK types one: parsed from JSON, so every value in it is JSON. */
function sdkJson(record: typeof JsonRecordSchema.Type): Record<string, SDKJsonValue> {
  // SAFETY: the record was decoded from a JSON body, so it holds JSON values alone; the SDK's type differs only in being mutable.
  return record as Record<string, SDKJsonValue>;
}

const InitializeAnswerSchema = Schema.Struct({
  result: Schema.Struct({ instructions: Schema.optionalKey(Schema.String) }),
});

const ToolSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  inputSchema: Schema.optionalKey(JsonRecordSchema),
  annotations: Schema.optionalKey(
    Schema.Struct({
      title: Schema.optionalKey(Schema.String),
      readOnlyHint: Schema.optionalKey(Schema.Boolean),
      destructiveHint: Schema.optionalKey(Schema.Boolean),
      idempotentHint: Schema.optionalKey(Schema.Boolean),
      openWorldHint: Schema.optionalKey(Schema.Boolean),
    }),
  ),
});

type Tool = typeof ToolSchema.Type;

const ToolsAnswerSchema = Schema.Struct({
  result: Schema.Struct({
    tools: Schema.Array(ToolSchema),
    nextCursor: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
});

/** A tool's answer as MCP writes it, every block kept as it was. */
const CallAnswerSchema = Schema.Struct({
  result: Schema.Struct({
    content: Schema.Array(JsonRecordSchema),
    isError: Schema.optionalKey(Schema.Boolean),
    structuredContent: Schema.optionalKey(JsonRecordSchema),
  }),
});

const decodeInitialize = Schema.decodeUnknownOption(InitializeAnswerSchema);
const decodeTools = Schema.decodeUnknownOption(ToolsAnswerSchema);
const decodeCall = Schema.decodeUnknownOption(CallAnswerSchema);

/** The name a server's tool is handed the SDK under, the one Claude Code knows it by. */
function cursorToolName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`;
}

/** One JSON-RPC request posted to a server under the runner's bearer, and the body it answered. */
const post = Effect.fn("agent-runner/cursor/mcpPost")(function* (
  server: McpServer,
  bearer: Redacted.Redacted,
  method: string,
  params: Readonly<Record<string, SDKJsonValue>>,
) {
  const client = yield* HttpClient.HttpClient;

  const request = HttpClientRequest.post(server.url).pipe(
    HttpClientRequest.bearerToken(bearer),
    HttpClientRequest.setHeader("accept", "application/json, text/event-stream"),
    HttpClientRequest.setHeader("mcp-protocol-version", PROTOCOL_VERSION),
    HttpClientRequest.bodyText(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      "application/json",
    ),
  );

  const response = yield* client.execute(request);

  if (response.status < 200 || response.status >= 300) {
    return yield* Effect.fail(`The service answered ${response.status}`);
  }

  return yield* response.json;
});

/** A tool's answer as the SDK takes it: text and pictures as they are, any other block as its JSON. */
function resultOf(answer: typeof CallAnswerSchema.Type): SDKCustomToolResult {
  const content = answer.result.content.map((block): SDKCustomToolContent => {
    if (block.type === "text" && Predicate.isString(block.text)) {
      return { type: "text", text: block.text };
    }

    if (block.type === "image" && Predicate.isString(block.data)) {
      return {
        type: "image",
        data: block.data,
        ...(Predicate.isString(block.mimeType) ? { mimeType: block.mimeType } : undefined),
      };
    }

    return { type: "text", text: JSON.stringify(block) };
  });

  return {
    content,
    isError: answer.result.isError ?? false,
    ...(answer.result.structuredContent === undefined
      ? undefined
      : { structuredContent: sdkJson(answer.result.structuredContent) }),
  };
}

/** A failed call as the agent reads it. */
function failedResult(detail: string): SDKCustomToolResult {
  return { content: [{ type: "text", text: detail }], isError: true };
}

/** One call of a server's tool, posted and answered within the server's bound; its failure answered as the tool's error. */
const callTool = Effect.fn("agent-runner/cursor/callTool")(function* (
  server: McpServer,
  bearer: Redacted.Redacted,
  name: string,
  args: Readonly<Record<string, SDKJsonValue>>,
) {
  return yield* post(server, bearer, METHOD.TOOLS_CALL, { name, arguments: args }).pipe(
    Effect.timeout(Duration.seconds(server.toolTimeoutSeconds)),
    Effect.map((body) => {
      const answer = decodeCall(body);

      return Option.isSome(answer)
        ? resultOf(answer.value)
        : failedResult(`${name} answered no result the runner could read`);
    }),
    // Note that the client's error is not kept, because the request it describes carries the bearer.
    Effect.catch(() => Effect.succeed(failedResult(`${name} could not be reached`))),
  );
});

/** A call the SDK made, waiting on its answer. */
interface PendingCall {
  readonly server: McpServer;
  readonly name: string;
  readonly args: Readonly<Record<string, SDKJsonValue>>;
  readonly answer: (result: SDKCustomToolResult) => void;
}

/** One server's tools, every page of them, and its instructions; fails where they could not be read. */
const listServer = Effect.fn("agent-runner/cursor/listServer")(function* (
  server: McpServer,
  bearer: Redacted.Redacted,
) {
  const initialized = yield* post(server, bearer, METHOD.INITIALIZE, {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "vespin-agent-runner", version: "1.0.0" },
  });

  const instructions = Option.getOrUndefined(decodeInitialize(initialized))?.result.instructions;
  const tools: Tool[] = [];
  let cursor: string | undefined;

  for (let pages = 0; pages < LIST_PAGES; pages += 1) {
    const listed = decodeTools(
      yield* post(server, bearer, METHOD.TOOLS_LIST, cursor === undefined ? {} : { cursor }),
    );

    if (Option.isNone(listed)) return yield* Effect.fail("tools/list answered no tools");
    tools.push(...listed.value.result.tools);
    cursor = listed.value.result.nextCursor ?? undefined;

    if (cursor === undefined) break;
  }

  return { tools, instructions };
});

/** The launch's custom tools, as they stand: those of every server listed so far. */
export interface CursorTools {
  readonly current: () => Record<string, SDKCustomTool>;
  /** Settles once every server the launch waits on is listed, or could not be, so the first message is sent with their tools. */
  readonly ready: Effect.Effect<void>;
}

/**
 * The servers' tools for the rest of the scope: each server listed beside
 * the others, every call relayed at once, beside the others, so a long one
 * holds up none after it.
 */
export const openCursorTools = Effect.fn("agent-runner/cursor/openCursorTools")(function* (
  servers: readonly McpServer[],
  bearer: Redacted.Redacted,
) {
  const listed: Record<string, SDKCustomTool> = {};
  const inbox = yield* Queue.unbounded<PendingCall>();

  yield* Stream.fromQueue(inbox).pipe(
    Stream.mapEffect(
      (call) =>
        callTool(call.server, bearer, call.name, call.args).pipe(
          Effect.tap((result) => Effect.sync(() => call.answer(result))),
        ),
      { concurrency: "unbounded" },
    ),
    Stream.runDrain,
    Effect.forkScoped,
  );

  const toolOf = (server: McpServer, instructions: string | undefined, tool: Tool) => {
    const description = [instructions, tool.description].filter(Predicate.isString).join("\n\n");

    const custom: SDKCustomTool = {
      ...(description === "" ? undefined : { description }),
      ...(tool.inputSchema === undefined ? undefined : { inputSchema: sdkJson(tool.inputSchema) }),
      ...(tool.annotations === undefined ? undefined : { annotations: { ...tool.annotations } }),
      execute: (args) =>
        new Promise((answer) => {
          Queue.offerUnsafe(inbox, { server, name: tool.name, args, answer });
        }),
    };

    return custom;
  };

  const listing = servers.map((server) =>
    listServer(server, bearer).pipe(
      Effect.timeout(Duration.seconds(server.startupTimeoutSeconds ?? LIST_TIMEOUT_SECONDS)),
      Effect.tap(({ tools, instructions }) =>
        Effect.sync(() => {
          for (const tool of tools) {
            listed[cursorToolName(server.name, tool.name)] = toolOf(server, instructions, tool);
          }
        }),
      ),
      Effect.catch(() =>
        Effect.logWarning(`agent-runner: the tools of ${server.name} could not be listed`),
      ),
      Effect.asVoid,
    ),
  );

  const fibers = yield* Effect.forEach(listing, (list) => Effect.forkScoped(list));
  const required = fibers.filter((_, at) => servers[at]?.startup === MCP_STARTUP.REQUIRED);

  return {
    current: () => ({ ...listed }),
    ready: Effect.asVoid(Fiber.awaitAll(required)),
  } satisfies CursorTools;
});
