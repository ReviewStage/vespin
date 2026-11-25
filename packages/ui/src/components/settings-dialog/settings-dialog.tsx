import { type ReactNode, useId, useLayoutEffect, useRef, useState } from "react";
import { GLYPH } from "../../icons/glyph-registry.js";
import { ForwardIcon } from "../../icons/lucide-glyphs.js";
import { ReplayWords } from "../../session-replay-marks.js";
import { BackButton, NO_BACK_KEY } from "../back-button/back-button.js";
import { IconButton } from "../button/button.js";
import { DIALOG_SIZE, Dialog, type DialogHandle } from "../dialog/dialog.js";
import { GAP, LAYOUT_ELEMENT, Stack } from "../layout/layout.js";
import { NAV_CURRENT, NavItem } from "../nav-item/nav-item.js";
import { useRovingKeys } from "../roving-keys/roving-keys.js";
import { SCROLL_FADE, ScrollArea } from "../scroll-area/scroll-area.js";
import { SETTINGS_PAGE_LOOK, SettingsPageColumn } from "../settings-page/settings-page.js";
import {
  type SettingsSectionSkeletonLayout,
  SettingsSectionsSkeleton,
} from "../settings-section/settings-section.js";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";
import { TOOLBAR_INSET, TOOLBAR_LOOK, Toolbar } from "../toolbar/toolbar.js";

/**
 * settings-dialog.tsx -- the settings of one thing in a dialog: a list of its sections down the card's start, and the section chosen beside it, one page of `SettingsSection`s.
 *
 * A thing whose settings are more than one card holds, a Manager's, opens
 * them in this dialog rather than a page of its own, since they are its and
 * not the window's. It reads exactly as Settings does, drawn by Settings'
 * own parts: down its start, on the sidebar's ground at the sidebar's inset,
 * the list, headed by the dialog's name in a group's role as Settings heads a
 * group of pages, which names the
 * card, with one place for each section (`NavItem`), its glyph and name, the
 * one shown lit and announced as the page, one Tab stop the arrows walk, as
 * Settings' list of pages is; beside it, the section chosen as a settings
 * page's column (`SettingsPageColumn`) in a dialog's look, its top at the
 * card's own inset level with the list's and its name in the dialog's role,
 * as every dialog names itself, at the page's sides and Settings' measure,
 * the card's close at the name's end, over
 * its `SettingsSection`s a page's gap apart, scrolling under its top edge as
 * a page does, an empty state filling the room under the title. The card
 * holds its height as the reader turns from one section to the next, so the
 * list never jumps under the pointer. Each row saves itself, as Settings'
 * rows do, so the card has no answers at its foot: the close, Escape, and a
 * press on the dimmed window put it away.
 *
 * Which section shows is its owner's (`current`, `onChoose`), so a link or a
 * menu item can open the card on the section it names, and the owner draws
 * only the one chosen (`children`), so a section's reads run while it
 * shows.
 *
 * On a phone, or in a room as narrow (`room-narrow`), the card takes the
 * window's room and shows the list or the section, one at a time, as
 * Settings does there, each headed as a phone heads every page (`Toolbar`'s
 * phone look): the list under the card's name centered and its close in the
 * end corner, each place ending in the › of a row that opens a page; a place
 * pressed opens its section in the list's room, under the way back to the
 * list in the start corner, the back glyph alone, hinted "Back to" the card's
 * name, the section's name centered, and the close in the end corner, the
 * section's column then opening on its sections a section's gap under the
 * bar, as a settings page's does under a phone's. The way back hands the
 * keyboard back to the place it opened. Wider, both stand, and what was last
 * chosen on a phone is simply the section shown. The choice between them is
 * drawn, not measured, so the card answers the room as the rest of the
 * dialog does, at no render of its own as the window resizes.
 *
 * While a section's rows are read, the card stands as it will
 * (`SettingsDialogSkeleton`): its list whole, from the sections it is
 * handed, and placeholder sections in the section's place, shaped as the
 * ones that land.
 *
 * It is drawn in Tailwind utilities over the theme on `Dialog`
 * (`DIALOG_SIZE.SECTIONS`), whose card it lays out edge to edge.
 */

/** One section of the dialog: its id, its name in the list and over its page, and its glyph in the list, as every page in Settings' list has one. */
export interface SettingsDialogSection<Id extends string> {
  readonly id: Id;
  readonly title: string;
  readonly icon: ReactNode;
}

