// row-open.ts -- what opens a row of the list it stands in, handed down from the list to each row's long press menu, and which of its rows stands selected.

import { createContext } from "react";

/**
 * Opens a row by its id, as its list's `onSelect` does on a tap: what a row
 * whose long press lifts a preview offers as Open, since the preview itself
 * takes no tap. None outside a list that opens its rows.
 */
export const RowOpenContext = createContext<((id: string) => void) | undefined>(undefined);

/**
 * The id of the row its list stands selected, such as the thread open in a
 * split view's detail, so the row draws the selection's fill itself, since
 * every row clears the system's ground for the list's own. None where the
 * list keeps no selection.
 */
export const RowSelectedContext = createContext<string | undefined>(undefined);

/**
 * The words a search typed, read into the words each row's title marks in
 * bold where they stand in it, as ⌘K marks in each row what found it and
 * Mail's search results set the words searched in bold. None outside a
 * list of what a search found.
 */
export const RowSearchedContext = createContext<readonly string[]>([]);
