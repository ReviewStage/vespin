/**
 * pty.ts -- what a sandbox's PTY writes, read as lines: its frames up to the exit its server sends, decoded and split.
 */

import { EXCESS_KEYS, unparsedWire, valueFromJsonText } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Result, Schema, Stream } from "effect";

/** The PTY server's exit frame: what it ran ended, the one text frame it sends of its own. */
export const ptyExitSchema = Schema.Struct({ type: Schema.Literal("exit"), code: Schema.Int });

const readPtyExit = readEither(ptyExitSchema, { excess: EXCESS_KEYS.DROP });

/** One frame of the PTY's socket: text as text, binary as binary. */
export type PtyFrame = { readonly text: string } | { readonly bytes: Uint8Array };

/** The PTY's output as the lines what it runs wrote, ending where that exits; a text frame that is not its exit is output sent as text. */
export function ptyLinesOf(frames: Stream.Stream<PtyFrame>): Stream.Stream<string> {
  const decoder = new TextDecoder();

  return frames.pipe(
    Stream.takeWhile(
      (frame) =>
        "bytes" in frame ||
        Result.isFailure(readPtyExit(unparsedWire(valueFromJsonText(frame.text)))),
    ),
    Stream.map((frame) =>
      "bytes" in frame ? decoder.decode(frame.bytes, { stream: true }) : frame.text,
    ),
    Stream.splitLines,
  );
}
