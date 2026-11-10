/**
 * permission-mode-prototype.ts -- the development-only `&mode-ui=a|b|c` switch between the permission mode control's mockups, and the fixture's `&perm=` mode.
 *
 * A prototype for choosing among three redesigns of the composer's mode
 * control, drawn over a fixture run (`?fixture=<profile>`):
 *
 * - `a`, the modes in the model chip's menu, the chip wearing the mode's
 *   glyph only off Full access;
 * - `b`, an icon-only chip beside the + only off Full access, the modes in
 *   the + menu always;
 * - `c`, an icon-only chip always beside the +, in the warning ink on Full
 *   access.
 *
 * With no switch the composer draws v1's labeled chip. Note that the gate is
 * Vite's own `DEV`, so a production build never
 * reads the address.
 */

import {
  AGENT_PERMISSION_MODE,
  type AgentPermissionMode,
} from "@repo/features/agent-approval-wire";

/** Which mockup the composer draws. */
export const PERMISSION_UI = {
  CURRENT: "current",
  MODEL_MENU: "a",
  WHEN_SET: "b",
  ICON: "c",
} as const;

export type PermissionUi = (typeof PERMISSION_UI)[keyof typeof PERMISSION_UI];

/** The query parameters the switch reads. */
const PARAMETER = {
  UI: "mode-ui",
  MODE: "perm",
} as const;

/** Whether this is a development build, as Vite says. */
function development(): boolean {
  return (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
}

/**
 * The address's parameters as the tab opened on them, in a development
 * build alone. Note that they are read once, as the module loads, because
 * the panel's router moves the address to its place at launch and drops them.
 */
const OPENED_ON =
  development() && typeof window !== "undefined"
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();

/** The parameter the tab opened on; none where it named none. */
function parameter(name: string): string | null {
  return OPENED_ON.get(name);
}

/** The mockup the address names; v1's chip where it names none. */
export function permissionUi(): PermissionUi {
  const named = parameter(PARAMETER.UI);
  return Object.values(PERMISSION_UI).find((each) => each === named) ?? PERMISSION_UI.CURRENT;
}

/** The mode the fixture's agent stands on, as the address names it; none where it names none. */
export function fixturePermissionMode(): AgentPermissionMode | undefined {
  const named = parameter(PARAMETER.MODE);
  return Object.values(AGENT_PERMISSION_MODE).find((each) => each === named);
}

/** Whether Settings draws the mocked default permissions row: under any mockup. */
export function mocksSettingsRow(): boolean {
  return permissionUi() !== PERMISSION_UI.CURRENT;
}

/** The mode a new agent starts in, as the mocked row offers it. */
export const DEFAULT_NEW_AGENT_MODE: AgentPermissionMode = AGENT_PERMISSION_MODE.FULL_ACCESS;
