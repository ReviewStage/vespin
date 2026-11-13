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
// round join. A curve is offset piece by piece, a fixed number of pieces per
// curve, so the count of commands never depends on the width either.
// `symbolTemplate` asserts the three agree before it answers.

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

// The pieces a curve is cut into before each is offset as a cubic of its own,
// fine enough that a piece of Lucide's tightest curve bends little.
const CUBIC_PIECES = 4;

// A length below which two points are one.
const NEAR = 1e-9;

// ---------- Vectors ----------

const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const times = (a, k) => ({ x: a.x * k, y: a.y * k });
const unit = (a) => times(a, 1 / Math.hypot(a.x, a.y));
const polar = (angle) => ({ x: Math.cos(angle), y: Math.sin(angle) });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const length = (a) => Math.hypot(a.x, a.y);
const lerp = (a, b, t) => add(a, times(sub(b, a), t));

// The normal on a stroke's first side, a quarter turn from its direction.
const normalOf = (direction) => ({ x: direction.y, y: -direction.x });
const turnBetween = (a, b) => Math.abs(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y));

// ---------- Lucide's drawing, read into segments ----------

// A cubic Bézier from `from` to `to` by its two control points.
const cubicSegment = (from, c1, c2, to) => ({ kind: "cubic", from, c1, c2, to });

// A quadratic Bézier, raised to the cubic that draws it.
const quadraticSegment = (from, control, to) =>
  cubicSegment(from, lerp(from, control, 2 / 3), lerp(to, control, 2 / 3), to);

const lineSegment = (from, to) => ({ kind: "line", from, to });

// An elliptical arc as cubics, one per quarter turn or less of its own sweep
// (SVG 1.1's implementation notes, F.6.5 and F.6.6, for its center).
function ellipticalArcSegments(from, rx, ry, rotation, largeArc, sweep, to) {
  const phi = (rotation * Math.PI) / 180;
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
  const half = times(sub(from, to), 0.5);
  const local = { x: cos * half.x + sin * half.y, y: -sin * half.x + cos * half.y };
  const lambda = (local.x / rx) ** 2 + (local.y / ry) ** 2;
  const [a, b] = lambda > 1 ? [rx * Math.sqrt(lambda), ry * Math.sqrt(lambda)] : [rx, ry];
  const numerator = a * a * b * b - a * a * local.y * local.y - b * b * local.x * local.x;
  const denominator = a * a * local.y * local.y + b * b * local.x * local.x;
  const rise = Math.sqrt(Math.max(0, numerator / denominator)) * (largeArc === sweep ? -1 : 1);
  const centerLocal = { x: (rise * a * local.y) / b, y: (-rise * b * local.x) / a };
  const middle = times(add(from, to), 0.5);

  const center = add(middle, {
    x: cos * centerLocal.x - sin * centerLocal.y,
    y: sin * centerLocal.x + cos * centerLocal.y,
  });

  const angleOf = (v) => Math.atan2(v.y, v.x);
  const start = angleOf({ x: (local.x - centerLocal.x) / a, y: (local.y - centerLocal.y) / b });

  let delta =
    angleOf({ x: (-local.x - centerLocal.x) / a, y: (-local.y - centerLocal.y) / b }) - start;

  if (sweep && delta < 0) delta += 2 * Math.PI;

  if (!sweep && delta > 0) delta -= 2 * Math.PI;

  const pointAt = (theta) =>
    add(center, {
      x: cos * a * Math.cos(theta) - sin * b * Math.sin(theta),
      y: sin * a * Math.cos(theta) + cos * b * Math.sin(theta),
    });

  const slopeAt = (theta) => ({
    x: -cos * a * Math.sin(theta) - sin * b * Math.cos(theta),
    y: -sin * a * Math.sin(theta) + cos * b * Math.cos(theta),
  });

  const pieces = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / pieces;
  const reach = (4 / 3) * Math.tan(step / 4);
  const segments = [];
  let at = from;

  for (let piece = 0; piece < pieces; piece++) {
    const [t0, t1] = [start + step * piece, start + step * (piece + 1)];
    const end = piece === pieces - 1 ? to : pointAt(t1);
    const c1 = add(at, times(slopeAt(t0), reach));
    const c2 = sub(end, times(slopeAt(t1), reach));
    segments.push(cubicSegment(at, c1, c2, end));
    at = end;
  }

  return segments;
}

