import { describe, expect, it } from "vitest";
import { cliPullRequestRefOf } from "./cli-pull-request-ref.js";

// Note that the regression these catch is a `vespin pr` argument read as another pull request, or a path riding in a repository's name.
describe("cliPullRequestRefOf", () => {
  it.each([
    ["owner/name#number", "acme/relay#42", { repository: "acme/relay", number: 42 }],
    [
      "a page under the pull request",
      "https://github.com/acme/relay/pull/42/files",
      { repository: "acme/relay", number: 42 },
    ],
    ["a path in the repository's name", "acme/relay/../x#42", undefined],
    ["number zero", "acme/relay#0", undefined],
    ["an issue's page", "https://github.com/acme/relay/issues/7", undefined],
  ])("reads %s", (_, argument, expected) => {
    expect(cliPullRequestRefOf(argument)).toEqual(expected);
  });
});
