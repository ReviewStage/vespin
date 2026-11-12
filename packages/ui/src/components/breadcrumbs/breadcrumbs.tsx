import {
  type ComponentProps,
  type ComponentType,
  isValidElement,
  type ReactNode,
  useState,
} from "react";
import { pulseOnPress } from "../../press-pulse.js";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../../shadcn/breadcrumb.js";
import { useDisclosure } from "../../use-disclosure.js";
import { BUTTON_VARIANT } from "../button/button.js";
import { FoldingButton, type FoldingButtonHint } from "../folding-button/folding-button.js";
import { withContextMenu } from "../menu/context-menu.js";
import { dropBelowStart, Menu, type MenuAction, useMenu } from "../menu/menu.js";
import {
  ClippedLine,
  ONE_LINE_ELEMENT,
  ONE_LINE_END,
  type OneLineEnd,
} from "../one-line/clipped-line.js";
import { Tooltip } from "../tooltip/hint.js";
import { BREADCRUMB_POPUP, BREADCRUMB_SHOWN, type Crumb } from "./crumb.js";
import { useCrumbFold } from "./crumb-fold.js";

/**
 * breadcrumbs.tsx -- a path to where the reader stands: a named landmark holding an ordered list of crumbs, each words, a press, or a press that opens a menu or a dialog, the chevrons between them punctuation alone.
 *
 * A crumb is data: its words, and what a press on it does. One crumb may be
 * the page the reader stands on, and is said to be (`aria-current`); a
 * crumb with no press is words, and one with a glyph is the toolbar's way
 * back, a `FoldingButton` whose words fold away where its toolbar says so.
 * A crumb that opens something says what it opens and whether it stands
 * open, and its press is handed the crumb, which the caller hangs what it
 * opens from and hands the keyboard back to. A crumb may wear a glyph
 * before its words, as a tab names its kind, and hang a card in its hint's
 * place, its hint raising it as it raises a pill. A crumb that presses
 * may hold a menu of what it names on a right-click, a long press, and the
 * menu key (`menu`), and stand as a field in its words' place while its
 * name is edited (`editing`), as a row of the same thing does. A crumb may come
 * and go (`shown`), as a page's title joins its bar once its heading has
 * scrolled away: it fades in with a short rise as it comes, and fades out
 * before it goes (`use-disclosure.ts`).
 *
 * Two looks: a bar's path in the caption type, every crumb a quiet pill
 * that narrows by its share, fading out at its end, the current one last of
 * all; and a toolbar's heading, a way back then the page's name in the
 * bar title type.
 *
 * A path may end on what its caller draws in a last crumb's place (`end`),
 * behind its chevron: a toolbar's heading ends on the page's own name as a
 * press that opens what it names, which no crumb's look draws.
 *
 * A path gives way on a narrow bar first by folding: one that does not
 * fit whole folds the crumbs at its start into one "…" (`crumb-fold.ts`),
 * the last always standing, before any crumb is cut; only once nothing is
 * left to fold does each crumb narrow, in the stylesheet, by its share down
 * to a floor its words stay legible at. The rest is the stylesheet's
 * alone, nothing measured: each crumb says at which of the bar's widths it is drawn
 * (`shownAt`), read off the `BreadcrumbBar` holding the path, the row of
 * the bar it stands in. A crumb may stand for others a narrow bar leaves
 * out, as a "…" naming them in its hint does.
 *
 * The path is shadcn/ui's breadcrumb (`../../shadcn/breadcrumb.tsx`), drawn
 * in Tailwind utilities over the theme; what hangs on the bar's widths, on
 * `:has()`, or on a keyframe stays in `breadcrumbs.css`.
 */

/** The two looks a path is drawn in. */
export const BREADCRUMBS_VARIANT = {
  /** A bar's path in the caption type, every crumb a quiet pill. */
  CAPTION: "caption",
  /** A toolbar's heading: the way back, then the page's name in the bar title type. */
  TITLE: "title",
} as const;

export type BreadcrumbsVariant = (typeof BREADCRUMBS_VARIANT)[keyof typeof BREADCRUMBS_VARIANT];

/**
 * The hint a path hangs from its crumbs, the window's tooltip unless the caller hangs its own: the words a crumb raises, or
 * the card it hangs in their place, and a folded way back's words.
 */
