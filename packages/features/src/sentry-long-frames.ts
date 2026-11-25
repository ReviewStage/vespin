/**
 * sentry-long-frames.ts -- the long animation frames a slow interaction or a panel span waited on, summed as the span's own attributes.
 *
 * Sentry's browser tracing records each long animation frame as a child of
 * whatever span is active when the browser reports it, which in a window is
 * its page load alone: a click, a keystroke, or a task opened long after has
 * no active span, so none of them carried any. The renderer keeps the last
 * frames the browser reported here instead, and as an interaction's span
 * (INP) or a panel span ends, the frames that overlap it are summed onto it:
 * how many, how long they blocked, how the longest split between script,
 * style and layout, and render, and the one script that ran longest among
 * them, so a slow span names the code that held it.
 *
 * Note that a script is named by what the browser says of it: its invoker
 * (`BUTTON.onclick`, `Response.json.then`), its kind, its function's name,
 * and its file, which are the app's own code and never a person's words. An
 * element invoker may name an image's address (`IMG[src=…].onload`), which
 * could carry a signed URL, so a bracketed part is left out, and every
 * address is scrubbed as a request's is (`sentry-addresses.ts`).
 *
 * An interaction's span is sent only once the window is hidden or closed, for
 * the slowest interaction it had, often long after the frames it overlapped
 * left what is kept; so each slow interaction's sum is taken as it happens,
 * and the slowest are kept for its span to find (`interactionLongFrames`).
 *
 * Written against the few fields read rather than the DOM's types, so it
 * runs where the frames are handed to it, and in a test.
 */

import { scrubbedUrl } from "./sentry-addresses.js";

/** One script a long frame ran, as the browser's `PerformanceScriptTiming` says it, in milliseconds. */
export interface LongFrameScript {
  readonly duration: number;
  readonly forcedStyleAndLayoutDuration: number;
  readonly invoker: string;
  readonly invokerType: string;
  readonly sourceURL: string;
  readonly sourceFunctionName: string;
  readonly sourceCharPosition: number;
}

/** One long animation frame, as the browser's `PerformanceLongAnimationFrameTiming` says it, on the page's clock in milliseconds. */
export interface LongFrame {
  readonly startTime: number;
  readonly duration: number;
  readonly blockingDuration: number;
  readonly renderStart: number;
  readonly styleAndLayoutStart: number;
  readonly scripts: readonly LongFrameScript[];
}

/** The attributes a span's long frames are summed under, by the names Sentry lists them by. */
export const LONG_FRAME_ATTRIBUTE = {
  /** How many long frames overlapped the span. */
  COUNT: "long_frames.count",
  /** How long they blocked input, summed, in milliseconds. */
  BLOCKING: "long_frames.blocking_ms",
  /** The longest frame's length, in milliseconds. */
  LONGEST: "long_frames.longest_ms",
  /** How much of the longest frame ran tasks before it began to render, in milliseconds. */
  LONGEST_WORK: "long_frames.longest.work_ms",
  /** How much of the longest frame was style and layout, in milliseconds. */
  LONGEST_STYLE_LAYOUT: "long_frames.longest.style_layout_ms",
  /** How much of the longest frame rendered, its style and layout among it, in milliseconds. */
  LONGEST_RENDER: "long_frames.longest.render_ms",
  /** The longest script among the frames: how long it ran, in milliseconds. */
  SCRIPT_DURATION: "long_frames.script.duration_ms",
  /** How long it forced style and layout, in milliseconds. */
  SCRIPT_FORCED_LAYOUT: "long_frames.script.forced_style_layout_ms",
  /** What called it: an event's target and type, a promise's resolver, or a timer. */
  SCRIPT_INVOKER: "long_frames.script.invoker",
  /** What kind of call that was: `event-listener`, `resolve-promise`, `user-callback`, or a script loading. */
  SCRIPT_INVOKER_TYPE: "long_frames.script.invoker_type",
  /** The function the browser named it by. */
  SCRIPT_FUNCTION: "long_frames.script.function",
  /** The file it ran from. */
  SCRIPT_URL: "long_frames.script.url",
  /** Where in that file the function stands, in characters. */
  SCRIPT_CHAR_POSITION: "long_frames.script.char_position",
} as const;

