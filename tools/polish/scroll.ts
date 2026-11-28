/**
 * scroll.ts -- the page script that moves a scene's scroll box as a reader's wheel would.
 *
 * It lives apart from `polish-shots.ts`, which runs the whole capture the
 * moment it is imported, so a test can hand it to a page of its own.
 */

/**
 * A page expression that scrolls the first element holding the ARIA `role`
 * by `by` pixels, up where negative, and is true where it found one. Note
 * that it moves the box's own scroll rather than turning the wheel over it,
 * because the wheel scrolls whatever stands under the pointer, which may be a
 * card inside the box with a scroll of its own. Note too that it sends the
 * box a wheel event first, because a log lets go of its newest line only
 * for a scroll up the reader's input came just before; any other it reads
 * as the layout's and takes back to its end.
 */
export function scrollScript(role: string, by: number): string {
  return `(() => {
  const box = document.querySelector(${JSON.stringify(`[role="${role}"]`)});
  if (box === null) return false;
  box.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: ${JSON.stringify(by)} }));
  box.scrollTop += ${JSON.stringify(by)};
  return true;
})()`;
}
