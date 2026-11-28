/**
 * pick.ts -- which element of a Browser tab's page stands at a point, for a member picking elements to note: a short label as the pointer moves, and on a press what the agent needs to find it, with a crop of it.
 *
 * Both read the page through the live view's own session on the tab's
 * target, at a point in the page's CSS pixels. Chromium's hit test
 * (`DOM.getNodeForLocation`) names the element, which an inspect labels by
 * its tag and its id or first class and boxes by its border. A pick reads
 * more in a world of its own on the page's main frame
 * (`Page.createIsolatedWorld`), so the page's scripts can neither see the
 * read nor bend what it answers: a selector that finds the element alone
 * (a unique id, test id, or label where one stands, else a path of tags,
 * classes, and places from the nearest such ancestor, cut where it is
 * already unique, in the tree it stands in, and after its shadow host's own
 * past ">>>" where it stands in a shadow root), its opening tag, and its words. Its accessible role and
 * name are Chromium's own (`Accessibility.getPartialAXTree`), as the
 * agent's snapshot prints them, and its ref is the one the agent's browser
 * tool names it by. The crop is the element's box with a margin, held to
 * the visible page and drawn no larger than `PICK_CROP.MAX_SIDE`. Nothing
 * read is kept, logged, or traced here: it goes to the member's panel
 * alone (root `AGENTS.md`'s cloud browser line). An element the page's main
 * world cannot reach, one in another frame, answers none.
 */

import { browserRefOf } from "@repo/features/browser-agent-actions";
import { BROWSER_PICK_BOUNDS, type BrowserLiveBox } from "@repo/features/browser-live-wire";
import { readEither } from "@repo/wire/effect";
import { Effect, Result, Schema } from "effect";
import type { CdpCommand, CdpSession } from "../agents/browser/browser-cdp.js";
import { EXCESS_KEYS, type UnparsedWireValue } from "../core.js";

/** How a pick's crop is drawn: the margin kept around the element, in CSS pixels, its longest side at most, and its JPEG quality. */
const PICK_CROP = { MARGIN: 24, MAX_SIDE: 1_024, QUALITY: 75 } as const;

/** The isolated world a pick reads the page in. */
const PICK_WORLD = "vespin-pick";

/** The tab's target as the live view attached it: the CDP session, the target session its commands go to, and its main frame. */
export interface PickTarget {
  readonly cdp: CdpSession;
  readonly sessionId: string;
  readonly frameId: string;
}

/** A point in the page's CSS pixels. */
export interface PagePoint {
  readonly x: number;
  readonly y: number;
}

/** What an inspect found: the element's box in the page's CSS pixels, and a label naming it. */
export interface Inspected {
  readonly box: BrowserLiveBox;
  readonly label: string;
}

/** What a pick found, its box in the page's CSS pixels. */
export interface Picked {
  readonly box: BrowserLiveBox;
  readonly ref: string;
  readonly selector: string;
  readonly role: string;
  readonly name: string;
  readonly tag: string;
  readonly text: string;
  readonly crop: string;
}

const read = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) =>
  readEither(schema, { excess: EXCESS_KEYS.DROP });

const readHit = read(
  Schema.Struct({ backendNodeId: Schema.Number, frameId: Schema.optional(Schema.String) }),
);

const readBoxModel = read(
  Schema.Struct({ model: Schema.Struct({ border: Schema.Array(Schema.Number) }) }),
);

const readDescribed = read(
  Schema.Struct({
    node: Schema.Struct({
      localName: Schema.String,
      attributes: Schema.optional(Schema.Array(Schema.String)),
    }),
  }),
);

const readWorld = read(Schema.Struct({ executionContextId: Schema.Number }));
const readResolved = read(Schema.Struct({ object: Schema.Struct({ objectId: Schema.String }) }));
const readCaptured = read(Schema.Struct({ data: Schema.String }));

