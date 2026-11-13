/**
 * voice-callers.ts -- a signed-in account with its own OpenAI key sealed under a fixed ring, as a voice call's caller is, and the environment that opens it.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Database } from "@repo/database/core/query";
import { parseKeyRing, sealProviderKey } from "@repo/database/models/provider-key-seal";
import { saveProviderKey } from "@repo/database/models/provider-key-store";
import { user } from "@repo/database/schemas/auth";
import { PROVIDER_KEY_KIND, PROVIDER_KEY_PROVIDER } from "@repo/features/provider-key-wire";
import { Effect, Redacted, Result } from "effect";
import type { HostedEnvironmentValues } from "../environment.js";

/** A synthetic OpenAI key, sealed for each caller who keeps one. */
export const VOICE_CALLER_KEY = "sk-proj-account-test-key-00000000000voice";

/** The deployment's ring the caller's key is sealed under: fixed bytes written for these tests. */
const RING = `1:${Buffer.alloc(32, 5).toString("base64")}`;

/** A deployment whose only configuration is the ring that opens a caller's key. */
export const VOICE_CALLER_ENVIRONMENT: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: Redacted.make(RING),
  titleAnthropicApiKey: undefined,
  previewApiKeys: {},
};

/** A signed-in account, with its own OpenAI key saved unless told otherwise; its id. */
export const openVoiceCaller = (options: { readonly key?: boolean } = {}) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });

    if (options.key === false) return userId;
    const ring = parseKeyRing(Redacted.make(RING));
    assert.ok(Result.isSuccess(ring));

    const owner = {
      userId,
      provider: PROVIDER_KEY_PROVIDER.OPENAI,
      kind: PROVIDER_KEY_KIND.API_KEY,
    } as const;

    yield* saveProviderKey(
      userId,
      owner.provider,
      owner.kind,
      sealProviderKey(ring.success, owner, Redacted.make(VOICE_CALLER_KEY)),
      "sk-…oice",
      null,
      new Date(0),
    );

    return userId;
  });
