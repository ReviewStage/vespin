import { Predicate } from "effect";
import { cn } from "../../cn.js";
import { Slider as ShadcnSlider } from "../../shadcn/slider.js";

/**
 * slider.tsx -- one thumb along a track, for a value chosen between two
 * ends: how far a swipe or a fade has gone, or where a video stands in its
 * run.
 *
 * It is shadcn/ui's Base UI slider (`../../shadcn/slider.tsx`), drawn in the
 * switch's inks, whose thumb holds a native range input, so the arrow,
 * Home, End, and Page keys and the slider role and value reading come with
 * it. A `label` names it. It stands at a comfortable length, as long as the
 * room allows, or fills the room its row gives it (`SLIDER_LENGTH.FILL`),
 * as a video's scrubber does between its buttons.
 */

/** How long a slider stands: at a comfortable length, or across the room its row gives it. */
export const SLIDER_LENGTH = {
  COMFORTABLE: "comfortable",
  FILL: "fill",
} as const;

export type SliderLength = (typeof SLIDER_LENGTH)[keyof typeof SLIDER_LENGTH];

/** Each length's box: an off-scale comfortable length the room may cut short, or the row's room. */
const LENGTH = {
  comfortable: "data-horizontal:w-[min(320px,100%)]",
  fill: "flex-[1_1_auto] data-horizontal:w-auto min-w-0",
} as const satisfies Record<SliderLength, string>;

/**
 * How a slider is drawn: on its own track, or bare over a drawing its
 * holder makes of what it moves along, as a sound clip's waveform, its
 * thumb riding across the whole of the room it stands in with no track
 * under it.
 */
export const SLIDER_LOOK = {
  TRACK: "track",
  BARE: "bare",
} as const;

export type SliderLook = (typeof SLIDER_LOOK)[keyof typeof SLIDER_LOOK];

/** Each look's box: the track as it stands, or the room its holder gives it, track and range clear. */
const LOOK = {
  track: "",
  bare: "absolute inset-0 [&>*]:h-full [&_[data-slot=slider-track]]:bg-transparent [&_[data-slot=slider-range]]:bg-transparent",
} as const satisfies Record<SliderLook, string>;

/** A range at `value` between `min` and `max`, named by `label`, told of each change. */
export function Slider({
  value,
  onChange,
  label,
  min = 0,
  max = 100,
  step,
  length = SLIDER_LENGTH.COMFORTABLE,
  look = SLIDER_LOOK.TRACK,
  valueText,
}: {
  value: number;
  onChange: (value: number) => void;
  /** What the slider moves, for a reader who cannot see it ("Swipe position"). */
  label: string;
  min?: number | undefined;
  max?: number | undefined;
  /** How far one step moves it; whole numbers where left out. */
  step?: number | undefined;
  /** How long it stands. */
  length?: SliderLength | undefined;
  /** How it is drawn: on its own track, or bare over its holder's drawing. */
  look?: SliderLook | undefined;
  /** Its value as a reader is told it ("0:04 of 0:25"), where the number alone says too little. */
  valueText?: string | undefined;
}): React.JSX.Element {
  return (
    <ShadcnSlider
      className={cn("ui-slider", LENGTH[length], LOOK[look])}
      data-length={length}
      min={min}
      max={max}
      step={step}
      value={value}
      thumbLabel={label}
      thumbValueText={valueText}
      onValueChange={(next) => onChange(Predicate.isNumber(next) ? next : (next[0] ?? min))}
    />
  );
}
