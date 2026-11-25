// @vitest-environment jsdom

import { act, createElement, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { leavingPlace } from "../../testing/leaving-place.js";
import { useDisclosureFold } from "../disclosure/disclosure.js";
import {
  LIST_MOTION_WAY,
  ListMotion,
  type ListMotionWay,
  motionKey,
  motionRows,
  useLeaving,
} from "./list-motion.js";

/**
 * list-motion.test.ts -- a row arriving in a list stands at once and the
 * rows it pushed down glide, a row leaving goes at once and the rows under
 * it close over it while the list holds its height at the scroller's end,
 * a row moved from one list to another glides across rather than leaving
 * and arriving, a row in a list a transform around it draws smaller glides
 * as far as its layout moved it, a change landing while rows still move
 * adds onto what they play rather than stopping it, nothing plays where no
 * motion is to play, an unrolling list's row rolls up and is let go once
 * that has played, or stands again and comes back the way it went, a row
 * out of the reader's sight plays nothing, so a change of thousands of rows
 * plays a screenful, and the rows under a fold glide up once its body has
 * gone.
 * jsdom lays nothing out and plays nothing, so each row's place is given
 * and each motion recorded.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** How tall a row is drawn, and how far apart the lists stand, in the layout given. */
const ROW = 40;
const COLUMN = 200;

/** The motion tokens the lists read, as an app's sheets set them. */
const TOKENS = {
  "--ui-duration-exit": "90ms",
  "--ui-motion-exit": "ease",
  "--ui-duration-quick": "140ms",
  "--ui-duration-shape": "460ms",
  "--ui-spring": "ease-out",
} as const;

/** A motion played: the element, its keyframes and timing, a way to have it finish, and whether it was stopped. */
interface Played {
  readonly element: Element;
  readonly keyframes: Keyframe[];
  readonly timing: KeyframeAnimationOptions;
  readonly finish: () => void;
  readonly stopped: () => boolean;
}

let root: Root | undefined;
let played: Played[] = [];

/** How far each row is drawn from its place by the glides it was handed, where a test draws them (`drawGlides`): each glide's first frame, added onto the last, as a browser draws a row the frame a glide starts. */
let drawGlides = false;
const shifted = new Map<Element, number>();

/** Draws `row` `y` from its place, where its rect and its transform both say it, as a browser draws a row mid-glide. */
function drawShift(row: Element, y: number): void {
  shifted.set(row, y);

  if (row instanceof HTMLElement) row.style.transform = `matrix(1, 0, 0, 1, 0, ${y})`;
}

type Motion = { onfinish: (() => void) | null; cancel: () => void };

beforeEach(() => {
  played = [];
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value(this: Element, keyframes: Keyframe[], timing: KeyframeAnimationOptions) {
      let canceled = false;

      const motion: Motion = {
        onfinish: null,
        cancel: () => {
          canceled = true;
        },
      };

      const glide = /^translate\(0px, (-?[\d.]+)px\)$/.exec(String(keyframes[0]?.transform ?? ""));

      if (drawGlides && glide !== null) {
        drawShift(this, (shifted.get(this) ?? 0) + Number(glide[1]));
      }

      played.push({
        element: this,
        keyframes,
        timing,
        finish: () => motion.onfinish?.(),
        stopped: () => canceled,
      });

      return motion;
    },
  });
  // Note that each list stands in its own column, and each row under the rows before it still in the layout, laid out as list-motion.css lays a leaving row, which jsdom does not read.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const list = this.parentElement;

    // Note that a row taken out of the layout is drawn nowhere, as a browser draws it: an empty box at the window's corner.
    if (!this.matches("li") || list === null || leavingPlace(this) === "gone") {
      return new DOMRect(0, 0, 0, 0);
    }

    const laidOut = [...list.children].filter(
      (each) => each instanceof HTMLElement && topOf(each) === undefined,
    );

    const column = [...(list.parentElement?.children ?? [])].indexOf(list);
    const top = topOf(this) ?? laidOut.indexOf(this) * ROW;

    return new DOMRect(column * COLUMN, top + (shifted.get(this) ?? 0), COLUMN, ROW);
  });
});

afterEach(() => {
  drawGlides = false;
  shifted.clear();
  vi.useRealTimers();
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();

  for (const name of Object.keys(TOKENS)) document.documentElement.style.removeProperty(name);
  Reflect.deleteProperty(Element.prototype, "animate");
  vi.restoreAllMocks();
});

