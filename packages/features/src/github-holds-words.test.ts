import { describe, expect, it } from "vitest";
import { githubHoldsWords, repositoryOwners } from "./github-holds-words.js";

describe("github holds words", () => {
  it("names each owner once, however GitHub spells it, in the order first met", () => {
    expect(repositoryOwners(["ada/relay", "Grace/ledger", "ADA/notes", "grace/site"])).toEqual([
      "ada",
      "Grace",
    ]);
  });

  it("says the accounts, then how many repositories once they are counted", () => {
    expect(githubHoldsWords(["ada", "grace"], 3)).toBe("ada and grace, 3 repositories");
    expect(githubHoldsWords(["ada"], undefined)).toBe("ada");
    expect(githubHoldsWords([], 0)).toBeUndefined();
  });
});
