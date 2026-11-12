// lucide-symbols.mjs -- Lucide's glyphs as SF Symbols custom symbol templates, their strokes outlined, for the iOS app's asset catalog.
//
// Lucide draws strokes, round-capped and round-joined, on a 24-unit square,
// and a symbol template holds filled outlines, so each stroke is outlined
// here. A template carries three weights (Ultralight-S, Regular-S, Black-S)
// that iOS interpolates point by point into every weight and scale, which
// only works when the three hold the same paths and, per path, the same
// commands. So the outline of a stroke is built from the stroke's geometry
// alone and only its points move with the width: a ring is two circles, a
// run of tangent segments is its two offset sides joined by round caps, and
// a corner splits a run into two, each round-capped, whose overlap draws the
// round join. `symbolTemplate` asserts the three agree before it answers.

// The template's own geometry, as Xcode's minimal template writers lay it
// out: an 800 by 600 board whose small row's cap line stands at 76 and
// baseline at 146, a cap height of 70, with each weight centered in its own
// column. The medium and large rows hold only their guides, since iOS
// derives both scales from the small row.
const CAPLINE = 76;
const BASELINE = 146;
const CAP_HEIGHT = BASELINE - CAPLINE;
const WEIGHT_CENTER = { ULTRALIGHT: 265, REGULAR: 465, BLACK: 665 };

// Note that Lucide's 24-unit square stands at one and a half cap heights,
// centered on the cap height's middle, because that is the size SF Symbols
// draws its own outlined glyphs at beside text (a circle spans about 1.25 cap
// heights, as Lucide's 20-unit drawings then do).
const BOX = 24;
const BOX_SIZE = CAP_HEIGHT * 1.5;
const SCALE = BOX_SIZE / BOX;
const BOX_TOP = CAPLINE + CAP_HEIGHT / 2 - BOX_SIZE / 2;

// Each weight's stroke, in Lucide's units: Regular is Lucide's own 2, which
// stands as thick as SF Symbols' regular strokes at this size; Black stops
// short of 4, where a stroke's inner side would close Lucide's tightest
// curve, the pull request's corner of radius 2.
const STROKE = { ULTRALIGHT: 0.6, REGULAR: 2, BLACK: 3.4 };

// Two segments that meet within this turn are one run, their offsets joined
// by a line too short to see; a sharper turn is a corner.
const TANGENT_TOLERANCE = (8 * Math.PI) / 180;

// The control point distance a quarter circle's cubic sits at.
const QUARTER = (4 / 3) * Math.tan(Math.PI / 8);

// ---------- Vectors ----------

const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const times = (a, k) => ({ x: a.x * k, y: a.y * k });
const unit = (a) => times(a, 1 / Math.hypot(a.x, a.y));
const polar = (angle) => ({ x: Math.cos(angle), y: Math.sin(angle) });

// The normal on a stroke's first side, a quarter turn from its direction.
const normalOf = (direction) => ({ x: direction.y, y: -direction.x });
const turnBetween = (a, b) => Math.abs(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y));

// ---------- Lucide's drawing, read into segments ----------

// An arc in the SVG's endpoint form, read into its center form (SVG 1.1's
// implementation notes, F.6.5 and F.6.6).
function arcSegment(from, rx, ry, largeArc, sweep, to) {
  if (rx !== ry) throw new Error("lucide-symbols: an elliptical arc has no circular outline");
  const half = times(sub(from, to), 0.5);
  const lambda = (half.x * half.x + half.y * half.y) / (rx * rx);
  const radius = lambda > 1 ? rx * Math.sqrt(lambda) : rx;
  const chord = Math.hypot(half.x, half.y);
  const rise = Math.sqrt(Math.max(0, radius * radius - chord * chord)) / chord;
  const sign = largeArc === sweep ? -1 : 1;
  const middle = times(add(from, to), 0.5);
  const center = add(middle, times({ x: half.y, y: -half.x }, sign * rise));
  const start = Math.atan2(from.y - center.y, from.x - center.x);
  let delta = Math.atan2(to.y - center.y, to.x - center.x) - start;

  if (sweep && delta < 0) delta += 2 * Math.PI;

  if (!sweep && delta > 0) delta -= 2 * Math.PI;

  return { kind: "arc", from, to, center, radius, start, delta };
}

const lineSegment = (from, to) => ({ kind: "line", from, to });

function directionAt(segment, end) {
  if (segment.kind === "line") return unit(sub(segment.to, segment.from));
  const angle = segment.start + (end ? segment.delta : 0);

  return times(polar(angle + Math.PI / 2), Math.sign(segment.delta));
}