/** Where a row out of the layout stands: laid over its place as it leaves, else where its run placed it; none for a row in the layout. */
function topOf(row: HTMLElement): number | undefined {
  const place = leavingPlace(row);

  if (place !== undefined && place !== "gone") return place.top;

  return row.style.position === "absolute" ? Number.parseFloat(row.style.top) : undefined;
}

/** Where a row a run places itself stands: absolutely, at its place in the run, as `VirtualRows` stands one. */
function placedAt(at: number): React.CSSProperties {
  return { position: "absolute", top: `${at * ROW}px` };
}

/** One list's rows, each by its key, drawn on while it leaves, each standing where it is `placed` where the list places its rows itself. */
function Rows({
  keys,
  placed = false,
}: {
  keys: readonly string[];
  placed?: boolean;
}): React.JSX.Element {
  const drawn = useLeaving(keys, (key) => key);

  return createElement(
    "ul",
    motionRows(),
    drawn.map(({ key }, at) =>
      createElement(
        "li",
        { key, ...motionKey(key), ...(placed ? { style: placedAt(at) } : undefined) },
        key,
      ),
    ),
  );
}

/** Lists side by side, each by its rows' keys, under one motion where `moving`, as the scene `scene`, their rows placed by the lists where `placed`, arriving and leaving `way`. */
function Lists({
  lists,
  moving,
  scene,
  placed,
  way,
}: {
  lists: readonly (readonly string[])[];
  moving: boolean;
  scene?: string | undefined;
  placed: boolean;
  way: ListMotionWay;
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null);

  const drawn = createElement(
    "div",
    { ref: box },
    lists.map((keys, at) => createElement(Rows, { key: String(at), keys, placed })),
  );

  return moving ? createElement(ListMotion, { root: box, scene, way, children: drawn }) : drawn;
}

/** Draws `lists`, the motion's tokens set where `tokens`, their rows placed by the lists where `placed`, and hands back a way to draw others, as the scene it names. */
function draw(
  lists: readonly (readonly string[])[],
  {
    moving = true,
    tokens = true,
    scene,
    placed = false,
    way = LIST_MOTION_WAY.AT_ONCE,
  }: {
    moving?: boolean;
    tokens?: boolean;
    scene?: string;
    placed?: boolean;
    way?: ListMotionWay;
  } = {},
): (next: readonly (readonly string[])[], nextScene?: string) => void {
  if (tokens) {
    for (const [name, value] of Object.entries(TOKENS)) {
      document.documentElement.style.setProperty(name, value);
    }
  }

  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(Lists, { lists, moving, scene, placed, way })));

  return (next, nextScene = scene) =>
    act(() =>
      root?.render(createElement(Lists, { lists: next, moving, scene: nextScene, placed, way })),
    );
}

/** The rows drawn, each list's keys in its order. */
function drawn(): string[][] {
  return [...document.querySelectorAll("ul")].map((list) =>
    [...list.children].map((row) => row.textContent ?? ""),
  );
}

/** The row of `key` drawn, and none where none is. */
function rowOf(key: string, leaving = false): Element | undefined {
  return [...document.querySelectorAll(`li`)].find(
    (row) => row.textContent === key && row.hasAttribute("data-leaving") === leaving,
  );
}

/** The motions played on `element`, by their keyframes. */
function motionsOf(element: Element | undefined): Keyframe[][] {
  return played.filter((each) => each.element === element).map((each) => each.keyframes);
}

/** The clip a row is drawn behind, by its key; none for a row not drawn. */
function clipOf(key: string): string | undefined {
  const row = rowOf(key);

  return row instanceof HTMLElement ? row.style.clipPath : undefined;
}

test("nothing plays the first time a list is drawn", () => {
  draw([["A", "B"]]);

  expect(played).toEqual([]);
});

test("a row arriving stands at once, and the row it pushed down glides from where it stood", () => {
  const show = draw([["A", "B"]]);

  show([["A", "N", "B"]]);

  expect(motionsOf(rowOf("N"))).toEqual([]);
  expect(motionsOf(rowOf("B"))).toEqual([
    [{ transform: `translate(0px, ${-ROW}px)` }, { transform: "none" }],
  ]);
  expect(motionsOf(rowOf("A"))).toEqual([]);
});