/** What a settings dialog is told: its name, its sections and the one shown, and how it is put away. */
export interface SettingsDialogProps<Id extends string> {
  open: boolean;
  /** The dialog's name, which heads its list and names the card. */
  title: string;
  /** Whether the name is a person's words, which a screen recording masks, as a Manager's name is; the sections' names are the app's own. */
  titleReplayMasked?: boolean | undefined;
  /** The sections, in the list's order. */
  sections: readonly SettingsDialogSection<Id>[];
  /** The section shown. */
  current: Id;
  /** Turns to a section. */
  onChoose: (id: Id) => void;
  /** The name of the close at the section's head, which puts the card away. */
  closeLabel?: string | undefined;
  onDismiss: () => void;
  /** Called once the card is gone, as `Dialog` calls it. */
  onExited?: (() => void) | undefined;
  /** The section shown: its `SettingsSection`s. */
  children: ReactNode;
}

/** What a card, its list, and its section are named for where they say nothing else. */
const CLOSE = "Close";

/** Where a phone's bar stands, as its toolbar names its place. */
const PLACE = "settings-dialog";

/** The card's room: on a phone the bar of whichever of the list and the section shows (`data-listed`), over the grid. */
const ROOM = "group/settings-dialog flex min-h-0 min-w-0 flex-1 flex-col";

/** The card's grid: the list's column and the section's, or on a phone one column holding whichever of them shows. */
const GRID =
  "ui-settings-dialog grid min-h-0 min-w-0 flex-1 grid-cols-dialog-sections room-narrow:grid-cols-1";

/**
 * The list's column, on the sidebar's ground at the sidebar's inset, a
 * hairline at its end, its top at the card's own inset, level with the
 * section's title; on a phone
 * the card's whole room while it shows, on the card's own ground under its
 * bar, as Settings' list of pages stands under a phone's.
 */
const LIST =
  "ui-settings-dialog-list flex min-h-0 min-w-0 flex-col gap-tight-gap border-e border-border bg-sidebar px-column-inset pt-dialog-inset pb-column-inset room-narrow:border-e-0 room-narrow:bg-transparent room-narrow:pt-title-under-bar room-narrow:group-data-[listed=false]/settings-dialog:hidden";

/**
 * The room the list scrolls in, reaching past the list's inset by a focus
 * ring's reach, with the list held that far inside it, as Settings' own list
 * of pages is, so the place shown keeps its hairline and shadow whole and a
 * focused place its ring, rather than clipped at the scroller's edge.
 */
const LIST_ROOM = "-m-ring-reach flex min-h-0 flex-1 flex-col";

/** The section's column; on a phone hidden while the list shows. */
const PAGE =
  "ui-settings-dialog-page flex min-h-0 min-w-0 flex-col room-narrow:group-data-[listed=true]/settings-dialog:hidden";

/**
 * The list's label, the card's name, over its places as Settings heads a
 * group of pages (`GroupHeader`): in the group's role, its words where the
 * places' glyphs start, its top level with the section's title; on a phone the list's bar names the
 * card instead.
 */
const LABEL = "flex min-w-0 items-center px-row-inset room-narrow:hidden";

/** A phone's bar over the list, as a phone heads every page (`Toolbar`'s phone look): the card's name centered, its close in the end corner; drawn only while the list shows. */
const LIST_BAR = "hidden room-narrow:group-data-[listed=true]/settings-dialog:block";

/** A phone's bar over a section: the way back to the list in the start corner, the section's name centered, and the close in the end corner; drawn only while the section shows. */
const PAGE_BAR = "hidden room-narrow:group-data-[listed=false]/settings-dialog:block";

/** What a phone alone draws: a place's ›. */
const PHONE_ONLY = "hidden room-narrow:flex";

/**
 * Hands the keyboard on where what held it is hidden as the list or the
 * section takes the card's room on a phone: to the way back to the list as
 * a section opens, in its bar, and to the place it opened from as the list comes back.
 * Note that wider, where both stand, what held it stays drawn and keeps it.
 */
function useHandedFocus(
  listed: boolean,
  list: React.RefObject<HTMLElement | null>,
  bar: React.RefObject<HTMLElement | null>,
): void {
  const last = useRef(listed);

  useLayoutEffect(() => {
    if (last.current === listed) return;
    last.current = listed;
    const held = document.activeElement;

    if (held instanceof HTMLElement && held.getClientRects().length > 0) return;

    const to = listed
      ? list.current?.querySelector<HTMLElement>("[aria-current]")
      : bar.current?.querySelector<HTMLElement>("button");

    to?.focus();
  }, [listed, list, bar]);
}