// An arc in the SVG's endpoint form, read into its center form: a circle's
// arc kept as one, whose offset is exact, and an ellipse's as cubics.
function arcSegments(from, rx, ry, rotation, largeArc, sweep, to) {
  if (length(sub(to, from)) < NEAR) return [];

  if (rx === 0 || ry === 0) return [lineSegment(from, to)];

  if (rx !== ry) return ellipticalArcSegments(from, rx, ry, rotation, largeArc, sweep, to);
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

  return [{ kind: "arc", from, to, center, radius, start, delta }];
}

// A segment's direction at its start, or at its end, which for a cubic is its
// first control leg that has a length.
function directionAt(segment, end) {
  if (segment.kind === "line") return unit(sub(segment.to, segment.from));

  if (segment.kind === "cubic") {
    const { from, c1, c2, to } = segment;

    const legs = end
      ? [sub(to, c2), sub(to, c1), sub(to, from)]
      : [sub(c1, from), sub(c2, from), sub(to, from)];

    return unit(legs.find((leg) => length(leg) > NEAR) ?? legs[2]);
  }

  const angle = segment.start + (end ? segment.delta : 0);

  return times(polar(angle + Math.PI / 2), Math.sign(segment.delta));
}

// A path's data as its subpaths, each a list of segments: moves, lines,
// arcs, cubic and quadratic curves with their smooth forms, and closes.
function subpathsOf(data) {
  const tokens = data.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+)(?:e-?\d+)?/g) ?? [];
  const subpaths = [];
  let at = { x: 0, y: 0 };
  let start = at;
  let current;
  let command;
  let index = 0;
  // The control point a smooth curve reflects, kept only after a curve of its kind.
  let cubicControl;
  let quadraticControl;
  const number = () => Number(tokens[index++]);
  const point = () => ({ x: number(), y: number() });

  // Note that an arc's flags are one character each and may stand unspaced
  // against what follows ("a1 1 0 01.5.5"), so a flag takes its token's first
  // character and leaves the rest for the next.
  const flag = () => {
    const token = tokens[index];

    if (token.length === 1) index++;
    else tokens[index] = token.slice(1);

    return token[0] === "1";
  };

  // The subpath a segment joins, begun where the pen stands after a close.
  const draw = (...segments) => {
    if (current === undefined) {
      current = [];
      subpaths.push(current);
      start = at;
    }

    current.push(...segments.filter((segment) => length(sub(segment.to, segment.from)) >= NEAR));
  };

  while (index < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[index])) command = tokens[index++];
    const relative = command === command.toLowerCase();
    const offset = (p) => (relative ? add(at, p) : p);
    const kind = command.toLowerCase();
    const reflected = (control) => (control === undefined ? at : sub(times(at, 2), control));
    let nextCubic;
    let nextQuadratic;

    switch (kind) {
      case "m":
        at = offset(point());
        start = at;
        current = [];
        subpaths.push(current);
        command = relative ? "l" : "L";
        break;
      case "l": {
        const to = offset(point());
        draw(lineSegment(at, to));
        at = to;
        break;
      }

      case "h": {
        const x = number();
        const to = { x: relative ? at.x + x : x, y: at.y };
        draw(lineSegment(at, to));
        at = to;
        break;
      }

      case "v": {
        const y = number();
        const to = { x: at.x, y: relative ? at.y + y : y };
        draw(lineSegment(at, to));
        at = to;
        break;
      }

      case "c":
      case "s": {
        const c1 = kind === "c" ? offset(point()) : reflected(cubicControl);
        const [c2, to] = [offset(point()), offset(point())];
        draw(cubicSegment(at, c1, c2, to));
        nextCubic = c2;
        at = to;
        break;
      }

      case "q":
      case "t": {
        const control = kind === "q" ? offset(point()) : reflected(quadraticControl);
        const to = offset(point());
        draw(quadraticSegment(at, control, to));
        nextQuadratic = control;
        at = to;
        break;
      }

      case "a": {
        const [rx, ry, rotation] = [Math.abs(number()), Math.abs(number()), number()];
        const largeArc = flag();
        const sweep = flag();
        const to = offset(point());
        draw(...arcSegments(at, rx, ry, rotation, largeArc, sweep, to));
        at = to;
        break;
      }

      case "z":
        if (current !== undefined) draw(lineSegment(at, start));
        at = start;
        current = undefined;

        // Note that a close takes no numbers, so one standing after it is refused, because it would loop here.
        if (index < tokens.length && !/^[a-zA-Z]$/.test(tokens[index])) {
          throw new Error(`lucide-symbols: a number "${tokens[index]}" follows a close`);
        }

        break;
      default:
        throw new Error(`lucide-symbols: no outline for the path command "${command}"`);
    }

    cubicControl = nextCubic;
    quadraticControl = nextQuadratic;
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

