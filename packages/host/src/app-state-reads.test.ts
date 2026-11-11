import { describe, expect, it } from "vitest";
import { shareAppState } from "./app-state-reads.js";

describe("shareAppState", () => {
  it("answers a reader's changed slice with the document's own nodes, not copies of them", () => {
    const kept = { id: "kept", title: "Kept" };
    const moved = { id: "moved", title: "Before" };
    const held = { tasks: [kept, moved] };
    const document = { tasks: [kept, { id: "moved", title: "After" }] };

    const shared = shareAppState(held, document);

    expect(shared).toBe(document);
    expect(shared.tasks).toBe(document.tasks);
  });

  it("keeps the held parts a fresh write left equal, and takes the parts it changed", () => {
    const kept = { id: "kept", title: "Kept" };
    const held = { tasks: [kept, { id: "moved", title: "Before" }] };
    const changed = { id: "moved", title: "After" };
    const write = { tasks: [{ id: "kept", title: "Kept" }, changed] };

    const shared = shareAppState(held, write);

    expect(shared).toEqual(write);
    expect(shared.tasks[0]).toBe(kept);
    expect(shared.tasks[1]).toBe(changed);
  });
});
