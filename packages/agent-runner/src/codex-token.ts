/**
 * codex-token.ts -- the plan's access token asked of the service under the runner's bearer, for a sandbox's sign-in of app-server and its refreshes.
 *
 * In the cloud's sandbox the launch asks (`askPlanTokens`), as it signs
 * app-server in with the token and as app-server asks for another after a
 * 401 (`codex.ts`'s `chatgptAuthTokens`). A host's app-server runs on the
 * machine's own login and asks for none. A refusal or failure says only its
 * status, which app-server may quote in a turn's error, so no secret is
 * ever written there.
 */

import { Data, Duration, Effect, Option, Redacted, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { type RunnerTokenAnswer, RunnerTokenAnswerSchema } from "./protocol.js";

/** How long the service is given to answer, within app-server's own timeout for the command. */
const ASK_TIMEOUT = Duration.seconds(20);

const HTTP_OK = 200;

const decodeAnswer = Schema.decodeUnknownOption(RunnerTokenAnswerSchema);

/** Why no token came back: words with no secret in them, for app-server's stderr or a launch's failure. */
export class CodexTokenFailed extends Data.TaggedError("CodexTokenFailed")<{
  readonly detail: string;
}> {}

/** The plan's access token and the workspace it pays from, asked of the service at `url` under `bearer`. */
export const askPlanTokens = Effect.fn("agent-runner/askPlanTokens")(function* (
  url: string,
  bearer: Redacted.Redacted,
) {
  const client = yield* HttpClient.HttpClient;
  const response = yield* client
    .execute(
      HttpClientRequest.post(url).pipe(HttpClientRequest.bearerToken(Redacted.value(bearer))),
    )
    .pipe(
      Effect.timeout(ASK_TIMEOUT),
      // Note that the client's error is not kept, because the request it describes carries the bearer.
      Effect.mapError(() => new CodexTokenFailed({ detail: "The service did not answer" })),
    );
  if (response.status !== HTTP_OK) {
    return yield* new CodexTokenFailed({
      detail: `The service refused the token: ${response.status}`,
    });
  }
  const body = yield* response.json.pipe(
    Effect.mapError(() => new CodexTokenFailed({ detail: "The service's answer is not JSON" })),
  );
  const answer = decodeAnswer(body);
  if (Option.isNone(answer) || answer.value.accessToken === "") {
    return yield* new CodexTokenFailed({ detail: "The service's answer holds no token" });
  }
  return answer.value satisfies RunnerTokenAnswer;
});
