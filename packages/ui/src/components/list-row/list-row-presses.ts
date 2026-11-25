/**
 * list-row-presses.ts -- every list row pressed in the window, heard as it happens, for a timing of the press to the paint after it.
 *
 * A row's press is `ListRow`'s main control (`ui-list-row-main`), whatever
 * list draws it: a task's, an agent's, an Inbox thread's. A caller that
 * times a press by the browser's Event Timing learns which presses were a
 * row's here, by the event's time stamp, which the timing's start is. Note
 * that it is heard as it happens, because a press that opens another page
 * may take its row away before the paint the timing is reported with, and
 * the timing's target is gone by then.
 */

/** A row's press, the class `ListRow` gives its main control. */
const ROW_PRESS_SELECTOR = ".ui-list-row-main";

/**
 * Hands `heard` the time stamp of each list row pressed in the window, by a
 * pointer or a key, answering what stops it. It listens in the capture
 * phase and passively, so it hears the press before the row does and
 * changes nothing of it.
 */
export function listenRowPresses(heard: (timeStamp: number) => void): () => void {
  const pressed = (event: Event) => {
    const { target } = event;

    if (!(target instanceof Element) || target.closest(ROW_PRESS_SELECTOR) === null) return;
    heard(event.timeStamp);
  };

  document.addEventListener("click", pressed, { capture: true, passive: true });

  return () => document.removeEventListener("click", pressed, { capture: true });
}
