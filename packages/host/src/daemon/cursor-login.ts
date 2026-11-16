/**
 * cursor-login.ts -- `vespin-host cursor-login`: the Mac's own Cursor sign-in, which its local Cursor agents run on, made through the very Cursor SDK the host keeps for them.
 *
 * Cursor's SDK runs on the key it is handed, else `CURSOR_API_KEY`, else
 * the sign-in its own `Cursor.auth.login()` keeps at
 * `~/.cursor/sdk/auth.json`, readable by the member alone. A local agent's
 * runner hands it no key and takes `CURSOR_API_KEY` out of its environment,
 * so that sign-in is the one a Mac's Cursor agents run on, and the service
 * holds no credential of Cursor's for a Mac. A sign-in of Cursor's own command
 * line is not it: the SDK reads none.
 *
 * The command runs that login: it opens the member's browser on Cursor's
 * sign-in page, waits for them to approve it there, and the SDK keeps the
 * key it mints, named for the Mac and expiring as Cursor's logins do, in its
 * own file. Nothing of the key passes through this program's output or the
 * service: the command prints the page's address and the account's email
 * alone. A Mac already signed in is told so and signs in again only with
 * `--again`. A machine that keeps no Cursor SDK (`HostOs.agentClis`), a
 * Linux host, runs no Cursor agent, and is told so.
 */

import { pathToFileURL } from "node:url";
import type { AgentToolPin } from "@repo/agent-runner/pins";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { Effect, Option, Result } from "effect";
import { localAgentTool } from "../local-agent-tools.js";

/** How the command exits: signed in, or already so; the sign-in failed or was not approved; or the machine runs no Cursor agent. */
export const CURSOR_LOGIN_EXIT = {
  SIGNED_IN: 0,
  FAILED: 1,
  NO_CURSOR: 2,
} as const;

type CursorModule = typeof import("@cursor/sdk");

/** The SDK's word for a sign-in that stands. */
const LOGGED_IN = "logged-in";

/** The SDK the host keeps, imported from its entry; none where it could not be loaded. */
const cursorModuleAt = (entry: string) =>
  Effect.tryPromise((): Promise<CursorModule> => import(pathToFileURL(entry).href)).pipe(
    Effect.option,
  );

/** Words for whom the sign-in stands for, where the SDK knows their email. */
const asWhom = (email: string | undefined): string => (email === undefined ? "" : ` as ${email}`);

/**
 * The Mac signed in to Cursor through the SDK it keeps under its state
 * root, fetched first where it is not kept yet, answering the exit the
 * command ends with. It writes what it says through `say`, one line at a
 * time, as it happens.
 */
export const cursorLogin = Effect.fnUntraced(function* (input: {
  readonly stateRoot: string;
  /** The SDK build the OS keeps, none where it keeps none. */
  readonly pin: AgentToolPin | undefined;
  /** The machine's own name, which the key Cursor mints is named for. */
  readonly deviceName: string;
  /** Whether to sign in again where a sign-in already stands. */
  readonly again: boolean;
  readonly say: (line: string) => void;
}) {
  const { pin } = input;
  const say = (line: string) => Effect.sync(() => input.say(line));

  if (pin === undefined) {
    yield* say(`Cursor agents run on a Mac or in the cloud, so this machine keeps no Cursor.`);

    return CURSOR_LOGIN_EXIT.NO_CURSOR;
  }

  const entry = yield* localAgentTool(input.stateRoot, pin, say("Fetching Cursor's SDK…"));

  if (Option.isNone(entry)) {
    yield* say("Cursor's SDK couldn't be downloaded or didn't pass its check. Try again later.");

    return CURSOR_LOGIN_EXIT.FAILED;
  }

  const sdk = yield* cursorModuleAt(entry.value);

  if (Option.isNone(sdk)) {
    yield* say("Cursor's SDK couldn't be loaded. Try again later.");

    return CURSOR_LOGIN_EXIT.FAILED;
  }

  const { auth } = sdk.value.Cursor;
  const standing = yield* Effect.tryPromise(() => auth.status()).pipe(Effect.option);

  if (Option.isSome(standing) && standing.value.status === LOGGED_IN && !input.again) {
    yield* say(
      `This Mac is already signed in to Cursor${asWhom(standing.value.email)}. Run it with --again to sign in as someone else.`,
    );

    return CURSOR_LOGIN_EXIT.SIGNED_IN;
  }

  // Note that the page's address is printed as well as opened, so a browser that did not open still lets the member sign in.
  const signedIn = yield* Effect.tryPromise(() =>
    auth.login({
      apiKeyName: `${PRODUCT_NAME} on ${input.deviceName}`,
      onLoginUrl: (url) =>
        input.say(`Approve the sign-in in your browser. If it didn't open, go to ${url}`),
    }),
  ).pipe(Effect.result);

  if (Result.isFailure(signedIn)) {
    yield* say("Cursor's sign-in didn't finish. Run this again to try once more.");

    return CURSOR_LOGIN_EXIT.FAILED;
  }

  yield* say(
    `Signed in to Cursor${asWhom(signedIn.success.email)}. Cursor agents can now run on this Mac.`,
  );

  return CURSOR_LOGIN_EXIT.SIGNED_IN;
});