test("a row arriving is clipped each frame at the top of the row it pushed down, where that row is drawn, and given its own clip back once that row has come to rest", () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  drawGlides = true;
  const show = draw([["A", "B"]]);

  show([["A", "N", "B"]]);

  const under = rowOf("B");
  expect(clipOf("N")).toBe(`inset(0 0 ${ROW}px 0)`);

  if (under !== undefined) drawShift(under, -ROW / 2);
  vi.advanceTimersToNextFrame();

  expect(clipOf("N")).toBe(`inset(0 0 ${ROW / 2}px 0)`);

  if (under !== undefined) drawShift(under, 0);
  vi.advanceTimersByTime(500);

  expect(clipOf("N")).toBe("");
});

test("rows arriving together, and a row arriving while the row under them still glides, never stand over it", () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  drawGlides = true;
  const show = draw([["A", "B"]]);

  show([["A", "M", "B"]]);
  show([["A", "M", "N", "B"]]);

  // Note that B is drawn where it stood before either change, both glides it was handed at their first frame.
  expect(clipOf("M")).toBe(`inset(0 0 ${ROW}px 0)`);
  expect(clipOf("N")).toBe(`inset(0 0 ${2 * ROW}px 0)`);
});

test("an arriving row stops standing behind the row it pushed down once a later change stands that row above it", () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  drawGlides = true;
  const show = draw([["A", "B"]]);

  show([["A", "N", "B"]]);
  show([["B", "A", "N"]]);
  vi.advanceTimersToNextFrame();

  expect(clipOf("N")).toBe("");
});

test("a row pushed down in a list a transform around it draws at half its size glides as far as its layout moved it, not as far as it is drawn", () => {
  const show = draw([["A", "B"]]);
  const box = document.querySelector("ul")?.parentElement;

  if (!(box instanceof HTMLElement)) throw new Error("no list box");
  Object.defineProperty(box, "offsetWidth", { configurable: true, value: COLUMN });
  Object.defineProperty(box, "offsetHeight", { configurable: true, value: 4 * ROW });
  const drawnAsLaidOut = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
  const laidOut = drawnAsLaidOut.getMockImplementation();

  if (laidOut === undefined) throw new Error("no layout given");
  drawnAsLaidOut.mockImplementation(function (this: HTMLElement) {
    if (this === box) return new DOMRect(0, 0, COLUMN / 2, (4 * ROW) / 2);
    const { x, y, width, height } = laidOut.call(this);

    return new DOMRect(x / 2, y / 2, width / 2, height / 2);
  });

  show([["A", "N", "B"]]);

  expect(motionsOf(rowOf("B"))).toEqual([
    [{ transform: `translate(0px, ${-ROW}px)` }, { transform: "none" }],
  ]);
});

test("a list drawn as another scene plays nothing, and what the last scene drew goes at once", () => {
  const show = draw([["A", "B"]], { scene: "app" });

  show([["C", "D"]], "design");

  expect(played).toEqual([]);
  expect(drawn()).toEqual([["C", "D"]]);
});

test("a change landing while rows still move stops none of what they play, and adds the glide it asks for onto it", () => {
  const show = draw([["A", "B"]]);
  show([["A", "N", "B"]]);

  show([["A", "M", "N", "B"]]);

  expect(played.filter((each) => each.stopped())).toEqual([]);
  expect(motionsOf(rowOf("B")).at(-1)).toEqual([
    { transform: `translate(0px, ${-ROW}px)` },
    { transform: "none" },
  ]);
  const travels = played.filter((each) => "transform" in (each.keyframes[0] ?? {}));
  expect(travels.map((each) => each.timing.composite)).toEqual(travels.map(() => "add"));
});

test("a row leaving goes at once, and the rows under it close over it", () => {
  const show = draw([["A", "B", "C"]]);

  show([["A", "C"]]);

  expect(drawn()).toEqual([["A", "C"]]);
  expect(played.filter((each) => each.element.textContent === "B")).toEqual([]);
  expect(motionsOf(rowOf("C"))).toEqual([
    [{ transform: `translate(0px, ${ROW}px)` }, { transform: "none" }],
  ]);
});

