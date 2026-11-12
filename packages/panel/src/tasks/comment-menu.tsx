import { BUTTON_SIZE, MoreButton, moreLabel, useMenu } from "@repo/ui";
import type { ReactNode } from "react";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";

/**
 * comment-menu.tsx -- a comment's ⋯ and the menu it drops, its writer's acts on it, as every comment draws them: a description's, a page's, and a pull request's, posted or pending.
 *
 * Every comment's tools, its ⋯ and a thread's Resolve beside it, stand in
 * one place (`CommentTools`), shown under the pointer or the keyboard and at
 * rest on a screen with no hover, so no comment wears its ⋯ always while
 * another wears it only on hover.
 */

/** What the ⋯ and its menu are named for. */
const THING = "Comment";

/** A comment's ⋯ and its menu; nothing where it offers no act, rather than a ⋯ opening an empty menu. */
export function CommentMenu({
  groups,
}: {
  groups: readonly MenuAction[][];
}): React.JSX.Element | null {
  const menu = useMenu(true);
  const trigger = menu.trigger();

  if (groups.length === 0) return null;

  return (
    <>
      <MoreButton thing={THING} size={BUTTON_SIZE.COMPACT} {...trigger} />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          replayUnmasked
          label={moreLabel(THING)}
          menu={menu.drawn}
          groups={groups}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** A comment's tools at its head's end, its ⋯ and a thread's Resolve, shown under the pointer over the comment or its card, under the keyboard, or while its menu is open. */
export function CommentTools({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className="comment-tools items-center">{children}</span>;
}
