/**
 * in-process-channel.ts -- the act port's two ends in one process: what the host's handler is upgraded with and the screens' client is linked to, in place of a `MessageChannel`.
 *
 * The web serves its act port over a `MessageChannel` in the page. The app
 * serves it over this pair instead, whatever Hermes offers, for two
 * reasons: a global `MessageChannel` is what React's scheduler reaches for
 * when it finds one, so a polyfill of it would change how every render is
 * scheduled, and nothing crosses a process here, so a message needs no
 * copy. Each end answers what oRPC's message-port adapters call
 * (`postMessage`, and `addEventListener` for `message` and `close`), hands a
 * posted message to the other end's listeners on a later turn, as a channel
 * does, and once closed takes and delivers nothing more, telling the other
 * end so.
 */

import { RPCLink } from "@orpc/client/message-port";
import type { RPCHandlerOptions } from "@orpc/server/message-port";
import type { WireBoundaryInput } from "@repo/wire";
import { Predicate } from "effect";

/**
 * How a message crosses the act port: as text, as oRPC encodes a peer
 * message by default, or handed across as the object itself, where both
 * ends stand in one process (`inProcessChannel`) and the text would only be
 * written and read back on the same thread, every photo's or file's base64
 * with it.
 */
export const ACT_PORT_CROSSING = {
  TEXT: "text",
  SAME_PROCESS: "same-process",
} as const;

export type ActPortCrossing = (typeof ACT_PORT_CROSSING)[keyof typeof ACT_PORT_CROSSING];

/** A listener on one end: a message's, handed the message as an event's data, or the close's. */
type Listener = (event: { readonly data: WireBoundaryInput }) => void;

/** One end of the channel, as oRPC's adapters hold a port and the app's root starts and closes it. */
interface InProcessPort {
  postMessage(data: WireBoundaryInput): void;
  addEventListener(type: "message" | "close", listener: Listener | (() => void)): void;
  start(): void;
  close(): void;
}

/** Both ends, each posting to the other, typed as the ports oRPC's adapters take. */
export interface InProcessChannel {
  readonly port1: MessagePort;
  readonly port2: MessagePort;
}

/** One end's listeners by the event they hear. */
interface EndListeners {
  readonly message: Set<Listener>;
  readonly close: Set<() => void>;
}

function endListeners(): EndListeners {
  return { message: new Set(), close: new Set() };
}

/** Tells one end's listeners it closed, once. */
function sayClosed(end: EndListeners): void {
  for (const listener of [...end.close]) listener();
  end.close.clear();
  end.message.clear();
}

/** A channel whose two ends post to each other in this process. */
export function inProcessChannel(): InProcessChannel {
  const ends = [endListeners(), endListeners()] as const;
  let closed = false;

  const portOf = (own: 0 | 1): InProcessPort => {
    const other = ends[own === 0 ? 1 : 0];

    return {
      postMessage: (data) => {
        if (closed) return;
        // Note that delivery waits a turn, as a channel's does, so a message posted from inside a listener reaches the other end after the listener returns.
        queueMicrotask(() => {
          if (closed) return;

          for (const listener of [...other.message]) listener({ data });
        });
      },
      addEventListener: (type, listener) => {
        if (closed) return;

        if (type === "message") {
          ends[own].message.add(listener);

          return;
        }

        // SAFETY: the channel's contract pairs `close` with a listener that takes no event.
        ends[own].close.add(listener as () => void);
      },
      start: () => undefined,
      close: () => {
        if (closed) return;
        closed = true;

        for (const end of ends) sayClosed(end);
      },
    };
  };

  // SAFETY: oRPC's adapters call `postMessage` and `addEventListener` for `message` and `close` on a port, and the app's root `start` and `close`, which each end answers; nothing reads the rest of a `MessagePort`.
  return {
    port1: portOf(0) as MessagePort,
    port2: portOf(1) as MessagePort,
  };
}

/**
 * The transfer list oRPC asks of each message on a port crossed in one
 * process: an empty one, since nothing moves between threads, which oRPC
 * takes as leave to post the message itself rather than its text. Note that
 * both ends then hold the same objects, which is safe because oRPC's
 * serializer builds a new body for each message and its deserializer copies
 * whatever it writes into, so neither end changes what the other was handed.
 */
function sameProcessTransfer(): object[] {
  return [];
}

/**
 * `value` with every object in it a plain one, as reading it back from text
 * made it, where oRPC hands its own null-prototype objects across. Note that
 * only objects and arrays are walked, so a string, however long, is shared
 * rather than copied, and anything of a class of its own stands as it is.
 */
function plainOf(value: WireBoundaryInput): WireBoundaryInput {
  if (Array.isArray(value)) return value.map(plainOf);

  if (value === null || !Predicate.isObject(value)) return value;
  const prototype: object | null = Object.getPrototypeOf(value);

  if (prototype !== null && Object.getPrototypeOf(prototype) !== null) return value;

  return Object.fromEntries(Object.entries(value).map(([key, each]) => [key, plainOf(each)]));
}

/** The handler's side of a port crossed in one process: each answer posted as the object itself, and each call's input made plain before a procedure reads it. */
export function sameProcessHandling<Context extends object>(): Pick<
  RPCHandlerOptions<Context>,
  "experimental_transfer" | "clientInterceptors"
> {
  return {
    experimental_transfer: sameProcessTransfer,
    clientInterceptors: [
      // SAFETY: a call's input is the contract's wire value, which its schema checks once the procedure reads it.
      ({ next, ...options }) =>
        next({ ...options, input: plainOf(options.input as WireBoundaryInput) }),
    ],
  };
}

/** The screens' link to a handler on `port` in this process: each call posted as the object itself, and each answer made plain before the screens read it. */
export function sameProcessLink(port: MessagePort): RPCLink<Record<never, never>> {
  return new RPCLink({
    port,
    experimental_transfer: sameProcessTransfer,
    // SAFETY: an answer is the contract's wire value, as its procedure's schema encoded it on the host's side.
    interceptors: [async ({ next }) => plainOf((await next()) as WireBoundaryInput)],
  });
}