export type BreadcrumbHint = ComponentType<
  ComponentProps<FoldingButtonHint> & { card?: ReactNode | undefined }
>;

/** The widths at which each `shownAt` draws its crumb. */
const SHOWN_WIDTHS = {
  [BREADCRUMB_SHOWN.ALWAYS]: { wide: true, narrow: true, narrowest: true },
  [BREADCRUMB_SHOWN.WIDE]: { wide: true, narrow: false, narrowest: false },
  [BREADCRUMB_SHOWN.WIDE_OR_NARROW]: { wide: true, narrow: true, narrowest: false },
  [BREADCRUMB_SHOWN.NARROW]: { wide: false, narrow: true, narrowest: false },
  [BREADCRUMB_SHOWN.NARROWEST]: { wide: false, narrow: false, narrowest: true },
} as const;

/** At which of the bar's widths something is drawn. */
interface Widths {
  readonly wide: boolean;
  readonly narrow: boolean;
  readonly narrowest: boolean;
}

/**
 * Each look's utilities by part. Note that a crumb's display, its share of a
 * narrow bar, and its floor stay in `breadcrumbs.css`, because they hang on
 * the bar's container widths and on `:has()`, and a utility would outrank
 * the rules that hide a crumb.
 */
const LOOK = {
  [BREADCRUMBS_VARIANT.CAPTION]: {
    nav: "text-caption",
    list: "",
    item: "",
    wordsItem: "",
    separator: "flex-none items-center text-muted-foreground [&>svg]:size-breadcrumb-chevron",
    words: "",
  },
  [BREADCRUMBS_VARIANT.TITLE]: {
    nav: "text-muted-foreground",
    list: "gap-breadcrumb-gap",
    item: "flex-none gap-breadcrumb-gap",
    wordsItem: "min-w-0 flex-initial gap-breadcrumb-gap",
    separator: "flex-none items-center [&>svg]:size-breadcrumb-title-chevron",
    words: "text-toolbar-title font-toolbar-title",
  },
} as const;

/**
 * The path's punctuation between two crumbs, drawn at the widths `at` says,
 * the chevron a menu row's submenu points with.
 */
function Chevron({ at, variant }: { at: Widths; variant: BreadcrumbsVariant }): React.JSX.Element {
  return (
    <BreadcrumbSeparator
      className={`ui-breadcrumb-separator ${LOOK[variant].separator}`}
      data-wide={at.wide}
      data-narrow={at.narrow}
      data-narrowest={at.narrowest}
    />
  );
}

/**
 * At which widths a chevron stands before the crumb at `at`: each width
 * where a crumb before it is drawn too, so a crumb leading the path at a
 * width, the others before it gone there, stands without one, as one
 * whose crumbs before it are not `shown` does. Note that a width the crumb
 * is not drawn at says yes, since nothing is drawn there.
 */
function chevronBefore(crumbs: readonly Crumb[], at: number): Widths | undefined {
  const own = SHOWN_WIDTHS[crumbs[at]?.shownAt ?? BREADCRUMB_SHOWN.ALWAYS];

  const before = crumbs
    .slice(0, at)
    .flatMap((each) =>
      each.shown === false ? [] : [SHOWN_WIDTHS[each.shownAt ?? BREADCRUMB_SHOWN.ALWAYS]],
    );

  const led = {
    wide: before.some((widths) => widths.wide),
    narrow: before.some((widths) => widths.narrow),
    narrowest: before.some((widths) => widths.narrowest),
  };

  if (!(own.wide && led.wide) && !(own.narrow && led.narrow) && !(own.narrowest && led.narrowest)) {
    return undefined;
  }

  return {
    wide: !own.wide || led.wide,
    narrow: !own.narrow || led.narrow,
    narrowest: !own.narrowest || led.narrowest,
  };
}

/** The chevron before a crumb, where one stands at any width. */
function CrumbChevron({
  at,
  variant,
}: {
  at: Widths | undefined;
  variant: BreadcrumbsVariant;
}): React.JSX.Element | null {
  return at === undefined ? null : <Chevron at={at} variant={variant} />;
}

