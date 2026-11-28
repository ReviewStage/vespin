import { type ReactNode, useRef, useState } from "react";
import { said } from "../../said.js";
import { type PageScroll, PageScrollContext } from "../page-frame/page-scroll.js";
import { useHeadingAway } from "../page-header/heading-away.js";
import { PAGE_HEADER_END, PAGE_HEADER_LOOK, PageHeader } from "../page-header/page-header.js";
import {
  type SettingsSectionSkeletonLayout,
  SettingsSectionsSkeleton,
} from "../settings-section/settings-section.js";
import { Skeleton } from "../skeleton/skeleton.js";
import { TEXT_TONE, Text } from "../text/text.js";
import { TOOLBAR_INSET, TOOLBAR_LOOK, Toolbar, type ToolbarLook } from "../toolbar/toolbar.js";

/**
 * settings-page.tsx -- a settings page: its title and what acts on the whole page above its sections, in a column that scrolls.
 *
 * The page stands under the window's bar (`Toolbar`), which leads with what
 * its caller hands it (a way back) and is still above the page's scroll;
 * once the header has scrolled away, the bar picks up its name
 * (`useHeadingAway`), so the reader never loses which page they are on.
 * Under it the page is its own scroller and owns everything between its
 * edges and its sections: the inset around the column, which narrows when the page
 * does, the measure the column reads at, the title's place and size, the
 * room under the head, and the room between one section (`SettingsSection`)
 * and the next. A section owns its heading and card, and a row its padding,
 * so a caller sets no length anywhere on a settings page. The page heads
 * itself with a document's header (`PageHeader`): the title is the page's
 * `h1`, which each section's `h2` heads a part of. What acts on the whole
 * page, a quiet reset, ends the title's line flush with the cards' edge,
 * and one quiet line under the title says what holds for all of it, where
 * its settings are kept,
 * its words rather than its hover's pill standing in the column, and drops
 * below the title when the column is too narrow for both, rather than
 * breaking the title inside a word.
 *
 * A section whose read is still out stands as placeholder rows shaped as
 * its own (`SettingsRowsSkeleton`), and a page that has not yet read what
 * its sections are stands as placeholder sections
 * (`SettingsSectionsSkeleton`), so the page is never blank under its title
 * and what lands takes the place its blocks stood in. An empty state that is the
 * page's whole content fills the room under the title and stands in its
 * middle.
 *
 * A long list on a page draws only the rows near the view (`VirtualRows`),
 * in the page's own scroller, which the page hands its sections
 * (`usePageScroll`) with the column of sections, whose resizing
 * moves where such a list stands.
 *
 * A page stands at Settings' measure, a step narrower than a document's,
 * or, where it holds records a reader compares across a table's columns,
 * at the wide measure (`SETTINGS_PAGE_WIDTH.WIDE`), capped so a row's words
 * stay readable in a big window; its head and every section follow it, and
 * a table still wider than that scrolls sideways in its own frame.
 *
 * A page whose name is not yet known, Settings while its chunk loads, stands
 * as a whole page of placeholders (`SettingsPageSkeleton`): the page itself,
 * a block for its title, and its sections' blocks.
 *
 * On a phone (`TOOLBAR_LOOK.PHONE`), the look a page standing alone in a
 * small window takes too, the bar is a phone's header: its way back in one
 * corner, what acts on the whole page in the other (a ⋯ the caller hands as
 * `actions`), and the page's title, its `h1`, centered between them, as a
 * phone heads every page. The page then draws no header of its own: it
 * opens on the quiet line saying what holds for all of it, a section's gap
 * under the bar's way back (`title-under-bar`), so no lone row of the way
 * back stands over an empty band before the title.
 *
 * It is drawn in Tailwind utilities over the theme with no shadcn/ui base,
 * since a page's frame, scroller, and column are a layout shadcn has no
 * component for. The top's fade on its scroll timeline, an empty state's
 * room, and the column's narrow inset stay in `settings-page.css`.
 */

/**
 * How wide a placeholder title stands: a short page name's, five controls'
 * height across. Note that it is a length rather than a share, because the
 * title's line is only as wide as what it holds.
 */