const readDescription = read(
  Schema.Struct({
    result: Schema.Struct({
      value: Schema.Struct({
        selector: Schema.String,
        tag: Schema.String,
        text: Schema.String,
        left: Schema.Finite,
        top: Schema.Finite,
        width: Schema.Finite,
        height: Schema.Finite,
        scrollX: Schema.Finite,
        scrollY: Schema.Finite,
        viewWidth: Schema.Finite,
        viewHeight: Schema.Finite,
      }),
    }),
  }),
);

const AxValueSchema = Schema.optional(Schema.Struct({ value: Schema.optional(Schema.String) }));

const readAxTree = read(
  Schema.Struct({
    nodes: Schema.Array(Schema.Struct({ role: AxValueSchema, name: AxValueSchema })),
  }),
);

/**
 * Called on the element hit, in the pick's own world: its selector, opening
 * tag, and words, its box in the visible page, and the page's scroll and
 * visible size. Note that a field's value is never read, since it may be a
 * password.
 */
const DESCRIBE = `function () {
  const MAX_SELECTOR = ${BROWSER_PICK_BOUNDS.MAX_SELECTOR_CHARS};
  const MAX_TAG = ${BROWSER_PICK_BOUNDS.MAX_TAG_CHARS};
  const MAX_TEXT = ${BROWSER_PICK_BOUNDS.MAX_TEXT_CHARS};
  const element = this.nodeType === 1 ? this : this.parentElement;
  const flat = (text) => String(text ?? "").replace(/\\s+/g, " ").trim();
  const cut = (text, most) => (text.length > most ? text.slice(0, most - 1) + "…" : text);
  const quoted = (value) => '"' + value.replace(/["\\\\]/g, "\\\\$&") + '"';
  // A selector is checked against the tree the element stands in, and one in a shadow root follows its host's, after ">>>".
  const pathIn = (target) => {
    const root = target.getRootNode();
    const scope = root instanceof ShadowRoot ? root : document;
    const unique = (selector) => {
      try {
        return scope.querySelectorAll(selector).length === 1;
      } catch {
        return false;
      }
    };
    const named = (at) => {
      if (at.id !== "" && unique("#" + CSS.escape(at.id))) return "#" + CSS.escape(at.id);
      for (const name of ["data-testid", "data-test", "data-cy"]) {
        const value = at.getAttribute(name);
        if (value && unique("[" + name + "=" + quoted(value) + "]")) return "[" + name + "=" + quoted(value) + "]";
      }
      const label = at.getAttribute("aria-label");
      const labeled = label ? at.localName + "[aria-label=" + quoted(label) + "]" : "";
      return labeled !== "" && unique(labeled) ? labeled : null;
    };
    const step = (at) => {
      const classes = [...at.classList].slice(0, 2).map((name) => "." + CSS.escape(name)).join("");
      const same = at.parentNode === null ? [at] : [...at.parentNode.children].filter((each) => each.localName === at.localName);
      return at.localName + classes + (same.length > 1 ? ":nth-of-type(" + (same.indexOf(at) + 1) + ")" : "");
    };
    const steps = [];
    for (let at = target; at !== null; at = at.parentElement) {
      const name = named(at);
      steps.unshift(name ?? step(at));
      if (name !== null || at === document.body || unique(steps.join(" > "))) break;
    }
    const inner = steps.join(" > ");
    return root instanceof ShadowRoot ? pathIn(root.host) + " >>> " + inner : inner;
  };
  let selector = pathIn(element);
  while (selector.length > MAX_SELECTOR && selector.includes(" > ")) selector = selector.slice(selector.indexOf(" > ") + 3);
  const attributes = [...element.attributes]
    .filter((attribute) => attribute.name !== "value")
    .map((attribute) => (attribute.value === "" ? attribute.name : attribute.name + "=" + quoted(cut(attribute.value, 80))))
    .join(" ");
  const rect = element.getBoundingClientRect();
  return {
    selector: selector.slice(-MAX_SELECTOR),
    tag: cut("<" + element.localName + (attributes === "" ? "" : " " + attributes) + ">", MAX_TAG),
    text: cut(flat(element.innerText ?? element.textContent), MAX_TEXT),
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    viewWidth: document.documentElement.clientWidth,
    viewHeight: document.documentElement.clientHeight,
  };
}`;

