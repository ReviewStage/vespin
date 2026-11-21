// task-row-fit-model.test.ts -- a task row lets its lesser marks go only as its name needs the room, and takes them back once it has room again.

import { describe, expect, it } from "vitest";
import { sparedMarksDropped } from "./task-row-fit-model.js";

describe("sparedMarksDropped", () => {
  it.each([
    {
      case: "a name that fits keeps every mark",
      fit: { name: 120, room: 150, marks: [{ width: 22, dropped: false }] },
      dropped: 0,
    },
    {
      case: "a cut name lets the first mark go where that is room enough",
      fit: {
        name: 160,
        room: 150,
        marks: [
          { width: 22, dropped: false },
          { width: 40, dropped: false },
        ],
      },
      dropped: 1,
    },
    {
      case: "a name still cut lets the next go too",
      fit: {
        name: 200,
        room: 150,
        marks: [
          { width: 22, dropped: false },
          { width: 40, dropped: false },
        ],
      },
      dropped: 2,
    },
    {
      case: "a name too long for any room lets every mark go and no more",
      fit: { name: 400, room: 150, marks: [{ width: 22, dropped: false }] },
      dropped: 1,
    },
    {
      case: "a row widened takes back a mark it let go",
      fit: {
        name: 160,
        room: 200,
        marks: [
          { width: 22, dropped: true },
          { width: 40, dropped: false },
        ],
      },
      dropped: 0,
    },
    {
      case: "a row with barely the room a mark aside takes leaves it aside",
      fit: {
        name: 160,
        room: 184,
        marks: [
          { width: 22, dropped: true },
          { width: 40, dropped: false },
        ],
      },
      dropped: 1,
    },
    {
      case: "a row whose name fits only with a mark aside keeps it aside",
      fit: {
        name: 160,
        room: 160,
        marks: [
          { width: 22, dropped: true },
          { width: 40, dropped: false },
        ],
      },
      dropped: 1,
    },
  ])("$case", ({ fit, dropped }) => {
    expect(sparedMarksDropped(fit)).toBe(dropped);
  });
});
