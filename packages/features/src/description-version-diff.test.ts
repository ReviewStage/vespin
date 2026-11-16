import { describe, expect, it } from "vitest";
import { VERSION_CHANGE, versionDiff } from "./description-version-diff.js";

/** A description of the given body, holding no assumptions. */
const described = (body: string) => ({ body, assumptions: [] });

describe("versionDiff", () => {
  it("gives a section the version's reference definitions, so it reads a link defined in another section", () => {
    const shown = described(
      "## Goal\n\nRead [the guide][g].\n\n## References\n\n[g]: https://example.com/guide",
    );

    expect(versionDiff(null, shown).units[0]?.plain).toBe(
      "## Goal\n\nRead [the guide][g].\n\n[g]: https://example.com/guide",
    );
  });

  it("reads a struck section through the definitions of the version it was struck from", () => {
    const base = described(
      "## Goal\n\nSee [shot][s].\n\n## Notes\n\nKeep it.\n\n[s]: https://example.com/old.png",
    );

    const shown = described("## Notes\n\nKeep it.");

    const struck = versionDiff(base, shown).units.find(
      (unit) => unit.change === VERSION_CHANGE.REMOVED,
    );

    expect(struck?.plain).toBe("## Goal\n\nSee [shot][s].\n\n[s]: https://example.com/old.png");
  });
});
