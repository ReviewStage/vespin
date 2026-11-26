// rig-pr-mockup.ts -- RIG ONLY, never merged: which design proposal the pull request page draws, as `-mockup <id>` names it, so the Mac queue shoots each proposal from one build.

import { Settings } from "react-native";

/** The proposals the rig draws, by the id a launch names. */
export const PR_MOCKUP = {
  NONE: "none",
  REVIEW: "review",
  DOCK: "dock",
  MERGE_CHIP: "mergechip",
  STACK: "stack",
  PEOPLE: "people",
  CHECKS: "checks",
} as const;

export type PrMockup = (typeof PR_MOCKUP)[keyof typeof PR_MOCKUP];

/** The proposal this launch draws; none where no `-mockup` names one. */
export function prMockup(): PrMockup {
  const named: unknown = Settings.get("mockup");

  return Object.values(PR_MOCKUP).find((each) => each === named) ?? PR_MOCKUP.NONE;
}
