// signed-in.ts -- the suite's `test` with `signedIn`: the test's fresh member, with the browser's context signed in as them.

import type { DemoMemberSeeded } from "@repo/service/demo/demo-member";
import { expect, test as memberTest } from "./member.js";

/**
 * The local server's sign-in (`apps/web/server/local-sign-in.ts`), which
 * mints a session with no provider between, and the parameter a bare one
 * names its member by (`MEMBER_PARAMETER` there).
 */
const SIGN_IN = { PATH: "/sign-in", MEMBER_PARAMETER: "member" } as const;

/** What the sign-in answers once it set the session's cookie: a redirect to the web app. */
const SIGNED_IN_STATUS = 302;

/**
 * The member fixture's `test` (`member.ts`) with `signedIn`: the member the
 * test seeded, signed in through the local sign-in on the test's own browser
 * context, so every page the test opens carries that member's session
 * cookie. The request goes through the context's own request client, which
 * shares the context's cookies, and stops at the redirect, so the journey
 * opens its first page itself.
 */
export const test = memberTest.extend<{ signedIn: DemoMemberSeeded }>({
  signedIn: async ({ member, context }, use) => {
    const signIn = await context.request.get(SIGN_IN.PATH, {
      params: { [SIGN_IN.MEMBER_PARAMETER]: member.userId },
      maxRedirects: 0,
    });

    expect(signIn.status(), await signIn.text()).toBe(SIGNED_IN_STATUS);
    await use(member);
  },
});

export { expect };
