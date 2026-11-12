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

/** A listener on one end: a message's, handed the message as an event's data, or the close's. */
type Listener = (event: { readonly data: unknown }) => void;

/** One end of the channel, as oRPC's adapters hold a port and the app's root starts and closes it. */
interface InProcessPort {
  postMessage(data: unknown): void;
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

        if (type === "message") ends[own].message.add(listener as Listener);
        else ends[own].close.add(listener as () => void);
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
    port1: portOf(0) as unknown as MessagePort,
    port2: portOf(1) as unknown as MessagePort,
  };
}
