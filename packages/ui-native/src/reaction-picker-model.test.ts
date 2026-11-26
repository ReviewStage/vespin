// reaction-picker-model.test.ts -- the reaction picker's search finds an emoji by any of Slack's names for it, and lists each by the kind its reaction is kept as.

import { type SlackEmojiTable, slackEmojiIndex } from "@repo/features/slack-emoji";
import { describe, expect, it } from "vitest";
import { reactionPicks } from "./reaction-picker-model.js";

const TABLE: SlackEmojiTable = [
  ["👍", "+1", "thumbsup"],
  ["🎉", "tada"],
  ["🤩", "star-struck", "grinning_face_with_star_eyes"],
  ["⭐", "star"],
];

const INDEX = slackEmojiIndex(TABLE);

/** The kinds `query` lists, in the order they stand. */
function kindsFor(query: string): readonly string[] {
  return reactionPicks(TABLE, INDEX, query).map((pick) => pick.name);
}

describe("reactionPicks", () => {
  // Note that the regression this catches is a search that misses an emoji named only by an alias, or 👍 listed as `+1`, under which the reader's own 👍, kept as `thumbsup`, never stands ringed.
  it("finds an emoji by any of its names and lists it by the kind it is kept as", () => {
    expect(kindsFor("")).toEqual(["thumbsup", "tada", "star-struck", "star"]);
    expect(kindsFor(":Star Eyes")).toEqual(["star-struck"]);
    expect(kindsFor("+1")).toEqual(["thumbsup"]);
    expect(kindsFor("🎉")).toEqual(["tada"]);
  });
});
