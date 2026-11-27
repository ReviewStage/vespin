import { describe, expect, it } from "vitest";
import { githubAutolinks } from "./github-autolinks.js";

const HASH = "e0961605344f28afe8966a7ce4f39e6d49e6dea4";

/** Each link found in `words`, as the words it covers and the page it opens. */
function linked(words: string, repository: string | null) {
  return githubAutolinks(words, repository).map((link) => ({
    written: words.slice(link.start, link.end),
    label: link.label,
    href: link.href,
  }));
}

describe("githubAutolinks", () => {
  it("links people, teams, issues and pull requests, and whole commit hashes, as GitHub does", () => {
    const words = `@ada and @acme/core: #126 fixed it, see other/lib#9, ${HASH} and other/lib@${HASH}.`;

    expect(linked(words, "acme/app")).toEqual([
      { written: "@ada", label: "@ada", href: "https://github.com/ada" },
      {
        written: "@acme/core",
        label: "@acme/core",
        href: "https://github.com/orgs/acme/teams/core",
      },
      { written: "#126", label: "#126", href: "https://github.com/acme/app/issues/126" },
      {
        written: "other/lib#9",
        label: "other/lib#9",
        href: "https://github.com/other/lib/issues/9",
      },
      { written: HASH, label: "e096160", href: `https://github.com/acme/app/commit/${HASH}` },
      {
        written: `other/lib@${HASH}`,
        label: "other/lib@e096160",
        href: `https://github.com/other/lib/commit/${HASH}`,
      },
    ]);
  });

  it.each([
    ["an email address", "mail ada@example.com"],
    ["a reference joined to a word", "issue#12 and #12abc"],
    ["a short hash, which GitHub links only where it knows the commit", "fixed in e096160"],
    ["a path", "see docs/@ada and a/b/#3"],
  ])("leaves %s as words", (_, words) => {
    expect(linked(words, "acme/app")).toEqual([]);
  });

  it("leaves a reference to no named repository as words where the words have none", () => {
    expect(linked(`#126 and ${HASH}, by @ada`, null)).toEqual([
      { written: "@ada", label: "@ada", href: "https://github.com/ada" },
    ]);
  });
});