/** A crumb's face: its glyph, where it wears one, then its words. */
function CrumbFace({
  glyph,
  label,
  end = ONE_LINE_END.FADE,
}: {
  glyph: ReactNode;
  label: string;
  end?: OneLineEnd | undefined;
}): React.JSX.Element {
  return (
    <>
      {glyph === undefined ? null : (
        <span className="flex flex-none [&_svg]:size-control-icon" aria-hidden="true">
          {glyph}
        </span>
      )}
      <ClippedLine
        className="ui-breadcrumb-label min-w-0 overflow-hidden whitespace-nowrap"
        as={ONE_LINE_ELEMENT.SPAN}
        end={end}
        words={label}
      >
        {label}
      </ClippedLine>
    </>
  );
}

/** One crumb's control: words, a quiet pill, or the toolbar's folding way back. */
function CrumbControl({
  crumb,
  variant,
  hint: Hint,
}: {
  crumb: Crumb;
  variant: BreadcrumbsVariant;
  hint: BreadcrumbHint;
}): React.JSX.Element {
  const { label, icon, onPress } = crumb;
  const current = crumb.current === true ? "page" : undefined;

  if (icon !== undefined) {
    return (
      <FoldingButton
        label={label}
        icon={icon}
        variant={BUTTON_VARIANT.QUIET}
        hint={Hint}
        onClick={onPress === undefined ? undefined : (event) => onPress(event.currentTarget)}
      />
    );
  }

  if (crumb.editing !== undefined && crumb.editing !== null) return <>{crumb.editing}</>;

  const control =
    onPress === undefined ? (
      <BreadcrumbPage
        className={`flex min-w-0 items-center gap-breadcrumb-gap ${LOOK[variant].words}`}
        aria-current={current}
      >
        <CrumbFace glyph={crumb.glyph} label={label} end={crumb.end} />
      </BreadcrumbPage>
    ) : (
      <BreadcrumbLink
        render={<button type="button" />}
        aria-label={crumb.name}
        aria-current={current}
        aria-haspopup={crumb.popup}
        aria-expanded={crumb.popup === undefined ? undefined : crumb.expanded === true}
        onClick={pulseOnPress((event) => onPress(event.currentTarget))}
        {...withContextMenu(crumb.menu?.contextMenu, {})}
        onKeyDown={crumb.menu?.keyMenu}
      >
        <CrumbFace glyph={crumb.glyph} label={label} end={crumb.end} />
      </BreadcrumbLink>
    );

  return crumb.hint === undefined && crumb.card === undefined ? (
    control
  ) : (
    <Hint label={crumb.hint} card={crumb.card}>
      {control}
    </Hint>
  );
}

/** The motions a crumb that comes and goes rides, read by the stylesheet from its `data-motion`. */
const CRUMB_MOTION = {
  ARRIVING: "arriving",
  LEAVING: "leaving",
} as const;

/**
 * One crumb's place in the path, its chevron before it. A crumb that comes
 * and goes is drawn while `shown` and through its exit after, and rides in
 * only when it comes on a change, so a path drawn with it already there
 * stands still. Note that one leaving is inert, since it already reads as
 * gone.
 */
function CrumbItem({
  crumb,
  chevron,
  legible,
  whole,
  variant,
  hint,
}: {
  crumb: Crumb;
  chevron: Widths | undefined;
  /** Whether it keeps its words legible, down to a floor of its own, in a narrow bar. */
  legible: boolean;
  /** Whether it keeps its whole width, because the path folds a crumb before it cuts this one. */
  whole: boolean;
  variant: BreadcrumbsVariant;
  hint: BreadcrumbHint;
}): React.JSX.Element | null {
  const shown = crumb.shown ?? true;
  const presence = useDisclosure(shown);
  const [was, setWas] = useState(shown);
  const [arriving, setArriving] = useState(false);

  if (shown !== was) {
    setWas(shown);
    setArriving(shown);
  }

  if (!presence.mounted) return null;

  const motion = presence.leaving
    ? CRUMB_MOTION.LEAVING
    : arriving
      ? CRUMB_MOTION.ARRIVING
      : undefined;

  const words = crumb.icon === undefined && crumb.onPress === undefined;

  return (
    <BreadcrumbItem
      ref={presence.ref}
      className={words ? LOOK[variant].wordsItem : LOOK[variant].item}
      data-shown={crumb.shownAt ?? BREADCRUMB_SHOWN.ALWAYS}
      data-words={words}
      data-fixed={crumb.fixed === true ? "true" : undefined}
      data-legible={legible ? "true" : undefined}
      data-whole={whole ? "true" : undefined}
      data-motion={motion}
      inert={presence.leaving}
    >
      <CrumbChevron at={chevron} variant={variant} />
      <CrumbControl crumb={crumb} variant={variant} hint={hint} />
    </BreadcrumbItem>
  );
}

