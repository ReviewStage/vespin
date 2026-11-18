/**
 * settings-row-press.ts -- the fold a settings row opens and closes from a press anywhere on it.
 *
 * A fold's head row (`SettingsFoldRow`, `SettingsRowsFold`) is drawn by its
 * caller, a `MenuRow` or a machine's row, so the fold hands the row its
 * toggle here rather than through every caller's props. The row it reaches
 * hands nothing on, so a row drawn under it, in its `below` or among its
 * controls, never folds it.
 */

import { createContext } from "react";

/** The toggle of the fold whose head row the caller is, or none where it heads none. */
export const SettingsRowFoldPress = createContext<(() => void) | undefined>(undefined);