type LongFrameAttribute = (typeof LONG_FRAME_ATTRIBUTE)[keyof typeof LONG_FRAME_ATTRIBUTE];

export type LongFrameAttributes = Partial<Record<LongFrameAttribute, number | string>>;

/** What a window keeps of what was reported, the latest first to stay: enough for a minute of a struggling window. */
const LONG_FRAMES_KEPT = 200;

/**
 * How many of a window's slowest interactions keep what they overlapped.
 * Note that the browser's INP is the slowest interaction but one in fifty,
 * so fifty kept cover the one it names over 2,500 interactions.
 */
const INTERACTIONS_KEPT = 50;

/** Where a frame ends on the page's clock. */
function endOf(frame: LongFrame): number {
  return frame.startTime + frame.duration;
}

/**
 * Text with every bracketed part left out, as an element invoker's
 * `IMG[src=…].onload`, which may carry an address; an unclosed bracket leaves
 * out the rest. Note that this is one pass rather than a pattern, because a
 * pattern over brackets backtracks on a long run of them.
 */
function withoutBrackets(text: string): string {
  let kept = "";
  let inside = false;

  for (const character of text) {
    if (character === "[") inside = true;
    else if (inside) inside = character !== "]";
    else kept += character;
  }

  return kept;
}

/** An invoker as it may be sent: no bracketed part, and an address scrubbed. */
function sentInvoker(invoker: string): string {
  const bare = withoutBrackets(invoker);

  return bare.includes("://") ? scrubbedUrl(bare) : bare;
}

/** The script that ran longest among the frames, if any ran. */
function longestScript(frames: readonly LongFrame[]): LongFrameScript | undefined {
  let longest: LongFrameScript | undefined;

  for (const frame of frames) {
    for (const script of frame.scripts) {
      if (longest === undefined || script.duration > longest.duration) longest = script;
    }
  }

  return longest;
}

/** The longest frame's lengths, split where it began to render and to lay out; a phase it never reached is 0. */
function longestFrameAttributes(frame: LongFrame): LongFrameAttributes {
  const end = endOf(frame);
  const rendered = frame.renderStart > 0;

  return {
    [LONG_FRAME_ATTRIBUTE.LONGEST]: Math.round(frame.duration),
    [LONG_FRAME_ATTRIBUTE.LONGEST_WORK]: Math.round(
      rendered ? frame.renderStart - frame.startTime : frame.duration,
    ),
    [LONG_FRAME_ATTRIBUTE.LONGEST_RENDER]: Math.round(rendered ? end - frame.renderStart : 0),
    [LONG_FRAME_ATTRIBUTE.LONGEST_STYLE_LAYOUT]: Math.round(
      frame.styleAndLayoutStart > 0 ? end - frame.styleAndLayoutStart : 0,
    ),
  };
}

/** One script's attributes, its function and file only where the browser named them. */
function scriptAttributes(script: LongFrameScript): LongFrameAttributes {
  return {
    [LONG_FRAME_ATTRIBUTE.SCRIPT_DURATION]: Math.round(script.duration),
    [LONG_FRAME_ATTRIBUTE.SCRIPT_FORCED_LAYOUT]: Math.round(script.forcedStyleAndLayoutDuration),
    [LONG_FRAME_ATTRIBUTE.SCRIPT_INVOKER]: sentInvoker(script.invoker),
    [LONG_FRAME_ATTRIBUTE.SCRIPT_INVOKER_TYPE]: script.invokerType,
    ...(script.sourceFunctionName === ""
      ? undefined
      : { [LONG_FRAME_ATTRIBUTE.SCRIPT_FUNCTION]: script.sourceFunctionName }),
    ...(script.sourceURL === ""
      ? undefined
      : { [LONG_FRAME_ATTRIBUTE.SCRIPT_URL]: scrubbedUrl(script.sourceURL) }),
    ...(script.sourceCharPosition < 0
      ? undefined
      : { [LONG_FRAME_ATTRIBUTE.SCRIPT_CHAR_POSITION]: script.sourceCharPosition }),
  };
}

