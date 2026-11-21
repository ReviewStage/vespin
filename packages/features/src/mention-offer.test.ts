// mention-offer.test.ts -- an `@` offers its groups in the panel's order, browses its kinds, and narrows to one by its word before a colon.

import { describe, expect, it } from "vitest";
import { MENTION_OFFER_KIND, type MentionCandidate, mentionOffer } from "./mention-offer.js";

describe("mentionOffer", () => {
  const row = (kind: MentionCandidate["kind"], name: string, key?: string): MentionCandidate => ({
    id: name,
    kind,
    name,
    key,
    target: `https://vespin.dev/stage/${name}`,
  });

  const sources = {
    suggested: [],
    agents: [row(MENTION_OFFER_KIND.AGENT, "STAG-4 reviewer")],
    tasks: [row(MENTION_OFFER_KIND.TASK, "Invite flow", "STAG-4")],
    people: ["Ada Reyes", "Dean Reyes", "Sam Ito"].map((name) =>
      row(MENTION_OFFER_KIND.PERSON, name),
    ),
    pages: [],
    threads: [],
    pullRequests: [],
    dates: (words: string) => (words === "" ? [] : [row(MENTION_OFFER_KIND.DATE, "Tomorrow")]),
  };

  const titles = (query: string) => mentionOffer(sources, query).groups.map((group) => group.title);

  it("leads with the date the words name, then the task whose key they are, before agents, as the panel orders them", () => {
    expect(titles("STAG-4")).toEqual(["Dates", "Tasks", "Agents"]);
  });

  it("browses each kind the place holds with nothing typed, a press writing its word before a colon", () => {
    const [browse] = mentionOffer(sources, "").groups;

    expect(browse?.title).toBe("Browse");
    expect(browse?.rows.map((each) => ("query" in each ? each.query : undefined))).toEqual([
      "agents:",
      "tasks:",
      "people:",
      "dates:",
    ]);
  });

  it("narrows to the kind whose word is typed before a colon, under its crumb, searched by the words after it", () => {
    const offered = mentionOffer(sources, "People:reyes");

    expect(offered.narrowed?.name).toBe("People");
    expect(offered.groups.map((group) => group.rows.map((each) => each.name))).toEqual([
      ["Ada Reyes", "Dean Reyes"],
    ]);
  });
});
