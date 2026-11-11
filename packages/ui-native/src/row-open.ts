// row-open.ts -- what opens a row of the list it stands in, handed down from the list to each row's long press menu.

import { createContext } from "react";

/**
 * Opens a row by its id, as its list's `onSelect` does on a tap: what a row
 * whose long press lifts a preview offers as Open, since the preview itself
 * takes no tap. None outside a list that opens its rows.
 */
export const RowOpenContext = createContext<((id: string) => void) | undefined>(undefined);
