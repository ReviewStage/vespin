import { describe, expect, it } from "vitest";
import { PORT_ACT, portRows } from "./agent-ports-model.js";

const PORTS = [
  { port: 3000, label: "vite" },
  { port: 5173, label: undefined },
];

describe("portRows", () => {
  it.each([
    {
      when: "none is shared",
      shared: undefined,
      rows: [
        { port: 3000, url: undefined, acts: [PORT_ACT.SHARE] },
        { port: 5173, url: undefined, acts: [PORT_ACT.SHARE] },
      ],
    },
    {
      when: "one is shared",
      shared: { port: 3000, url: "https://one.vespin.page" },
      rows: [
        {
          port: 3000,
          url: "https://one.vespin.page",
          acts: [PORT_ACT.OPEN_LINK, PORT_ACT.COPY_LINK, PORT_ACT.STOP_SHARING],
        },
        { port: 5173, url: undefined, acts: [] },
      ],
    },
    {
      when: "the shared one is no longer listed",
      shared: { port: 8080, url: "https://gone.vespin.page" },
      rows: [
        { port: 3000, url: undefined, acts: [] },
        { port: 5173, url: undefined, acts: [] },
        {
          port: 8080,
          url: "https://gone.vespin.page",
          acts: [PORT_ACT.OPEN_LINK, PORT_ACT.COPY_LINK, PORT_ACT.STOP_SHARING],
        },
      ],
    },
  ])("offers Share on every port only while none is shared ($when)", ({ shared, rows }) => {
    expect(portRows({ ports: PORTS, shared })).toMatchObject(rows);
  });
});
