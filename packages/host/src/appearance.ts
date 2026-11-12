import { APP_SETTING_SCHEMA, type Theme } from "@repo/settings";
import { Context, Effect } from "effect";

/**
 * The slice of Electron's `nativeTheme` this process steers: the override it
 * sets, the appearance that override resolves to, and the event saying the
 * resolution moved. A service rather than an import because it is this
 * process's one door to the Mac's appearance, so a test stands a Layer of its
 * own on it; `nativeTheme` itself satisfies it, and the window service hands
 * that in.
 */
export interface NativeThemeSurface {
  themeSource: Theme;
  readonly shouldUseDarkColors: boolean;
  on(event: "updated", listener: () => void): void;
  removeListener(event: "updated", listener: () => void): void;
}

export class NativeTheme extends Context.Service<NativeTheme, NativeThemeSurface>()(
  "@repo/desktop/NativeTheme",
) {}

/**
 * Steers the whole app to a stored theme preference. `themeSource` is what
 * the renderers' `prefers-color-scheme`, the native window chrome, and the
 * menus all follow, so this one assignment is the theme everywhere, and it
 * neither reloads nor remounts a window. An absent preference is the schema's
 * default. Note that an override already standing is not assigned again,
 * because every published document passes through here and each assignment
 * is a round trip through AppKit that emits `updated`.
 */
export const applyThemePreference = /* @__PURE__ */ Effect.fn("desktop/applyThemePreference")(
  function* (preference: Theme | undefined) {
    const theme = yield* NativeTheme;
    const wanted = preference ?? APP_SETTING_SCHEMA.theme.default;

    if (theme.themeSource !== wanted) theme.themeSource = wanted;
  },
);

/*
 * Which native material the panel window is drawn on: macOS 26's Liquid
 * Glass where the Mac has it, the sidebar's vibrancy before. Liquid Glass is
 * laid behind the page once it has loaded (the desktop's
 * `native/liquid-glass.ts`), and needs the window transparent and free of
 * Electron's own vibrancy, which would cover it. A Mac before 26 has no
 * glass, so the window keeps the sidebar material, which follows the
 * window's appearance and Reduce transparency by itself.
 */

/** The first macOS release that draws Liquid Glass (Tahoe). */
const LIQUID_GLASS_SINCE = 26;

export const WINDOW_MATERIAL = {
  LIQUID_GLASS: "liquid-glass",
  SIDEBAR: "sidebar",
} as const;

export type WindowMaterial = (typeof WINDOW_MATERIAL)[keyof typeof WINDOW_MATERIAL];

/** The material a Mac at `systemVersion` (`process.getSystemVersion()`, such as "26.1") draws the window on. */
export function windowMaterialFor(systemVersion: string): WindowMaterial {
  const major = Number.parseInt(systemVersion.split(".")[0] ?? "", 10);

  return Number.isFinite(major) && major >= LIQUID_GLASS_SINCE
    ? WINDOW_MATERIAL.LIQUID_GLASS
    : WINDOW_MATERIAL.SIDEBAR;
}