test("a row leaving a list scrolled down holds the list as tall as it stood, so the scroller is not scrolled back", () => {
  const show = draw([["A", "B", "C"]]);
  const box = document.querySelector("ul")?.parentElement;
  const scroller = box?.parentElement;

  if (!(box instanceof HTMLElement && scroller instanceof HTMLElement)) throw new Error("no list");
  scroller.style.overflowY = "auto";
  scroller.scrollTop = ROW;
  vi.spyOn(box, "offsetHeight", "get").mockReturnValue(3 * ROW);
  const laidOut = vi.mocked(HTMLElement.prototype.getBoundingClientRect).getMockImplementation();

  if (laidOut === undefined) throw new Error("no layout given");
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (
    this: HTMLElement,
  ) {
    return this === scroller ? new DOMRect(0, 0, COLUMN, 10 * ROW) : laidOut.call(this);
  });

  show([["A", "C"]]);

  expect(box.style.getPropertyValue("--ui-list-held-height")).toBe(`${3 * ROW}px`);
});

test("a row leaving an unrolling list rolls up out of reach where it stood, as the rows under it close over it, and is let go once that has played", () => {
  const show = draw([["A", "B", "C"]], { way: LIST_MOTION_WAY.UNROLL });

  show([["A", "C"]]);

  const leaving = rowOf("B", true);
  expect(leaving?.hasAttribute("inert")).toBe(true);
  expect(motionsOf(leaving)).toEqual([
    [
      { opacity: "1", clipPath: "inset(0)" },
      { opacity: 0, clipPath: "inset(0 0 100% 0)" },
    ],
  ]);
  const glide = played.find((each) => each.element === rowOf("C"));
  expect(glide?.keyframes[0]).toEqual({ transform: `translate(0px, ${ROW}px)` });
  expect(glide?.timing.duration).toBe(90);
  expect(drawn()).toEqual([["A", "B", "C"]]);

  act(() => played.find((each) => each.element === leaving)?.finish());

  expect(drawn()).toEqual([["A", "C"]]);
});

test("a row listed again before its exit has played stands again, and comes back the way it went", () => {
  const show = draw([["A", "B", "C"]], { way: LIST_MOTION_WAY.UNROLL });
  show([["A", "C"]]);
  const leaving = rowOf("B", true);
  played = [];

  show([["A", "B", "C"]]);

  const back = rowOf("B");
  expect(back).toBe(leaving);
  expect(back?.hasAttribute("inert")).toBe(false);
  expect(motionsOf(back)).toEqual([
    [{ opacity: 0 }, { opacity: 1 }],
    [{ clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0)" }],
  ]);
});

test("a row listed again by its own list before the motion took its exit stands, rather than playing an exit that nothing lets go", () => {
  for (const [name, value] of Object.entries(TOKENS)) {
    document.documentElement.style.setProperty(name, value);
  }

  let relist: (keys: readonly string[]) => void = () => undefined;

  // Note that the list holds its rows itself, so a change of its own draws it while the motion around it hears nothing.
  function OwnRows(): React.JSX.Element {
    const [keys, setKeys] = useState<readonly string[]>(["A", "B", "C"]);
    relist = setKeys;

    return createElement(Rows, { keys });
  }

  function Moving(): React.JSX.Element {
    const box = useRef<HTMLDivElement>(null);

    return createElement(ListMotion, {
      root: box,
      children: createElement("div", { ref: box }, createElement(OwnRows)),
    });
  }

  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root?.render(createElement(Moving)));
  act(() => relist(["A", "C"]));

  act(() => {
    relist(["A", "B", "C"]);
    root?.render(createElement(Moving));
  });
  act(() => {
    for (const each of played) each.finish();
  });

  expect(drawn()).toEqual([["A", "B", "C"]]);
  expect(rowOf("B")?.hasAttribute("inert")).toBe(false);
});

test("a row its list places itself, as a virtual run does, stands again where it is placed, not over the run's first row", () => {
  const show = draw([["A", "B", "C"]], { placed: true, way: LIST_MOTION_WAY.UNROLL });
  show([["A", "C"]]);
  const leaving = rowOf("B", true);

  show([["A", "B", "C"]]);

  const back = rowOf("B");
  expect(back).toBe(leaving);
  expect(back instanceof HTMLElement ? back.style.position : undefined).toBe("absolute");
  expect(back?.getBoundingClientRect().top).toBe(ROW);
});

test("a key listed twice is drawn once, so no row is left behind as the list changes after it", () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const show = draw([["A", "B"]]);
  show([["A", "A", "B"]]);

  show([["N", "A", "B"]]);

  expect(drawn()).toEqual([["N", "A", "B"]]);
});