/** The settings of one thing: its sections listed down the card's start, and the one chosen beside them; on a phone, one at a time. */
export function SettingsDialog<Id extends string>({
  open,
  title,
  titleReplayMasked = false,
  sections,
  current,
  onChoose,
  closeLabel = CLOSE,
  onDismiss,
  onExited,
  children,
}: SettingsDialogProps<Id>): React.JSX.Element {
  const dialog = useRef<DialogHandle>(null);
  const list = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const pageTitleId = useId();
  // Whether a phone shows the list rather than the section; wider, both stand whatever it says.
  const [listed, setListed] = useState(true);
  const roving = useRovingKeys<HTMLDivElement>();
  useHandedFocus(listed, list, bar);
  const shown = sections.find((section) => section.id === current);

  const close = (
    <IconButton
      icon={<GLYPH.CLOSE />}
      label={closeLabel}
      onClick={() => dialog.current?.dismiss()}
    />
  );

  return (
    <Dialog
      ref={dialog}
      open={open}
      size={DIALOG_SIZE.SECTIONS}
      labelledBy={titleId}
      replayUnmasked
      onDismiss={onDismiss}
      onExited={onExited}
    >
      <div className={ROOM} data-listed={listed}>
        <div className={LIST_BAR}>
          <Toolbar
            look={TOOLBAR_LOOK.PHONE}
            place={PLACE}
            start={TOOLBAR_INSET.COLUMN}
            end={TOOLBAR_INSET.COLUMN}
            title={<ReplayWords masked={titleReplayMasked}>{title}</ReplayWords>}
            titleReplayUnmasked={!titleReplayMasked}
            actions={close}
          />
        </div>
        <div ref={bar} className={PAGE_BAR}>
          <Toolbar
            look={TOOLBAR_LOOK.PHONE}
            place={PLACE}
            start={TOOLBAR_INSET.COLUMN}
            end={TOOLBAR_INSET.COLUMN}
            lead={
              // Note that the way back names the card, so it is masked as the card's name is.
              <ReplayWords masked={titleReplayMasked}>
                <BackButton
                  label={title}
                  place={title}
                  command={NO_BACK_KEY}
                  onBack={() => setListed(true)}
                />
              </ReplayWords>
            }
            title={shown?.title ?? ""}
            titleReplayUnmasked
            actions={close}
          />
        </div>
        <div className={GRID}>
          <div ref={list} className={LIST}>
            <div className={LABEL}>
              <Text
                variant={TEXT_VARIANT.GROUP}
                as={TEXT_ELEMENT.H2}
                id={titleId}
                truncate
                className="flex-1"
              >
                <ReplayWords masked={titleReplayMasked}>{title}</ReplayWords>
              </Text>
            </div>
            <div className={LIST_ROOM}>
              <ScrollArea fade={SCROLL_FADE.BOTH}>
                <div {...roving} className="p-ring-reach">
                  <Stack as={LAYOUT_ELEMENT.UL} gap={GAP.ROW} aria-labelledby={titleId}>
                    {sections.map((section) => (
                      <li key={section.id}>
                        <NavItem
                          icon={section.icon}
                          current={section.id === current ? NAV_CURRENT.PAGE : undefined}
                          roving
                          mark={
                            <span className={PHONE_ONLY}>
                              <ForwardIcon />
                            </span>
                          }
                          onClick={() => {
                            onChoose(section.id);
                            setListed(false);
                          }}
                        >
                          {section.title}
                        </NavItem>
                      </li>
                    ))}
                  </Stack>
                </div>
              </ScrollArea>
            </div>
          </div>
          <section className={PAGE} aria-labelledby={pageTitleId}>
            <SettingsPageColumn
              title={shown?.title ?? ""}
              titleId={pageTitleId}
              actions={close}
              titledWhenNarrow
              look={SETTINGS_PAGE_LOOK.DIALOG}
            >
              {children}
            </SettingsPageColumn>
          </section>
        </div>
      </div>
    </Dialog>
  );
}

/** The dialog while its section's rows are read, drawn by the dialog itself: its list whole, and placeholder sections of `layouts`' shapes in the section's place. */
export function SettingsDialogSkeleton<Id extends string>({
  label,
  layouts,
  ...dialog
}: Omit<SettingsDialogProps<Id>, "children"> & {
  /** What is being read, said to a reader: "Reading the people". */
  label: string;
  /** The sections likely to land in the section shown, each in its shape, from what its sections are drawn from. */
  layouts: readonly SettingsSectionSkeletonLayout[];
}): React.JSX.Element {
  return (
    <SettingsDialog {...dialog}>
      <SettingsSectionsSkeleton label={label} sections={layouts} />
    </SettingsDialog>
  );
}
