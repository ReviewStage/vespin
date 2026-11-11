import { randomBytes } from "node:crypto";
import net from "node:net";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { Duration, Effect, Option, Path, Result } from "effect";
import * as FileSystem from "effect/FileSystem";
import { Reporter } from "../effect/seams.js";

/**
 * host-lock.ts -- the one daemon a state root runs: a lock its daemon holds for as long as its scope stands, which a second daemon on the same state root finds held and leaves alone.
 *
 * Node has no `flock`, so the lock is a Unix socket the daemon listens on,
 * which the kernel stops answering the moment its process ends, however it
 * ends. Each daemon listens on a socket of its own, under a name apart, and
 * takes the lock by linking it under the lock's one name (`LOCK_NAME`), which
 * a link makes only where none stands. A name that stands is another
 * daemon's while its socket answers a connect, and is left by one that died
 * while it does not, so it is removed and taken. Two daemons that both found
 * the same one dead may each remove what the other just linked, so a daemon
 * reads the name again once `SETTLE` has passed and holds the lock only
 * where it still names its own socket; one that lost it finds the winner's
 * answering and leaves.
 *
 * Closing the scope removes the name while the socket still answers, so no
 * daemon starting meanwhile takes it for a dead one's, then closes the
 * socket, which removes its own file; the sockets of daemons that died are
 * removed by the next one to take the lock. A state root the lock cannot be made
 * in, as one whose path is longer than a socket's may be, is said, and the
 * daemon runs without it, since a daemon that never starts is the worse
 * failure.
 */

/** The lock's one name in the state root, which the daemon holding it has linked to its own socket. */
const LOCK_NAME = "daemon.lock";

/** How long after it linked its socket a daemon reads the lock's name again, well past the moment between another's finding a dead lock and its link. */
const SETTLE = Duration.millis(250);

/** A daemon's own socket's name in the state root, made apart from every other daemon's. */
const SOCKET_NAME = /^daemon-[0-9a-f]+\.sock$/u;

/** How many times a daemon tries to take a lock it found left by a dead one, before it takes it as another's. */
const TRIES = 3;

/** How taking the lock went: taken, held by another daemon, or not made at all, the daemon running without it. */
export const HOST_LOCK = { TAKEN: "taken", HELD: "held", UNLOCKED: "unlocked" } as const;

/** What a connect fails with where no daemon answers: nothing listens on the socket, nothing stands, or what stands is no socket. */
const DEAD = new Set(["ECONNREFUSED", "ENOENT", "ENOTSOCK"]);

/** Whether a daemon's socket answers at the path given: false where nothing listens there, nothing stands, or no socket does. */
const answers = (path: string) =>
  Effect.callback<boolean>((resume) => {
    const socket = net.connect(path);
    socket.once("connect", () => {
      socket.destroy();
      resume(Effect.succeed(true));
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      socket.destroy();
      resume(Effect.succeed(!DEAD.has(error.code ?? "")));
    });
  });

/** A socket listened on at the path given for as long as the scope stands, each connect to it closed at once; none where it could not be. */
const listening = (path: string) =>
  Effect.acquireRelease(
    Effect.callback<Option.Option<net.Server>>((resume) => {
      const server = net.createServer((socket) => socket.destroy());
      server.once("error", () => resume(Effect.succeed(Option.none())));
      server.listen(path, () => {
        // Note that the socket holds the process open no longer than the daemon does.
        server.unref();
        resume(Effect.succeed(Option.some(server)));
      });
    }),
    (server) =>
      Option.match(server, {
        onNone: () => Effect.void,
        onSome: (open) =>
          Effect.callback<void>((resume) => void open.close(() => resume(Effect.void))),
      }),
  );

/**
 * The state root's lock taken for as long as the scope stands, or why not:
 * held by another daemon, which this one leaves alone, or not made, said,
 * with the daemon running without it.
 */
export const hostLockTaken = Effect.fnUntraced(function* (stateRoot: string) {
  const { report } = yield* Reporter;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const lock = path.join(stateRoot, LOCK_NAME);
  const own = path.join(stateRoot, `daemon-${randomBytes(6).toString("hex")}.sock`);
  const inode = (at: string) =>
    Effect.map(Effect.option(fileSystem.stat(at)), (info) =>
      Option.getOrUndefined(Option.flatMap(info, (read) => read.ino)),
    );
  const unlocked = (why: string) =>
    Effect.sync(() => {
      report(`${PRODUCT_NAME} host: could not lock ${stateRoot} (${why}), so it runs without it.`);
      return HOST_LOCK.UNLOCKED;
    });
  if (
    Option.isNone(
      yield* Effect.option(fileSystem.makeDirectory(stateRoot, { recursive: true, mode: 0o700 })),
    )
  ) {
    return yield* unlocked("its folder could not be made");
  }
  const server = yield* listening(own);
  if (Option.isNone(server)) return yield* unlocked("no socket could be made there");
  const ownInode = yield* inode(own);
  if (ownInode === undefined) return yield* unlocked("its socket could not be read");
  for (let tried = 0; tried < TRIES; tried += 1) {
    const linked = yield* Effect.result(fileSystem.link(own, lock));
    if (Result.isFailure(linked)) {
      // Note that only a name that stands may be another daemon's; a state root that takes no link runs without the lock.
      if (linked.failure.reason._tag !== "AlreadyExists") {
        return yield* unlocked("no link could be made there");
      }
      const probed = yield* inode(lock);
      if (yield* answers(lock)) return HOST_LOCK.HELD;
      // Note that the name is removed only while it still names the socket found dead, never one another daemon linked since.
      if ((yield* inode(lock)) === probed) {
        yield* Effect.ignore(fileSystem.remove(lock, { force: true }));
      }
      continue;
    }
    yield* Effect.sleep(SETTLE);
    if ((yield* inode(lock)) === ownInode) {
      // Note that the name is removed before the socket closes, and only while it is still this daemon's.
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          if ((yield* inode(lock)) === ownInode) {
            yield* Effect.ignore(fileSystem.remove(lock, { force: true }));
          }
        }),
      );
      // Note that the sockets of daemons that died are removed once the lock is this daemon's, a starting one's own answering and kept.
      for (const name of yield* Effect.orElseSucceed(
        fileSystem.readDirectory(stateRoot),
        () => [],
      )) {
        const at = path.join(stateRoot, name);
        if (!SOCKET_NAME.test(name) || at === own || (yield* answers(at))) continue;
        yield* Effect.ignore(fileSystem.remove(at, { force: true }));
      }
      return HOST_LOCK.TAKEN;
    }
    if (yield* answers(lock)) return HOST_LOCK.HELD;
  }
  return HOST_LOCK.HELD;
});
