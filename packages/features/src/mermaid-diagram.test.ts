// mermaid-diagram.test.ts -- what a diagram's picture is heard as.

import { describe, expect, it } from "vitest";
import { diagramAlt } from "./mermaid-diagram.js";

describe("diagramAlt", () => {
  // A fence's words are anyone's; a title line padded with a long run of tabs once took the reader seconds to name, on the panel and the iPhone alike.
  it("names a diagram by its title or first line, however much whitespace pads them", () => {
    const tabs = "\t".repeat(100_000);

    expect(diagramAlt("---\ntitle: Order flow\n---\nflowchart LR")).toBe("Diagram: Order flow");
    expect(diagramAlt(`pie title Votes${tabs}`)).toBe("Diagram: Votes");
    expect(diagramAlt(`---\ntitle:${tabs}a${tabs}b\n---\npie`)).toBe("Diagram: a…");
    expect(diagramAlt(`%% a note\n${tabs}x\nflowchart LR`)).toBe("Diagram: x");
  });
});