// A path's data as its subpaths, each a list of segments; Lucide's glyphs
// here use only moves, lines, and arcs, and anything else is refused.
function subpathsOf(data) {
  const tokens = data.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+)(?:e-?\d+)?/g) ?? [];
  const subpaths = [];
  let at = { x: 0, y: 0 };
  let current;
  let command;
  let index = 0;
  const number = () => Number(tokens[index++]);

  while (index < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[index])) command = tokens[index++];
    const relative = command === command.toLowerCase();
    const offset = (point) => (relative ? add(at, point) : point);

    switch (command.toLowerCase()) {
      case "m":
        at = offset({ x: number(), y: number() });
        current = [];
        subpaths.push(current);
        command = relative ? "l" : "L";
        break;
      case "l": {
        const to = offset({ x: number(), y: number() });
        current.push(lineSegment(at, to));
        at = to;
        break;
      }

      case "h": {
        const x = number();
        const to = { x: relative ? at.x + x : x, y: at.y };
        current.push(lineSegment(at, to));
        at = to;
        break;
      }

      case "v": {
        const y = number();
        const to = { x: at.x, y: relative ? at.y + y : y };
        current.push(lineSegment(at, to));
        at = to;
        break;
      }

      case "a": {
        const [rx, ry] = [number(), number()];
        number();
        const [largeArc, sweep] = [number() === 1, number() === 1];
        const to = offset({ x: number(), y: number() });
        current.push(arcSegment(at, rx, ry, largeArc, sweep, to));
        at = to;
        break;
      }

      default:
        throw new Error(`lucide-symbols: no outline for the path command "${command}"`);
    }
  }

  return subpaths;
}

// A subpath as its runs: its segments split wherever two meet at a corner.
function runsOf(segments) {
  const runs = [];

  for (const segment of segments) {
    const run = runs.at(-1);

    const tangent =
      run !== undefined &&
      turnBetween(directionAt(run.at(-1), true), directionAt(segment, false)) < TANGENT_TOLERANCE;

    if (tangent) run.push(segment);
    else runs.push([segment]);
  }

  return runs;
}

// Lucide's icon node as what is outlined: rings and runs, in drawing order.
function strokesOf(node) {
  const strokes = [];

  for (const [element, attributes] of node) {
    const value = (name) => Number(attributes[name]);

    if (element === "circle") {
      strokes.push({
        kind: "ring",
        center: { x: value("cx"), y: value("cy") },
        radius: value("r"),
      });
    } else if (element === "line") {
      const from = { x: value("x1"), y: value("y1") };
      strokes.push({
        kind: "run",
        segments: [lineSegment(from, { x: value("x2"), y: value("y2") })],
      });
    } else if (element === "path") {
      for (const subpath of subpathsOf(attributes.d))
        for (const run of runsOf(subpath)) strokes.push({ kind: "run", segments: run });
    } else {
      throw new Error(`lucide-symbols: no outline for a <${element}>`);
    }
  }

  return strokes;
}

// ---------- Outlines ----------

// An arc of `radius` about `center`, from `start` through `delta`, as cubics:
// one per quarter turn or less of the drawing's own arc, so the count never
// depends on the width.
function arcCubics(center, radius, start, delta) {
  const pieces = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / pieces;
  const reach = (4 / 3) * Math.tan(step / 4) * radius;
  const cubics = [];

  for (let piece = 0; piece < pieces; piece++) {
    const a = start + step * piece;
    const b = a + step;
    const p0 = add(center, times(polar(a), radius));
    const p3 = add(center, times(polar(b), radius));
    const c1 = add(p0, times(polar(a + Math.PI / 2), reach));
    const c2 = sub(p3, times(polar(b + Math.PI / 2), reach));
    cubics.push({ command: "C", points: [c1, c2, p3] });
  }

  return cubics;
}

// A half circle of `radius` about `point`, from the side `from` faces round
// through `ahead`, as two quarter cubics.
function capCubics(point, radius, from, ahead) {
  const quarter = (u, v) => ({
    command: "C",
    points: [
      add(point, times(add(u, times(v, QUARTER)), radius)),
      add(point, times(add(v, times(u, QUARTER)), radius)),
      add(point, times(v, radius)),
    ],
  });

  return [quarter(from, ahead), quarter(ahead, times(from, -1))];
}

// One side of a segment, `side` the normal's sign, traveled forward or back.
function sideOf(segment, half, side, forward) {
  if (segment.kind === "line") {
    const normal = times(normalOf(directionAt(segment, false)), half * side);
    const start = add(forward ? segment.from : segment.to, normal);
    const end = add(forward ? segment.to : segment.from, normal);

    return { start, commands: [{ command: "L", points: [end] }] };
  }

  // Note that an arc's offset is an arc about the same center, its radius
  // grown or shrunk by the half width as the side faces out or in.
  const radius = segment.radius + half * side * Math.sign(segment.delta);

  if (radius <= 0) throw new Error("lucide-symbols: a stroke closes a curve tighter than it");
  const start = forward ? segment.start : segment.start + segment.delta;
  const delta = forward ? segment.delta : -segment.delta;

  return {
    start: add(segment.center, times(polar(start), radius)),
    commands: arcCubics(segment.center, radius, start, delta),
  };
}