const SKELETON_TITLE_WIDTH = "calc(5 * var(--ui-control-height))";

/** How wide a settings page's column stands: Settings' measure, or the wide measure for a page of records compared across a table's columns. */
export const SETTINGS_PAGE_WIDTH = {
  MEASURE: "measure",
  WIDE: "wide",
} as const;

export type SettingsPageWidth = (typeof SETTINGS_PAGE_WIDTH)[keyof typeof SETTINGS_PAGE_WIDTH];

/**
 * A settings page's column, the part under its bar: its own scroller, at
 * the page's inset, around
 * a column at the page's measure holding the head (the title, its line
 * under it, and what acts on the whole page at the title's end) over the
 * sections a page's gap apart, handing its sections the page's scroller (`usePageScroll`). A
 * page whose title a phone's bar draws (`titled`) opens on its line alone,
 * under the bar. `SettingsPage` stands it under the window's bar, and a
 * settings dialog (`SettingsDialog`) beside its section list, so a section
 * there reads exactly as a page here does.
 */
export function SettingsPageColumn({
  title,
  titleId,
  description,
  actions,
  width = SETTINGS_PAGE_WIDTH.MEASURE,
  titled = false,
  titledWhenNarrow = false,
  look = SETTINGS_PAGE_LOOK.PAGE,
  scroller,
  head,
  children,
}: {
  /** The page's name, its `h1`. */
  title: ReactNode;
  /** The id the title stands under, for a region to name itself by. */
  titleId?: string | undefined;
  /** One quiet line under the title that holds for the whole page. */
  description?: ReactNode;
  /** What acts on the whole page, at the end of the title's line. */
  actions?: ReactNode;
  /** How wide the column stands, its head and sections alike. */
  width?: SettingsPageWidth | undefined;
  /** Whether a bar above already draws the title, as a phone's does, so the column opens on its line alone. */
  titled?: boolean | undefined;
  /** Whether that bar stands only where the room is narrow (`room-narrow`), as a settings dialog's does, which answers the room in what it draws rather than in what it is handed: there the head gives way to the bar as `titled`'s does. */
  titledWhenNarrow?: boolean | undefined;
  /** How it stands: a page's, unless it stands in a dialog's card. */
  look?: SettingsPageLook | undefined;
  /** The scroller, for an owner that watches it; one of its own where none is handed. */
  scroller?: React.RefObject<HTMLDivElement | null> | undefined;
  /** The head, for an owner that watches it scroll away. */
  head?: React.Ref<HTMLDivElement> | undefined;
  /** The sections, a section's gap apart. */
  children: ReactNode;
}): React.JSX.Element {
  const own = useRef<HTMLDivElement>(null);
  const page = scroller ?? own;
  const sections = useRef<HTMLDivElement>(null);
  const [scroll] = useState((): PageScroll => ({ scroller: page, shiftedBy: sections }));

  return (
    <div
      ref={page}
      data-width={width}
      data-look={look}
      className="ui-settings-page @container/ui-settings-page box-border min-h-0 min-w-0 grow basis-0 overflow-x-clip overflow-y-auto overscroll-contain scroll-py-page-inset [scrollbar-gutter:stable]"
    >
      <div
        className={
          titled
            ? "ui-settings-page-column mx-auto pt-title-under-bar"
            : titledWhenNarrow
              ? "ui-settings-page-column mx-auto room-narrow:pt-title-under-bar"
              : "ui-settings-page-column mx-auto"
        }
      >
        {titled ? (
          said(description) ? (
            <div className="ui-settings-page-head mb-ui-24">
              <Text tone={TEXT_TONE.MUTED}>{description}</Text>
            </div>
          ) : null
        ) : (
          <div
            ref={head}
            className={
              titledWhenNarrow
                ? "ui-settings-page-head mb-ui-24 room-narrow:hidden"
                : "ui-settings-page-head mb-ui-24"
            }
          >
            <PageHeader
              title={title}
              titleId={titleId}
              description={description}
              actions={actions}
              end={PAGE_HEADER_END.WORDS}
              look={
                look === SETTINGS_PAGE_LOOK.DIALOG ? PAGE_HEADER_LOOK.DIALOG : PAGE_HEADER_LOOK.PAGE
              }
            />
          </div>
        )}
        <div
          ref={sections}
          className="ui-settings-page-sections flex min-w-0 flex-col gap-page-section-gap"
        >
          <PageScrollContext value={scroll}>{children}</PageScrollContext>
        </div>
      </div>
    </div>
  );
}

