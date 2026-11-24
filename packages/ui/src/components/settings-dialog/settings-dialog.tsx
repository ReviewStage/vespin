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
import {
  type SettingsSectionSkeletonLayout,
  SettingsSectionsSkeleton,
} from "../settings-section/settings-section.js";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * settings-dialog.tsx -- the settings of one thing in a dialog: a list of its sections down the card's start, and the section chosen beside it, one page of `SettingsSection`s.
 *
 * A thing whose settings are more than one card holds, a Manager's, opens
 * them in this dialog rather than a page of its own, since they are its and
 * not the window's. Its section stands at Settings' own measure, so its rows
 * read as Settings' do, and the card at a height it holds as the reader turns
 * from one section to the next, so the list never jumps under the pointer. Down its start stands the list, on the sidebar's
 * ground, headed by the dialog's name, which names the card: one place for
 * each section (`NavItem`), the one shown lit and announced as the page,
 * one Tab stop the arrows walk, as Settings' own list of pages is. Beside it
 * stands the section chosen, headed by its name with the card's close at its
 * end, over the section's own `SettingsSection`s a page's section gap
 * apart, which scroll under the head and fade into it. Each row saves
 * itself, as Settings' rows do, so the card has no answers at its foot:
 * the close, Escape, and a press on the dimmed window put it away.
 *
 * Which section shows is its owner's (`current`, `onChoose`), so a link or a
 * menu item can open the card on the section it names, and the owner draws
 * only the one chosen (`children`), so a section's reads run while it
 * shows.
 *
 * On a phone, or in a room as narrow (`room-narrow`), the card takes the
 * window's room and shows the list or the section, one at a time, as
 * Settings does there: the list first, each place ending in the › of a row
 * that opens a page, its close at the head's end; a place pressed opens its
 * section in the list's room, headed by the way back to the list, which
 * hands the keyboard back to the place it opened. Wider, both stand, and
 * what was last chosen on a phone is simply the section shown. The choice
 * between them is drawn, not measured, so the card answers the room as the
 * rest of the dialog does, at no render of its own as the window resizes.
 *
 * While a section's rows are read, the card stands as it will
 * (`SettingsDialogSkeleton`): its list whole, from the sections it is
 * handed, and placeholder sections in the section's place, shaped as the
 * ones that land.
 *
 * It is drawn in Tailwind utilities over the theme on `Dialog`
 * (`DIALOG_SIZE.SECTIONS`), whose card it lays out edge to edge.
 */

/** One section of the dialog: its id, its name in the list and over its page, and its glyph in the list. */
export interface SettingsDialogSection<Id extends string> {
  readonly id: Id;
  readonly title: string;
  readonly icon?: ReactNode;
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

/**
 * The card's grid: the list's column and the section's, or on a phone one
 * column holding whichever of them shows (`data-listed`).
 */
const GRID =
  "ui-settings-dialog group/settings-dialog grid min-h-0 min-w-0 flex-1 grid-cols-dialog-sections room-narrow:grid-cols-1";

/** The list's column, on the sidebar's ground, a hairline at its end; on a phone the card's whole room while it shows. */
const LIST =
  "ui-settings-dialog-list flex min-h-0 min-w-0 flex-col gap-block-gap border-e border-border bg-sidebar p-dialog-inset pe-ui-12 room-narrow:border-e-0 room-narrow:pe-dialog-inset room-narrow:group-data-[listed=false]/settings-dialog:hidden";

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

/** A head's row: its words, and what stands at their start or end, one control's height so a head with no control stands as tall as one with. */
const HEAD = "flex min-h-control min-w-0 items-center gap-control-gap";

/** The section's head: its name and the card's close; on a phone, the way back and the close over the name, on a line of its own, as a phone heads a page under its bar. */
const PAGE_HEAD = `${HEAD} px-dialog-inset pt-dialog-inset pb-block-gap room-narrow:flex-wrap room-narrow:gap-y-block-gap`;

/** What a phone alone draws: the way back to the list, the list's close, and a place's ›. */
const PHONE_ONLY = "hidden room-narrow:flex";

/**
 * Hands the keyboard on where what held it is hidden as the list or the
 * section takes the card's room on a phone: to the way back to the list as
 * a section opens, and to the place it opened from as the list comes back.
 * Note that wider, where both stand, what held it stays drawn and keeps it.
 */
function useHandedFocus(
  listed: boolean,
  list: React.RefObject<HTMLElement | null>,
  page: React.RefObject<HTMLElement | null>,
): void {
  const last = useRef(listed);

  useLayoutEffect(() => {
    if (last.current === listed) return;
    last.current = listed;
    const held = document.activeElement;

    if (held instanceof HTMLElement && held.getClientRects().length > 0) return;

    const to = listed
      ? list.current?.querySelector<HTMLElement>("[aria-current]")
      : page.current?.querySelector<HTMLElement>("button");

    to?.focus();
  }, [listed, list, page]);
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
  const page = useRef<HTMLElement>(null);
  const titleId = useId();
  const pageTitleId = useId();
  // Whether a phone shows the list rather than the section; wider, both stand whatever it says.
  const [listed, setListed] = useState(true);
  const roving = useRovingKeys<HTMLDivElement>();
  useHandedFocus(listed, list, page);
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
      <div className={GRID} data-listed={listed}>
        <div ref={list} className={LIST}>
          <div className={HEAD}>
            <Text
              variant={TEXT_VARIANT.DIALOG}
              as={TEXT_ELEMENT.H2}
              id={titleId}
              truncate
              className="flex-1"
            >
              <ReplayWords masked={titleReplayMasked}>{title}</ReplayWords>
            </Text>
            <span className={PHONE_ONLY}>{close}</span>
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
        <section ref={page} className={PAGE} aria-labelledby={pageTitleId}>
          <div className={PAGE_HEAD}>
            <span className={PHONE_ONLY}>
              <BackButton
                label={title}
                place={title}
                command={NO_BACK_KEY}
                onBack={() => setListed(true)}
              />
            </span>
            <Text
              variant={TEXT_VARIANT.DIALOG}
              as={TEXT_ELEMENT.H2}
              id={pageTitleId}
              truncate
              className="flex-1 room-narrow:order-last room-narrow:basis-full"
            >
              {shown?.title ?? ""}
            </Text>
            <span className="ms-auto flex">{close}</span>
          </div>
          <ScrollArea fade={SCROLL_FADE.BOTH}>
            <div className="ui-settings-dialog-sections flex min-w-0 flex-col gap-page-section-gap px-dialog-inset pb-dialog-inset">
              {children}
            </div>
          </ScrollArea>
        </section>
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
