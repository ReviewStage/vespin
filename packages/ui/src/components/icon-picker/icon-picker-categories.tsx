import { type ComponentType, type RefObject, useCallback, useEffect, useState } from "react";
import { cn } from "../../cn.js";
import { IconButton } from "../button/button.js";
import { ROVING_ORIENTATION, useRovingKeys } from "../roving-keys/roving-keys.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * icon-picker-categories.tsx -- an icon picker's category bar, as Slack's emoji picker draws one: a glyph for each group of its grid across the band under its head, a press jumping the grid to the group, the group in view underlined as the grid scrolls.
 *
 * The bar stands in the picker's band (`icon-picker-frame.ts`), outside the
 * grid, so its buttons are never the grid's choices: Enter in the search,
 * the arrows, and the grid's one tab stop pass it by. It is one tab stop of
 * its own, a toolbar walked with ← and →, on the group in view. A group is in
 * view from the moment its top reaches the grid's top, where its name then
 * stands (`IconPickerGroup`), and the last is once the grid is scrolled to
 * its end, short as it may be; a press marks the group pressed in view at
 * once. Each glyph says its group's name in the hint over it.
 */

/** What the bar is called for a reader. */
const BAR_LABEL = "Emoji categories";

/** How near, in pixels, a group's top counts as at the grid's top, or the grid's end as reached, since a scroll stops on a fraction of one. */
const AT_EDGE = 1;

/** One group the bar offers: its name and the glyph it wears. */
export interface IconPickerCategory {
  readonly name: string;
  readonly glyph: ComponentType;
}

/** The group in view in `scroller`: the last whose top has reached its top, or the last of all once it is scrolled to its end. */
function groupInView(scroller: HTMLElement, groups: readonly (HTMLElement | null)[]): number {
  if (scroller.scrollTop <= 0) return 0;

  if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - AT_EDGE) {
    return groups.length - 1;
  }

  const top = scroller.getBoundingClientRect().top;

  return groups.reduce(
    (inView, group, at) =>
      group !== null && group.getBoundingClientRect().top - top <= AT_EDGE ? at : inView,
    0,
  );
}

/** Scrolls `scroller` at once so `group`'s top stands at its top. */
function jumpTo(scroller: HTMLElement, group: HTMLElement): void {
  const by = group.getBoundingClientRect().top - scroller.getBoundingClientRect().top;

  scroller.scrollTo({ top: scroller.scrollTop + by });
}

/**
 * The bar; see the module's head. `groups` holds each category's box in the
 * grid, in the bar's order, which `scroller` scrolls. Note that it hears the
 * scroll and draws itself alone, once a frame at most, so the grid's some
 * two thousand choices are never drawn again as the group in view changes.
 */
export function IconPickerCategories({
  categories,
  groups,
  scroller,
}: {
  categories: readonly IconPickerCategory[];
  groups: RefObject<(HTMLElement | null)[]>;
  scroller: HTMLElement;
}): React.JSX.Element {
  const [inView, setInView] = useState(0);
  const roving = useRovingKeys<HTMLDivElement>({ orientation: ROVING_ORIENTATION.HORIZONTAL });

  useEffect(() => {
    let frame: number | undefined;

    const hear = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        setInView(groupInView(scroller, groups.current));
      });
    };

    hear();
    scroller.addEventListener("scroll", hear, { passive: true });

    return () => {
      scroller.removeEventListener("scroll", hear);

      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [scroller, groups]);

  const jump = useCallback(
    (at: number) => {
      const group = groups.current[at];

      if (group == null) return;
      jumpTo(scroller, group);
      setInView(at);
    },
    [scroller, groups],
  );

  return (
    <div
      ref={roving.ref}
      data-roving={roving["data-roving"]}
      role="toolbar"
      aria-label={BAR_LABEL}
      className="ui-icon-picker-categories flex justify-between border-b border-border px-card-inset-snug pt-control-gap"
      onKeyDown={roving.onKeyDown}
      onFocus={roving.onFocus}
    >
      {categories.map((category, at) => {
        const Glyph = category.glyph;
        const current = at === inView;

        return (
          <div key={category.name} className="ui-icon-picker-category flex flex-col items-center">
            <Tooltip label={category.name}>
              <IconButton
                icon={<Glyph />}
                label={category.name}
                roving
                aria-current={current ? "true" : undefined}
                onClick={() => jump(at)}
              />
            </Tooltip>
            <span
              className={cn(
                "ui-icon-picker-category-rule -mb-px h-icon-picker-category-rule w-full rounded-full",
                current ? "bg-foreground" : "bg-transparent",
              )}
              aria-hidden="true"
            />
          </div>
        );
      })}
    </div>
  );
}