/**
 * A path named `label`, its crumbs in order. Note that a crumb is keyed by
 * its place, because the same words may stand twice in one path.
 */
export function Breadcrumbs({
  label,
  crumbs,
  end,
  variant = BREADCRUMBS_VARIANT.CAPTION,
  hint = Tooltip,
}: {
  /** The landmark's name ("Path"). */
  label: string;
  crumbs: readonly Crumb[];
  /** What the path ends on, drawn by the caller in a last crumb's place behind its chevron: the page's own name as a press (a toolbar's heading); none where the crumbs end it. */
  end?: ReactNode;
  variant?: BreadcrumbsVariant;
  /** The hint raising a crumb's `hint` or hanging its `card`, and a folded way back's words: the window's tooltip, unless the caller hangs one of its own. */
  hint?: BreadcrumbHint | undefined;
}): React.JSX.Element {
  const [measured, drawn, hidden] = useCrumbFold(crumbs);
  const menu = useMenu(hidden.length > 0);

  // Note that the "…" opens a menu of the crumbs it stands for, each pressing as its own crumb did, since folding a crumb must not take away where it leads.
  const shown = drawn.map((each) =>
    each.folded
      ? {
          ...each,
          crumb: {
            label: each.crumb.label,
            name: each.crumb.name,
            hint: each.crumb.hint,
            popup: BREADCRUMB_POPUP.MENU,
            expanded: menu.open !== undefined,
            onPress: (opener: HTMLElement) =>
              menu.open === undefined
                ? menu.show(dropBelowStart(opener), opener)
                : menu.close(true),
          } satisfies Crumb,
        }
      : each,
  );

  const path = shown.map((each) => each.crumb);
  const opener = menu.open?.opener;

  const hiddenRows: MenuAction[] = hidden.map((crumb) => ({
    label: crumb.label,
    ...(isValidElement(crumb.glyph) && { icon: crumb.glyph }),
    disabled: crumb.onPress === undefined,
    onSelect: () => {
      if (opener !== undefined) crumb.onPress?.(opener);
    },
  }));

  return (
    <Breadcrumb
      ref={variant === BREADCRUMBS_VARIANT.CAPTION ? measured : undefined}
      className={`ui-breadcrumbs relative min-w-0 flex-initial overflow-clip ${LOOK[variant].nav}`}
      data-variant={variant}
      aria-label={label}
    >
      <BreadcrumbList className={LOOK[variant].list}>
        {shown.map((each, at) => (
          <CrumbItem
            key={each.key}
            crumb={each.crumb}
            chevron={chevronBefore(path, at)}
            legible={each.legible}
            whole={each.whole}
            variant={variant}
            hint={hint}
          />
        ))}
        {end === undefined ? null : (
          <BreadcrumbItem className={LOOK[variant].wordsItem} data-words="true">
            {shown.length === 0 ? null : (
              <Chevron at={SHOWN_WIDTHS[BREADCRUMB_SHOWN.ALWAYS]} variant={variant} />
            )}
            {/* Note that the end is the page the reader stands on, so it takes the text ink, as a current crumb's words do, rather than the path's muted one its chevron keeps. */}
            <span className="flex min-w-0 text-foreground">{end}</span>
          </BreadcrumbItem>
        )}
      </BreadcrumbList>
      {menu.drawn === undefined ? null : (
        <Menu
          label="Earlier in the path"
          menu={menu.drawn}
          groups={[hiddenRows]}
          onClose={menu.close}
        />
      )}
    </Breadcrumb>
  );
}

/**
 * A bar's row holding a path among the bar's other controls, whose width is
 * what the path's crumbs fold by (`shownAt`). It fills the bar it stands in
 * and lays its children in a row, centered, spaced as the bar spaces its
 * own, so the bar keeps its padding, its height, and its gap.
 */
export function BreadcrumbBar({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="@container/ui-breadcrumb-bar flex min-w-0 flex-auto items-center gap-[inherit]">
      {children}
    </div>
  );
}
