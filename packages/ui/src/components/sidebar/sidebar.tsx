import type { ReactNode } from "react";
import { ReplayWords } from "../../session-replay-marks.js";

/**
 * sidebar.tsx -- the parts of the app's sidebar every surface that draws it shares: the head naming whose it is, the places under it, the rule that parts them from a list, and the foot with the account's row.
 *
 * The panel's sidebar, Settings' page list, a version history's versions,
 * and the web's admin dashboard all stand these in the column the app's
 * shell lays (`@repo/panel`'s `shell.css`), so the four read as one product
 * from one set of boxes rather than copies of them. The column itself, its
 * ground, insets, width, and slide, stays the shell's, and so does what
 * each part holds.
 *
 * Each part keeps the class the window's own sheets and its tests know it
 * by (`sidebar-places`, `sidebar-foot`, `sidebar-account-row`), a placement
 * hook rather than a look: the account's row is the container the foot's
 * pills fold in (`@container sidebar-foot`), and a sheet may restage a part
 * by its hook. Each draws in Tailwind utilities over the shared theme and
 * takes no class or style of its own.
 */

/**
 * The head of the sidebar: a mark on its tile beside a name, and under the
 * name, muted, where the head stands on a surface that is the name's own
 * but not the app itself (the admin dashboard's "Admin"). The mark is the
 * caller's, which fills the tile's middle.
 */
export function SidebarIdentity({
  name,
  qualifier,
  mark,
  replayUnmasked = false,
  end,
}: {
  name: string;
  qualifier?: string | undefined;
  /** The mark, drawn to fill its seat (a `ProductMark` with `fill`). */
  mark: ReactNode;
  /** Whether its name and qualifier are the app's own, which a screen recording shows as they read; masked unless set (`@repo/ui/session-replay-marks`). */
  replayUnmasked?: boolean | undefined;
  /** A control at the head's end, such as the app's New task while no workspace heads the sidebar. */
  end?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="sidebar-identity flex items-center gap-ui-12 px-row-inset pt-ui-2 pb-section-gap">
      <span className="grid size-ui-40 flex-none place-items-center rounded-ui-14 bg-fill-strong">
        <span className="grid size-ui-24">{mark}</span>
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-dialog-size font-dialog tracking-identity">
          <ReplayWords unmasked={replayUnmasked}>{name}</ReplayWords>
        </span>
        {qualifier === undefined ? null : (
          <span className="text-caption-inline text-muted-foreground">
            <ReplayWords unmasked={replayUnmasked}>{qualifier}</ReplayWords>
          </span>
        )}
      </span>
      {end === undefined ? null : <span className="ms-auto flex-none">{end}</span>}
    </div>
  );
}

/**
 * The sidebar's places, each a `NavItem` a list's gap from the next, as the
 * rows under them are: a navigation landmark where it is named (`label`),
 * the admin's sections, and a plain column where its rows are commands.
 */
export function SidebarPlaces({
  label,
  children,
}: {
  /** The landmark's name, which makes it one; none leaves it a plain column. */
  label?: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const className = "sidebar-places mb-list-gap flex flex-none flex-col gap-list-gap";

  return label === undefined ? (
    <div className={className}>{children}</div>
  ) : (
    <nav aria-label={label} className={className}>
      {children}
    </nav>
  );
}

/**
 * The hairline under the places that parts them from the list, at the rows' inset.
 * Note that it draws in the translucent border, because the sidebar stands on the
 * window's vibrancy: the opaque one matches its gray where the wallpaper is light
 * and fades out there.
 */
export function SidebarRule(): React.JSX.Element {
  return (
    <hr className="sidebar-rule mx-row-inset my-ui-8 h-px flex-none border-0 bg-border-strong" />
  );
}

/** Where the foot stands: at the column's end, its account a row, or at the rail's foot, its parts a stack of tiles. */
export const SIDEBAR_FOOT_LOOK = {
  ROW: "row",
  RAIL: "rail",
} as const;

export type SidebarFootLook = (typeof SIDEBAR_FOOT_LOOK)[keyof typeof SIDEBAR_FOOT_LOOK];

/** The foot of the column: what docks above the account's row, and the row. */
export function SidebarFoot({
  look = SIDEBAR_FOOT_LOOK.ROW,
  children,
}: {
  look?: SidebarFootLook | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={
        look === SIDEBAR_FOOT_LOOK.RAIL
          ? "sidebar-foot flex flex-col items-center"
          : "sidebar-foot flex flex-col pt-ui-8"
      }
      data-look={look}
    >
      {children}
    </div>
  );
}

/**
 * The foot's one row: the account at its start, taking what room is left,
 * and whatever stands after it. It is the container the foot's pills fold
 * in as the column narrows (`sidebar-foot`), so at the rail's foot, a stack
 * a tile wide, they stand as their glyphs alone.
 */
export function SidebarAccountRow({
  look = SIDEBAR_FOOT_LOOK.ROW,
  children,
}: {
  look?: SidebarFootLook | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={
        look === SIDEBAR_FOOT_LOOK.RAIL
          ? "sidebar-account-row @container/sidebar-foot flex w-rail-tile flex-col items-center gap-rail-gap"
          : "sidebar-account-row @container/sidebar-foot flex items-center gap-ui-4"
      }
    >
      {children}
    </div>
  );
}

/**
 * The sidebar's rail: a narrow column of places at the column's start, each a
 * `NavItem` tile, under the `head` (whose the sidebar is) and over the `foot`
 * (the account's), which stands at the rail's end. Every tile, the head's and
 * the foot's included, is one square on the rail's one center line, one gap
 * from the next, and the rail keeps as much room at its end as at its sides.
 * The places are a navigation landmark named `label`. The column beside it,
 * and where the rail stands in it, stay the shell's.
 */
export function SidebarRail({
  label,
  head,
  foot,
  children,
}: {
  label: string;
  head?: ReactNode;
  foot?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="sidebar-rail flex w-rail flex-none flex-col items-center gap-rail-gap pb-rail-inset">
      {head === undefined ? null : (
        <div className="sidebar-rail-head flex w-rail-tile flex-none flex-col items-center">
          {head}
        </div>
      )}
      <nav
        aria-label={label}
        className="sidebar-places flex w-rail-tile flex-none flex-col items-center gap-rail-gap"
      >
        {children}
      </nav>
      {foot === undefined ? null : (
        <div className="sidebar-rail-foot mt-auto flex w-rail-tile flex-none flex-col items-center">
          {foot}
        </div>
      )}
    </div>
  );
}
