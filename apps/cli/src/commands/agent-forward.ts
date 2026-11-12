/**
 * agent-forward.ts -- `vespin agent forward`: a coding agent's cloud ports served on this machine's `localhost` until Ctrl-C or until its sandbox stops.
 *
 * Each port is forwarded through the tunnel client the desktop forwards
 * with (`@repo/features/port-forward-tunnel`), over Node's loopback listener
 * and relay socket (`@repo/features/node`), under the session's credential;
 * this command only chooses the ports and says how they stand. The ports
 * are the ones named, or the ones the sandbox listens on as the command
 * starts (`agentPorts.list`), each on the same local port, or on `--local`
 * for one. A local port that will not listen, held by another program or
 * not the person's to bind, is refused rather than moved to the next free
 * one, so the address printed is the address asked for.
 *
 * The sandbox's ports are read again every few seconds, as the desktop's
 * forward reads them, until a read says the sandbox stopped; a read that
 * fails for any reason but a lapsed sign-in is no news. Nothing here wakes
 * the sandbox: a stopped one is refused before anything listens.
 */

import { webSocketOrigin } from "@repo/features";
import { CLI_EXIT } from "@repo/features/cli-exit";
import { listenOnLoopbackOverNet, openTerminalSocketOverWs } from "@repo/features/node";
import { type ForwardedPort, forwardPort } from "@repo/features/port-forward-tunnel";
import { FORWARD_PORT } from "@repo/features/sandbox-tunnel-wire";
import { Duration, Effect, Option, Schedule } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { answer, CommandFailed, note } from "../output.js";
import { askService, session } from "../session.js";

/** How often the sandbox is read while forwarding, as the desktop's forward reads it. */
const LOOK_EVERY = Duration.seconds(3);

/** Whether a port is one the tunnel forwards. */
function forwardable(port: number): boolean {
  return Number.isInteger(port) && port >= FORWARD_PORT.MIN && port <= FORWARD_PORT.MAX;
}

const PORT_RANGE = `a port from ${FORWARD_PORT.MIN} to ${FORWARD_PORT.MAX}`;

/** Whether the agent's sandbox still runs: a failed read is no news, but a lapsed sign-in ends the forward, whose tunnels it would refuse. */
function stillRunning(agentId: string) {
  return Effect.gen(function* () {
    const { hosted } = yield* session;

    return yield* askService(hosted.agentPorts.list, { id: agentId }).pipe(
      Effect.map((read) => read.running),
      Effect.catch((failed) =>
        failed.exit === CLI_EXIT.AUTH ? Effect.fail(failed) : Effect.succeed(true),
      ),
    );
  });
}

/** What a forward says of its ports once each listens, each with what serves it where that was read. */
function forwardingLines(
  forwards: readonly ForwardedPort[],
  labels: ReadonlyMap<number, string>,
): string[] {
  return forwards.map((forward) => {
    const label = labels.get(forward.port);
    const served = label === undefined ? "" : ` (${label})`;

    return `Forwarding http://localhost:${forward.localPort} to the sandbox's ${forward.port}${served}`;
  });
}

export const forwardCommand = Command.make(
  "forward",
  {
    agent: Argument.String("agent").pipe(Argument.withDescription("The agent's id")),
    ports: Argument.Int("port").pipe(
      Argument.filter(forwardable, () => PORT_RANGE),
      Argument.variadic(),
      Argument.withDescription(
        "The sandbox's ports to forward (default: the ones it listens on now)",
      ),
    ),
    local: Flag.Int("local").pipe(
      Flag.filter(forwardable, () => PORT_RANGE),
      Flag.optional,
      Flag.withDescription("The local port to serve the one port named on (default: the same)"),
    ),
  },
  ({ agent: id, ports, local }) =>
    Effect.gen(function* () {
      if (Option.isSome(local) && ports.length !== 1) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message: "--local serves one port: name exactly one with it.",
        });
      }

      const { origin, credential, hosted } = yield* session;
      const socketOrigin = webSocketOrigin(origin);

      if (socketOrigin === undefined) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message: `${origin} is no address a tunnel opens on.`,
        });
      }

      const listed = yield* askService(hosted.agentPorts.list, { id });

      if (!listed.running) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.REFUSED,
          message: "The agent's sandbox isn't running, so it has no ports to forward.",
        });
      }

      const wanted = ports.length > 0 ? [...new Set(ports)] : listed.ports;

      if (wanted.length === 0) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.REFUSED,
          message: `Nothing listens in the agent's sandbox yet. Name the port to forward: vespin agent forward ${id} 3000`,
        });
      }

      const dependencies = {
        socketOrigin,
        credential,
        openSocket: openTerminalSocketOverWs,
        listen: listenOnLoopbackOverNet,
      };

      const labels = new Map((listed.labels ?? []).map(({ port, label }) => [port, label]));
      yield* Effect.scoped(
        Effect.gen(function* () {
          const forwards = yield* Effect.forEach(wanted, (port) =>
            forwardPort(
              dependencies,
              { agentId: id, port, localPort: Option.getOrElse(local, () => port) },
              Effect.void,
            ),
          );

          const busy = forwards.find((forward) => forward.localPort === undefined);

          if (busy !== undefined) {
            const taken = Option.getOrElse(local, () => busy.port);

            return yield* new CommandFailed({
              exit: CLI_EXIT.REFUSED,
              message: `Could not listen on port ${taken} on this machine: another program may hold it, or it may not be yours to bind. Serve the sandbox's ${busy.port} on another: vespin agent forward ${id} ${busy.port} --local <port>`,
            });
          }

          yield* answer({
            json: {
              id,
              ports: forwards.map((forward) => ({
                port: forward.port,
                localPort: forward.localPort,
                label: labels.get(forward.port),
              })),
            },
            lines: forwardingLines(forwards, labels),
            ids: forwards.map((forward) => String(forward.localPort)),
          });
          yield* note("Press Ctrl-C to stop.");
          yield* Effect.repeat(stillRunning(id), {
            schedule: Schedule.spaced(LOOK_EVERY),
            until: (running) => !running,
          });
          yield* note("The agent's sandbox stopped, so forwarding ended.");
        }),
      );
    }),
).pipe(
  Command.withDescription(
    "Serve an agent's cloud ports on localhost until Ctrl-C or until its sandbox stops",
  ),
  Command.withExamples([
    {
      command: "vespin agent forward <id>",
      description: "Every port the sandbox listens on now, each on the same local port",
    },
    { command: "vespin agent forward <id> 3000 5173", description: "The ports named" },
    {
      command: "vespin agent forward <id> 3000 --local 3001",
      description: "The sandbox's 3000 on localhost:3001",
    },
  ]),
);
