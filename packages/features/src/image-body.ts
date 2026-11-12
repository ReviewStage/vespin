import { unparsedWire } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Effect, Result, type Schema } from "effect";
import { Base64 } from "effect/encoding";
import { CALL_FAULT, type CallAnswer } from "./account-call.js";

/**
 * image-body.ts -- an image a hosted read answered as its bytes, read whole and spelled in base64 for a window to draw from a `data:` URL of its own making.
 *
 * The host fetches the bytes under the account, so a window holds no bearer
 * and no address; what it hears is the type and the base64. An inbox
 * attachment and a workspace's photo are both read this way, each held to
 * the types its own wire names.
 */

/** An image's bytes in base64 under its media type. */
export interface ImageBody<Type extends string> {
  readonly contentType: Type;
  readonly base64: string;
}

/** A body the network cut after its status arrived, as a call that never reached the service answers: its fault, and the kind of error it ended with, never its words. */
export type ImageBodyUnread = Exclude<CallAnswer, { readonly response: Response }>;

/**
 * The kind of error a body's read ended with, as a call's transport fault is
 * named (`account-call.ts`): the platform's beneath the HTTP client's that
 * wraps it, where there is one, never its words.
 */
function endedWith(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;

  return error.cause instanceof Error ? error.cause.name : error.name;
}

/** Whether an image's read ended as its body cut, rather than its bytes or a type refused. */
export function imageBodyUnread<Type extends string>(
  read: ImageBody<Type> | ImageBodyUnread | undefined,
): read is ImageBodyUnread {
  return read !== undefined && "fault" in read;
}

/**
 * The response's bytes in base64 under the type it named, or nothing where
 * the type is none `types` admits. Note that a body that could not be read
 * answers as the network's fault, because its status already arrived and
 * what failed after it is the connection, as a phone's that drops or a tab
 * the browser suspends, never the service or the app.
 */
export function imageBodyOf<Type extends string>(
  response: Response,
  types: Schema.Codec<Type, Type>,
): Effect.Effect<ImageBody<Type> | ImageBodyUnread | undefined> {
  const contentType = Result.getOrUndefined(
    readEither(types)(unparsedWire(response.headers.get("content-type"))),
  );

  if (contentType === undefined) return Effect.succeed(undefined);

  return Effect.promise(() =>
    response
      .arrayBuffer()
      .then(
        (bytes): ImageBody<Type> => ({ contentType, base64: Base64.encode(new Uint8Array(bytes)) }),
      )
      .catch((error: unknown): ImageBodyUnread => {
        const name = endedWith(error);

        return {
          fault: CALL_FAULT.NETWORK,
          ...(name === undefined ? undefined : { errorName: name }),
        };
      }),
  );
}
