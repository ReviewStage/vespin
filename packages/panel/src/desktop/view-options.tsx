import { TASKS_VIEW_WORDS } from "@repo/features/tasks-page-model";
import { IconButton, Tooltip, useMenu } from "@repo/ui";
import { RotateCcwIcon, SlidersHorizontalIcon } from "@repo/ui/icons";
import { ActionMenu, type MenuAction, type MenuEntry } from "./action-menu.js";
import { type MenuAsk, useAskedMenu } from "./phone-head.js";

/**
 * view-options.tsx -- a page's View options: the sliders at its toolbar's end and the menu they drop, how the page lays out what it lists.
 *
 * The Tasks page and the Automations list each say what their menu offers,
 * and this draws it the one way: the sliders' button under its tooltip, or,
 * on a phone, no button, the menu drawn under the head's ⋯ each time it
 * asks (`phone-head.tsx`); the choices kept on this Mac are the page's own
 * (`use-kept.ts`). Reset view ends a menu, put back to the view the page
 * started as, and lies still while the view is that one.
 */

/** What the button is called, on its tooltip and its menu alike. */
export const VIEW_OPTIONS = "View options";

/** Reset view, still while the view is the one the page started as. */
export function resetViewAction(initial: boolean, onReset: () => void): MenuAction {
  return {
    label: TASKS_VIEW_WORDS.RESET_VIEW,
    icon: <RotateCcwIcon />,
    disabled: initial,
    onSelect: onReset,
  };
}

/** The toolbar's View options: its button and the menu it drops, its groups read as the menu is drawn. */
export function ViewOptions({
  shown,
  groups,
  asked,
}: {
  /** Whether the page is on screen, for the menu not to outlive it. */
  shown: boolean;
  groups: () => MenuEntry[][];
  /** Where a phone's ⋯ stands for the button, the menu drawn under the ⋯ each time it asks; none elsewhere. */
  asked?: { readonly ask: MenuAsk | undefined } | undefined;
}): React.JSX.Element {
  const menu = useMenu(shown);
  useAskedMenu(menu.show, asked?.ask);

  return (
    <>
      {asked === undefined ? (
        <span className="view-options relative inline-flex">
          <Tooltip label={VIEW_OPTIONS}>
            <IconButton icon={<SlidersHorizontalIcon />} label={VIEW_OPTIONS} {...menu.trigger()} />
          </Tooltip>
        </span>
      ) : null}
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={VIEW_OPTIONS}
          menu={menu.drawn}
          replayUnmasked
          groups={groups()}
          onClose={menu.close}
        />
      )}
    </>
  );
}
