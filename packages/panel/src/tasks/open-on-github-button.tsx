import { IconButtonLink, Tooltip } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { appPlatform } from "../app-platform.js";
import { linkPressOf } from "./use-open-link.js";

const OPEN_ON_GITHUB_LABEL = "Open on GitHub";

/**
 * open-on-github-button.tsx -- a glyph-alone press that opens a GitHub page in the browser, where a phone's pull request header, with no toolbar ⋯ to hold Open on GitHub, offers it.
 *
 * It is a real link, so a right-click or long-press offers the address, and a
 * press opens it through the platform's own Open on GitHub act
 * (`appPlatform().openGitHub`), the one the toolbar's ⋯ runs, so a refused
 * address toasts the same and the browser does not follow it a second time.
 */
export function OpenOnGitHubButton({ url }: { url: string }): React.JSX.Element {
  return (
    <Tooltip label={OPEN_ON_GITHUB_LABEL}>
      <IconButtonLink
        icon={<GLYPH.OPEN_ON_GITHUB />}
        label={OPEN_ON_GITHUB_LABEL}
        href={url}
        newTab
        onClick={linkPressOf((href) => appPlatform().openGitHub(href), url)}
      />
    </Tooltip>
  );
}