const cut = (text: string, most: number) =>
  text.length > most ? `${text.slice(0, most - 1)}…` : text;

/** One command to the tab's target, read by the reader given; none where the browser refused it or answered something else. */
function ask<A>(
  target: PickTarget,
  command: CdpCommand,
  reader: (value: UnparsedWireValue) => Result.Result<A, unknown>,
): Effect.Effect<A | undefined> {
  return target.cdp.send({ ...command, sessionId: target.sessionId }).pipe(
    Effect.map((answer) => Result.getOrUndefined(reader(answer))),
    Effect.orElseSucceed(() => undefined),
  );
}

/** The element at a point, by its backend node id, and the frame it stands in where Chromium says; none where the page holds none there. */
function hitAt(
  target: PickTarget,
  point: PagePoint,
): Effect.Effect<
  { readonly backendNodeId: number; readonly frameId?: string | undefined } | undefined
> {
  const params = { x: Math.round(point.x), y: Math.round(point.y) };

  return ask(target, { method: "DOM.getNodeForLocation", params }, readHit);
}

/** The box a quad of eight numbers bounds. */
function boxOfQuad(quad: readonly number[]): BrowserLiveBox | undefined {
  if (quad.length !== 8) return undefined;
  const xs = [quad[0] ?? 0, quad[2] ?? 0, quad[4] ?? 0, quad[6] ?? 0];
  const ys = [quad[1] ?? 0, quad[3] ?? 0, quad[5] ?? 0, quad[7] ?? 0];
  const x = Math.min(...xs);
  const y = Math.min(...ys);

  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** A label naming an element by its tag and its id or first class, and its size. */
function labelOf(localName: string, attributes: readonly string[], box: BrowserLiveBox): string {
  const attributeOf = (name: string) => {
    const at = attributes.findIndex((attribute, index) => index % 2 === 0 && attribute === name);

    return at === -1 ? "" : (attributes[at + 1] ?? "").trim();
  };

  const id = attributeOf("id");
  const firstClass = attributeOf("class").split(/\s+/u)[0] ?? "";
  const mark = id !== "" ? `#${id}` : firstClass !== "" ? `.${firstClass}` : "";
  const size = `${Math.round(box.width)}×${Math.round(box.height)}`;

  return cut(`${localName}${mark} · ${size}`, BROWSER_PICK_BOUNDS.MAX_LABEL_CHARS);
}

/** The element at a point, boxed and labeled; none where the page holds none there or the browser could not say. */
export function inspectAt(
  target: PickTarget,
  point: PagePoint,
): Effect.Effect<Inspected | undefined> {
  return Effect.gen(function* () {
    const backendNodeId = (yield* hitAt(target, point))?.backendNodeId;

    if (backendNodeId === undefined) return undefined;
    const params = { backendNodeId };

    const [model, described] = yield* Effect.all(
      [
        ask(target, { method: "DOM.getBoxModel", params }, readBoxModel),
        ask(target, { method: "DOM.describeNode", params }, readDescribed),
      ],
      { concurrency: "unbounded" },
    );

    const box = model === undefined ? undefined : boxOfQuad(model.model.border);

    if (box === undefined || described === undefined) return undefined;
    const { localName, attributes } = described.node;

    return { box, label: labelOf(localName, attributes ?? [], box) };
  });
}

/** An element's box in the visible page, and the page's scroll and visible size, as the pick's read answers them. */
interface Seen {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly viewWidth: number;
  readonly viewHeight: number;
}

/** The visible part of an element's box with the crop's margin, in the page's document coordinates, and the scale that draws it no larger than the crop's longest side; none where none of it is visible. */
function clipOf(seen: Seen) {
  const { MARGIN, MAX_SIDE } = PICK_CROP;
  const left = Math.max(0, seen.left - MARGIN);
  const top = Math.max(0, seen.top - MARGIN);
  const right = Math.min(seen.viewWidth, seen.left + seen.width + MARGIN);
  const bottom = Math.min(seen.viewHeight, seen.top + seen.height + MARGIN);
  const width = right - left;
  const height = bottom - top;

  if (width < 1 || height < 1) return undefined;

  return {
    x: left + seen.scrollX,
    y: top + seen.scrollY,
    width,
    height,
    scale: Math.min(1, MAX_SIDE / Math.max(width, height)),
  };
}

/** The element's accessible role and name, as Chromium's tree has them; empty where it has none. */
function roleOf(
  target: PickTarget,
  backendNodeId: number,
): Effect.Effect<{ readonly role: string; readonly name: string }> {
  const command = {
    method: "Accessibility.getPartialAXTree",
    params: { backendNodeId, fetchRelatives: false },
  };

  return Effect.map(ask(target, command, readAxTree), (tree) => {
    const node = tree?.nodes[0];

    return {
      role: cut(node?.role?.value ?? "", BROWSER_PICK_BOUNDS.MAX_ROLE_CHARS),
      name: cut(node?.name?.value ?? "", BROWSER_PICK_BOUNDS.MAX_NAME_CHARS),
    };
  });
}

/** The element at a point, with what the agent needs to find it and a crop of it; none where it cannot be read or drawn. */
export function pickAt(target: PickTarget, point: PagePoint): Effect.Effect<Picked | undefined> {
  return Effect.gen(function* () {
    const hit = yield* hitAt(target, point);

    // Note that an element in another frame is not read, because the page's world places it by its own frame's viewport.
    if (hit === undefined || (hit.frameId !== undefined && hit.frameId !== target.frameId))
      return undefined;
    const { backendNodeId } = hit;
    const worldParams = { frameId: target.frameId, worldName: PICK_WORLD };

    const world = yield* ask(
      target,
      { method: "Page.createIsolatedWorld", params: worldParams },
      readWorld,
    );

    if (world === undefined) return undefined;
    const resolveParams = { backendNodeId, executionContextId: world.executionContextId };

    const resolved = yield* ask(
      target,
      { method: "DOM.resolveNode", params: resolveParams },
      readResolved,
    );

    if (resolved === undefined) return undefined;

    const callParams = {
      functionDeclaration: DESCRIBE,
      objectId: resolved.object.objectId,
      returnByValue: true,
    };

    const described = yield* ask(
      target,
      { method: "Runtime.callFunctionOn", params: callParams },
      readDescription,
    );

    const seen = described?.result.value;
    const clip = seen === undefined ? undefined : clipOf(seen);

    if (seen === undefined || clip === undefined) return undefined;
    const captureParams = { format: "jpeg", quality: PICK_CROP.QUALITY, clip };

    const [captured, named] = yield* Effect.all(
      [
        ask(target, { method: "Page.captureScreenshot", params: captureParams }, readCaptured),
        roleOf(target, backendNodeId),
      ],
      { concurrency: "unbounded" },
    );

    // Note that base64 spells three bytes in four characters.
    if (
      captured === undefined ||
      (captured.data.length * 3) / 4 > BROWSER_PICK_BOUNDS.MAX_CROP_BYTES
    )
      return undefined;

    return {
      box: { x: seen.left, y: seen.top, width: seen.width, height: seen.height },
      ref: browserRefOf(backendNodeId),
      selector: seen.selector,
      role: named.role,
      name: named.name,
      tag: seen.tag,
      text: seen.text,
      crop: captured.data,
    };
  });
}
