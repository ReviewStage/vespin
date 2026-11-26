import { type ReactNode, type RefObject, useRef, useState } from "react";
import { SmilePlusIcon } from "../../icons/icons.js";
import type { EmojiGroup } from "../../section-icon-model.js";
import { ReplayUnmask } from "../../session-replay-marks.js";
import { BUTTON_SIZE } from "../button/button.js";
import { IconPicker } from "../icon-picker/icon-picker.js";
import { IconPickerEmoji } from "../icon-picker/icon-picker-emoji.js";
import { PopoverIconButton } from "../popover-icon-button/popover-icon-button.js";

/**
 * reaction-picker.tsx -- where a reaction is picked from every emoji: the app's one icon picker (`IconPicker`) over its emoji (`IconPickerEmoji`), hung from a message's Add reaction or beside a menu's item.
 *
 * The picker lists every emoji under its category, as a section's Emoji
 * tab does, and a search finds them by name, an emoji typed or pasted into
 * it first; Enter picks the first found. The emoji are its owner's to
 * read, as the icon picker's are (`useEmojiGroups`), so a window reads them
 * only where a picker stands open. A pick hands the emoji on, which its
 * owner gives as a reaction or takes back where the reader gave it, and
 * puts the picker away.
 *
 * It stands as a message's action (`ReactionPickerButton`), a smile-plus
 * beside the reactions offered first, and beside a menu's item on the
 * menu's surface (`ReactionPickerMenuPanel`), as a message's Add reaction ›
 * opens it; each draws the picker its owner hands it (`picker`), once it
 * stands open.
 */

/** What the press that opens the picker, and the picker, are called. */
const ADD_REACTION = "Add reaction";

/** What the search asks for. */
const SEARCH_EMOJI = "Search emoji";

/** What the grid is called for a reader. */
const EMOJI = "Emoji";

/** The picker as a menu's panel: on the menu's surface, which the panel beside a menu's item leaves to what it holds. */
const MENU_PANEL =
  "ui-reaction-picker-menu-panel w-fit rounded-menu border border-border-strong bg-popover text-popover-foreground shadow-menu animate-menu-in";

/** Where a picker stands: the search a popover focuses first, and the press a pick goes to. */
export interface ReactionPickerPlace {
  /** The search's field, which a popover opening the picker focuses first. */
  readonly search?: RefObject<HTMLInputElement | null> | undefined;
  readonly onEmoji: (emoji: string) => void;
}

/** The picker; see the module's head. A pick hands the emoji to `onEmoji`. */
export function ReactionPicker({
  groups,
  failed,
  search,
  onEmoji,
}: ReactionPickerPlace & {
  /** Every emoji by category; none while they load or where they failed to. */
  groups: readonly EmojiGroup[] | undefined;
  /** Whether the emoji could not be loaded. */
  failed: boolean;
}): React.JSX.Element {
  const [query, setQuery] = useState("");

  return (
    <ReplayUnmask>
      <IconPicker
        searchLabel={SEARCH_EMOJI}
        search={search}
        query={query}
        onQuery={setQuery}
        legend={EMOJI}
      >
        <IconPickerEmoji
          groups={groups}
          failed={failed}
          query={query}
          chosen={undefined}
          onEmoji={onEmoji}
        />
      </IconPicker>
    </ReplayUnmask>
  );
}

/**
 * A message's Add reaction: a compact smile-plus among its actions, hanging
 * the picker while `open`, whose owner may open it from elsewhere too, as
 * the message's menu does. A pick hands the emoji on and puts the picker
 * away.
 */
export function ReactionPickerButton({
  open,
  onOpenChange,
  onEmoji,
  picker,
}: {
  open: boolean;
  /** Hears the picker stand or go. */
  onOpenChange: (open: boolean) => void;
  onEmoji: (emoji: string) => void;
  /** The picker where it stands (`ReactionPicker`), its emoji read by its owner. */
  picker: (place: ReactionPickerPlace) => ReactNode;
}): React.JSX.Element {
  const search = useRef<HTMLInputElement | null>(null);

  return (
    <PopoverIconButton
      icon={<SmilePlusIcon aria-hidden="true" />}
      label={ADD_REACTION}
      title={ADD_REACTION}
      hint={ADD_REACTION}
      open={open}
      onOpenChange={(next) => onOpenChange(next)}
      size={BUTTON_SIZE.COMPACT}
      initialFocus={search}
    >
      {picker({
        search,
        onEmoji: (emoji) => {
          onEmoji(emoji);
          onOpenChange(false);
        },
      })}
    </PopoverIconButton>
  );
}

/** The picker as a menu's panel beside its item (`MenuPanel`'s `panel`), on the menu's surface, as a message's Add reaction › opens it: a pick hands the emoji on, and its owner closes the menu. */
export function ReactionPickerMenuPanel({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className={MENU_PANEL}>{children}</div>;
}