// A rectangle's outline as path data, its corners rounded where it names a
// radius (one radius standing for both where it names one), as SVG draws it.
function rectData(value, attributes) {
  const [x, y, width, height] = [value("x") || 0, value("y") || 0, value("width"), value("height")];
  const named = (name) => (attributes[name] === undefined ? undefined : value(name));
  const rx = Math.min(named("rx") ?? named("ry") ?? 0, width / 2);
  const ry = Math.min(named("ry") ?? named("rx") ?? 0, height / 2);

  if (rx === 0 || ry === 0) return `M${x} ${y}H${x + width}V${y + height}H${x}Z`;
  const corner = (toX, toY) => `A${rx} ${ry} 0 0 1 ${toX} ${toY}`;

  return [
    `M${x + rx} ${y}H${x + width - rx}`,
    `${corner(x + width, y + ry)}V${y + height - ry}`,
    `${corner(x + width - rx, y + height)}H${x + rx}`,
    `${corner(x, y + height - ry)}V${y + ry}`,
    `${corner(x + rx, y)}Z`,
  ].join("");
}

// A polyline's or a polygon's points as path data, a polygon's closed.
function pointsData(points, closed) {
  const numbers = points.trim().split(/[\s,]+/u);
  const pairs = [];

  for (let at = 0; at + 1 < numbers.length; at += 2)
    pairs.push(`${numbers[at]} ${numbers[at + 1]}`);

  return `M${pairs.join("L")}${closed ? "Z" : ""}`;
}

// Each element read as the path data that draws it.
const PATH_DATA = {
  path: (_, attributes) => attributes.d,
  rect: rectData,
  polyline: (_, attributes) => pointsData(attributes.points, false),
  polygon: (_, attributes) => pointsData(attributes.points, true),
  ellipse: (value) => {
    const [cx, cy, rx, ry] = [value("cx"), value("cy"), value("rx"), value("ry")];
    const half = (toX) => `A${rx} ${ry} 0 1 1 ${toX} ${cy}`;

    return `M${cx + rx} ${cy}${half(cx - rx)}${half(cx + rx)}Z`;
  },
};