/**
 * The long frames that overlap `startTime` to `endTime`, on the page's clock
 * in milliseconds, summed as a span's attributes; none where no frame did.
 */
export function longFrameAttributes(
  frames: readonly LongFrame[],
  startTime: number,
  endTime: number,
): LongFrameAttributes {
  const overlapping = frames.filter(
    (frame) => frame.startTime < endTime && endOf(frame) > startTime,
  );

  const longest = overlapping.reduce<LongFrame | undefined>(
    (held, frame) => (held === undefined || frame.duration > held.duration ? frame : held),
    undefined,
  );

  if (longest === undefined) return {};
  const script = longestScript(overlapping);

  return {
    [LONG_FRAME_ATTRIBUTE.COUNT]: overlapping.length,
    [LONG_FRAME_ATTRIBUTE.BLOCKING]: Math.round(
      overlapping.reduce((sum, frame) => sum + frame.blockingDuration, 0),
    ),
    ...longestFrameAttributes(longest),
    ...(script === undefined ? undefined : scriptAttributes(script)),
  };
}

/** The frames a window keeps, and what a span that ended reads of them. */
export interface LongFrameHistory {
  /** Keeps frames the browser reported, dropping the oldest past what is kept. */
  readonly add: (frames: Iterable<LongFrame>) => void;
  /** The kept frames that overlap `startTime` to `endTime`, on the page's clock in milliseconds, summed. */
  readonly attributesFor: (startTime: number, endTime: number) => LongFrameAttributes;
}

/** An empty history, holding the latest frames it is handed and no more. */
export function longFrameHistory(): LongFrameHistory {
  const kept: LongFrame[] = [];

  return {
    add: (frames) => {
      for (const frame of frames) kept.push(frame);

      if (kept.length > LONG_FRAMES_KEPT) kept.splice(0, kept.length - LONG_FRAMES_KEPT);
    },
    attributesFor: (startTime, endTime) => longFrameAttributes(kept, startTime, endTime),
  };
}

/** What a window's slow interactions overlapped, summed as each happened, for the span that names one to find. */
export interface InteractionLongFrames {
  /** Sums what the kept frames overlap of an interaction now, keeping it while it is among the slowest. */
  readonly note: (startTime: number, duration: number) => void;
  /** What was summed for the interaction that started at `startTime`, on the page's clock in milliseconds. */
  readonly of: (startTime: number) => LongFrameAttributes | undefined;
}

/**
 * The slow interactions' sums, read from `history`, keyed by their start to
 * the millisecond. Note that one interaction is several events, a pointer's
 * down, up, and click, each with a start of its own, so each is kept, and
 * the one the span names is found among them.
 */
export function interactionLongFrames(history: LongFrameHistory): InteractionLongFrames {
  const kept = new Map<
    number,
    { readonly duration: number; readonly attributes: LongFrameAttributes }
  >();

  return {
    note: (startTime, duration) => {
      const key = Math.round(startTime);
      const held = kept.get(key);

      if (held !== undefined && held.duration >= duration) return;

      kept.set(key, {
        duration,
        attributes: history.attributesFor(startTime, startTime + duration),
      });

      if (kept.size <= INTERACTIONS_KEPT) return;

      const [fastest] = [...kept].reduce((low, entry) =>
        entry[1].duration < low[1].duration ? entry : low,
      );

      kept.delete(fastest);
    },
    of: (startTime) => {
      const key = Math.round(startTime);

      return (
        kept.get(key)?.attributes ?? kept.get(key - 1)?.attributes ?? kept.get(key + 1)?.attributes
      );
    },
  };
}