test("a row moved into another list glides across from where it stood rather than leaving one and arriving in the other", () => {
  const show = draw([["A", "B"], ["C"]]);

  show([["A"], ["B", "C"]]);

  expect(drawn()).toEqual([["A"], ["B", "C"]]);
  expect(motionsOf(rowOf("B"))).toEqual([
    [{ transform: `translate(${-COLUMN}px, ${ROW}px)` }, { transform: "none" }],
  ]);
  expect(motionsOf(rowOf("C"))).toEqual([
    [{ transform: `translate(0px, ${-ROW}px)` }, { transform: "none" }],
  ]);
});

test("a row arriving or leaving below the window's foot plays nothing, and one leaving there goes at once", () => {
  // Note that jsdom's window is 768px tall, so of these 40px rows the first stand in it and the last far below it.
  const many = Array.from({ length: 40 }, (_, at) => `R${at}`);
  const show = draw([["A"]], { way: LIST_MOTION_WAY.UNROLL });

  show([["A", ...many]]);

  expect(motionsOf(rowOf("R0"))).not.toEqual([]);
  expect(motionsOf(rowOf("R39"))).toEqual([]);

  played = [];
  const far = rowOf("R39");
  show([["A"]]);

  expect(motionsOf(rowOf("R0", true))).toHaveLength(1);
  expect(motionsOf(far)).toEqual([]);
  expect(far?.isConnected).toBe(false);
});

test("with no motion to play, a leaving row goes on the change that stopped listing it and nothing moves", () => {
  const show = draw([["A", "B", "C"]], { tokens: false });

  show([["A", "C"]]);

  expect(drawn()).toEqual([["A", "C"]]);
  expect(played).toEqual([]);
});

test("with no motion around it, a list lets a leaving row go at once", async () => {
  const show = draw([["A", "B"]], { moving: false });

  show([["A"]]);
  await act(async () => undefined);

  expect(drawn()).toEqual([["A"]]);
});

test("the rows under a fold glide down as a press opens it, and up once its body has faded and gone", () => {
  for (const [name, value] of Object.entries(TOKENS)) {
    document.documentElement.style.setProperty(name, value);
  }

  // Note that the fold keeps its own state and its body is a row of the list, so only the fold draws the commits that move the row under it.
  let toggle = (): void => undefined;

  function Folded(): React.JSX.Element {
    const { state } = useDisclosureFold(false);
    toggle = state.toggle;

    return createElement(
      "ul",
      motionRows(),
      createElement("li", { key: "head" }, "Head"),
      state.drawn ? createElement("li", { key: "body", ref: state.body }, "Body") : null,
      createElement("li", { key: "under" }, "Under"),
    );
  }

  function Sidebar(): React.JSX.Element {
    const box = useRef<HTMLDivElement>(null);

    return createElement(ListMotion, {
      root: box,
      children: createElement("div", { ref: box }, createElement(Folded)),
    });
  }

  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(Sidebar)));

  act(() => toggle());

  expect(drawn()).toEqual([["Head", "Body", "Under"]]);
  expect(motionsOf(rowOf("Under"))).toEqual([
    [{ transform: `translate(0px, ${-ROW}px)` }, { transform: "none" }],
  ]);

  played = [];
  act(() => toggle());

  expect(drawn()).toEqual([["Head", "Under"]]);
  expect(motionsOf(rowOf("Under"))).toEqual([
    [{ transform: `translate(0px, ${ROW}px)` }, { transform: "none" }],
  ]);
});

test("rows that unroll in together share one edge across them, as a fold's body does", () => {
  // Note that each row stands a row tall, as the rows' rects say, so the edge travels from the top of B to the foot of C.
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(ROW);
  const show = draw([["A", "D"]], { way: LIST_MOTION_WAY.UNROLL });

  show([["A", "B", "C", "D"]]);

  expect(motionsOf(rowOf("B"))[1]).toEqual([
    { clipPath: `inset(0px 0px ${ROW}px 0px)` },
    { clipPath: `inset(0px 0px ${-ROW}px 0px)` },
  ]);
  expect(motionsOf(rowOf("C"))[1]).toEqual([
    { clipPath: `inset(0px 0px ${2 * ROW}px 0px)` },
    { clipPath: "inset(0px 0px 0px 0px)" },
  ]);
});