// Lucide's icon node as what is outlined: rings and runs, in drawing order.
// Note that a rectangle, a polyline, a polygon, and an ellipse are read as
// the path data that draws each, so one reader outlines them all.
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
      const to = { x: value("x2"), y: value("y2") };

      // Note that a line of no length is a dot, as a round cap draws it.
      strokes.push(
        length(sub(to, from)) < NEAR
          ? { kind: "dot", center: from }
          : { kind: "run", segments: [lineSegment(from, to)] },
      );
    } else if (element === "ellipse" && value("rx") === value("ry")) {
      strokes.push({
        kind: "ring",
        center: { x: value("cx"), y: value("cy") },
        radius: value("rx"),
      });
    } else if (PATH_DATA[element] !== undefined) {
      for (const subpath of subpathsOf(PATH_DATA[element](value, attributes)))
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

// A cubic's point and slope at `t`.
const cubicPoint = ({ from, c1, c2, to }, t) => {
  const u = 1 - t;

  return add(
    add(times(from, u * u * u), times(c1, 3 * u * u * t)),
    add(times(c2, 3 * u * t * t), times(to, t * t * t)),
  );
};

const cubicSlope = ({ from, c1, c2, to }, t) => {
  const u = 1 - t;

  return add(
    add(times(sub(c1, from), 3 * u * u), times(sub(c2, c1), 6 * u * t)),
    times(sub(to, c2), 3 * t * t),
  );
};

// A cubic cut at `t` into the two that draw it (de Casteljau).
function cubicCut(segment, t) {
  const { from, c1, c2, to } = segment;
  const [a, b, c] = [lerp(from, c1, t), lerp(c1, c2, t), lerp(c2, to, t)];
  const [d, e] = [lerp(a, b, t), lerp(b, c, t)];
  const middle = lerp(d, e, t);

  return [cubicSegment(from, a, d, middle), cubicSegment(middle, e, c, to)];
}

// A cubic as `CUBIC_PIECES` pieces of equal parameter.
function cubicPieces(segment) {
  const pieces = [];
  let rest = segment;

  for (let piece = 0; piece < CUBIC_PIECES - 1; piece++) {
    const [head, tail] = cubicCut(rest, 1 / (CUBIC_PIECES - piece));
    pieces.push(head);
    rest = tail;
  }

  return [...pieces, rest];
}

// A cubic's offset by `distance` along its normal, as one cubic: its ends
// moved along their normals and its control legs kept in direction, scaled so
// its middle lands on the true offset's middle.
function cubicOffset(segment, distance) {
  const from = add(segment.from, times(normalOf(directionAt(segment, false)), distance));
  const to = add(segment.to, times(normalOf(directionAt(segment, true)), distance));
  const [lead, tail] = [sub(segment.c1, segment.from), sub(segment.c2, segment.to)];
  const slope = cubicSlope(segment, 0.5);
  const normal = length(slope) < NEAR ? { x: 0, y: 0 } : normalOf(unit(slope));
  const middle = add(cubicPoint(segment, 0.5), times(normal, distance));
  const reach = times(add(lead, tail), 3 / 8);
  const room = dot(reach, reach);
  const scale = room < NEAR ? 1 : Math.max(0, dot(sub(middle, lerp(from, to, 0.5)), reach) / room);

  return cubicSegment(from, add(from, times(lead, scale)), add(to, times(tail, scale)), to);
}

// The radius an offset arc shrinks to no further: past the center, a stroke's
// inner side meets at its center, which a radius this small stands for.
const LEAST_RADIUS = 0.01;

// One side of a segment, `side` the normal's sign, traveled forward or back.
function sideOf(segment, half, side, forward) {
  if (segment.kind === "cubic") {
    const pieces = cubicPieces(segment).map((piece) => cubicOffset(piece, half * side));

    const ordered = forward
      ? pieces
      : pieces.toReversed().map(({ from, c1, c2, to }) => cubicSegment(to, c2, c1, from));

    return {
      start: ordered[0].from,
      commands: ordered.map(({ c1, c2, to }) => ({ command: "C", points: [c1, c2, to] })),
    };
  }

  if (segment.kind === "line") {
    const normal = times(normalOf(directionAt(segment, false)), half * side);
    const start = add(forward ? segment.from : segment.to, normal);
    const end = add(forward ? segment.to : segment.from, normal);

    return { start, commands: [{ command: "L", points: [end] }] };
  }

  // Note that an arc's offset is an arc about the same center, its radius
  // grown or shrunk by the half width as the side faces out or in.
  const radius = Math.max(LEAST_RADIUS, segment.radius + half * side * Math.sign(segment.delta));
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
  const circle = (r, delta) => [
    { command: "M", points: [add(center, { x: r, y: 0 })] },
    ...arcCubics(center, r, 0, delta),
    { command: "Z", points: [] },
  ];

  return [
    ...circle(radius + half, 2 * Math.PI),
    ...circle(Math.max(LEAST_RADIUS, radius - half), -2 * Math.PI),
  ];
}

// A dot's outline: a disc as wide as the stroke.
const dotOutline = ({ center }, half) => [
  { command: "M", points: [add(center, { x: half, y: 0 })] },
  ...arcCubics(center, half, 0, 2 * Math.PI),
  { command: "Z", points: [] },
];

const OUTLINE = {
  ring: (stroke, half) => ringOutline(stroke, half),
  dot: (stroke, half) => dotOutline(stroke, half),
  run: (stroke, half) => runOutline(stroke.segments, half),
};

const outlineOf = (stroke, half) => OUTLINE[stroke.kind](stroke, half);

// ---------- The template ----------

const coordinate = (value) => {
  if (!Number.isFinite(value)) throw new Error("lucide-symbols: an outline reached no number");
  const rounded = Math.round(value * 1000) / 1000;

  return Object.is(rounded, -0) ? "0" : String(rounded);
};

function pathData(commands, centerX) {
  const left = centerX - BOX_SIZE / 2;
  const place = ({ x, y }) => `${coordinate(left + x * SCALE)},${coordinate(BOX_TOP + y * SCALE)}`;

  return commands.map(({ command, points }) => [command, ...points.map(place)].join(" ")).join(" ");
}

function weightGroup(name, paths, weight) {
  return {
    pathCommands: paths.map((commands) => commands.map(({ command }) => command).join("")),
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

/** A template's three weights, each the outlines `outlinesAt` draws at that weight's half stroke, as an SF Symbols custom symbol template. */
function templateOf(outlinesAt) {
  const weights = WEIGHTS.map(([name, weight]) =>
    weightGroup(name, outlinesAt(STROKE[weight] / 2, weight), weight),
  );

  const [ultralight, regular, black] = weights.map(({ pathCommands }) => pathCommands.join("|"));

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

/**
 * A Lucide icon's node (`lucide-react`'s `__iconData.node`) as an SF Symbols
 * custom symbol template, version 3.0, whose three weights iOS interpolates.
 */
export function symbolTemplate(node) {
  const strokes = strokesOf(node);

  return templateOf((half) => strokes.map((stroke) => outlineOf(stroke, half)));
}

// ---------- A task's status mark ----------

// A mark's parts are a ring, its dashes, discs, and cuts: strokes outlined as
// Lucide's are, and fills, all in one path, so a cut wound against the fill
// beneath it leaves a hole under the nonzero fill. Its 14-unit square stands
// where Lucide's 24-unit square does, as the panel draws both in the same
// glyph cell, and its line is weighed against Lucide's stroke: as much wider
// at each weight as it is at Regular.

/** Twice a closed outline's signed area, from its points and control points, whose sign is the way it winds. */
function windingOf(commands) {
  const points = commands.flatMap(({ points: at }) => at);

  return points.reduce((area, a, index) => {
    const b = points[(index + 1) % points.length];

    return area + a.x * b.y - b.x * a.y;
  }, 0);
}

/** A closed outline traced the other way round. */
function reversedOutline(commands) {
  const [move, ...rest] = commands.filter(({ command }) => command !== "Z");
  let at = move.points[0];

  const steps = rest.map(({ command, points }) => {
    const from = at;
    at = points.at(-1);

    return { command, points, from };
  });

  const reversed = [{ command: "M", points: [at] }];

  for (const { command, points, from } of steps.toReversed()) {
    reversed.push(
      command === "C"
        ? { command: "C", points: [points[1], points[0], from] }
        : { command: "L", points: [from] },
    );
  }

  return [...reversed, { command: "Z", points: [] }];
}

/** An outline wound the way `like` winds, or against it where `against`. */
function wound(commands, like, against = false) {
  const same = Math.sign(windingOf(commands)) === Math.sign(windingOf(like));

  return same === against ? reversedOutline(commands) : commands;
}

/** A disc of `radius` about `center`. */
const discOutline = (center, radius) => [
  { command: "M", points: [add(center, { x: radius, y: 0 })] },
  ...arcCubics(center, radius, 0, 2 * Math.PI),
  { command: "Z", points: [] },
];

/** One side of a polyline offset by `half` along each segment's normal, round at a corner it turns away from and mitred where it turns toward. */
function polylineSide(points, half) {
  const directions = points.slice(1).map((point, index) => unit(sub(point, points[index])));
  const offset = (point, direction) => add(point, times(normalOf(direction), half));
  const commands = [{ command: "L", points: [offset(points[0], directions[0])] }];

  for (let index = 1; index < directions.length; index++) {
    const [a, b] = [directions[index - 1], directions[index]];
    const [na, nb] = [normalOf(a), normalOf(b)];
    const turn = Math.atan2(a.x * b.y - a.y * b.x, dot(a, b));

    if (turn > 0) {
      commands.push({ command: "L", points: [offset(points[index], a)] });
      commands.push(...arcCubics(points[index], half, Math.atan2(na.y, na.x), turn));
    } else {
      // Note that the two offset lines meet on the corner's bisector, half over the cosine of half the turn out.
      const meet = add(points[index], times(add(na, nb), half / (1 + dot(na, nb))));
      commands.push({ command: "L", points: [meet] });
    }
  }

  commands.push({ command: "L", points: [offset(points.at(-1), directions.at(-1))] });

  return commands;
}

/** A polyline stroked `half` each side, round-capped and round-joined, as one outline that never crosses itself. */
function polylineOutline(points, half) {
  const first = unit(sub(points[1], points[0]));
  const last = unit(sub(points.at(-1), points.at(-2)));
  const [move, ...forward] = polylineSide(points, half);

  return [
    { command: "M", points: move.points },
    ...forward,
    ...capCubics(points.at(-1), half, normalOf(last), last),
    ...polylineSide(points.toReversed(), half),
    ...capCubics(points[0], half, normalOf(times(first, -1)), times(first, -1)),
    { command: "Z", points: [] },
  ];
}

/** Where two straight cuts cross within both, the square of their two bands that both cut, which is wound back in so the crossing stays cut. */
function crossingOutline([a0, a1], [b0, b1], half) {
  const [da, db] = [unit(sub(a1, a0)), unit(sub(b1, b0))];
  const across = da.x * db.y - da.y * db.x;

  if (Math.abs(across) < NEAR) return undefined;

  const t = ((b0.x - a0.x) * db.y - (b0.y - a0.y) * db.x) / across;
  const s = ((b0.x - a0.x) * da.y - (b0.y - a0.y) * da.x) / across;

  if (t <= 0 || t >= length(sub(a1, a0)) || s <= 0 || s >= length(sub(b1, b0))) return undefined;

  const center = add(a0, times(da, t));
  const [na, nb] = [normalOf(da), normalOf(db)];
  const determinant = na.x * nb.y - na.y * nb.x;

  const corner = (sa, sb) =>
    add(center, {
      x: (sa * half * nb.y - sb * half * na.y) / determinant,
      y: (sb * half * na.x - sa * half * nb.x) / determinant,
    });

  return [
    { command: "M", points: [corner(1, 1)] },
    { command: "L", points: [corner(1, -1)] },
    { command: "L", points: [corner(-1, -1)] },
    { command: "L", points: [corner(-1, 1)] },
    { command: "Z", points: [] },
  ];
}

/** A dashed ring's dashes, as SVG lays a dash array along a circle from its rightmost point, a last dash cut short by the start joined to the first. */
function dashOutlines({ center, radius, dash }, half) {
  const [on, off] = dash;
  const round = 2 * Math.PI * radius;
  const starts = [];

  for (let at = 0; at < round; at += on + off) starts.push(at);

  const last = starts.at(-1);
  const wrapped = last + on > round ? starts.pop() - round : undefined;

  const runs = starts.map((start, index) => ({
    from: index === 0 && wrapped !== undefined ? wrapped : start,
    to: start + on,
  }));

  return runs.map(({ from, to }) => {
    const [a, delta] = [from / radius, (to - from) / radius];
    const outer = arcCubics(center, radius + half, a, delta);
    const inner = arcCubics(center, radius - half, a + delta, -delta);

    return [
      { command: "M", points: [add(center, times(polar(a), radius + half))] },
      ...outer,
      { command: "L", points: [add(center, times(polar(a + delta), radius - half))] },
      ...inner,
      { command: "Z", points: [] },
    ];
  });
}

/** A fill path's own outline, its segments as lines and cubics. */
function fillOutlines(data) {
  return subpathsOf(data).map((segments) => [
    { command: "M", points: [segments[0].from] },
    ...segments.flatMap((segment) => {
      if (segment.kind === "line") return [{ command: "L", points: [segment.to] }];

      if (segment.kind === "cubic")
        return [{ command: "C", points: [segment.c1, segment.c2, segment.to] }];

      return arcCubics(segment.center, segment.radius, segment.start, segment.delta);
    }),
    { command: "Z", points: [] },
  ]);
}

/** A cut path's polylines; a cut is drawn of straight lines only. */
function cutPolylines(data) {
  return subpathsOf(data).map((segments) => {
    if (segments.some(({ kind }) => kind !== "line"))
      throw new Error("lucide-symbols: a mark's cut is drawn of straight lines only");

    return [segments[0].from, ...segments.map(({ to }) => to)];
  });
}

/** A mark's parts as one outline at a line's `half`, its points on the mark's square. */
function markOutline(parts, half, grow, { roles, elements }) {
  const forward = discOutline({ x: 0, y: 0 }, 1);
  const outline = [];
  const cuts = [];

  for (const part of parts) {
    const center = { x: part.cx, y: part.cy };

    if (part.role === roles.LINE && part.element === elements.CIRCLE) {
      const stroke = { center, radius: part.r, dash: part.dash };
      outline.push(
        ...(part.dash === undefined ? [ringOutline(stroke, half)] : dashOutlines(stroke, half)),
      );
    } else if (part.role === roles.FILL && part.element === elements.CIRCLE) {
      // Note that a disc's edge moves with the weight as a line's does, since it stands where a ring's outer edge would.
      outline.push(discOutline(center, part.r + grow));
    } else if (part.role === roles.FILL && part.element === elements.PATH) {
      outline.push(...fillOutlines(part.d).map((commands) => wound(commands, forward)));
    } else if (part.role === roles.CUT && part.element === elements.PATH) {
      cuts.push(...cutPolylines(part.d));
    } else {
      throw new Error(`lucide-symbols: no outline for a mark's ${part.role} <${part.element}>`);
    }
  }

  outline.push(...cuts.map((points) => wound(polylineOutline(points, half), forward, true)));

  for (const [index, a] of cuts.entries())
    for (const b of cuts.slice(index + 1)) {
      const crossing = a.length === 2 && b.length === 2 ? crossingOutline(a, b, half) : undefined;

      if (crossing !== undefined) outline.push(wound(crossing, forward));
    }

  return outline.flat();
}

/** An outline on a mark's square scaled onto Lucide's. */
const scaledOutline = (commands, scale) =>
  commands.map(({ command, points }) => ({
    command,
    points: points.map((point) => times(point, scale)),
  }));

/**
 * A task's status mark (`task-status-marks.mjs`) as an SF Symbols custom
 * symbol template, its parts one outline, so a cut leaves a hole, and its
 * line weighed at each weight as Lucide's stroke is.
 */
export function markTemplate(parts, { box, lineWidth, roles, elements }) {
  const scale = BOX / box;

  return templateOf((_, weight) => {
    const half = (lineWidth / 2) * (STROKE[weight] / STROKE.REGULAR);
    const grow = half - lineWidth / 2;

    return [scaledOutline(markOutline(parts, half, grow, { roles, elements }), scale)];
  });
}
