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
      linkRead: true,
      rows: [
        { port: 3000, url: undefined, acts: [PORT_ACT.SHARE] },
        { port: 5173, url: undefined, acts: [PORT_ACT.SHARE] },
      ],
    },
    {
      when: "one is shared",
      shared: { port: 3000, url: "https://one.vespin.page" },
      linkRead: true,
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
      linkRead: true,
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
    {
      when: "the link is not read, so one may be live",
      shared: undefined,
      linkRead: false,
      rows: [
        { port: 3000, url: undefined, acts: [] },
        { port: 5173, url: undefined, acts: [] },
      ],
    },
  ])(
    "offers Share on every port only while none is known shared ($when)",
    ({ shared, linkRead, rows }) => {
      expect(portRows({ ports: PORTS, shared, linkRead })).toMatchObject(rows);
    },
  );
});
