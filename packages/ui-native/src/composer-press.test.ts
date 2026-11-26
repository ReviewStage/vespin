import { describe, expect, it } from "vitest";
import { pressSend, type TakingField } from "./composer-press.js";

/** A field as the native view holds it: its words, emptied by a take in one step, and words given back laid in ahead of anything typed since. */
function nativeField(words: string): TakingField & { words: string } {
  const field = {
    words,
    take: async () => {
      const taken = field.words;
      field.words = "";

      return {
        words: taken,
        giveBack: () => {
          field.words = field.words === "" ? taken : `${taken}\n${field.words}`;
        },
      };
    },
  };

  return field;
}

describe("pressSend", () => {
  // Charles's "What abo": the render pressed in drew Send over the words it last heard, while the field held every key typed since, and both presses reached JavaScript in one batch, before any render.
  it("sends what the field holds, once, for two presses made in a render that lags the field", async () => {
    const field = nativeField("What about the release");
    const sent: string[] = [];

    const act = (words: string) => {
      sent.push(words);

      return true;
    };

    await Promise.all([pressSend(field, "What abo", act), pressSend(field, "What abo", act)]);

    expect(sent).toEqual(["What about the release"]);
    expect(field.words).toBe("");
  });

  it("acts on an empty field where Send was drawn over one, as Got it is pressed", async () => {
    const sent: string[] = [];

    await pressSend(nativeField(""), "", (words) => {
      sent.push(words);

      return true;
    });

    expect(sent).toEqual([""]);
  });

  it("lays words its holder did not take back in the field", async () => {
    const field = nativeField("Ship it");

    await pressSend(field, "Ship it", () => false);

    expect(field.words).toBe("Ship it");
  });
});
