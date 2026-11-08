/**
 * crumb.ts -- what a crumb of a path is and at which widths it is drawn, which `Breadcrumbs` draws and `crumb-fold.ts` folds.
 */

import type { ReactNode } from "react";
import type { ContextMenuProps } from "../menu/menu.js";
import type { OneLineEnd } from "../one-line/clipped-line.js";

/**
 * At which of its bar's widths a crumb is drawn: wide is 520px and up,
 * narrow 300px to 519px, narrowest under 300px, the width of the
 * `BreadcrumbBar` holding the path. A path in none is drawn as a wide bar
 * draws it.
 */
export const BREADCRUMB_SHOWN = {
  ALWAYS: "always",
  WIDE: "wide",
  WIDE_OR_NARROW: "wide-or-narrow",
  /** Narrow alone: a crumb standing for those a narrow bar leaves out. */
  NARROW: "narrow",
  /** Narrowest alone: a crumb standing for those the narrowest bar leaves out. */
  NARROWEST: "narrowest",
} as const;

export type BreadcrumbShown = (typeof BREADCRUMB_SHOWN)[keyof typeof BREADCRUMB_SHOWN];

/** What a crumb's press opens. */
export const BREADCRUMB_POPUP = {
  DIALOG: "dialog",
  MENU: "menu",
} as const;

export type BreadcrumbPopup = (typeof BREADCRUMB_POPUP)[keyof typeof BREADCRUMB_POPUP];

/** The menu a crumb holds on a right-click, a long press, and the menu key, as `useMenu` hands out its doors. */
export interface CrumbMenu {
  readonly contextMenu: ContextMenuProps;
  readonly keyMenu: (event: React.KeyboardEvent<HTMLElement>) => void;
}

/** What every crumb holds: its words, its press, and the widths it is drawn at. */
interface CrumbBase {
  /** Its words. */
  readonly label: string;
  /** What a press does, handed the crumb pressed. */
  readonly onPress?: ((crumb: HTMLElement) => void) | undefined;
  /** At which of its bar's widths it is drawn; always where none is said. */
  readonly shownAt?: BreadcrumbShown | undefined;
}

/** A crumb of words, or a quiet pill a press reaches. */
interface PathCrumb extends CrumbBase {
  readonly icon?: undefined;
  /** A glyph before its words, as a tab names its kind; decoration, since the words say what it is. */
  readonly glyph?: ReactNode;
  /** The card its hint hangs in the words' place. */
  readonly card?: ReactNode;
  /** Its name for a reader, where its words alone do not say it ("…"). */
  readonly name?: string | undefined;
  /** The words its hint raises, where the app hands the path one. */
  readonly hint?: string | undefined;
  /** Whether it is the page the reader stands on. */
  readonly current?: boolean | undefined;
  /** What a press opens, said to a reader. */
  readonly popup?: BreadcrumbPopup | undefined;
  /** Whether what it opens stands open. */
  readonly expanded?: boolean | undefined;
  /** Whether it stands in the path now, for a crumb that comes and goes; always where none is said. */
  readonly shown?: boolean | undefined;
  /** How its words end where they are cut short: fading out where none is said, or in an ellipsis. */
  readonly end?: OneLineEnd | undefined;
  /** Whether the path never folds it into the "…", though it still gives way in a narrow bar like any crumb: a crumb that must stay on screen but may be cut short. */
  readonly kept?: boolean | undefined;
  /** Whether it keeps its size in a narrow bar, so the crumbs after it are cut short first; it gives way with the rest where none is said. */
  readonly fixed?: boolean | undefined;
  /** The menu of what it names, which a right-click, a long press, or the menu key on its press opens; read only where it presses. */
  readonly menu?: CrumbMenu | undefined;
  /** The field it stands as while its name is edited, in its press's place. */
  readonly editing?: ReactNode;
}

/**
 * The toolbar's way back: a glyph before its words, which fold away where
 * its toolbar folds them. Note that it is never the current page and opens
 * nothing, because a way back leads elsewhere, and so it says neither.
 */
interface WayBackCrumb extends CrumbBase {
  readonly icon: ReactNode;
  readonly onPress: (crumb: HTMLElement) => void;
  readonly glyph?: undefined;
  readonly card?: undefined;
  readonly name?: undefined;
  readonly hint?: undefined;
  readonly current?: undefined;
  readonly popup?: undefined;
  readonly expanded?: undefined;
  readonly shown?: undefined;
  readonly end?: undefined;
  readonly kept?: undefined;
  readonly fixed?: undefined;
  readonly menu?: undefined;
  readonly editing?: undefined;
}

/** One crumb of a path. */
export type Crumb = PathCrumb | WayBackCrumb;
