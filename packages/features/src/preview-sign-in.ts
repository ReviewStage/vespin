/**
 * preview-sign-in.ts -- the app's sign-in step for a shared preview, and the one return the sign-in page takes back to it.
 *
 * A browser that opens a preview without a session is sent to the app's
 * sign-in page with the step's own address as its `return`; once signed in,
 * the page sends it back there, and the step goes on to the preview. The page
 * returns only to that step, so its `return` sends nobody anywhere else.
 */

export const PREVIEW_SIGN_IN = {
  /** The app's route that checks a member's reach and hands them to the preview host. */
  PATH: "/api/previews/sign-in",
  /** The sign-in page's query naming where to return once signed in. */
  RETURN_PARAM: "return",
} as const;

/** The step the sign-in page's query asks to return to, where it is the preview's step; none for anything else. */
export function previewSignInReturn(search: string): string | undefined {
  const asked = new URLSearchParams(search).get(PREVIEW_SIGN_IN.RETURN_PARAM);
  if (asked === null || !asked.startsWith(`${PREVIEW_SIGN_IN.PATH}?`)) return undefined;
  return asked;
}
