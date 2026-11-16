import type { NumberedAddress } from "@repo/features/link-grammar";
import { createContext, useContext } from "react";

/**
 * open-pull-request.ts -- the door a Pull request tab opens another pull request through, in a tab of the same panel, by its repository and number.
 *
 * A link to another pull request pressed inside a Pull request tab leaves
 * for GitHub (`use-open-link.ts`'s `PullRequestsOnGitHub`), since the tab
 * already is a pull request; what the tab offers to open as a pull request
 * of its own, a stack's other entries (`pull-request-stack.tsx`), opens
 * through this door instead, in the panel that holds the tab. Outside a
 * panel there is none, and the tab opens them on GitHub.
 */

const OpenPullRequestContext = createContext<((pullRequest: NumberedAddress) => void) | undefined>(
  undefined,
);

/** Hands a Pull request tab the door that opens another pull request in its panel. */
export const OpenPullRequestProvider = OpenPullRequestContext.Provider;

/** The door that opens a pull request in the panel holding the tab; none outside one. */
export function useOpenPullRequest(): ((pullRequest: NumberedAddress) => void) | undefined {
  return useContext(OpenPullRequestContext);
}
