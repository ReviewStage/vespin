import { describe, expect, it } from "vitest";
import { variableAddProblem, variableChanger } from "./cloud-environment-words.js";

/**
 * cloud-environment-words.test.ts -- a variable's line names who last
 * changed it, and an add refuses a name the service would refuse or one
 * saved already, on the panel and the phone alike.
 */

const ADA = { userId: "user-ada", name: "Ada" };
const GRACE = { userId: "user-grace", name: "Grace" };

// Note that the regression this catches is a line naming whoever added a variable after someone else changed it, or naming the adder of one changed by an account since deleted.
describe("whom a variable's line names", () => {
  it.each([
    {
      when: "never changed",
      variable: { name: "A", createdAt: 1, updatedAt: 1, createdBy: ADA },
      named: ADA,
    },
    {
      when: "changed by another member",
      variable: { name: "A", createdAt: 1, updatedAt: 2, createdBy: ADA, updatedBy: GRACE },
      named: GRACE,
    },
    {
      when: "changed by an account since deleted",
      variable: { name: "A", createdAt: 1, updatedAt: 2, createdBy: ADA },
      named: undefined,
    },
  ])("names the right member when $when", ({ variable, named }) => {
    expect(variableChanger(variable)).toEqual(named);
  });
});

// Note that the regression this catches is a phone's add overwriting a saved secret, or sending a name the service refuses.
describe("an added variable's name", () => {
  const saved = [{ name: "DATABASE_URL", updatedAt: 1 }];

  it.each([
    { name: "1PASSWORD", refused: true },
    { name: "DATABASE_URL", refused: true },
    { name: "SENTRY_DSN", refused: false },
  ])("refuses $name: $refused", ({ name, refused }) => {
    expect(variableAddProblem(name, saved) !== undefined).toBe(refused);
  });
});
