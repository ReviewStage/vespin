// mention-offer.test.ts -- an `@` offers its groups in the panel's order, browses its kinds, narrows to one by its word before a colon, and writes a description's sections and a date as the panel's picks do.

import { describe, expect, it } from "vitest";
import {
  dateCandidates,
  descriptionCandidates,
  MENTION_OFFER_KIND,
  type MentionCandidate,
  mentionOffer,
} from "./mention-offer.js";

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
    description: [],
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

  it("narrows to the description's sections and the description whole, each a pick writing the panel's link", () => {
    const place = { workspace: "acme", repository: null };
    const text = "Intro\n\n## Rollout\n\nSteps\n\n## Ship it\n";

    const description = descriptionCandidates(
      { taskId: "42", name: "Invite flow", key: "ACME-42" },
      text,
      place,
    );

    const offered = mentionOffer({ ...sources, description }, "description:");

    expect(offered.narrowed?.name).toBe("Description");
    expect(
      offered.groups.flatMap((group) =>
        group.rows.map((each) => [each.name, "target" in each ? each.target : undefined]),
      ),
    ).toEqual([
      ["Rollout", "https://vespin.dev/acme/task/42#rollout"],
      ["Ship it", "https://vespin.dev/acme/task/42#ship-it"],
      ["Invite flow", "https://vespin.dev/acme/task/42"],
    ]);
  });

  it("says a date as the chip does and writes the day it names whole, as the panel's pick does", () => {
    const now = Date.UTC(2026, 10, 22, 21, 0);

    const [tomorrow] = dateCandidates("tomorrow", now, "America/Los_Angeles", {
      workspace: "acme",
      repository: null,
    });

    expect([tomorrow?.name, tomorrow?.written]).toEqual(["Tomorrow", "Nov 23, 2026"]);
  });
});