/**
 * How a settings page's column stands: a page's, at the page's inset all
 * round under its title in the title's role; or a page in a dialog's card
 * (a settings dialog's section), its top and foot at the card's own inset and
 * its title in the dialog's role, as every dialog names itself, its sides
 * and measure still a page's, so its rows read as Settings' do.
 */
export const SETTINGS_PAGE_LOOK = {
  PAGE: "page",
  DIALOG: "dialog",
} as const;

export type SettingsPageLook = (typeof SETTINGS_PAGE_LOOK)[keyof typeof SETTINGS_PAGE_LOOK];

/** A column of `children`, one section each, under `title` and its `description`, beside them `actions`, or on a phone under a bar ending with them. */
export function SettingsPage({
  title,
  description,
  actions,
  lead,
  look = TOOLBAR_LOOK.WINDOW,
  width = SETTINGS_PAGE_WIDTH.MEASURE,
  titleReplayUnmasked = false,
  children,
}: {
  /** The page's name, its `h1`. */
  title: ReactNode;
  /** Whether a title in words is the app's own, which a screen recording shows as it reads on a phone's bar (`Toolbar`'s `titleReplayUnmasked`); a page named for a workspace stays masked. */
  titleReplayUnmasked?: boolean | undefined;
  /** One quiet line under the title that holds for the whole page: where its settings are kept. */
  description?: ReactNode;
  /** What acts on the whole page, at the end of the title's line, or on a phone at the end of the bar. */
  actions?: ReactNode;
  /** What leads the bar above the page: a way back, where the window gives one. */
  lead?: ReactNode;
  /** How the bar lays its slots: the window's, or a phone's one control a corner. */
  look?: ToolbarLook | undefined;
  /** How wide its column stands, its head and sections alike. */
  width?: SettingsPageWidth | undefined;
  /** The sections, a section's gap apart. */
  children: ReactNode;
}): React.JSX.Element {
  const page = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const named = useHeadingAway(page, head);
  const phone = look === TOOLBAR_LOOK.PHONE;

  return (
    <div className="ui-settings-page-frame flex h-full min-h-0 min-w-0 grow basis-0 flex-col">
      <Toolbar
        lead={lead}
        {...(phone
          ? {
              look,
              place: "settings-page",
              start: TOOLBAR_INSET.COLUMN,
              end: TOOLBAR_INSET.COLUMN,
              title,
              titleReplayUnmasked,
              actions,
            }
          : { pickUp: { name: named.name, shown: named.away } })}
      />
      <SettingsPageColumn
        title={title}
        description={description}
        actions={actions}
        width={width}
        titled={phone}
        scroller={page}
        head={head}
      >
        {children}
      </SettingsPageColumn>
    </div>
  );
}

/** A page of placeholders while `label` is read, drawn by the page itself: a block for its title over sections of `sections`' shapes. */
export function SettingsPageSkeleton({
  label,
  lead,
  look,
  sections,
}: {
  /** What is being read, said to a reader: "Reading Settings". */
  label: string;
  /** What leads the bar above the page, as `SettingsPage` takes it. */
  lead?: ReactNode;
  /** How the bar lays its slots, as `SettingsPage` takes it. */
  look?: ToolbarLook | undefined;
  /** The sections likely to land, each in its shape. */
  sections: readonly SettingsSectionSkeletonLayout[];
}): React.JSX.Element {
  return (
    <SettingsPage title={<Skeleton width={SKELETON_TITLE_WIDTH} />} lead={lead} look={look}>
      <SettingsSectionsSkeleton label={label} sections={sections} />
    </SettingsPage>
  );
}
