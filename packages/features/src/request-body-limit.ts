/**
 * request-body-limit.ts -- the platform's request body limit, and the bytes that fit under it once base64 grows them.
 */

/** The most bytes a Vercel Function's request body may carry: Vercel's documented 4.5 MB limit. */
export const FUNCTION_BODY_LIMIT_BYTES = 4_500_000;

/** The room a request that carries files leaves for the JSON around them: a form's values, the ids, the envelope. */
const JSON_MARGIN_BYTES = 500_000;

/** The room a request that carries one `data:` URL and nothing else leaves for the rest of its JSON. */
const DATA_URL_MARGIN_BYTES = 100_000;

/** The most bytes that base64 spells in `characters` characters: three bytes in four. */
function decodedBytesOf(characters: number): number {
  return Math.floor((characters * 3) / 4);
}

/**
 * The most bytes, decoded, that fit in one request's files together: what
 * remains under the body limit after the JSON margin, with base64 growing
 * them by a third (3 MB).
 */
export const MAX_REQUEST_FILES_BYTES = decodedBytesOf(
  FUNCTION_BODY_LIMIT_BYTES - JSON_MARGIN_BYTES,
);

/** The most bytes, decoded, that one `data:` URL may hold in a request that carries little else (3.3 MB). */
export const MAX_REQUEST_DATA_URL_BYTES = decodedBytesOf(
  FUNCTION_BODY_LIMIT_BYTES - DATA_URL_MARGIN_BYTES,
);
