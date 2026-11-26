/**
 * sandbox-door.ts -- the door to a native agent's sandbox a tool of our MCP server reads a file through.
 *
 * `inbox_post`, `edit_description`, `show_media`, and `show_page` read a
 * file the agent names by its path through a door made here, and
 * `look_at_picture` writes a description's PDF in through it, over the
 * agent's machine (`../machine/agent-machine.ts`, the one its row names, a
 * sandbox or its starter's Mac): the place its session runs in, and the
 * one file asked for, read as the agent's own user, never
 * as root, so a path the model was talked into naming (the runner's
 * environment, a private home) reads as no file. Nothing is resumed: the
 * agent calling the tool runs in that place, so a place not up has nothing
 * to read from, and the read is unavailable.
 *
 * Every door hands a file on as one stream, which the door's caller holds to
 * its own bound; the read stops one byte past the widest of those bounds, so
 * a file larger than any is refused as larger rather than read whole.
 */

import { SandboxUnavailable } from "@repo/sandbox";
import { Effect, type Layer } from "effect";
import type { HttpClient } from "effect/http";
import type { InboxSandboxDoor, SandboxSelfUpload } from "../coder-host/inbox-image.js";
import {
  AgentMachine,
  type AgentMachineService,
  type SelfUpload,
} from "../machine/agent-machine.js";
import type { AdmittedConversation } from "../sessions/admitted-conversation.js";

/** The most of one file a door reads: past every bound a tool holds a file to, a page's HTML and a kept picture among them. */
export const SANDBOX_DOOR_MAX_BYTES = 8 * 1024 * 1024;

/** How the edge runs the door's effects, on its own runtime, which provides what the machine's layer needs. */
export type SandboxDoorRunner<R = HttpClient.HttpClient> = <A, E>(
  effect: Effect.Effect<A, E, R>,
) => Promise<A>;

/** The doors to the admitted agent's sandbox: one to read a file through, which names where its machine keeps its checkout, also makes a recording's MP4 there, and writes a file under its attachments folder. */
export interface AgentSandboxDoors {
  readonly files: InboxSandboxDoor;
}

/** Bytes as the one-chunk stream a door's caller reads. */
function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** A place's own uploads as the door reaches them, each call run on the edge's runner; none where the place uploads nothing itself. */
function selfUploadDoor(
  selfUpload: SelfUpload | undefined,
  ask: <A, E>(call: (machine: AgentMachineService) => Effect.Effect<A, E>) => Promise<A>,
): SandboxSelfUpload | undefined {
  if (selfUpload === undefined) return undefined;
  const run = <A, E>(effect: Effect.Effect<A, E>) => ask(() => effect);

  return {
    probe: async (path, headBytes) => (await run(selfUpload.probe(path, headBytes))) ?? null,
    upload: (path, upload) => run(selfUpload.upload(path, upload)),
    uploadPhoneCopy: (path, kind, upload) => run(selfUpload.uploadPhoneCopy(path, kind, upload)),
  };
}

/**
 * The doors to the admitted agent's sandbox, their calls made of the agent's
 * machine the layer given provides and run on the runner given; a
 * conversation that records no session has no sandbox to find, and its
 * doors fail, which each tool answers as a sandbox it could not reach.
 */
export function agentSandboxDoors<R>(
  run: SandboxDoorRunner<R>,
  machine: Layer.Layer<AgentMachine, never, R>,
): (admitted: AdmittedConversation) => AgentSandboxDoors {
  /** One call of the agent's machine, run on the edge's runner. */
  const ask = <A, E>(call: (machine: AgentMachineService) => Effect.Effect<A, E>) =>
    run(Effect.flatMap(AgentMachine, call).pipe(Effect.provide(machine)));

  return (admitted) => {
    const sessionId = admitted.runtimeSessionId;
    const unfound = () => Promise.reject(new SandboxUnavailable({}));

    if (sessionId === undefined) return { files: unfound };

    return {
      files: async () => ({
        checkout: await ask((each) => each.checkoutPath(sessionId)),
        selfUpload: selfUploadDoor(await ask((each) => each.selfUpload(sessionId)), ask),
        readFile: async ({ path }: { readonly path: string }) => {
          const bytes = await ask((each) => each.readFile(sessionId, path, SANDBOX_DOOR_MAX_BYTES));

          return bytes === undefined ? null : streamOf(bytes);
        },
        phoneVideo: async ({ path }: { readonly path: string }) =>
          (await ask((each) => each.phoneVideo(sessionId, path))) ?? null,
        phoneAudio: async ({ path }: { readonly path: string }) =>
          (await ask((each) => each.phoneAudio(sessionId, path))) ?? null,
        writeFile: (file: { readonly name: string; readonly contents: Uint8Array }) =>
          ask((each) => each.writeFile(sessionId, file)),
      }),
    };
  };
}