// A run's outline: out along its first side, round its end, back along its
// second, and round its start.
function runOutline(segments, half) {
  const commands = [];

  const travel = (sides) => {
    for (const [index, { start, commands: along }] of sides.entries()) {
      if (index === 0)
        commands.push({ command: commands.length === 0 ? "M" : "L", points: [start] });
      else commands.push({ command: "L", points: [start] });
      commands.push(...along);
    }
  };

  const first = segments[0];
  const last = segments.at(-1);
  const endNormal = normalOf(directionAt(last, true));
  const startNormal = normalOf(directionAt(first, false));
  travel(segments.map((segment) => sideOf(segment, half, 1, true)));
  commands.push(...capCubics(last.to, half, endNormal, directionAt(last, true)));
  travel(segments.toReversed().map((segment) => sideOf(segment, half, -1, false)));
  commands.push(
    ...capCubics(first.from, half, times(startNormal, -1), times(directionAt(first, false), -1)),
  );
  commands.push({ command: "Z", points: [] });

  return commands;
}

// A ring's outline: its outer circle one way and its inner the other, so the
// inside stays open under the nonzero fill.
function ringOutline({ center, radius }, half) {
  if (radius - half <= 0) throw new Error("lucide-symbols: a stroke fills a ring's inside");

  const circle = (r, delta) => [
    { command: "M", points: [add(center, { x: r, y: 0 })] },
    ...arcCubics(center, r, 0, delta),
    { command: "Z", points: [] },
  ];

  return [...circle(radius + half, 2 * Math.PI), ...circle(radius - half, -2 * Math.PI)];
}

const outlineOf = (stroke, half) =>
  stroke.kind === "ring" ? ringOutline(stroke, half) : runOutline(stroke.segments, half);

// ---------- The template ----------

const coordinate = (value) => {
  const rounded = Math.round(value * 1000) / 1000;

  return Object.is(rounded, -0) ? "0" : String(rounded);
};

function pathData(commands, centerX) {
  const left = centerX - BOX_SIZE / 2;
  const place = ({ x, y }) => `${coordinate(left + x * SCALE)},${coordinate(BOX_TOP + y * SCALE)}`;

  return commands.map(({ command, points }) => [command, ...points.map(place)].join(" ")).join(" ");
}

function weightGroup(name, strokes, weight) {
  const paths = strokes.map((stroke) => outlineOf(stroke, STROKE[weight] / 2));

  return {
    shapes: paths.map((commands) => commands.map(({ command }) => command).join("")),
    svg: `<g id="${name}-S">${paths
      .map((commands) => `<path d="${pathData(commands, WEIGHT_CENTER[weight])}"/>`)
      .join("")}</g>`,
  };
}

function marginGuides(name, weight) {
  const center = WEIGHT_CENTER[weight];

  return [
    `<path id="left-margin-${name}-S" d="M${coordinate(center - BOX_SIZE / 2)},56 l0,110"/>`,
    `<path id="right-margin-${name}-S" d="M${coordinate(center + BOX_SIZE / 2)},56 l0,110"/>`,
  ].join("");
}

const WEIGHTS = [
  ["Ultralight", "ULTRALIGHT"],
  ["Regular", "REGULAR"],
  ["Black", "BLACK"],
];

/**
 * A Lucide icon's node (`lucide-react`'s `__iconData.node`) as an SF Symbols
 * custom symbol template, version 3.0, whose three weights iOS interpolates.
 */
export function symbolTemplate(node) {
  const strokes = strokesOf(node);
  const weights = WEIGHTS.map(([name, weight]) => weightGroup(name, strokes, weight));
  const [ultralight, regular, black] = weights.map(({ shapes }) => shapes.join("|"));

  if (ultralight !== regular || regular !== black)
    throw new Error("lucide-symbols: the weights' outlines differ in shape and cannot interpolate");

  const guides = [
    `<path id="Capline-S" d="M18,${CAPLINE} l800,0"/>`,
    `<path id="H-reference" stroke="none" d="M85,145.755 L87.685,145.755 L113.369,79.287 L114.052,79.287 L114.052,76 L112.148,76 L85,145.755 Z M95.693,121.536 L130.996,121.536 L130.263,119.313 L96.474,119.313 L95.693,121.536 Z M139.15,145.755 L141.787,145.755 L114.638,76 L113.466,76 L113.466,79.287 L139.15,145.755 Z"/>`,
    `<path id="Baseline-S" d="M18,${BASELINE} l800,0"/>`,
    ...WEIGHTS.map(([name, weight]) => marginGuides(name, weight)),
    `<path id="Capline-M" d="M18,276 l800,0"/>`,
    `<path id="Baseline-M" d="M18,346 l800,0"/>`,
    `<path id="Capline-L" d="M18,476 l800,0"/>`,
    `<path id="Baseline-L" d="M18,546 l800,0"/>`,
  ].join("");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg width="800" height="600" version="1.1" xmlns="http://www.w3.org/2000/svg">`,
    `<g id="Notes" font-family="sans-serif" font-size="13px"><rect x="0" y="0" width="800" height="600" fill="white"/><text x="18" y="176">Small</text><text x="18" y="376">Medium</text><text x="18" y="576">Large</text><text id="template-version" x="785" y="575" text-anchor="end">Template v.3.0</text></g>`,
    `<g id="Guides" stroke="rgb(39,170,225)" stroke-width="0.5px">${guides}</g>`,
    `<g id="Symbols">${weights.map(({ svg }) => svg).join("")}</g>`,
    `</svg>`,
  ].join("");
}
