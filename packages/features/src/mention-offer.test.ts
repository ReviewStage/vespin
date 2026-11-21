// mention-offer.test.ts -- a picked mention goes as the link the wire carries, and an `@` word is read where the words end.

import { describe, expect, it } from "vitest";
import {
  atWordEnding,
  MENTION_OFFER_KIND,
  type MentionCandidate,
  mentionOffer,
  withMentionLinks,
} from "./mention-offer.js";

describe("withMentionLinks", () => {
  it("writes each picked @name still standing as its markdown link, and leaves the rest as typed", () => {
    const sent = withMentionLinks("Ask @Dean Stratakos and @Ada, then email dean@example.com.", [
      { name: "Dean Stratakos", target: "https://vespin.dev/stage/person/u1" },
      { name: "Dean", target: "https://vespin.dev/stage/person/u2" },
    ]);

    expect(sent).toBe(
      "Ask [@Dean Stratakos](https://vespin.dev/stage/person/u1) and @Ada, then email dean@example.com.",
    );
  });
});

describe("atWordEnding", () => {
  it("reads the @ word the words end with, and none mid-word", () => {
    expect(atWordEnding("Ping @de")).toEqual({ start: 5, query: "de" });
    expect(atWordEnding("mail dean@ex")).toBeUndefined();
  });
});

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
