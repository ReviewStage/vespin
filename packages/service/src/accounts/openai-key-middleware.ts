/**
 * openai-key-middleware.ts -- a procedure run on the caller's own OpenAI API key, refused as missing one where they saved none.
 *
 * What a dictated clip and a voice call alike run behind: the key is read
 * afresh on every call (`own-api-key.ts`), handed on redacted in the
 * procedure's context, and never answered, logged, or traced. An account
 * that saved no OpenAI API key is refused as missing one, which a client
 * answers by pointing at Settings; one whose saved key the deployment cannot
 * open, or whose store did not answer, is answered unavailable, since adding
 * another key would not help.
 */

import { middlewareGen } from "@orpc/experimental-effect";
import { PROVIDER_KEY_UNREADABLE } from "@repo/database/models/provider-key-seal";
import { PROVIDER_KEY_PROVIDER } from "@repo/features/provider-key-wire";
import { Effect, type Redacted } from "effect";
import { HostedEnvironment } from "../environment.js";
import { HOSTED_REFUSAL } from "../http/http-effect.js";
import { logStoreFailure } from "../http/store-failure.js";
import type { HostedCaller, HostedContext } from "../orpc/base.js";
import { ownApiKeyOf } from "./own-api-key.js";

/** The caller's own OpenAI API key, or refused as missing where it saved none; unavailable where the store did not answer or the deployment cannot open the key it saved. */
export const openAiKeyMiddleware = middlewareGen<
  HostedContext & HostedCaller,
  { readonly openAiKey: Redacted.Redacted<string> }
>(function* ({ context, next }) {
  const environment = yield* HostedEnvironment;

  const key = yield* ownApiKeyOf(context.userId, PROVIDER_KEY_PROVIDER.OPENAI, environment).pipe(
    Effect.tapError(logStoreFailure),
    Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
  );

  if (key === undefined) return yield* Effect.fail(HOSTED_REFUSAL.OPENAI_KEY_MISSING);

  if (key === PROVIDER_KEY_UNREADABLE) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);

  return yield* next({ context: { openAiKey: key } });
});
