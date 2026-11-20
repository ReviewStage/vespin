// mention-offer.test.ts -- a picked mention goes as the link the wire carries, and an `@` word is read where the words end.

import { describe, expect, it } from "vitest";
import {
  atWordEnding,
  MENTION_OFFER_KIND,
  type MentionCandidate,
  mentionGroups,
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

describe("mentionGroups", () => {
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
    people: [],
    pages: [],
    threads: [],
    pullRequests: [],
    dates: [row(MENTION_OFFER_KIND.DATE, "Tomorrow")],
  };

  it("leads with the date the words name, then the task whose key they are, before agents, as the panel orders them", () => {
    expect(mentionGroups(sources, "STAG-4").map((group) => group.title)).toEqual([
      "Dates",
      "Tasks",
      "Agents",
    ]);
  });
});
